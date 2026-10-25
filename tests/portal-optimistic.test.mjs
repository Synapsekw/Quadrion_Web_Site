import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Node??=class{};
const {optimisticSave}=await import('../portal/src/tests.mjs');

function line(initial){
  let value=initial;const painted=[];const replies=[];
  const save=optimisticSave({read:()=>value,write:a=>{value=a;},paint:()=>painted.push(value?.status??null),
    send:()=>new Promise(resolve=>replies.push(resolve))});
  return {save,painted,replies,get value(){return value;}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('a tick shows as saved before the server answers, then keeps the confirmed answer',async()=>{
  const l=line(null);
  const done=l.save({status:'pass'},{status:'pass'});
  assert.equal(l.value.status,'pass','shown at once');
  await tick();
  l.replies[0]({ok:true,answer:{lineId:'a',status:'pass',comment:'',build:'0.26.0'},itemId:null});
  const result=await done;
  assert.equal(result.ok,true);
  assert.deepEqual(l.value,{lineId:'a',status:'pass',comment:'',build:'0.26.0',itemId:null});
});

test('a failed save rolls the line back to the last confirmed answer',async()=>{
  const l=line({status:'skip'});
  const done=l.save({status:'pass'},{status:'pass'});
  assert.equal(l.value.status,'pass');
  await tick();l.replies[0]({ok:false,message:'Check your connection, then try again.'});
  const result=await done;
  assert.equal(result.ok,false);assert.equal(result.superseded,undefined);
  assert.deepEqual(l.value,{status:'skip'});
  assert.deepEqual(l.painted,['pass','skip']);
});

test('a thrown error rolls back too',async()=>{
  const save=optimisticSave({read:()=>null,write:a=>{v=a;},paint(){},send:async()=>{throw new Error('down');}});let v;
  const result=await save({status:'pass'},{});
  assert.equal(result.ok,false);assert.equal(v,null);
});

test('quick clicks save in order and only the newest decides what is shown',async()=>{
  const l=line(null);
  const first=l.save({status:'pass'},{status:'pass'});
  const second=l.save(null,{status:null});
  assert.equal(l.value,null,'the second click shows at once');
  await tick();
  assert.equal(l.replies.length,1,'the second save waits for the first');
  l.replies[0]({ok:false,message:'Down'});
  const r1=await first;
  assert.equal(r1.superseded,true,'an older failure is not shown');
  assert.equal(l.value,null);
  await tick();
  l.replies[1]({ok:true,answer:null,itemId:null});
  await second;
  assert.equal(l.value,null);
});
