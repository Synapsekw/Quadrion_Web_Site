import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortalApi} from '../portal/src/api.mjs';
test('bearer credentials stay in headers and denials clear cached UI state',async()=>{
  let reset=0,status=200,seen;
  const api=createPortalApi({getToken:async()=>'private-token',onDenied:()=>reset++,fetcher:async(url,options)=>{seen=new Request('https://quadrion.ai'+url,options);return new Response(JSON.stringify(status===200?{items:[]}:{error:'forbidden',message:'Access denied'}),{status});}});
  await api.get('projects');assert.equal(seen.headers.get('authorization'),'Bearer private-token');assert.equal(seen.url.includes('private-token'),false);
  status=403;await assert.rejects(api.get('projects'),/Access denied/);assert.equal(reset,1);
  status=401;await assert.rejects(api.get('me'));assert.equal(reset,2);
});
test('network failures clear old private content, and unknown actions cannot issue requests',async()=>{
  let reset=0,calls=0;
  const api=createPortalApi({getToken:async()=>'private-token',onDenied:()=>reset++,fetcher:async()=>{calls++;throw new Error('network');}});
  await assert.rejects(api.get('projects'),/connection/i);assert.equal(reset,1);
  await assert.rejects(api.get('https://evil.test'),/Unknown/);assert.equal(calls,1);
});
