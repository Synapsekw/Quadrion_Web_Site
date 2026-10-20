import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySlice} from '../netlify/lib/portal/verification.mjs';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';

for(const [kind,filename,mimeType,bytes,maxBytes] of [
  ['binary','project.aio','application/octet-stream',3000000000,100000000000],
  ['preview','cover.png','image/png',100,10000000],
])test('project '+kind+' uploads allocate against the version ID with password-only admin access',async()=>{
  const db=await portalDb();try{
    const project=await rpc(db,'portal_save_project',[ids.owner,'aal1',{title:'Project upload',category:'basic',minimumTier:2,audience:'tier'}]);
    const version=await rpc(db,'portal_save_version',[ids.owner,'aal1',{projectId:project.id,version:'1.0'}]);
    const session=await rpc(db,'portal_upload_begin',[ids.owner,'aal1',{releaseId:null,projectVersionId:version.id,kind,filename,bytes,sha256:'a'.repeat(64),mimeType,maxBytes}]);
    assert.equal(session.state,'pending');
    assert.equal(session.file.project_version_id,version.id);
    assert.equal(session.file.release_id,null);
    assert.equal(session.file.bucket,'quadrion-projects');
    assert.equal(session.file.kind,kind);
    assert.equal(session.file.filename,filename);
    assert.equal(session.file.bytes,bytes);
    assert.equal(session.file.object_path,version.id+'/'+session.file.id+'/'+filename);
    const listed=await rpc(db,'portal_admin_list',[ids.owner,'aal1','projects','',0]);
    assert.equal(listed.items[0].versions[0].files[0].upload_session_id,session.id);
    assert.equal((await rpc(db,'portal_upload_command',[ids.owner,'aal1',session.id,'resume'])).file.id,session.file.id);
    await rpc(db,'portal_upload_command',[ids.owner,'aal1',session.id,'finalize']);
    const job=await rpc(db,'portal_verify_claim',[session.id]);
    await rpc(db,'portal_verify_checkpoint',[session.id,job.lease_id,bytes,null,'v1','a'.repeat(64)]);
    assert.equal((await rpc(db,'portal_upload_command',[ids.owner,'aal1',session.id,'status'])).state,'verified');
  }finally{await db.close();}
});

