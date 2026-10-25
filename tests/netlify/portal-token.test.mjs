import test from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
import {createBackend} from '../../netlify/lib/portal/supabase.mjs';
import {createMemberHandler} from '../../netlify/lib/portal/member-api.mjs';
import {createAdminHandler} from '../../netlify/lib/portal/admin-api.mjs';
import {createFeedbackHandler} from '../../netlify/lib/portal/feedback-api.mjs';
const userId='30000000-0000-4000-8000-000000000001';
const production={deploy:{context:'production',published:true}};
let site=0;
// Each test gets its own Supabase URL, so the container-wide key cache starts empty.
async function project({algs=['ES256']}={}){
  const url=`https://t${++site}.supabase.co`,config={enabled:true,url,publishableKey:'sb_publishable_example',secretKey:'sb_secret_example',origin:'https://quadrion.ai'};
  const keys={};
  for(const [i,alg] of algs.entries()){const pair=await generateKeyPair(alg,{extractable:true});keys['k'+i]={alg,...pair,jwk:{...await exportJWK(pair.publicKey),kid:'k'+i,alg,use:'sig'}};}
  const published=new Set(['k0']);
  const calls={jwks:0,user:0},state={jwksStatus:200,user:{id:userId,email:'member@example.com',email_confirmed_at:'2026-10-01T00:00:00Z',is_anonymous:false}};
  const fetch=async(input,init={})=>{
    const target=new URL(typeof input==='string'?input:input.url);
    if(target.pathname==='/auth/v1/.well-known/jwks.json'){calls.jwks++;if(state.jwksStatus!==200)return new Response('down',{status:state.jwksStatus});return Response.json({keys:[...published].map(k=>keys[k].jwk)});}
    if(target.pathname==='/auth/v1/user'){calls.user++;const auth=new Headers(init.headers).get('authorization');if(!state.user||!auth)return Response.json({code:403,error_code:'session_not_found',msg:'Session not found'},{status:403});return Response.json(state.user);}
    return new Response('unexpected',{status:500});
  };
  const backend=createBackend(config,{fetch,keyCooldown:0});
  const claims=(extra={})=>({sub:userId,aud:'authenticated',role:'authenticated',aal:'aal1',email:'member@example.com',session_id:'40000000-0000-4000-8000-000000000001',is_anonymous:false,...extra});
  async function sign({kid='k0',signWith=kid,alg=keys[signWith].alg,iss=url+'/auth/v1',exp='1h',...extra}={}){
    return new SignJWT(claims(extra)).setProtectedHeader({alg,kid,typ:'JWT'}).setIssuedAt().setIssuer(iss).setExpirationTime(exp).sign(keys[signWith].privateKey);
  }
  const hs256=(extra={})=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({...claims(extra),iss:url+'/auth/v1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'c2lnbmF0dXJl'].join('.');
  return {url,config,backend,calls,state,sign,hs256,publish:kid=>published.add(kid)};
}
const refused=async(promise)=>assert.rejects(promise,{message:'portal:unauthorized'});

test('a valid asymmetric token is verified locally, with the key set fetched once per container',async()=>{
  for(const alg of ['ES256','RS256']){
    const p=await project({algs:[alg]});
    const user=await p.backend.verifyUser(await p.sign());
    assert.deepEqual(user,{userId,email:'member@example.com',emailConfirmed:true,aal:'aal1',sessionChecked:false});
    await p.backend.verifyUser(await p.sign({aal:'aal2'}));
    assert.deepEqual(p.calls,{jwks:1,user:0},alg);
  }
});
test('expired, wrong audience, wrong issuer, wrong role and anonymous tokens are refused',async()=>{
  const p=await project();
  await refused(p.backend.verifyUser(await p.sign({exp:Math.floor(Date.now()/1000)-5})));
  await refused(p.backend.verifyUser(await p.sign({aud:'anon'})));
  await refused(p.backend.verifyUser(await p.sign({aud:['authenticated','other']})));
  await refused(p.backend.verifyUser(await p.sign({iss:'https://other.supabase.co/auth/v1'})));
  await refused(p.backend.verifyUser(await p.sign({role:'service_role'})));
  await refused(p.backend.verifyUser(await p.sign({role:'anon'})));
  await refused(p.backend.verifyUser(await p.sign({is_anonymous:true})));
  await refused(p.backend.verifyUser(await p.sign({aal:'aal3'})));
  await refused(p.backend.verifyUser(await p.sign({sub:'not-a-uuid'})));
  assert.equal(p.calls.user,0,'a refused token never falls back to Auth');
});
test('a bad signature, a missing key id or alg none is refused without asking Auth',async()=>{
  const p=await project({algs:['ES256','ES256']});
  // Signed by a different key but naming the published one.
  await refused(p.backend.verifyUser(await p.sign({kid:'k0',signWith:'k1'})));
  const good=await p.sign(),[h,b,s]=good.split('.');
  await refused(p.backend.verifyUser([h,Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(b,'base64url')),sub:'30000000-0000-4000-8000-000000000002'})).toString('base64url'),s].join('.')));
  const header=alg=>Buffer.from(JSON.stringify({alg,kid:'k0',typ:'JWT'})).toString('base64url');
  for(const alg of ['none','NONE'])await refused(p.backend.verifyUser([header(alg),b,s].join('.')));
  await refused(p.backend.verifyUser([Buffer.from(JSON.stringify({alg:'ES256',typ:'JWT'})).toString('base64url'),b,s].join('.')));
  await refused(p.backend.verifyUser('not.a.token'));
  assert.equal(p.calls.user,0);
});
test('an unknown key id refetches the key set, so a rotated key verifies; a key that is never published is refused',async()=>{
  const p=await project({algs:['ES256','ES256','ES256']});
  await p.backend.verifyUser(await p.sign());assert.equal(p.calls.jwks,1);
  // k1 is not published yet: refetch, still no match, refused.
  await refused(p.backend.verifyUser(await p.sign({kid:'k1'})));assert.equal(p.calls.jwks,2);
  p.publish('k1');
  const rotated=await p.backend.verifyUser(await p.sign({kid:'k1'}));assert.equal(rotated.userId,userId);assert.equal(p.calls.jwks,3);
  await p.backend.verifyUser(await p.sign({kid:'k1'}));assert.equal(p.calls.jwks,3,'the refreshed set is cached');
  assert.equal(p.calls.user,0);
});
test('a token signed with another algorithm (a future key type) goes to the Supabase Auth check instead of a 401',async()=>{
  const p=await project();
  const [,b,s]=(await p.sign()).split('.');
  const header=alg=>Buffer.from(JSON.stringify({alg,kid:'k9',typ:'JWT'})).toString('base64url');
  for(const alg of ['EdDSA','PS256']){
    const user=await p.backend.verifyUser([header(alg),b,s].join('.'));
    assert.equal(user.userId,userId);assert.equal(user.sessionChecked,true);
  }
  assert.deepEqual(p.calls,{jwks:0,user:2});
  // Refusals on their own merits still hold: Auth says no, or the claims are wrong before Auth is asked.
  p.state.user=null;await refused(p.backend.verifyUser([header('EdDSA'),b,s].join('.')));
  const [,expired]=(await p.sign({exp:'-1m'})).split('.');
  await refused(p.backend.verifyUser([header('EdDSA'),expired,s].join('.')));assert.equal(p.calls.user,3);
});
test('legacy HS256 tokens and an unreachable key set fall back to the Supabase Auth check',async()=>{
  const p=await project();
  const legacy=await p.backend.verifyUser(p.hs256());
  assert.deepEqual(legacy,{userId,email:'member@example.com',emailConfirmed:true,aal:'aal1',sessionChecked:true});
  assert.deepEqual(p.calls,{jwks:0,user:1});
  await refused(p.backend.verifyUser(p.hs256({aud:'anon'})));assert.equal(p.calls.user,1,'claims are checked before Auth is asked');
  p.state.user=null;await refused(p.backend.verifyUser(p.hs256()));
  p.state.user={id:'30000000-0000-4000-8000-000000000009',email_confirmed_at:'2026-10-01T00:00:00Z'};await refused(p.backend.verifyUser(p.hs256()));
  p.state.user={id:userId,email_confirmed_at:null};await refused(p.backend.verifyUser(p.hs256()));
  const down=await project();down.state.jwksStatus=503;
  assert.equal((await down.backend.verifyUser(await down.sign())).sessionChecked,true);
  assert.deepEqual(down.calls,{jwks:1,user:1});
  down.state.user=null;await refused(down.backend.verifyUser(await down.sign()));
});
test('confirmSession asks Auth once for a locally verified token and refuses a signed-out session',async()=>{
  const p=await project(),token=await p.sign(),user=await p.backend.verifyUser(token);
  await p.backend.confirmSession(token,user);assert.equal(p.calls.user,1);
  await p.backend.confirmSession(p.hs256(),{...user,sessionChecked:true});assert.equal(p.calls.user,1,'an Auth-checked token is not asked twice');
  await refused(p.backend.confirmSession(token,{...user,userId:'30000000-0000-4000-8000-000000000002'}));
  p.state.user=null;await refused(p.backend.confirmSession(token,user));
});

