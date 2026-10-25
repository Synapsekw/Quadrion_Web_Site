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

const {saverFor,forgetSavers,defersCommit}=await import('../portal/src/tests.mjs');

test('a step change mid-save keeps one queue per line and the failure shows on the row now on screen',async()=>{
  forgetSavers();
  let answer=null;const sends=[];const problems=[];
  const view=name=>({read:()=>answer,write:a=>{answer=a;},paint(){},send:request=>new Promise(resolve=>sends.push({request,resolve})),problem:r=>problems.push([name,r.message])});
  const first=saverFor('line-1',view('old row'));
  const pending=first.save({status:'pass'},{status:'pass'});
  // The tester moves to another step and back: the row is drawn again.
  const again=saverFor('line-1',view('new row'));
  assert.equal(again,first,'the same queue');
  const second=again.save(null,{status:null});
  await tick();
  assert.equal(sends.length,1,'the second save waits behind the first, even from the new row');
  sends[0].resolve({ok:true,answer:{status:'pass'},itemId:null});
  await pending;await tick();
  sends[1].resolve({ok:false,message:'Down'});
  const result=await second;
  // What the row's save() does with a failure: report it through the row now on screen.
  if(!result.ok&&!result.superseded)again.view.problem(result);
  assert.deepEqual(problems,[['new row','Down']]);
  assert.deepEqual(answer,{status:'pass',itemId:null},'rolled back to the confirmed pass');
});

test('a fresh page load resyncs the confirmed answer when nothing is in flight',async()=>{
  forgetSavers();
  let answer={status:'skip'};
  const view={read:()=>answer,write:a=>{answer=a;},paint(){},send:async()=>({ok:false,message:'Down'}),problem(){}};
  saverFor('line-2',view);
  answer={status:'pass'};// the server's answers after a reload
  const entry=saverFor('line-2',view);
  await entry.save(null,{status:null});
  assert.deepEqual(answer,{status:'pass'},'a failure rolls back to the reloaded answer, not the old one');
});

test('leaving the note for the line\'s own tick or menu holds the save back; anywhere else saves it',()=>{
  const tick={},toggle={},elsewhere={};
  assert.equal(defersCommit(tick,[tick,toggle]),true,'type a note, then click the tick: the tick decides');
  assert.equal(defersCommit(toggle,[tick,toggle]),true);
  assert.equal(defersCommit(null,[tick,toggle],true),true,'Safari: no focus on click, the press marks it');
  assert.equal(defersCommit(elsewhere,[tick,toggle]),false);
  assert.equal(defersCommit(null,[tick,toggle]),false,'Ctrl+Enter or a click on the page saves the note');
});
