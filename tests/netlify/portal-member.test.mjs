import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberHandler} from '../../netlify/lib/portal/member-api.mjs';
const config={enabled:true,url:'https://example.supabase.co',publishableKey:'sb_publishable_example',secretKey:'secret',origin:'https://quadrion.ai'};
const production={deploy:{context:'production',published:true}};
const artifactId='10000000-0000-4000-8000-000000000001';
function fixture(){
  let active=true,allowed=true,signed=0;
  const backend={
    async verifyUser(token){if(token!=='valid')throw new Error('portal:unauthorized');return {userId:'user',emailConfirmed:true,aal:'aal1',email:'test@example.com'};},
    async account(){if(!active)throw new Error('portal:forbidden');return {user_id:'user',role:'member',tier:2,status:'active',expires_at:null,revision:1};},
    async catalog(){return {items:[],total:0};},
    async project(){if(!allowed)throw new Error('portal:not_found');return {id:artifactId,title:'Example'};},
    async reserveDownload(){if(!allowed)throw new Error('portal:not_found');return {id:artifactId,bucket:'quadrion-projects',object_path:'private/file.aio',filename:'file.aio',bytes:20,sha256:'a'.repeat(64)};},
    async signDownload(){signed++;return 'https://example.supabase.co/storage/v1/object/sign/private?token=temporary';},
    async recordDownload(){},
  };
  return {backend,handler:createMemberHandler({config,backend}),revoke:()=>{active=false;},remove:()=>{allowed=false;},signed:()=>signed};
}
const req=(action,body,headers={})=>new Request('https://quadrion.ai/api/portal?action='+action,{method:body?'POST':'GET',headers:{authorization:'Bearer valid',...(body?{'content-type':'application/json',origin:config.origin}:{}),...headers},body:body?JSON.stringify(body):undefined});
test('unpublished and preview deployments return no configuration or provider access',async()=>{
  const f=fixture(); f.backend.verifyUser=()=>{throw new Error('must not run');};
  for(const context of [{},{deploy:{context:'deploy-preview',published:true}},{deploy:{context:'production',published:false}}]) {
    const r=await f.handler(req('config'),context);assert.equal(r.status,503);assert.equal((await r.text()).includes('publishable'),false);
  }
  const r=await f.handler(req('config'),production);const b=await r.json();assert.equal(b.publishableKey,config.publishableKey);assert.equal(b.secretKey,undefined);
});
test('unauthorized tokens, foreign origins and malformed bodies never sign files',async()=>{
  const f=fixture();
  assert.equal((await f.handler(req('download',{artifactId},{authorization:''}),production)).status,401);
  assert.equal((await f.handler(req('download',{artifactId},{origin:'https://evil.example'}),production)).status,403);
  assert.equal((await f.handler(req('download',{artifactId,path:'../../secret'}),production)).status,400);
  assert.equal((await f.handler(req('download',{artifactId:'../../secret'}),production)).status,400);
  assert.equal((await f.handler(req('download',{artifactId},{'content-type':'text/plain'}),production)).status,415);
  assert.equal((await f.handler(req('download',{artifactId,extra:'x'.repeat(40000)}),production)).status,413);
  assert.equal(f.signed(),0);
});
test('fresh membership and assignment changes deny the same session immediately',async()=>{
  const f=fixture();const good=await f.handler(req('download',{artifactId}),production);
  assert.equal(good.status,200);const body=await good.json();assert.equal(body.expiresIn,300);assert.equal(body.object_path,undefined);
  assert.match(good.headers.get('cache-control'),/no-store/);assert.equal(good.headers.get('referrer-policy'),'no-referrer');
  f.remove();const missing=await f.handler(req('download',{artifactId}),production);assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{error:'not_found',message:'This item is unavailable.'});
  f.revoke();assert.equal((await f.handler(req('projects'),production)).status,403);assert.equal(f.signed(),1);
});
test('password sign-in grants active owners access; unconfirmed identities are denied',async()=>{
  const f=fixture();f.backend.account=async()=>({user_id:'user',role:'owner',tier:null,status:'active',expires_at:null});
  assert.equal((await f.handler(req('releases'),production)).status,200);
  assert.equal((await (await f.handler(req('me'),production)).json()).requiresMfa,false);
  f.backend.verifyUser=async()=>({userId:'user',emailConfirmed:false,aal:'aal1'});
  assert.equal((await f.handler(req('me'),production)).status,401);
});
test('backend outages return a safe error without credentials',async()=>{
  const f=fixture();f.backend.account=async()=>{throw new Error('connection failed secret-key-re_do_not_print');};
  const r=await f.handler(req('me'),production);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret|re_do/);
});
