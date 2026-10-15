import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
let db;
before(async()=>{db=await portalDb();});
after(async()=>{await db?.close();});
const change=(actor,aal,target,revision,role,tier,status='active')=>rpc(db,'portal_member_change',[actor,aal,target,revision,role,tier,status,null]);
test('MFA and current role gate mutations; T3 and admins cannot grant privileged roles',async()=>{
  await assert.rejects(change(ids.owner,'aal1',ids.t1,1,'member',2),/portal:mfa_required/);
  await assert.rejects(change(ids.t3,'aal2',ids.t1,1,'member',2),/portal:forbidden/);
  await assert.rejects(change(ids.admin,'aal2',ids.t1,1,'owner',null),/portal:forbidden/);
  await assert.rejects(change(ids.admin,'aal2',ids.owner,1,'member',1),/portal:forbidden/);
});
test('member updates are revision checked and audited atomically',async()=>{
  const result=await change(ids.admin,'aal2',ids.t1,1,'member',2);
  assert.equal(result.tier,2);assert.equal(result.revision,2);
  await assert.rejects(change(ids.admin,'aal2',ids.t1,1,'member',3),/portal:conflict/);
  await db.exec("alter table public.portal_events add constraint fail_test check(action <> 'member_changed') not valid");
  try { await assert.rejects(change(ids.admin,'aal2',ids.t1,2,'member',3),/fail_test/); }
  finally {await db.exec('alter table public.portal_events drop constraint fail_test');}
  assert.equal((await db.query('select tier from public.portal_members where user_id=$1',[ids.t1])).rows[0].tier,2);
});
test('last active owner cannot be removed or suspended',async()=>{
  await assert.rejects(change(ids.owner,'aal2',ids.owner,1,'member',3),/portal:last_owner/);
  await assert.rejects(change(ids.owner,'aal2',ids.owner,1,'owner',null,'suspended'),/portal:last_owner/);
});
test('project classification, assignments and metadata enforce tier intersection',async()=>{
  await assert.rejects(rpc(db,'portal_save_project',[ids.owner,'aal2',{title:'Oil',category:'oil_gas',minimumTier:2,audience:'tier'}]),/check constraint/);
  const project=await rpc(db,'portal_save_project',[ids.owner,'aal2',{title:'Private site',category:'oil_gas',minimumTier:3,audience:'assigned'}]);
  const version=await rpc(db,'portal_save_version',[ids.owner,'aal2',{projectId:project.id,version:'1.0',minimumAppVersion:'0.14.0',notes:'Initial'}]);
  await assert.rejects(rpc(db,'portal_save_version',[ids.owner,'aal2',{projectId:project.id,version:'1.0'}]),/duplicate key/);
  await assert.rejects(rpc(db,'portal_publish',[ids.owner,'aal2','project',project.id,1,version.id]),/portal:unverified/);
  await db.query("insert into public.artifact_files(project_version_id,kind,bucket,object_path,filename,bytes,sha256,state) values ($1,'binary','quadrion-projects','fixture/file.aio','file.aio',20,$2,'verified')",[version.id,'a'.repeat(64)]);
  await assert.rejects(rpc(db,'portal_publish',[ids.owner,'aal2','project',project.id,1,version.id]),/portal:empty_audience/);
  await rpc(db,'portal_set_assignments',[ids.owner,'aal2',project.id,1,[{userId:ids.t2,expiresAt:null},{userId:ids.t3,expiresAt:null}]]);
  await rpc(db,'portal_publish',[ids.owner,'aal2','project',project.id,2,version.id]);
  assert.equal(await rpc(db,'portal_project_visible',[ids.t2,project.id,'aal1']),false);
  assert.equal(await rpc(db,'portal_project_visible',[ids.t3,project.id,'aal1']),true);
  assert.equal(await rpc(db,'portal_project_visible',[ids.owner,project.id,'aal1']),false);
  const t2=await rpc(db,'portal_catalog',[ids.t2,'aal1','projects','',0]);assert.equal(t2.items.length,0);
  const t3=await rpc(db,'portal_catalog',[ids.t3,'aal1','projects','',0]);assert.equal(t3.items[0].title,'Private site');
  await rpc(db,'portal_set_assignments',[ids.owner,'aal2',project.id,3,[]]);
  assert.equal(await rpc(db,'portal_project_visible',[ids.t3,project.id,'aal1']),false);
});
test('anonymous and authenticated callers cannot invoke trusted functions or read catalogue records',async()=>{
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    try {
      await assert.rejects(db.query('select * from public.projects'),/permission denied/);
      await assert.rejects(change(ids.owner,'aal2',ids.t1,2,'member',3),/permission denied/);
      await assert.rejects(rpc(db,'portal_catalog',[ids.owner,'aal2','projects','',0]),/permission denied/);
    } finally {await db.exec('reset role');}
  }
});

test('release download reservation enforces live status, quota and immutable file identity',async()=>{
  const r=await rpc(db,'portal_save_release',[ids.owner,'aal2',{kind:'app',version:'0.14.0',platform:'windows'}]);
  const f=(await db.query("insert into public.artifact_files(release_id,kind,bucket,object_path,filename,bytes,sha256,state) values ($1,'binary','quadrion-software','fixture/app.exe','app.exe',20,$2,'verified') returning id",[r.id,'b'.repeat(64)])).rows[0];
  await assert.rejects(rpc(db,'portal_download',[ids.t1,'aal1',f.id]),/portal:not_found/);
  await rpc(db,'portal_publish',[ids.owner,'aal2','release',r.id,1,null]);
  const download=await rpc(db,'portal_download',[ids.t1,'aal1',f.id]); assert.equal(download.object_path,'fixture/app.exe');
  await assert.rejects(db.query("update public.artifact_files set object_path='changed.exe' where id=$1",[f.id]),/portal:immutable_artifact/);
  for(let n=1;n<30;n++) await rpc(db,'portal_download',[ids.t1,'aal1',f.id]);
  await assert.rejects(rpc(db,'portal_download',[ids.t1,'aal1',f.id]),/portal:rate_limited/);
  await db.query("update public.portal_members set status='suspended' where user_id=$1",[ids.t1]);
  await assert.rejects(rpc(db,'portal_download',[ids.t1,'aal1',f.id]),/portal:forbidden/);
  await db.query("update public.portal_members set status='active' where user_id=$1",[ids.t1]);
  await rpc(db,'portal_archive',[ids.owner,'aal2','release',r.id,2]);
  await assert.rejects(rpc(db,'portal_download',[ids.t3,'aal1',f.id]),/portal:not_found/);
});
test('invited membership activates only after confirmation and before expiry; Auth bans deny access',async()=>{
  await db.query("update public.portal_members set status='invited' where user_id=$1",[ids.t2]);
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids.t2]);
  await assert.rejects(rpc(db,'portal_account',[ids.t2]),/portal:forbidden/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.t2]);
  assert.equal((await rpc(db,'portal_account',[ids.t2])).status,'active');
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[ids.t2]);
  await assert.rejects(rpc(db,'portal_account',[ids.t2]),/portal:forbidden/);
  await db.query('update auth.users set banned_until=null where id=$1',[ids.t2]);
  await db.query("update public.portal_members set status='invited',expires_at=now() where user_id=$1",[ids.t2]);
  await assert.rejects(rpc(db,'portal_account',[ids.t2]),/portal:forbidden/);
});
