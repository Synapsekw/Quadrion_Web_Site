import test from 'node:test';
import assert from 'node:assert/strict';
import {loadUpload,forgetUpload,STALE_PAGE_MESSAGE} from '../portal/src/tus.mjs';

test('a missing upload chunk (the site was updated) says so and asks for a reload, then can try again',async()=>{
  forgetUpload();
  await assert.rejects(loadUpload(async()=>{throw new TypeError('Failed to fetch dynamically imported module');}),error=>{
    assert.equal(error.message,STALE_PAGE_MESSAGE);assert.equal(error.reload,true);return true;});
  class Upload{}
  assert.equal(await loadUpload(async()=>({Upload})),Upload,'a failure is not remembered');
  forgetUpload();
});
