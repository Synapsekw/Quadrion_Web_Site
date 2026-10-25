import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgress} from '../portal/src/progress.mjs';
import {createPortalApi} from '../portal/src/api.mjs';
import {busy} from '../portal/src/ui.mjs';

// A hand-driven clock: schedule() queues, run() fires what is due.
function clock(){
  let now=0,id=0;const timers=new Map();
  return {schedule:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},cancel:t=>timers.delete(t),
    advance(ms){now+=ms;for(const [k,t] of [...timers])if(t.at<=now){timers.delete(k);t.fn();}}};
}
function bar(){const c=clock(),log=[];const p=createProgress({delay:150,schedule:c.schedule,cancel:c.cancel,show:()=>log.push('show'),hide:()=>log.push('hide')});return {p,c,log};}

test('a request quicker than 150 ms never shows the bar',()=>{
  const {p,c,log}=bar();const done=p.track();c.advance(100);done();c.advance(500);
  assert.deepEqual(log,[]);
});

test('a slow request shows the bar after 150 ms and hides it when it ends',()=>{
  const {p,c,log}=bar();const done=p.track();c.advance(149);assert.deepEqual(log,[]);
  c.advance(1);assert.deepEqual(log,['show']);done();assert.deepEqual(log,['show','hide']);
});

test('overlapping requests keep one bar until the last ends; done twice counts once',()=>{
  const {p,c,log}=bar();const a=p.track();c.advance(200);const b=p.track();
  a();a();assert.equal(p.pending,1);assert.deepEqual(log,['show']);
  b();assert.deepEqual(log,['show','hide']);assert.equal(p.pending,0);
});

test('the portal API reports each request start and end to track, also on failure',async()=>{
  const events=[];const track=()=>{events.push('start');return ()=>events.push('end');};
  const ok=createPortalApi({getToken:async()=>'t',track,fetcher:async()=>new Response('{"items":[]}')});
  await ok.get('projects');
  const failing=createPortalApi({getToken:async()=>'t',track,fetcher:async()=>{throw new Error('network');}});
  await assert.rejects(failing.get('projects'));
  assert.deepEqual(events,['start','end','start','end']);
});

test('busy() disables, labels and marks a button, then restores its own content',()=>{
  const attrs={},kids=['Save'];
  const node={disabled:false,childNodes:kids,setAttribute:(k,v)=>{attrs[k]=v;},removeAttribute:k=>{delete attrs[k];},
    set textContent(v){this.childNodes=[v];},replaceChildren(...k){this.childNodes=k;}};
  const done=busy(node,'Saving…');
  assert.equal(node.disabled,true);assert.equal(attrs['aria-busy'],'true');assert.deepEqual(node.childNodes,['Saving…']);
  done();done();
  assert.equal(node.disabled,false);assert.equal(attrs['aria-busy'],undefined);assert.deepEqual(node.childNodes,['Save']);
});
