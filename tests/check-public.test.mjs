import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {findPrivateContent} from '../scripts/check-quori-public.mjs';

test('a built asset carrying a test line id fails',()=>{
  assert.equal(findPrivateContent('{"id":"testing:stage-m1:0123456789"}',[]).length,1);
  assert.equal(findPrivateContent('x "setup:install:0123456789-2" y',[]).length,1);
  assert.equal(findPrivateContent('extra:a:b:abcdef0123',[]).length,1);
  assert.equal(findPrivateContent('{"id":"other:stage-m1:0123456789"}',[]).length,0);
});

test('format markers fail',()=>{
  assert.equal(findPrivateContent('format: quadrion-test-content/1',[]).length,1);
  assert.equal(findPrivateContent('quadrion-test-results/1',[]).length,1);
  assert.equal(findPrivateContent('plain text',[]).length,0);
});

test('a private term fails word-bounded and case-insensitive',()=>{
  assert.equal(findPrivateContent('northwind yard',['Northwind']).length,1);
  assert.equal(findPrivateContent('northwindy',['Northwind']).length,0);
  assert.equal(findPrivateContent('the (NORTHWIND) site',['Northwind']).length,1);
  assert.equal(findPrivateContent('anything',['']).length,0);
});

test('ordinary portal bundles pass',async()=>{
  const dir=new URL('../directions/assets/portal/',import.meta.url);
  let names=[];
  try{names=(await readdir(dir)).filter(n=>n.endsWith('.js'));}catch(error){if(error.code!=='ENOENT')throw error;}
  assert.ok(names.length>0,'run npm run build:portal first');
  for(const name of names)assert.deepEqual(findPrivateContent(await readFile(new URL(name,dir),'utf8'),[]),[],name);
});
