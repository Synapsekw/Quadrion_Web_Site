import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
import {createMemberHandler} from '../netlify/lib/portal/member-api.mjs';
let db;before(async()=>{db=await portalDb();});after(async()=>{await db?.close();});
const save=data=>rpc(db,'portal_save_release',[ids.owner,'aal1',data]);
const publish=r=>rpc(db,'portal_publish',[ids.owner,'aal1','release',r.id,r.revision,null]);
const metadata=(kind,version,extra={})=>({kind,version,platform:'windows',autoUpdateEnabled:true,architecture:'x64',packageFormat:kind==='app'?'nsis':'tar.gz',...(kind==='pipeline'?{appRange:'>=0.24.0 <2.0.0'}:{}),...extra});
async function file(r,filename=r.kind==='app'?'Quadrion-Setup.exe':'pipeline-pack.tar.gz',state='verified'){
  return (await db.query("insert into public.artifact_files(release_id,kind,bucket,object_path,filename,bytes,sha256,state) values ($1,'binary','quadrion-software',$2,$3,100,$4,$5) returning id",[r.id,r.id+'/'+filename,filename,'a'.repeat(64),state])).rows[0];
}
test('draft release metadata edits use revisions, audit changes and cannot edit published releases',async()=>{
  const draft=await save(metadata('pipeline','0.20.0'));
  assert.equal(draft.auto_update_enabled,true);assert.equal(draft.app_range,'>=0.24.0 <2.0.0');
  const edit=await save(metadata('pipeline','0.20.0',{id:draft.id,revision:1,notes:'Corrected',appRange:'>=0.25.0 <2.0.0'}));
  assert.equal(edit.revision,2);assert.equal(edit.notes,'Corrected');assert.equal(edit.app_range,'>=0.25.0 <2.0.0');
  await assert.rejects(save(metadata('pipeline','0.20.0',{id:draft.id,revision:1})),/portal:conflict/);
  await file(edit);await publish(edit);
  await assert.rejects(save(metadata('pipeline','0.20.0',{id:draft.id,revision:3})),/portal:conflict/);
  await assert.rejects(db.query("update public.software_releases set app_range='>=0.1.0 <3.0.0' where id=$1",[draft.id]),/portal:immutable_release/);
  assert.equal((await db.query("select count(*)::int n from public.portal_events where resource_id=$1 and action='release_saved'",[draft.id])).rows[0].n,2);
});
test('database independently rejects malformed opt-in metadata and incomplete publication',async()=>{
  for(const extra of [{version:'0.21'},{version:'0.21.0-beta.1'},{version:'01.21.0'},{appRange:'>=0.24.0'},{appRange:'>=2.0.0 <0.24.0'},{architecture:'arm64'},{packageFormat:'zip'},{platform:'all'},{pipelineReleaseId:ids.owner}])await assert.rejects(save(metadata('pipeline','0.21.0',extra)),/portal:invalid|check constraint/);
  const unverified=await save(metadata('pipeline','0.21.0'));await file(unverified,'kit.tar.gz','pending');await assert.rejects(publish(unverified),/portal:unverified/);
  const wrong=await save(metadata('pipeline','0.22.0'));await file(wrong,'kit with spaces.tar.gz');await assert.rejects(publish(wrong),/portal:unverified/);
  await assert.rejects(db.query("update public.software_releases set status='published' where id=$1",[wrong.id]),/portal:unverified/);
  const draftKit=await save(metadata('pipeline','0.23.0'));await file(draftKit);
  const app=await save(metadata('app','0.25.0',{pipelineReleaseId:draftKit.id}));await file(app);
  await assert.rejects(publish(app),/portal:incompatible/);
  await publish(draftKit);await publish(app);
  const incompatible=await save(metadata('app','2.0.0',{pipelineReleaseId:draftKit.id}));await file(incompatible);await assert.rejects(publish(incompatible),/portal:incompatible/);
});
test('service-only candidates exclude historical, retired, drafts, unverified and unsupported artifacts without quota effects',async()=>{
  const legacy=await save({kind:'app',version:'historical',platform:'windows'});assert.equal(legacy.auto_update_enabled,false);await file(legacy);await publish(legacy);
  const retired=await save(metadata('pipeline','0.24.0'));await file(retired);await publish(retired);await rpc(db,'portal_archive',[ids.owner,'aal1','release',retired.id,2]);
  const before=(await db.query('select count(*)::int n from public.portal_events')).rows[0].n;
  const candidates=await rpc(db,'portal_update_candidates',[ids.t1,'aal1']);
  assert.deepEqual(candidates.map(r=>r.version).sort(),['0.20.0','0.23.0','0.25.0']);
  const encoded=JSON.stringify(candidates);for(const secret of ['bucket','object_path','quadrion-software','published_at','auto_update_enabled'])assert.equal(encoded.includes(secret),false);
  assert.equal((await db.query('select count(*)::int n from public.portal_events')).rows[0].n,before);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(rpc(db,'portal_update_candidates',[ids.owner,'aal1']),/permission denied/);}finally{await db.exec('reset role');}}
  await db.query("update public.portal_members set status='suspended' where user_id=$1",[ids.t1]);await assert.rejects(rpc(db,'portal_update_candidates',[ids.t1,'aal1']),/portal:forbidden/);
  await db.query("update public.portal_members set status='active',expires_at=now() where user_id=$1",[ids.t1]);await assert.rejects(rpc(db,'portal_update_candidates',[ids.t1,'aal1']),/portal:forbidden/);
  await assert.rejects(rpc(db,'portal_update_candidates',[ids.owner,'forged']),/portal:unauthorized/);
});

test('the HTTP check consumes real database candidates and immediately withholds an app whose baseline is retired',async()=>{
  const config={enabled:true,url:'https://example.supabase.co',origin:'https://quadrion.ai'},context={deploy:{context:'production',published:true}};
  const handler=createMemberHandler({config,backend:{verifyUser:async()=>({userId:ids.t2,emailConfirmed:true,aal:'aal1'}),account:actor=>rpc(db,'portal_account',[actor]),rpc:(name,args)=>rpc(db,name,[args.p_actor,args.p_aal])}});
  const request=()=>new Request('https://quadrion.ai/api/portal?action=updates&platform=win-x64&appVersion=0.24.0&pipelineVersion=0.19.0',{headers:{authorization:'Bearer fixture'}});
  const before=(await db.query('select count(*)::int n from public.portal_events')).rows[0].n;
  const response=await handler(request(),context);assert.equal(response.status,200);const result=await response.json();assert.equal(result.targetAppVersion,'0.25.0');assert.equal(result.app.version,'0.25.0');assert.equal(result.pipeline.version,'0.23.0');assert.equal((await db.query('select count(*)::int n from public.portal_events')).rows[0].n,before);
  const baseline=(await db.query("select * from public.software_releases where kind='pipeline' and version='0.23.0'")).rows[0];
  await rpc(db,'portal_archive',[ids.owner,'aal1','release',baseline.id,baseline.revision]);
  const withheld=await (await handler(request(),context)).json();assert.equal(withheld.app,null);assert.equal(withheld.targetAppVersion,'0.24.0');assert.equal(withheld.pipeline,null);
  await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[ids.t2]);assert.equal((await handler(request(),context)).status,403);
});
