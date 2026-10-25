import test from 'node:test';
import assert from 'node:assert/strict';
import {createCache,sessionSeed} from '../portal/src/cache.mjs';

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('me is fetched once and later navigations answer from memory',async()=>{
  let loads=0;const cache=createCache(async()=>({member:{role:'owner',n:++loads}}));
  const [a,b]=await Promise.all([cache.get(),cache.get()]);
  assert.equal(loads,1,'two callers during the first load share one request');
  assert.equal(a,b);
  for(let i=0;i<5;i++)await cache.get();
  assert.equal(loads,1);
});

test('a stale value answers at once and refreshes once in the background',async()=>{
  let clock=0,loads=0;const changes=[];
  const cache=createCache(async()=>++loads,{maxAge:1000,now:()=>clock,onChange:v=>changes.push(v)});
  assert.equal(await cache.get(),1);
  clock=5000;
  assert.equal(await cache.get(),1,'the stale value is used without waiting');
  await cache.get();
  await settle();
  assert.equal(loads,2,'only one background refresh');
  assert.equal(cache.peek(),2);
  assert.deepEqual(changes,[1,2]);
});

test('a failed background refresh keeps the old value; the first load failing rejects',async()=>{
  let fail=false;const cache=createCache(async()=>{if(fail)throw new Error('down');return 'ok';});
  assert.equal(await cache.get(),'ok');
  fail=true;await cache.revalidate();
  assert.equal(cache.peek(),'ok');
  const broken=createCache(async()=>{throw new Error('down');});
  await assert.rejects(broken.get(),/down/);
  await assert.rejects(broken.get(),/down/,'a failed first load is retried, not remembered');
});

test('clear forgets the value and an answer that arrives after clear is dropped',async()=>{
  let release;const cache=createCache(()=>new Promise(resolve=>{release=resolve;}));
  const pending=cache.get();cache.clear();release('old user');await pending;
  assert.equal(cache.peek(),undefined);
});

test('set keeps a known answer without a request',async()=>{
  let loads=0;const cache=createCache(async()=>++loads);
  cache.set(9);assert.equal(await cache.get(),9);assert.equal(loads,0);
});

test('a session seed draws the shell on reload, then refreshes; storage failures are harmless',async()=>{
  const store=new Map();const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  const first=createCache(async()=>({member:{role:'owner'}}),{seed:sessionSeed('quadrion-me',storage)});
  await first.get();
  let loads=0;
  const second=createCache(async()=>{loads++;return {member:{role:'admin'}};},{seed:sessionSeed('quadrion-me',storage)});
  assert.deepEqual(await second.get(),{member:{role:'owner'}},'the seeded value answers first');
  await settle();
  assert.equal(loads,1,'and is refreshed straight away');
  assert.deepEqual(second.peek(),{member:{role:'admin'}});
  second.clear();
  assert.equal(createCache(async()=>1,{seed:sessionSeed('quadrion-me',storage)}).peek(),undefined,'clear drops the seed');
  const throwing={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const guarded=createCache(async()=>'fresh',{seed:sessionSeed('k',throwing)});
  assert.equal(await guarded.get(),'fresh');
});