// Handler level: the membership refusal is unchanged, and each call makes fewer sequential trips.
function tracked(member){
  const log=[];let inFlight=0,peak=0;
  const trip=(name,value)=>async(...args)=>{log.push(name);inFlight++;peak=Math.max(peak,inFlight);await new Promise(r=>setTimeout(r,5));inFlight--;const v=typeof value==='function'?value(...args):value;if(v instanceof Error)throw v;return v;};
  const backend={
    verifyUser:async()=>({userId,email:'member@example.com',emailConfirmed:true,aal:'aal1',sessionChecked:false}),
    confirmSession:trip('auth',undefined),
    account:trip('account',()=>member.value),
    catalog:trip('catalog',{items:[{id:'secret'}],total:1}),
    reserveDownload:trip('reserve',{id:'50000000-0000-4000-8000-000000000001',bucket:'b',object_path:'p',filename:'f.aio',bytes:1,sha256:'a'.repeat(64)}),
    signDownload:trip('sign','https://example.supabase.co/storage/v1/object/sign/p'),
    recordDownload:trip('record',(id,artifact,success)=>{log.push('record:'+success);}),
    rpc:trip('rpc',{items:[{id:'secret'}]}),
  };
  return {backend,log,peak:()=>peak};
}
const active={user_id:userId,role:'member',tier:2,status:'active',expires_at:null,revision:1,tester:true};
const cfg={enabled:true,url:'https://example.supabase.co',publishableKey:'sb_publishable_example',secretKey:'secret',origin:'https://quadrion.ai'};
const get=(path,action)=>new Request(`https://quadrion.ai/api/${path}?action=${action}`,{headers:{authorization:'Bearer x.y.z'}});
const post=(path,action,body)=>new Request(`https://quadrion.ai/api/${path}?action=${action}`,{method:'POST',headers:{authorization:'Bearer x.y.z','content-type':'application/json',origin:cfg.origin},body:JSON.stringify(body)});
const forbidden={error:'forbidden',message:'Your account does not have access.'};

