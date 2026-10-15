import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySlice} from '../netlify/lib/portal/verification.mjs';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
test('verification resumes from checkpoints and rejects changed or truncated objects',async()=>{
  const bytes=Buffer.from('bounded verification across separate invocations'),sha=createHash('sha256').update(bytes).digest('hex');
  let checkpoint;const job={bytes:bytes.length,sha256:sha,verified_bytes:0,hash_state:null,object_etag:null};
  const readRange=async(start,end)=>new Response(bytes.subarray(start,end+1),{status:206,headers:{etag:'"v1"','content-range':`bytes ${start}-${end}/${bytes.length}`}});
  let now=0;const first=await verifySlice({job,readRange,checkpoint:async v=>{checkpoint=v;now+=100;},clock:()=>now,budgetMs:50,chunkBytes:8});
  assert.equal(first.done,false);assert.equal(checkpoint.offset,8);
  const second=await verifySlice({job:{...job,verified_bytes:checkpoint.offset,hash_state:checkpoint.hashState,object_etag:checkpoint.etag},readRange,checkpoint:async v=>{checkpoint=v;},chunkBytes:8});assert.equal(second.done,true);assert.equal(second.sha256,sha);
  await assert.rejects(verifySlice({job,readRange:async()=>new Response('short',{status:206,headers:{etag:'"v1"','content-range':`bytes 0-7/${bytes.length}`}}),checkpoint:async()=>{},chunkBytes:8}),/size_mismatch/);
  await assert.rejects(verifySlice({job:{...job,object_etag:'"old"'},readRange,checkpoint:async()=>{},chunkBytes:8}),/object_changed/);
  await assert.rejects(verifySlice({job:{...job,sha256:'f'.repeat(64)},readRange,checkpoint:async()=>{},chunkBytes:8}),/checksum_mismatch/);
});
test('revoked administrators cannot finalize, leases exclude other workers, and mismatched hashes never verify',async()=>{
  const db=await portalDb();try{
    const release=await rpc(db,'portal_save_release',[ids.admin,'aal2',{kind:'app',version:'1',platform:'windows'}]);
    const input={releaseId:release.id,projectVersionId:null,kind:'binary',filename:'app.exe',bytes:100,sha256:'a'.repeat(64),mimeType:'application/octet-stream',maxBytes:1000000000};
    const session=await rpc(db,'portal_upload_begin',[ids.admin,'aal2',input]);
    await db.query("update public.portal_members set status='revoked' where user_id=$1",[ids.admin]);
    await assert.rejects(rpc(db,'portal_upload_command',[ids.admin,'aal2',session.id,'finalize']),/portal:forbidden/);
    await db.query("update public.portal_members set status='active' where user_id=$1",[ids.admin]);
    await rpc(db,'portal_upload_command',[ids.admin,'aal2',session.id,'finalize']);
    const job=await rpc(db,'portal_verify_claim',[session.id]);assert.ok(job.lease_id);assert.equal(await rpc(db,'portal_verify_claim',[session.id]),null);
    await assert.rejects(rpc(db,'portal_verify_checkpoint',[session.id,job.lease_id,100,null,'etag','b'.repeat(64)]),/portal:checksum_mismatch/);
    assert.equal((await db.query('select state from public.artifact_files where id=$1',[session.artifact_id])).rows[0].state,'verifying');
    await rpc(db,'portal_verify_checkpoint',[session.id,job.lease_id,100,null,'etag','a'.repeat(64)]);
    assert.equal((await db.query('select state from public.artifact_files where id=$1',[session.artifact_id])).rows[0].state,'verified');
  }finally{await db.close();}
});
