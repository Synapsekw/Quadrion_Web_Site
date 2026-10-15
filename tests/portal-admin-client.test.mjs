import test from 'node:test';
import assert from 'node:assert/strict';
import {submitMutation} from '../portal/src/mutations.mjs';
test('stale writes retain the draft and never retry or overwrite automatically',async()=>{
  let sends=0,refreshed=0,message='';
  const result=await submitMutation({send:async()=>{sends++;const e=new Error('Changed');e.status=409;throw e;},refresh:()=>refreshed++,showError:value=>message=value});
  assert.equal(result,false);assert.equal(sends,1);assert.equal(refreshed,0);assert.match(message,/Refresh/);
});
test('lost privilege clears the private view',async()=>{
  let cleared=0;
  await submitMutation({send:async()=>{const e=new Error('No access');e.status=403;throw e;},refresh:()=>{},clear:()=>cleared++,showError:()=>{}});assert.equal(cleared,1);
});
