import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../../netlify/lib/portal/admin-api.mjs';
const config={enabled:true,origin:'https://quadrion.ai',url:'https://example.supabase.co'},context={deploy:{context:'production',published:true}};
function fixture(role='owner',aal='aal2'){
  const calls=[];const backend={verifyUser:async()=>({userId:'10000000-0000-4000-8000-000000000001',emailConfirmed:true,aal}),account:async()=>({user_id:'10000000-0000-4000-8000-000000000001',role,tier:role==='member'?3:null,status:'active',expires_at:null}),rpc:async(name,args)=>{calls.push({name,args});return {items:[]};}};
  return {calls,backend,handler:createAdminHandler({config,backend})};
}
const req=(action,body)=>new Request('https://quadrion.ai/api/portal-admin?action='+action,{method:body?'POST':'GET',headers:{authorization:'Bearer valid',origin:config.origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});

test('administrators can see upload readiness without receiving the verification credential',async()=>{
  for(const [verifySecret,ready] of [[undefined,false],['too short',false],['x'.repeat(32),true]]){
    const f=fixture('owner','aal1');
    const handler=createAdminHandler({config:{...config,verifySecret},backend:f.backend});
    const response=await handler(req('overview'),context),body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.limits.uploadsReady,ready);
    if(verifySecret)assert.equal(JSON.stringify(body).includes(verifySecret),false);
  }
});
test('T3 members cannot administer; password-authenticated admins and owners can',async()=>{
  for(const [role,aal] of [['member','aal2'],['member','aal1']]){
    const f=fixture(role,aal);assert.equal((await f.handler(req('users'),context)).status,403);assert.equal(f.calls.length,0);
  }
  for(const role of ['admin','owner']){
    const f=fixture(role,'aal1');assert.equal((await f.handler(req('users'),context)).status,200);assert.equal(f.calls.length,1);
  }
});
test('admin mutations derive actor from Auth and reject privilege/payload injection',async()=>{
  const f=fixture('admin');
  assert.equal((await f.handler(req('member',{userId:'10000000-0000-4000-8000-000000000003',role:'owner',tier:null,status:'active',expiresAt:null,revision:1}),context)).status,403);
  assert.equal((await f.handler(req('member',{actor:'forged'}),context)).status,400);assert.equal(f.calls.length,0);
  const r=await f.handler(req('member',{userId:'10000000-0000-4000-8000-000000000003',role:'member',tier:2,status:'active',expiresAt:null,revision:1}),context);assert.equal(r.status,200);assert.equal(f.calls[0].args.p_actor,'10000000-0000-4000-8000-000000000001');
});
test('publication requires exact IDs, a revision and no browser-supplied paths',async()=>{
  const f=fixture();assert.equal((await f.handler(req('publish',{kind:'project',id:'../secret',revision:1}),context)).status,400);
  assert.equal((await f.handler(req('publish',{kind:'project',id:'10000000-0000-4000-8000-000000000003',revision:1,versionId:null,object_path:'private'}),context)).status,400);
  assert.equal(f.calls.length,0);
});

test('definite invite errors are persisted; unknown delivery is reconciled without redispatch',async()=>{
  for(const status of [429,500]){
    const f=fixture();f.backend.rpc=async(name,args)=>{f.calls.push({name,args});return name==='portal_invite_begin'?{id:'10000000-0000-4000-8000-000000000009',dispatch:true}:{status:name==='portal_invite_recover'?'failed':'dispatching'};};
    f.backend.service={auth:{admin:{inviteUserByEmail:async()=>({data:null,error:{status}})}}};
    const response=await f.handler(req('invite',{email:'test@example.com',role:'member',tier:1,expiresAt:null,idempotencyKey:'10000000-0000-4000-8000-000000000008'}),context);
    assert.equal(response.status,200);assert.equal(f.calls.at(-1).name,status===429?'portal_invite_recover':'portal_invite_resolve');
  }
  const f=fixture();assert.equal((await f.handler(req('inviteRecovery',{id:'10000000-0000-4000-8000-000000000009',action:'failed'}),context)).status,400);
});

test('only an owner can create an immediately usable member without email after password sign-in',async()=>{
  const body={email:'manual@example.com',password:'A local test password 123!',tier:2,expiresAt:null,idempotencyKey:'10000000-0000-4000-8000-000000000008'};
  for(const [role,aal] of [['member','aal2'],['admin','aal2'],['admin','aal1']]){
    const denied=fixture(role,aal);assert.equal((await denied.handler(req('createUser',body),context)).status,403);assert.equal(denied.calls.length,0);
  }
  const f=fixture('owner','aal1');let created=0;
  f.backend.rpc=async(name,args)=>{f.calls.push({name,args});return name==='portal_create_user_begin'?{id:body.idempotencyKey,dispatch:created===0}:{status:'created',email:body.email};};
  f.backend.service={auth:{admin:{createUser:async input=>{created++;assert.equal(input.email_confirm,true);assert.equal(input.password,body.password);assert.equal(input.app_metadata.quadrion_creation_id,body.idempotencyKey);return {data:{user:{id:'10000000-0000-4000-8000-000000000009'}},error:null};},inviteUserByEmail:async()=>assert.fail('Manual users must not receive invitations')}}};
  const response=await f.handler(req('createUser',body),context);assert.equal(response.status,200);
  assert.equal((await response.text()).includes(body.password),false);assert.equal(JSON.stringify(f.calls).includes(body.password),false);
  assert.equal((await f.handler(req('createUser',body),context)).status,200);assert.equal(created,1);
  assert.equal((await f.handler(req('createUser',{...body,role:'owner'}),context)).status,400);
  assert.equal((await f.handler(req('createUser',{...body,password:'short'}),context)).status,400);
  assert.equal((await f.handler(req('creationRecovery',{id:body.idempotencyKey,action:'failed'}),context)).status,400);
});

test('manual user provider failures are safe and uncertain responses are never blindly retried',async()=>{
  for(const status of [422,500]){
    const f=fixture();f.backend.rpc=async(name,args)=>{f.calls.push({name,args});return name==='portal_create_user_begin'?{id:'10000000-0000-4000-8000-000000000009',dispatch:true}:{status:args.p_action==='failed'?'failed':'creating'};};
    f.backend.service={auth:{admin:{createUser:async()=>({error:{status,message:'private-provider-details'},data:null})}}};
    const response=await f.handler(req('createUser',{email:'test@example.com',password:'Local test password 123!',tier:1,expiresAt:null,idempotencyKey:'10000000-0000-4000-8000-000000000008'}),context);
    assert.equal(response.status,200);assert.equal(f.calls.at(-1).args.p_action,status===422?'failed':'reconcile');assert.equal((await response.text()).includes('private-provider-details'),false);
  }
});
