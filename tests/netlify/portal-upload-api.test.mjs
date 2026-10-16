import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadActions} from '../../netlify/lib/portal/uploads.mjs';
import {errorResponse} from '../../netlify/lib/portal/http.mjs';

test('unconfigured verification refuses uploads with an actionable error before allocating a file',async()=>{
  for(const secret of [undefined,'','short secret']){
    let allocated=false;
    const actions=createUploadActions({config:{verifySecret:secret},backend:{rpc:async()=>{allocated=true;}}});
    await assert.rejects(actions('upload',{},{}),error=>{
      assert.equal(error.message,'portal:upload_not_configured');
      assert.equal(errorResponse(error).status,503);
      return true;
    });
    assert.equal(allocated,false);
  }
});
test('upload allocation validates file type, configured size and forbids paths before contacting Storage',async()=>{
  let calls=0;const actions=createUploadActions({config:{verifySecret:'x'.repeat(32),projectMaxBytes:100000000000,releaseMaxBytes:1000000000},backend:{rpc:async()=>{calls++;}},dispatch:async()=>{}});
  const user={userId:'10000000-0000-4000-8000-000000000001',aal:'aal2'},base={projectVersionId:'10000000-0000-4000-8000-000000000002',releaseId:null,kind:'binary',filename:'site.aio',bytes:100000000001,sha256:'a'.repeat(64)};
  await assert.rejects(actions('upload',base,user),/portal:too_large/);
  await assert.rejects(actions('upload',{...base,bytes:100,filename:'../../site.aio'},user),/portal:invalid/);
  await assert.rejects(actions('upload',{...base,bytes:100,filename:'preview.svg',kind:'preview'},user),/portal:invalid/);
  await assert.rejects(actions('upload',{...base,bytes:100,object_path:'own/path'},user),/portal:invalid/);assert.equal(calls,0);
});
