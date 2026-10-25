import test from 'node:test';
import assert from 'node:assert/strict';
// A tiny DOM stand-in, enough for ui.mjs el(): the tester page helpers build real nodes with it.
class FakeNode{
  constructor(tag,text){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.className='';this.text=text;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  append(...nodes){this.children.push(...nodes);}
  get textContent(){return this.text??this.children.map(c=>c.textContent).join('');}
  set textContent(value){this.text=String(value);this.children=[];}
  find(match){if(match(this))return this;for(const c of this.children){const hit=c.find?.(match);if(hit)return hit;}return null;}
}
globalThis.Node=FakeNode;
globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',text)};
const {waitingList,sendAnswer,answerProblem,RETIRED_MESSAGE}=await import('../portal/src/tests.mjs');
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
