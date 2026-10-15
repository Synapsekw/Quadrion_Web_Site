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
  await assert.rejects(rpc(db,'portal_admin_list',[ids.owner,'aal1','users','',0]),/portal:mfa_required/);
  const users=await rpc(db,'portal_admin_list',[ids.admin,'aal2','users','',0]);assert.ok(users.items.some(m=>m.email==='new@example.com'));
});