test('a read runs alongside the membership check: one sequential trip instead of three',async()=>{
  const t=tracked({value:active}),handler=createMemberHandler({config:cfg,backend:t.backend});
  const r=await handler(get('portal','releases'),production);
  assert.equal(r.status,200);assert.deepEqual(t.log,['account','catalog']);assert.equal(t.peak(),2);
});
test('a non-member or inactive member is refused exactly as before and no read result leaves',async()=>{
  for(const value of [new Error('portal:forbidden'),{...active,status:'suspended'},{...active,expires_at:'2020-01-01T00:00:00Z'},{...active,role:'member',tier:7}]){
    const t=tracked({value}),handler=createMemberHandler({config:cfg,backend:t.backend});
    for(const action of ['me','releases','projects']){const r=await handler(get('portal',action),production);assert.equal(r.status,403,action);assert.deepEqual(await r.json(),forbidden);}
    const d=await handler(post('portal','download',{artifactId:'50000000-0000-4000-8000-000000000001'}),production);
    assert.equal(d.status,403);assert.deepEqual(await d.json(),forbidden);
    assert.equal(t.log.includes('sign'),false,'a refused member is never given a link');
    // A reservation made alongside a refused check is closed as failed.
    assert.deepEqual(t.log.filter(n=>n.startsWith('record:')),['record:false']);
    const f=createFeedbackHandler({config:cfg,backend:t.backend});
    const fr=await f(get('portal-feedback','mine'),production);assert.equal(fr.status,403);assert.deepEqual(await fr.json(),forbidden);
    const fw=await f(post('portal-feedback','answer',{lineId:'stage-1:group-a:0123456789',status:'pass',comment:'',build:'0.25.2'}),production);assert.equal(fw.status,403);
    assert.equal(t.log.filter(n=>n==='rpc').length,1,'only the read ran; the write waited for the check');
  }
});
test('downloads take three sequential trips instead of five',async()=>{
  const t=tracked({value:active}),handler=createMemberHandler({config:cfg,backend:t.backend});
  const r=await handler(post('portal','download',{artifactId:'50000000-0000-4000-8000-000000000001'}),production);
  assert.equal(r.status,200);assert.deepEqual(t.log,['account','reserve','sign','record','record:true']);assert.equal(t.peak(),2);
  const bad=await handler(post('portal','download',{artifactId:'../x'}),production);assert.equal(bad.status,400);
});
test('a read refused while the same request accepts an invitation is run again after the check',async()=>{
  const t=tracked({value:active});let first=true;
  t.backend.catalog=async()=>{t.log.push('catalog');if(first){first=false;throw new Error('portal:forbidden');}return {items:[],total:0};};
  const r=await createMemberHandler({config:cfg,backend:t.backend})(get('portal','projects'),production);
  assert.equal(r.status,200);assert.deepEqual(t.log,['account','catalog','catalog']);
  t.backend.catalog=async()=>{throw new Error('portal:unavailable');};
  assert.equal((await createMemberHandler({config:cfg,backend:t.backend})(get('portal','projects'),production)).status,503);
});
test('admin calls still ask Auth for the session, in parallel, and a signed-out session wins over everything',async()=>{
  const t=tracked({value:{...active,role:'owner',tier:null}}),handler=createAdminHandler({config:cfg,backend:t.backend});
  const r=await handler(get('portal-admin','users'),production);
  assert.equal(r.status,200);assert.deepEqual(new Set(t.log),new Set(['auth','account','rpc']));assert.equal(t.peak(),3);
  t.log.length=0;
  const w=await handler(post('portal-admin','member',{userId:'30000000-0000-4000-8000-000000000003',role:'member',tier:2,status:'active',expiresAt:null,revision:1}),production);
  assert.equal(w.status,200);assert.deepEqual(t.log,['auth','account','rpc'],'a write waits for the check');
  const out=tracked({value:new Error('portal:forbidden')});out.backend.confirmSession=async()=>{throw new Error('portal:unauthorized');};
  const signedOut=createAdminHandler({config:cfg,backend:out.backend});
  for(const request of [get('portal-admin','users'),post('portal-admin','member',{userId:'30000000-0000-4000-8000-000000000003',role:'member',tier:2,status:'active',expiresAt:null,revision:1})]){
    const res=await signedOut(request,production);assert.equal(res.status,401);assert.deepEqual(await res.json(),{error:'unauthorized',message:'Please sign in again.'});
  }
  assert.equal(out.log.filter(n=>n==='rpc').length,1,'only the read ran');
  const missing=tracked({value:{...active,role:'owner',tier:null}});delete missing.backend.confirmSession;
  assert.equal((await createAdminHandler({config:cfg,backend:missing.backend})(get('portal-admin','users'),production)).status,503,'no session check fails closed');
});
