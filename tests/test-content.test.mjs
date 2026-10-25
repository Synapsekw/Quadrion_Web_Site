import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTestContent} from '../netlify/lib/portal/test-content.mjs';
const id=n=>`walk:open-map:${String(n).padStart(10,'0')}`;
const model=(over={})=>({format:'quadrion-test-content/1',builtAt:'2026-10-25T08:00:00.000Z',title:'Sample round',source:'sample',owner:'owner',unit:'stage',
  guide:[{title:'How to test',html:'<p>Open the <b>sample</b> project.</p><ul><li>Step</li></ul>'}],testers:[{id:'tester-1',name:'Tester One'}],
  stages:[{id:'walk',title:'Getting around',intro:'<details><summary>About</summary><p>Made up.</p></details>',groups:[
    {title:'Map',notes:'<h4>Notes</h4><p>See <a href="https://example.com/help" target="_blank" rel="noreferrer">help</a>.</p>',items:[
      {id:id(1),html:'Open the sample project and switch to <b>Map</b>',sub:['<code>Zoom</code> twice','<pre>a &lt; b</pre>'],plain:'Open the sample project and switch to Map',subPlain:['`Zoom` twice','a < b']},
      {id:id(2),html:'Pan the map',sub:[],plain:'Pan the map',subPlain:[]}]}]}],...over});
const refused=m=>assert.throws(()=>validateTestContent(m),{message:'portal:invalid'});
test('accepts the made-up fixture model',()=>{
  assert.deepEqual(validateTestContent(model()),{lines:2});
  assert.deepEqual(validateTestContent(model({guide:undefined})),{lines:2});
});
test('refuses script, img, on* attributes and javascript: links',()=>{
  const withHtml=html=>model({stages:[{id:'w',title:'W',groups:[{title:'G',items:[{id:id(1),html,sub:[]}]}]}]});
  for(const html of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','<p onclick="x()">a</p>','<a href="javascript:alert(1)" target="_blank" rel="noreferrer">a</a>',
    '<a href="http://example.com" target="_blank" rel="noreferrer">a</a>','<a href="https://example.com">a</a>','<b <script>','1 < 2'])refused(withHtml(html));
  refused(model({stages:[{id:'w',title:'W',groups:[{title:'G',items:[{id:id(1),html:'ok',sub:['<iframe></iframe>']}]}]}]}));
  refused(model({stages:[{id:'w',title:'W',intro:'<style>x{}</style>',groups:[{title:'G',items:[{id:id(1),html:'ok',sub:[]}]}]}]}));
  refused(model({stages:[{id:'w',title:'W',groups:[{title:'G',notes:'<svg onload=x>',items:[{id:id(1),html:'ok',sub:[]}]}]}]}));
  refused(model({guide:[{title:'T',html:'<object></object>'}]}));
});
test('refuses duplicate or malformed line ids',()=>{
  const items=ids=>model({stages:[{id:'w',title:'W',groups:[{title:'G',items:ids.map(i=>({id:i,html:'x',sub:[]}))}]}]});
  refused(items([id(1),id(1)]));
  for(const bad of ['Walk:open:0a1b2c3d4e','walk:0a1b2c3d4e','walk:open:0a1b2c3d4','walk:open:0a1b2c3d4G','walk:open:'+'0a1b2c3d4e'+'-x','a:'+'b'.repeat(200)+':0a1b2c3d4e',1,null])refused(items([bad]));
  assert.equal(validateTestContent(items(['walk:open:0a1b2c3d4e-2'])).lines,1);
  refused(model({format:'quadrion-test-content/2'}));
  refused(model({stages:[]}));
  refused(model({stages:[{id:'w',title:'W',groups:[]}]}));
});
