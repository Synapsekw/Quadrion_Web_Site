import test from 'node:test';
import assert from 'node:assert/strict';
// A tiny DOM stand-in, enough for ui.mjs el(): the tester page helpers build real nodes with it.
class FakeNode{
  constructor(tag,text){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.className='';this.text=text;this.style={};}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  append(...nodes){this.children.push(...nodes);}
  get textContent(){return this.text??this.children.map(c=>c.textContent).join('');}
  set textContent(value){this.text=String(value);this.children=[];}
  find(match){if(match(this))return this;for(const c of this.children){const hit=c.find?.(match);if(hit)return hit;}return null;}
}
globalThis.Node=FakeNode;
globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',text)};
const {waitingList,sendAnswer,answerProblem,RETIRED_MESSAGE,saveStatus,keepDetailOpen,fillMeter,createAct,sendThreadNote}=await import('../portal/src/tests.mjs');
test('a saved action whose refresh fails says it was saved and offers Reload',async()=>{
  const posts=[];let reloads=0,after=0;
  const api={post:async(action,body)=>{posts.push([action,body]);return {};}};
  const act=createAct({api,refresh:async()=>{throw new Error('Check your connection, then try again.');},reload:()=>reloads++,currentBuild:()=>'0.26.1'});
  const feedback=document.createElement('div');
  const ok=await act({id:'item-1',revision:3},'confirm','',feedback,()=>after++);
  assert.equal(ok,true,'the action was saved, so it must not read as failed');
  assert.deepEqual(posts,[['act',{id:'item-1',revision:3,action:'confirm',body:'',build:'0.26.1'}]]);
  assert.match(feedback.textContent,/Saved/);assert.match(feedback.textContent,/could not refresh/);
  assert.doesNotMatch(feedback.textContent,/connection/);
  const reload=feedback.find(n=>n.tagName==='button');
  assert.equal(reload.textContent,'Reload');reload.listeners.click();assert.equal(reloads,1);
  assert.equal(after,0);
});
test('a failed action still reads as failed and a refreshed one runs its follow-up',async()=>{
  let refreshed=0,after=0;
  const failing={post:async()=>{throw new Error('Service unavailable');}};
  const feedback=document.createElement('div');
  assert.equal(await createAct({api:failing,refresh:async()=>refreshed++,reload:()=>{},currentBuild:()=>''})({id:'i',revision:1},'comment','x',feedback),false);
  assert.match(feedback.textContent,/Service unavailable/);assert.equal(refreshed,0);
  const ok=await createAct({api:{post:async()=>({})},refresh:async()=>refreshed++,reload:()=>{},currentBuild:()=>'<bad>'})({id:'i',revision:1},'comment','x',feedback,()=>after++);
  assert.equal(ok,true);assert.equal(refreshed,1);assert.equal(after,1);
});
test('a thread note uploads files first, then comments; either alone is enough',async()=>{
  const steps=[];
  const upload=ok=>async files=>{steps.push(['upload',files.map(f=>f.name)]);return ok;};
  const comment=async text=>{steps.push(['comment',text]);return true;};
  const refresh=async()=>{steps.push(['refresh']);return true;};
  const zip={name:'diagnostics.zip'};
  assert.deepEqual(await sendThreadNote({text:'  ',files:[],upload:upload(true),comment,refresh}),{ok:false,message:'Write a comment or attach a file first.'});
  assert.deepEqual(steps,[]);
  assert.equal((await sendThreadNote({text:' Here is the file ',files:[zip],upload:upload(true),comment,refresh})).ok,true);
  assert.deepEqual(steps.splice(0),[['upload',['diagnostics.zip']],['comment','Here is the file']]);
  assert.equal((await sendThreadNote({text:'',files:[zip],upload:upload(true),comment,refresh})).ok,true);
  assert.deepEqual(steps.splice(0),[['upload',['diagnostics.zip']],['refresh']]);
  // A failed upload keeps the comment back, so the tester can add the file again and send both.
  assert.deepEqual(await sendThreadNote({text:'With the file',files:[zip],upload:upload(false),comment,refresh}),{ok:false,uploadFailed:true});
  assert.deepEqual(steps.splice(0),[['upload',['diagnostics.zip']]]);
  assert.equal((await sendThreadNote({text:'Only words',files:[],upload:upload(true),comment,refresh})).ok,true);
  assert.deepEqual(steps.splice(0),[['comment','Only words']]);
});
test('after a save the comment panel closes unless screenshots were kept',()=>{
  assert.equal(keepDetailOpen(0),false);
  assert.equal(keepDetailOpen(2),true);
});
test('save with no choice records nothing',()=>{
  assert.equal(saveStatus(null,undefined),null);
  assert.equal(saveStatus(null,'pass'),'pass');
  assert.equal(saveStatus('fail','pass'),'fail');
});
test('progress meters set widths through the CSSOM, not a style attribute',()=>{
  const bar=document.createElement('span');
  fillMeter(bar,{pass:1,fail:1,skip:0,total:4});
  assert.deepEqual(bar.children.map(n=>n.style.width),['25%','25%','0%']);
  assert.ok(bar.children.every(n=>!('style' in n.attributes)));
  fillMeter(bar,{pass:0,fail:0,skip:0,total:0});
  assert.deepEqual(bar.children.map(n=>n.style.width),['0%','0%','0%']);
});
const line='walk:open-map:0a1b2c3d4e';
test('the waiting list puts fixed items before questions',()=>{
  const items=[
    {id:'q-new',status:'question',waiting:true,updated_at:'2026-10-25T10:00:00Z'},
    {id:'f-old',status:'fixed',waiting:true,updated_at:'2026-10-20T10:00:00Z'},
    {id:'done',status:'fixed',waiting:false,updated_at:'2026-10-25T11:00:00Z'},
    {id:'triaged',status:'triaged',waiting:false,updated_at:'2026-10-25T12:00:00Z'},
    {id:'f-new',status:'fixed',waiting:true,updated_at:'2026-10-24T10:00:00Z'},
    {id:'q-old',status:'question',waiting:true,updated_at:'2026-10-21T10:00:00Z'}];
  assert.deepEqual(waitingList(items).map(i=>i.id),['f-new','f-old','q-new','q-old']);
  assert.deepEqual(waitingList(undefined),[]);
});
test('a failed answer without a comment is not sent',async()=>{
  const sent=[],api={post:async(action,body)=>{sent.push([action,body]);return {answer:{lineId:line,status:body.status},itemId:null};}};
  const blank=await sendAnswer(api,{lineId:line,status:'fail',comment:'   ',build:'0.26.0'});
  assert.equal(blank.ok,false);assert.match(blank.message,/what went wrong/);assert.equal(sent.length,0);
  const badBuild=await sendAnswer(api,{lineId:line,status:'pass',comment:'',build:'<b>'});
  assert.equal(badBuild.ok,false);assert.equal(sent.length,0);
  const ok=await sendAnswer(api,{lineId:line,status:'fail',comment:' The map stays blank. ',build:' 0.26.0 '});
  assert.equal(ok.ok,true);
  assert.deepEqual(sent,[['answer',{lineId:line,status:'fail',comment:'The map stays blank.',build:'0.26.0'}]]);
});
test('an answer conflict shows the reload notice',async()=>{
  const api={post:async()=>{const error=new Error('This record changed. Refresh it before saving.');error.status=409;error.code='conflict';throw error;}};
  const result=await sendAnswer(api,{lineId:line,status:'pass',comment:'',build:'0.26.0'});
  assert.deepEqual({ok:result.ok,conflict:result.conflict,message:result.message},{ok:false,conflict:true,message:RETIRED_MESSAGE});
  assert.equal(RETIRED_MESSAGE,'This line was changed or retired. Reload the tests.');
  let reloads=0;const view=answerProblem(result,()=>reloads++);
  assert.ok(view.textContent.includes(RETIRED_MESSAGE));
  const reload=view.find(n=>n.tagName==='button');
  assert.equal(reload.textContent,'Reload');reload.listeners.click();assert.equal(reloads,1);
  const other=answerProblem({ok:false,message:'Check your connection, then try again.'},()=>{});
  assert.equal(other.find(n=>n.tagName==='button'),null);
});