test('project upload allocation rejects unknown and published versions without leaving files',async()=>{
  const db=await portalDb();try{
    const input={releaseId:null,projectVersionId:'20000000-0000-4000-8000-000000000001',kind:'binary',filename:'project.aio',bytes:100,sha256:'a'.repeat(64),mimeType:'application/octet-stream',maxBytes:100000000000};
    await assert.rejects(rpc(db,'portal_upload_begin',[ids.owner,'aal1',input]),/portal:conflict/);
    const project=await rpc(db,'portal_save_project',[ids.owner,'aal1',{title:'Published project',category:'basic',minimumTier:2,audience:'tier'}]);
    const version=await rpc(db,'portal_save_version',[ids.owner,'aal1',{projectId:project.id,version:'1.0'}]);
    const session=await rpc(db,'portal_upload_begin',[ids.owner,'aal1',{...input,projectVersionId:version.id}]);
    await rpc(db,'portal_upload_command',[ids.owner,'aal1',session.id,'finalize']);
    const job=await rpc(db,'portal_verify_claim',[session.id]);
    await rpc(db,'portal_verify_checkpoint',[session.id,job.lease_id,100,null,'v1','a'.repeat(64)]);
    await rpc(db,'portal_publish',[ids.owner,'aal1','project',project.id,1,version.id]);
    await assert.rejects(rpc(db,'portal_upload_begin',[ids.owner,'aal1',{...input,projectVersionId:version.id,kind:'preview',filename:'cover.png',mimeType:'image/png'}]),/portal:conflict/);
    assert.equal((await db.query('select count(*)::int n from public.artifact_files')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from public.upload_sessions')).rows[0].n,1);
  }finally{await db.close();}
});

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

test('cleanup claims abandoned files before removal and prevents retry or publication',async()=>{
  const db=await portalDb();try{
    const release=await rpc(db,'portal_save_release',[ids.admin,'aal2',{kind:'app',version:'cleanup',platform:'windows'}]);
    const input={releaseId:release.id,kind:'binary',filename:'app.exe',bytes:100,sha256:'a'.repeat(64),mimeType:'application/octet-stream',maxBytes:1000000000};
    const s=await rpc(db,'portal_upload_begin',[ids.admin,'aal2',input]);
    await db.query("update public.upload_sessions set state='failed',expires_at=now()-interval '9 days' where id=$1",[s.id]);
    await db.query("update public.artifact_files set state='failed' where id=$1",[s.artifact_id]);
    const candidates=await rpc(db,'portal_cleanup',[null]);assert.equal(candidates.length,1);
    await assert.rejects(rpc(db,'portal_upload_command',[ids.admin,'aal2',s.id,'retry']),/portal:conflict/);
    assert.equal(await rpc(db,'portal_verify_claim',[s.id]),null);
    await assert.rejects(rpc(db,'portal_publish',[ids.admin,'aal2','release',release.id,1,null]),/portal:unverified/);
    const next=await rpc(db,'portal_upload_begin',[ids.admin,'aal2',input]);assert.notEqual(next.file.object_path,s.file.object_path);
    await rpc(db,'portal_cleanup',[s.id]);await rpc(db,'portal_cleanup',[s.id]);
    assert.equal((await rpc(db,'portal_cleanup',[null])).length,0);
  }finally{await db.close();}
});

test('expired or invalid uploads can be abandoned and replaced without losing their audit identity',async()=>{
  const db=await portalDb();try{
    const r=await rpc(db,'portal_save_release',[ids.admin,'aal2',{kind:'app',version:'replace',platform:'windows'}]);
    const input={releaseId:r.id,kind:'binary',filename:'app.exe',bytes:100,sha256:'a'.repeat(64),mimeType:'application/octet-stream',maxBytes:1000000000};
    const s=await rpc(db,'portal_upload_begin',[ids.admin,'aal2',input]);
    await db.query("update public.upload_sessions set expires_at=now()-interval '1 minute' where id=$1",[s.id]);
    await assert.rejects(rpc(db,'portal_upload_command',[ids.admin,'aal2',s.id,'finalize']),/portal:conflict/);
    await rpc(db,'portal_upload_command',[ids.admin,'aal2',s.id,'abandon']);
    const next=await rpc(db,'portal_upload_begin',[ids.admin,'aal2',input]);
    assert.notEqual(next.file.id,s.file.id);assert.notEqual(next.file.object_path,s.file.object_path);
    assert.equal((await db.query('select count(*)::int n from public.artifact_files where release_id=$1',[r.id])).rows[0].n,2);
    assert.equal((await rpc(db,'portal_admin_list',[ids.admin,'aal2','releases','',0])).items[0].files.length,1);
    await rpc(db,'portal_upload_command',[ids.admin,'aal2',next.id,'finalize']);
    const job=await rpc(db,'portal_verify_claim',[next.id]);
    await rpc(db,'portal_verify_checkpoint',[next.id,job.lease_id,100,null,'v1','a'.repeat(64)]);
    await assert.rejects(rpc(db,'portal_upload_command',[ids.admin,'aal2',next.id,'abandon']),/portal:conflict/);
    await rpc(db,'portal_publish',[ids.admin,'aal2','release',r.id,1,null]);
    await db.query("update public.upload_sessions set expires_at=now()-interval '9 days' where id=$1",[s.id]);
    const cleanup=await rpc(db,'portal_cleanup',[null]);assert.deepEqual(cleanup.map(c=>c.id),[s.id]);
    assert.equal((await rpc(db,'portal_upload_command',[ids.admin,'aal2',next.id,'status'])).state,'verified');
  }finally{await db.close();}
});
