import test from 'node:test';
import assert from 'node:assert/strict';
// A tiny DOM stand-in, enough for ui.mjs el() and the owner's item dialog.
class FakeNode{
  constructor(tag,text){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.className='';this.text=text;this.style={};}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];}
  get childNodes(){return this.children;}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  get value(){return this._value??this.attributes.value??'';}
  set value(v){this._value=String(v);}
  get textContent(){return this.text??this.children.map(c=>c.textContent).join('');}
  set textContent(value){this.text=String(value);this.children=[];}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  focus(){}
  // A browser fires close as a task, after the code that closed the dialog has moved on.
  close(){setTimeout(()=>this.listeners.close?.(),0);}
  find(match){if(match(this))return this;for(const c of this.children){const hit=c.find?.(match);if(hit)return hit;}return null;}
}
globalThis.Node=FakeNode;
globalThis.document={createElement:tag=>new FakeNode(tag),createTextNode:text=>new FakeNode('#text',text)};
globalThis.location={pathname:'/admin/feedback/',search:''};
const {renderInbox}=await import('../portal/src/feedback-admin.mjs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));

test('a single Mark fixed offers the tester message to copy, after one render',async()=>{
  const summary={id:'30000000-0000-4000-8000-000000000001',number:7,title:'Map stays blank',kind:'bug',status:'triaged',priority:'normal',revision:2,reporters:[],owner_attention:false,build_seen:'0.26.0',updated_at:'2026-10-25T10:00:00Z'};
  const posts=[],copied=[],dialogs=[];let renders=0;
  const api={
    get:async action=>action==='feedbackInbox'?{items:[summary],total:1}:action==='feedbackProgress'?{testers:[]}:{item:summary,events:[],attachments:[]},
    post:async(action,body)=>{posts.push([action,body]);return {...summary,status:'fixed',fixed_in:body.data.build,revision:3};},
  };
  const ctx={api,member:{role:'owner'},content:new FakeNode('main'),navigate(){},search:'',origin:'https://quadrion.ai',
    clipboard:{writeText:async text=>copied.push(text)},
    dialog:(title,description,body)=>{const d=new FakeNode('dialog');d.append(body);dialogs.push(d);return d;},
    async render(){renders++;this.content=new FakeNode('main');}};
  await renderInbox(ctx);
  await ctx.content.find(n=>n.tagName==='button'&&n.textContent==='Open').listeners.click();
  const dialog=dialogs[0];
  dialog.find(n=>n.attributes.id==='fb-fix').value=' 0.26.1 ';
  const fixForm=dialog.find(n=>n.tagName==='form'&&n.textContent.includes('Mark fixed in build'));
  await fixForm.listeners.submit({preventDefault(){}});
  await tick();
  assert.deepEqual(posts,[['feedbackAction',{id:summary.id,revision:2,action:'fix',data:{build:'0.26.1'}}]]);
  assert.equal(renders,1,'the closing dialog must not render the page again over the notice');
  const block=ctx.content.children[0];
  assert.match(block.textContent,/Marked #7 fixed in 0\.26\.1/);
  assert.match(block.textContent,/1 fix in 0\.26\.1 is ready to re-check: https:\/\/quadrion\.ai\/portal\/tests\//);
  const copy=block.find(n=>n.tagName==='button'&&n.textContent==='Copy message for testers');
  await copy.listeners.click();
  assert.deepEqual(copied,['1 fix in 0.26.1 is ready to re-check: https://quadrion.ai/portal/tests/']);
});
