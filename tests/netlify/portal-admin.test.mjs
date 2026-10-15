import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../../netlify/lib/portal/admin-api.mjs';
const config={enabled:true,origin:'https://quadrion.ai',url:'https://example.supabase.co'},context={deploy:{context:'production',published:true}};
function fixture(role='owner',aal='aal2'){
  const calls=[];const backend={verifyUser:async()=>({userId:'10000000-0000-4000-8000-000000000001',emailConfirmed:true,aal}),account:async()=>({user_id:'10000000-0000-4000-8000-000000000001',role,tier:role==='member'?3:null,status:'active',expires_at:null}),rpc:async(name,args)=>{calls.push({name,args});return {items:[]};}};
  return {calls,backend,handler:createAdminHandler({config,backend})};
}
const req=(action,body)=>new Request('https://quadrion.ai/api/portal-admin?action='+action,{method:body?'POST':'GET',headers:{authorization:'Bearer valid',origin:config.origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('T3 members and administrators without MFA cannot execute any admin action',async()=>{
  for(const [role,aal] of [['member','aal2'],['admin','aal1'],['owner','aal1']]){
    const f=fixture(role,aal);assert.equal((await f.handler(req('users'),context)).status,403);assert.equal(f.calls.length,0);
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
