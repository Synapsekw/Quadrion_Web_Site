import test from 'node:test';
import assert from 'node:assert/strict';
import {safeLink,normalizeAnswer} from '../directions/quori/reply.js';
test('reply links reject script, protocol-relative and disguised external destinations',()=>{
  for(const href of ['javascript:alert(1)','//evil.example','/\\evil.example','/%5cevil.example','https://evil.example','/x\ny'])assert.equal(safeLink(href),null);
  assert.equal(safeLink('/d3-quarter/#trust'),'/d3-quarter/#trust');
  assert.equal(safeLink('https://www.synapse-solutions.ai/#contact'),'https://www.synapse-solutions.ai/#contact');
  assert.deepEqual(normalizeAnswer({reply:'Hi',links:[{label:'bad',href:'javascript:alert(1)'}]}),{reply:'Hi',links:[]});
});
test('an empty provider response is an error rather than a successful empty bubble',()=>{
  assert.throws(()=>normalizeAnswer({reply:'  '}),/could not read/);
});
