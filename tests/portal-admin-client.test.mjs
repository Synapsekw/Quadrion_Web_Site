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
test('stale writes retain the draft and never retry or overwrite automatically',async()=>{
  let sends=0,refreshed=0,message='';
  const result=await submitMutation({send:async()=>{sends++;const e=new Error('Changed');e.status=409;throw e;},refresh:()=>refreshed++,showError:value=>message=value});
  assert.equal(result,false);assert.equal(sends,1);assert.equal(refreshed,0);assert.match(message,/Refresh/);
});
test('lost privilege clears the private view',async()=>{
  let cleared=0;
  await submitMutation({send:async()=>{const e=new Error('No access');e.status=403;throw e;},refresh:()=>{},clear:()=>cleared++,showError:()=>{}});assert.equal(cleared,1);
});
