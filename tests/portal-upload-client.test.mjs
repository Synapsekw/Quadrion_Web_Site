import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';

async function uploadFixture({existing=null,post=async()=>{throw new Error('Upload rejected');}}={}){
  const source=(await readFile(new URL('../portal/src/upload.mjs',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'').replace('export function uploadControl','function uploadControl');
  const nodes=[],buttons=new Map();let workers=0;
  const el=(tag,attrs={},...children)=>{
    const node={tag,...attrs,children:children.flat().filter(Boolean),textContent:children.filter(v=>typeof v==='string').join(''),replaceChildren(...items){this.children=items;},append(...items){this.children.push(...items);}};
    nodes.push(node);return node;
  };
  const button=(label,handler)=>{const node=el('button',{},label);node.click=handler;buttons.set(label,node);return node;};
  const notice=message=>el('div',{role:'alert'},message);
  class Worker{constructor(){workers++;}terminate(){}postMessage(){queueMicrotask(()=>{this.onmessage({data:{progress:1}});this.onmessage({data:{sha256:'a'.repeat(64)}});});}}
  const storage={getItem:()=>null,setItem(){},removeItem(){}};
  const window={addEventListener(){},removeEventListener(){}};
  const create=compileFunction(source+'\nreturn uploadControl;',['el','button','notice','bytes','Worker','sessionStorage','window','loadUpload'])(el,button,notice,String,Worker,storage,window,async()=>class{});
  create({api:{post},releaseId:'release-fixture',limit:1000000000,existing});
  return {nodes,buttons,input:nodes.find(n=>n.tag==='input'),workers:()=>workers};
}

test('a rejected request after hashing stops showing an active checksum operation',async()=>{
  const view=await uploadFixture();view.input.files=[{name:'team.zip',size:100}];
  await view.buttons.get('Upload / resume').click();
  assert.ok(view.nodes.some(n=>n.role==='alert'&&n.textContent==='Upload rejected'));
  assert.ok(!view.nodes.some(n=>n.tag==='p'&&/Calculating.*checksum/i.test(n.textContent)));
  assert.equal(view.buttons.get('Upload / resume').disabled,false);
});

for(const selection of [{name:'installer.exe',size:100},{name:'team.zip',size:40}])test('resuming with a mismatched '+(selection.name==='team.zip'?'size':'filename')+' shows the expected file before hashing or contacting the server',async()=>{
  let requests=0;
  const view=await uploadFixture({existing:{filename:'team.zip',bytes:100,state:'pending',upload_session_id:'session-fixture'},post:async()=>{requests++;throw new Error('Unexpected request');}});
  view.input.files=[selection];
  await view.buttons.get('Upload / resume').click();
  assert.equal(view.workers(),0);assert.equal(requests,0);
  assert.ok(view.nodes.some(n=>n.role==='alert'&&n.textContent.includes('team.zip')));
  assert.ok(view.nodes.some(n=>n.tag==='p'&&n.textContent.includes('team.zip')));
});

test('the same pending file is hashed and submitted for resumption',async()=>{
  let submitted;
  const view=await uploadFixture({existing:{filename:'team.zip',bytes:100,state:'pending',upload_session_id:'session-fixture'},post:async(action,payload)=>{submitted={action,payload};throw new Error('Provider unavailable');}});
  view.input.files=[{name:'team.zip',size:100}];
  await view.buttons.get('Upload / resume').click();
  assert.equal(view.workers(),1);
  assert.deepEqual(submitted,{action:'resumeUpload',payload:{id:'session-fixture',filename:'team.zip',bytes:100,sha256:'a'.repeat(64)}});
});
