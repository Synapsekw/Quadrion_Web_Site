import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
let db;before(async()=>{db=await portalDb();});after(async()=>db?.close());
const data={email:'new@example.com',tier:2,role:'member',expiresAt:null,idempotencyKey:'10000000-0000-4000-8000-000000000091'};
test('invitation intents serialize sending and recover an ambiguous Auth success without resending',async()=>{
  const first=await rpc(db,'portal_invite_begin',[ids.admin,'aal2',data]);assert.equal(first.dispatch,true);
  const retry=await rpc(db,'portal_invite_begin',[ids.admin,'aal2',data]);assert.equal(retry.dispatch,false);assert.equal(retry.id,first.id);
  const unknown=await rpc(db,'portal_invite_resolve',[ids.admin,'aal2',first.id,null]);assert.equal(unknown.status,'dispatching');
  const uid='10000000-0000-4000-8000-000000000092';await db.query('insert into auth.users(id,email) values($1,$2)',[uid,data.email]);
  const bound=await rpc(db,'portal_invite_resolve',[ids.admin,'aal2',first.id,null]);assert.equal(bound.status,'sent');
  const m=(await db.query('select * from public.portal_members where user_id=$1',[uid])).rows[0];assert.equal(m.tier,2);assert.equal(m.status,'invited');
  assert.equal((await rpc(db,'portal_invite_resolve',[ids.admin,'aal2',first.id,uid])).status,'sent');
  assert.equal((await db.query("select count(*)::int n from public.portal_events where action='invitation_bound'")).rows[0].n,1);
});
test('reused idempotency keys cannot change grants, admins cannot invite administrators, and recipient cooldown applies',async()=>{
  await assert.rejects(rpc(db,'portal_invite_begin',[ids.admin,'aal2',{...data,tier:3}]),/portal:conflict/);
  await assert.rejects(rpc(db,'portal_invite_begin',[ids.admin,'aal2',{...data,email:'admin@example.com',role:'admin',tier:null,idempotencyKey:'10000000-0000-4000-8000-000000000093'}]),/portal:forbidden/);
  await assert.rejects(rpc(db,'portal_invite_begin',[ids.admin,'aal2',{...data,idempotencyKey:'10000000-0000-4000-8000-000000000094',resend:true}]),/portal:rate_limited/);
});
test('current administrator checks gate all admin listings',async()=>{
  await assert.rejects(rpc(db,'portal_admin_list',[ids.t3,'aal2','users','',0]),/portal:forbidden/);
  assert.ok((await rpc(db,'portal_admin_list',[ids.owner,'aal1','users','',0])).items.length);
  const users=await rpc(db,'portal_admin_list',[ids.admin,'aal2','users','',0]);assert.ok(users.items.some(m=>m.email==='new@example.com'));
});

test('definite failures release the recipient after cooldown; unknown outcomes need reconciliation before cancellation',async()=>{
  const input={...data,email:'failure@example.com',idempotencyKey:'10000000-0000-4000-8000-000000000095'};
  const first=await rpc(db,'portal_invite_begin',[ids.admin,'aal2',input]);
  const failed=await rpc(db,'portal_invite_recover',[ids.admin,'aal2',first.id,'failed']);assert.equal(failed.status,'failed');
  await db.query("update public.portal_invitations set created_at=now()-interval '11 minutes' where id=$1",[first.id]);
  const second=await rpc(db,'portal_invite_begin',[ids.admin,'aal2',{...input,idempotencyKey:'10000000-0000-4000-8000-000000000096'}]);assert.equal(second.dispatch,true);
  await assert.rejects(rpc(db,'portal_invite_recover',[ids.admin,'aal2',second.id,'cancel']),/portal:conflict/);
  await db.query("update public.portal_invitations set created_at=now()-interval '11 minutes' where id=$1",[second.id]);
  assert.equal((await rpc(db,'portal_invite_recover',[ids.admin,'aal2',second.id,'cancel'])).status,'cancelled');
  const third=await rpc(db,'portal_invite_begin',[ids.admin,'aal2',{...input,idempotencyKey:'10000000-0000-4000-8000-000000000097'}]);
  const uid='10000000-0000-4000-8000-000000000098';await db.query('insert into auth.users(id,email) values($1,$2)',[uid,input.email]);
  await db.query("update public.portal_invitations set created_at=now()-interval '11 minutes' where id=$1",[third.id]);
  assert.equal((await rpc(db,'portal_invite_recover',[ids.admin,'aal2',third.id,'cancel'])).status,'sent');
});
