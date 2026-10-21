import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import {compatibleBaselines} from '../portal/src/release-metadata.mjs';

// Run the actual editor against lightweight DOM controls; no auth or Storage is
// contacted. Assertions cover the payload and interactive baseline selection.
test('release editor uses readable compatible kit choices and preserves the draft revision',async()=>{
  const source=(await readFile(new URL('../portal/src/admin.mjs',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'').split('try{auth=await createPortalAuth')[0];
  const controls=new Map();let captured;
  function node(tag,attrs={},...children){const n={tag,attrs,children:children.flat(Infinity).filter(Boolean),value:attrs.value||'',disabled:false,required:false,listeners:{},append(...items){this.children.push(...items.flat(Infinity));},replaceChildren(...items){this.children=items.map(item=>Array.isArray(item)?String(item):item);if(this.tag==='select')this.value=this.children.find(c=>c.attrs?.selected)?.attrs.value||this.children[0]?.attrs?.value||'';},addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];}};if(tag==='select')n.value=n.children.find(c=>c.attrs?.selected)?.attrs.value||n.children[0]?.attrs?.value||'';if(attrs.id)controls.set(attrs.id,n);return n;}
  const field=(label,name,attrs={})=>{const input=node('input',{...attrs,id:name});return {input,node:node('div',{},label,input)};};
  const doc={querySelector:()=>({}),addEventListener(){}};
  const kits=[{id:'kit-good',kind:'pipeline',version:'0.20.0',status:'published',auto_update_enabled:true,platform:'windows',architecture:'x64',package_format:'tar.gz',app_range:'>=0.25.0 <2.0.0',files:[{filename:'kit.tar.gz',state:'verified'}]},{id:'kit-wrong',kind:'pipeline',version:'0.21.0',status:'published',auto_update_enabled:true,platform:'windows',architecture:'x64',package_format:'tar.gz',app_range:'>=1.0.0 <2.0.0',files:[{filename:'kit.tar.gz',state:'verified'}]}];
  const load=compileFunction(source+`\nreturn async function(draft){api={get:async()=>({items:kits,total:2})};dialog=(title,description,body)=>body;saveForm=(fields,action,payload)=>{capture(payload);return fields;};await releaseEditor(draft);};`,['document','window','el','field','notice','button','kits','capture','compatibleBaselines']);
  await load(doc,{addEventListener(){}},node,field,(text)=>text,()=>({}),kits,payload=>{captured=payload;},compatibleBaselines)({id:'draft-id',revision:7,kind:'app',version:'0.25.0',platform:'windows',notes:'Draft',auto_update_enabled:true,pipeline_release_id:'kit-good'});
  assert.equal(captured().id,'draft-id');assert.equal(captured().revision,7);
  const baseline=controls.get('release-baseline');assert.ok(baseline,'Readable kit selector must exist');
  assert.ok(baseline.children.some(n=>n.attrs?.value==='kit-good'&&n.children.join('').includes('0.20.0')));
  assert.equal(baseline.children.some(n=>n.attrs?.value==='kit-wrong'),false);
  assert.equal(captured().pipelineReleaseId,'kit-good');assert.equal(captured().architecture,'x64');assert.equal(captured().packageFormat,'nsis');
  controls.get('release-kind').value='pipeline';await controls.get('release-kind').listeners.change();
  controls.get('release-app-range').value='>=0.25.0 <2.0.0';assert.equal(captured().pipelineReleaseId,null);assert.equal(captured().packageFormat,'tar.gz');assert.equal(captured().appRange,'>=0.25.0 <2.0.0');
});
