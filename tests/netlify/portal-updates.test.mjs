import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberHandler} from '../../netlify/lib/portal/member-api.mjs';
const config={enabled:true,url:'https://example.supabase.co',origin:'https://quadrion.ai'},context={deploy:{context:'production',published:true}};
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const kit=(n,version,appRange='>=0.25.0 <2.0.0')=>({releaseId:id(n),artifactId:id(n+100),kind:'pipeline',version,platform:'win-x64',filename:`pipeline-pack-${version}-win-x64.tar.gz`,bytes:456,sha256:'b'.repeat(64),notes:'Kit notes',appRange});
const app=(n,version,pipelineReleaseId)=>({releaseId:id(n),artifactId:id(n+100),kind:'app',version,platform:'win-x64',filename:'Quadrion-Setup.exe',bytes:123,sha256:'a'.repeat(64),notes:'Release notes',pipelineReleaseId});
function fixture(candidates=[]){
  let active=true,reserved=0,reads=0;
  const backend={verifyUser:async()=>({userId:id(1),emailConfirmed:true,aal:'aal1'}),account:async()=>({user_id:id(1),role:'member',tier:1,status:active?'active':'suspended',expires_at:null,revision:1}),rpc:async(name,args)=>{assert.equal(name,'portal_update_candidates');assert.deepEqual(args,{p_actor:id(1),p_aal:'aal1'});reads++;return candidates;},reserveDownload:async()=>{reserved++;throw Error('must not reserve');}};
  return {handler:createMemberHandler({config,backend}),revoke:()=>{active=false;},reads:()=>reads,reserved:()=>reserved};
}
const req=(query='platform=win-x64&appVersion=0.24.0&pipelineVersion=0.19.0',auth=true)=>new Request('https://quadrion.ai/api/portal?action=updates&'+query,{headers:auth?{authorization:'Bearer valid'}:{}});
test('update checks use member authentication and fresh access without reserving downloads',async()=>{
  const f=fixture([kit(2,'0.20.0'),app(3,'0.25.0',id(2))]);
  assert.equal((await f.handler(req(undefined,false),context)).status,401);
  const response=await f.handler(req(),context);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{schema:'quadrion.updates/1',targetAppVersion:'0.25.0',app:{releaseId:id(3),artifactId:id(103),version:'0.25.0',platform:'win-x64',filename:'Quadrion-Setup.exe',bytes:123,sha256:'a'.repeat(64),notes:'Release notes'},pipeline:{releaseId:id(2),artifactId:id(102),version:'0.20.0',platform:'win-x64',filename:'pipeline-pack-0.20.0-win-x64.tar.gz',bytes:456,sha256:'b'.repeat(64),notes:'Kit notes',appRange:'>=0.25.0 <2.0.0'}});
  assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(f.reserved(),0);
  f.revoke();assert.equal((await f.handler(req(),context)).status,403);assert.equal(f.reads(),1);
});
test('numeric app ordering selects a compatible pair and withholds a newer app with no valid baseline',async()=>{
  const f=fixture([kit(2,'0.9.0'),kit(3,'0.10.0'),kit(4,'0.99.0','>=1.0.0 <2.0.0'),app(5,'0.9.0',id(2)),app(6,'0.10.0',id(3)),app(7,'0.11.0',id(99))]);
  const result=await (await f.handler(req('platform=win-x64&appVersion=0.8.0'),context)).json();
  // These kits start at 0.25.0, so neither 0.9 nor 0.10 is compatible.
  assert.equal(result.targetAppVersion,'0.8.0');assert.equal(result.app,null);assert.equal(result.pipeline,null);
  const g=fixture([kit(2,'0.9.0','>=0.1.0 <1.0.0'),kit(3,'0.10.0','>=0.1.0 <1.0.0'),app(5,'0.9.0',id(2)),app(6,'0.10.0',id(3)),app(7,'0.11.0',id(99))]);
  const selected=await (await g.handler(req('platform=win-x64&appVersion=0.8.0'),context)).json();assert.equal(selected.app.version,'0.10.0');assert.equal(selected.pipeline.version,'0.10.0');
});
test('kit-only checks honor the current app and retain an identical installed selected kit for app upgrades',async()=>{
  const f=fixture([kit(2,'0.20.0','>=0.24.0 <2.0.0')]);
  assert.equal((await (await f.handler(req(),context)).json()).pipeline.version,'0.20.0');
  const unchanged=await (await f.handler(req('platform=win-x64&appVersion=0.24.0&pipelineVersion=0.20.0'),context)).json();assert.equal(unchanged.pipeline,null);assert.equal(unchanged.targetAppVersion,'0.24.0');
  const g=fixture([kit(2,'0.20.0'),app(3,'0.25.0',id(2))]);
  const retained=await (await g.handler(req('platform=win-x64&appVersion=0.24.0&pipelineVersion=0.20.0'),context)).json();assert.equal(retained.app.version,'0.25.0');assert.equal(retained.pipeline,null);
});
test('checks reject unsupported platforms, ambiguous queries and non-stable versions before reading candidates',async()=>{
  const f=fixture();
  for(const query of ['platform=windows&appVersion=0.24.0','platform=win-x64&appVersion=v0.24.0','platform=win-x64&appVersion=0.24.0-beta.1','platform=win-x64&appVersion=0.24.0+build','platform=win-x64&appVersion=01.24.0','platform=win-x64&appVersion=0.24.0&pipelineVersion=','platform=win-x64&appVersion=0.24.0&appVersion=0.25.0','platform=win-x64&appVersion=0.24.0&bucket=secret'])assert.equal((await f.handler(req(query),context)).status,400,query);
  assert.equal(f.reads(),0);
});
test('malformed candidate metadata is excluded and cannot change a valid selected pair',async()=>{
  const validKit=kit(2,'0.20.0'),validApp=app(3,'0.25.0',id(2));
  const malformed=[{...validKit,releaseId:id(10),version:'0.99.0',filename:'kit with spaces.tar.gz'},{...validApp,version:'bad'},{...validApp,version:'0.90.0',bytes:9007199254740992},{...validKit,version:'0.90.0',appRange:'*'},{...validApp,version:'0.99.0',sha256:'A'.repeat(64)},{...validApp,version:'0.98.0',platform:'macos'},{...validApp,version:'0.97.0',artifactId:'not-an-id'},{...validApp,version:'0.96.0',notes:null}];
  const f=fixture([...malformed,validKit,validApp]);const response=await f.handler(req(),context);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.app.version,'0.25.0');assert.equal(result.pipeline.version,'0.20.0');
});
test('the highest compatible kit must meet the linked baseline version',async()=>{
  const f=fixture([kit(2,'0.9.0'),kit(3,'0.10.0'),kit(4,'0.11.0','>=1.0.0 <2.0.0'),app(5,'0.25.0',id(2))]);
  const result=await (await f.handler(req(),context)).json();assert.equal(result.pipeline.version,'0.10.0');
  const g=fixture([kit(2,'0.20.0','>=1.0.0 <2.0.0'),kit(3,'0.19.0'),app(5,'0.25.0',id(2))]);
  const withheld=await (await g.handler(req(),context)).json();assert.equal(withheld.app,null);assert.equal(withheld.targetAppVersion,'0.24.0');
});
