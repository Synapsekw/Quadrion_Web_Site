import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
let db;
before(async()=>{db=await portalDb();});
after(async()=>{await db?.close();});
const input=(email='manual@example.com')=>({email,tier:2,expiresAt:null,idempotencyKey:randomUUID()});
const begin=(data,actor=ids.owner,aal='aal1')=>rpc(db,'portal_create_user_begin',[actor,aal,data]);
const resolve=(id,action='reconcile',actor=ids.owner)=>rpc(db,'portal_create_user_resolve',[actor,'aal2',id,action]);

test('manual creation is owner-only with password sessions and denies existing accounts',async()=>{
  await assert.rejects(begin(input(),ids.admin),/portal:forbidden/);
  await assert.rejects(begin(input(),ids.owner,null),/portal:unauthorized/);
  await assert.rejects(begin(input('t3@example.com')),/portal:account_exists/);
  await assert.rejects(begin({...input(),role:'owner'}),/portal:invalid/);
  await assert.rejects(begin({...input(),tier:4}),/portal:invalid/);
  await assert.rejects(begin({...input(),password:'never-store-this'}),/portal:invalid/);
});

test('a confirmed manual identity is bound once and becomes an active tier member without email',async()=>{
  const data=input(),intent=await begin(data),userId=randomUUID();
  assert.equal(intent.dispatch,true);
  assert.equal((await begin(data)).dispatch,false);
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values ($1,$2,now(),$3)",[userId,data.email,{quadrion_creation_id:intent.id}]);
  const result=await resolve(intent.id);
  assert.equal(result.status,'created');assert.equal(result.user_id,userId);
  const member=await rpc(db,'portal_account',[userId]);
  assert.equal(member.status,'active');assert.equal(member.role,'member');assert.equal(member.tier,2);
  await resolve(intent.id);
  assert.equal((await db.query("select count(*)::int n from public.portal_events where resource_id=$1 and action='user_created_manually'",[intent.id])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.portal_invitations where email=$1',[data.email])).rows[0].n,0);
});

test('lost responses cannot bind an unrelated identity or dispatch another password',async()=>{
  const data=input('ambiguous@example.com'),intent=await begin(data),userId=randomUUID();
  assert.equal((await resolve(intent.id)).status,'creating');
  await assert.rejects(begin({...data,idempotencyKey:randomUUID()}),/portal:creation_pending/);
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values ($1,$2,now(),'{}')",[userId,data.email]);
  assert.equal((await resolve(intent.id)).status,'creating');
  assert.equal((await db.query('select count(*)::int n from public.portal_members where user_id=$1',[userId])).rows[0].n,0);
  await assert.rejects(resolve(intent.id,'cancel'),/portal:conflict/);
});

test('current owner authority and atomic audit protect the final manual grant',async()=>{
  const data=input('audit@example.com'),intent=await begin(data),userId=randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values ($1,$2,now(),$3)",[userId,data.email,{quadrion_creation_id:intent.id}]);
  await assert.rejects(resolve(intent.id,'reconcile',ids.admin),/portal:forbidden/);
  await db.query("update public.portal_members set status='suspended' where user_id=$1",[ids.owner]);
  await assert.rejects(resolve(intent.id),/portal:forbidden/);
  await db.query("update public.portal_members set status='active' where user_id=$1",[ids.owner]);
  await db.exec("alter table public.portal_events add constraint manual_audit_fail check(action <> 'user_created_manually') not valid");
  try{await assert.rejects(resolve(intent.id),/manual_audit_fail/);}finally{await db.exec('alter table public.portal_events drop constraint manual_audit_fail');}
  assert.equal((await db.query('select count(*)::int n from public.portal_members where user_id=$1',[userId])).rows[0].n,0);
  assert.equal((await resolve(intent.id)).status,'created');
});

test('manual creation recovery never grants browser roles database access',async()=>{
  const data=input('cancel@example.com'),intent=await begin(data);
  await db.query("update public.portal_user_creations set created_at=now()-interval '11 minutes' where id=$1",[intent.id]);
  assert.equal((await resolve(intent.id,'cancel')).status,'cancelled');
  assert.equal((await begin({...data,idempotencyKey:randomUUID()})).dispatch,true);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    try{await assert.rejects(db.query('select * from public.portal_user_creations'),/permission denied/);await assert.rejects(begin(input()),/permission denied/);}finally{await db.exec('reset role');}
  }
});
