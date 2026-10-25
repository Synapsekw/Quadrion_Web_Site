import test from 'node:test';
import assert from 'node:assert/strict';
import {STATUS_LABELS,statusLabel,buildLabel,prefillFromQuery,buildSuggestions,attachmentKind,testerMessage} from '../portal/src/feedback-ui.mjs';
const file=(name,type,size)=>({name,type,size});
test('attachmentKind refuses unsupported or oversized files',()=>{
  assert.deepEqual(attachmentKind(file('notes.txt','text/plain',10)),{ok:false,reason:'PNG, JPG, WebP, MP4, WebM or ZIP only'});
  assert.deepEqual(attachmentKind(file('photo.heic','image/heic',10)),{ok:false,reason:'PNG, JPG, WebP, MP4, WebM or ZIP only'});
  assert.deepEqual(attachmentKind(file('photo.heic','',10)),{ok:false,reason:'PNG, JPG, WebP, MP4, WebM or ZIP only'});
  assert.deepEqual(attachmentKind(file('big.png','image/png',10000001)),{ok:false,reason:'Larger than 10 MB'});
  assert.deepEqual(attachmentKind(file('big.mp4','video/mp4',100000001)),{ok:false,reason:'Larger than 100 MB'});
  assert.deepEqual(attachmentKind(file('d.zip','application/zip',50000001)),{ok:false,reason:'Larger than 50 MB'});
  assert.deepEqual(attachmentKind(file('empty.png','image/png',0)),{ok:false,reason:'The file is empty'});
  assert.deepEqual(attachmentKind(file('a.png','image/png',10000)),{ok:true,mime:'image/png'});
  assert.deepEqual(attachmentKind(file('a.mp4','video/mp4',90000000)),{ok:true,mime:'video/mp4'});
  assert.deepEqual(attachmentKind(file('d.zip','application/x-zip-compressed',5000)),{ok:true,mime:'application/zip'});
  assert.deepEqual(attachmentKind(file('shot.jpg','',5000)),{ok:true,mime:'image/jpeg'});
});
test('testerMessage words one, many, features and both',()=>{
  const origin='https://quadrion.ai',build='0.26.0',u=': https://quadrion.ai/portal/tests/';
  assert.equal(testerMessage({fixes:3,features:0,build,origin}),'3 fixes in 0.26.0 are ready to re-check'+u);
  assert.equal(testerMessage({fixes:1,features:0,build,origin}),'1 fix in 0.26.0 is ready to re-check'+u);
  assert.equal(testerMessage({fixes:0,features:2,build,origin}),'2 features built in 0.26.0 are ready to try'+u);
  assert.equal(testerMessage({fixes:0,features:1,build,origin}),'1 feature built in 0.26.0 is ready to try'+u);
  assert.equal(testerMessage({fixes:3,features:2,build,origin}),'3 fixes in 0.26.0 are ready to re-check; 2 features built in 0.26.0 are ready to try'+u);
});
test('prefillFromQuery keeps a valid build and screen and drops the rest',()=>{
  assert.deepEqual(prefillFromQuery('?build=0.26.0&screen=map'),{kind:'bug',build:'0.26.0',screen:'map'});
  assert.deepEqual(prefillFromQuery('?build=%3Cscript%3E&screen=a%20b%2Fc'),{kind:'bug',build:'',screen:''});
  assert.deepEqual(prefillFromQuery('?build='+'1'.repeat(81)),{kind:'bug',build:'',screen:''});
  assert.deepEqual(prefillFromQuery(''),{kind:'bug',build:'',screen:''});
  assert.equal(prefillFromQuery('?kind=feature').kind,'bug');
});
test('buildLabel names unknown builds',()=>{
  assert.equal(buildLabel('unknown'),'build not recorded');
  assert.equal(buildLabel(''),'build not recorded');
  assert.equal(buildLabel('0.26.0'),'0.26.0');
});
test('status labels differ by viewer only for question',()=>{
  assert.equal(STATUS_LABELS.fixed,'Fixed, re-check');
  assert.equal(statusLabel('question','tester'),'Question for you');
  assert.equal(statusLabel('question','owner'),'Waiting on tester');
  assert.equal(statusLabel('reopened','owner'),'Sent back');
  assert.equal(statusLabel('odd','owner'),'odd');
});
test('buildSuggestions lists app releases newest first without repeats',()=>{
  const items=[{kind:'app',version:'0.25.0'},{kind:'pipeline',version:'0.9.0'},{kind:'app',version:'0.26.0'},{kind:'app',version:'0.25.0'},{kind:'app',version:'0.9.1'}];
  assert.deepEqual(buildSuggestions(items),['0.26.0','0.25.0','0.9.1']);
  assert.deepEqual(buildSuggestions(undefined),[]);
});
