import test from 'node:test';
import assert from 'node:assert/strict';
import {submitMutation} from '../portal/src/mutations.mjs';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';

test('clearing a failed upload removes private content but leaves its error and recovery controls visible',async()=>{
  const source=(await readFile(new URL('../portal/src/admin.mjs',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'').split('try{auth=await createPortalAuth')[0];
  const children=['private release'],dialogs=[{remove(){this.removed=true;}}],events=[];
  const content={replaceChildren(...items){children.splice(0,children.length,...items);},append(...items){children.push(...items);}};
  const document={querySelector:()=>({}),querySelectorAll:()=>dialogs,addEventListener(){}};
  const window={addEventListener(){},dispatchEvent:event=>events.push(event.type)};
  const load=compileFunction(source+'\nreturn view=>{content=view;return clear;};',['document','window','notice','button']);
  const clear=load(document,window,(message,kind)=>({message,kind}),(label,action)=>({label,action}))(content);
  clear(503,new Error('Upload service unavailable'));
  assert.equal(children.includes('private release'),false);
  assert.ok(dialogs[0].removed);
  assert.ok(events.includes('quadrion:signout'));
  assert.ok(children.some(node=>node.message==='Upload service unavailable'));
  assert.ok(children.some(node=>node.label==='Refresh'));
});
test('a failing feedback count leaves the admin page standing with no badge',async()=>{
  const {createPortalApi}=await import('../portal/src/api.mjs');
  const source=(await readFile(new URL('../portal/src/admin.mjs',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'');
  const node=(tag,attrs={},...kids)=>({tag,attrs,kids:kids.flat(Infinity).filter(k=>k!=null),append(...k){this.kids.push(...k);},replaceChildren(...k){this.kids=k;},querySelector:()=>null});
  const text=n=>n==null?'':typeof n!=='object'?String(n):(n.kids||[]).map(text).join(' ');
  const root=node('div'),events=[],calls=[];
  const document={querySelector:()=>root,querySelectorAll:()=>[],addEventListener(){},body:node('body')};
  const window={addEventListener(){},dispatchEvent:event=>events.push(event.type)};
  const replies={me:[200,{member:{role:'owner',displayName:'Owner'}}],overview:[200,{limits:{}}],feedbackCounts:[503,{error:'unavailable',message:'Down'}]};
  const fetcher=async url=>{const action=new URL(url,'https://x.test').searchParams.get('action');calls.push(action);const [status,body]=replies[action];return {ok:status<400,status,json:async()=>body};};
  const auth={getToken:async()=>'token',needsPassword:()=>false,signOut:async()=>{}};
  const params=['document','window','location','history','createPortalAuth','createPortalApi','el','button','link','field','heading','empty','notice','bytes','date','uploadControl','submitMutation','renderInbox','renderProgress','renderContent','testerSection'];
  const run=compileFunction('return (async()=>{'+source+'\n})();',params);
  await run(document,window,{pathname:'/admin/nowhere/',search:'',origin:'https://x.test',replace(){}},{pushState(){}},async()=>auth,
    options=>createPortalApi({...options,fetcher}),node,label=>node('button',{},label),(label,href)=>node('a',{href},label),()=>({}),(...t)=>node('h1',{},...t),
    title=>node('section',{},title),message=>node('p',{},message),()=>'',()=>'',()=>({}),async()=>{},async()=>{},async()=>{},async()=>{},()=>null);
  assert.ok(calls.includes('feedbackCounts'));
  assert.equal(events.includes('quadrion:signout'),false);
  const page=text(root);
  assert.match(page,/Page unavailable/);assert.match(page,/Feedback/);
  assert.doesNotMatch(page,/waiting/);
});
test('stale writes retain the draft and never retry or overwrite automatically',async()=>{
  let sends=0,refreshed=0,message='';
  const result=await submitMutation({send:async()=>{sends++;const e=new Error('Changed');e.status=409;throw e;},refresh:()=>refreshed++,showError:value=>message=value});
  assert.equal(result,false);assert.equal(sends,1);assert.equal(refreshed,0);assert.match(message,/Refresh/);
});
test('lost privilege clears the private view',async()=>{
  let cleared=0;
  await submitMutation({send:async()=>{const e=new Error('No access');e.status=403;throw e;},refresh:()=>{},clear:()=>cleared++,showError:()=>{}});assert.equal(cleared,1);
});
