import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadActions} from '../../netlify/lib/portal/uploads.mjs';
import {errorResponse} from '../../netlify/lib/portal/http.mjs';

for(const action of ['upload','resumeUpload'])test(action+' pairs its signed token with the signed TUS endpoint',async()=>{
  const file={bucket:'quadrion-software',object_path:'release/file/team.zip',filename:'team.zip',bytes:100,sha256:'a'.repeat(64),mime_type:'application/octet-stream'};
  const session={id:'10000000-0000-4000-8000-000000000001',state:'pending',verified_bytes:0,expires_at:'2099-01-01T00:00:00Z',file};
  const backend={rpc:async()=>session,service:{storage:{from(bucket){assert.equal(bucket,'quadrion-software');return {createSignedUploadUrl:async(path,options)=>{assert.equal(path,'release/file/team.zip');assert.equal(options.upsert,false);return {data:{token:'file-scoped-test-token'},error:null};}};}}}};
  const actions=createUploadActions({config:{url:'https://fixture.supabase.co',verifySecret:'x'.repeat(32),releaseMaxBytes:1000000000},backend});
  const input=action==='upload'?{releaseId:session.id,projectVersionId:null,kind:'binary',filename:file.filename,bytes:file.bytes,sha256:file.sha256}:{id:session.id,filename:file.filename,bytes:file.bytes,sha256:file.sha256};
  const result=await actions(action,input,{});
  assert.equal(result.endpoint,'https://fixture.storage.supabase.co/storage/v1/upload/resumable/sign');
  assert.equal(result.token,'file-scoped-test-token');
});

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

test('release uploads accept processing tar.gz archives while project uploads keep their AIO restriction',async()=>{
  const id='10000000-0000-4000-8000-000000000001',allocations=[];
  const actions=createUploadActions({config:{url:'https://fixture.supabase.co',verifySecret:'x'.repeat(32),releaseMaxBytes:1000000000,projectMaxBytes:1000000000},backend:{rpc:async(name,args)=>{allocations.push(args.p_data);return {id,state:'pending',verified_bytes:0,file:{...args.p_data,bucket:'quadrion-software',object_path:'fixture/kit.tar.gz'}};},service:{storage:{from:()=>({createSignedUploadUrl:async()=>({data:{token:'test-token'}})})}}}});
  const data={releaseId:id,projectVersionId:null,kind:'binary',filename:'pipeline-pack-0.20.0-win-x64.tar.gz',bytes:403990062,sha256:'a'.repeat(64)};
  const result=await actions('upload',data,{});assert.equal(result.state,'pending');assert.equal(allocations[0].filename,data.filename);
  await assert.rejects(actions('upload',{...data,releaseId:null,projectVersionId:id},{}),/portal:invalid/);
  await assert.rejects(actions('upload',{...data,filename:'kit.gz'},{}),/portal:invalid/);assert.equal(allocations.length,1);
});

test('resuming with a different file returns a specific recovery error without issuing an upload token',async()=>{
  let signed=0;
  const actions=createUploadActions({config:{verifySecret:'x'.repeat(32)},backend:{rpc:async()=>({state:'pending',expires_at:'2099-01-01T00:00:00Z',file:{filename:'team.zip',bytes:100,sha256:'a'.repeat(64)}}),service:{storage:{from(){signed++;}}}}});
  for(const change of [{filename:'installer.exe'},{bytes:200},{sha256:'b'.repeat(64)}]){
    await assert.rejects(actions('resumeUpload',{id:'10000000-0000-4000-8000-000000000001',filename:'team.zip',bytes:100,sha256:'a'.repeat(64),...change},{}),asyncError=>{
      assert.equal(asyncError.message,'portal:upload_file_mismatch');assert.equal(errorResponse(asyncError).status,409);return true;
    });
  }
  assert.equal(signed,0);
});
