import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../../netlify/lib/portal/admin-api.mjs';
import {createFeedbackAdminActions} from '../../netlify/lib/portal/feedback-admin-api.mjs';
const config={enabled:true,origin:'https://quadrion.ai',url:'https://example.supabase.co'},context={deploy:{context:'production',published:true}};
const actor='10000000-0000-4000-8000-000000000001',itemId='20000000-0000-4000-8000-000000000001',otherId='20000000-0000-4000-8000-000000000002';
const line=n=>`walk:open-map:${String(n).padStart(10,'0')}`;
function fixture(role='owner',reply={}){
  const calls=[],signed=[];
  const backend={verifyUser:async()=>({userId:actor,emailConfirmed:true,aal:'aal1'}),account:async()=>({user_id:actor,role,tier:role==='member'?3:null,status:'active',expires_at:null}),
    rpc:async(name,args)=>{calls.push({name,args});return reply[name]??{ok:true};},
    signDownload:async(file,ttl,download)=>{signed.push({file,ttl,download});return `https://files.example.com/${file.id}?ttl=${ttl}`;}};
  return {calls,signed,backend,handler:createAdminHandler({config,backend,feedback:createFeedbackAdminActions({config,backend,clock:()=>Date.parse('2026-10-25T10:00:00Z')})})};
}
const req=(action,body,query='')=>new Request('https://quadrion.ai/api/portal-admin?action='+action+query,{method:body?'POST':'GET',headers:{authorization:'Bearer valid',origin:config.origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
const content=(n=1)=>({format:'quadrion-test-content/1',builtAt:'2026-10-25T08:00:00.000Z',title:'Sample',source:'s',owner:'o',unit:'stage',guide:[],testers:[],
  stages:[{id:'w',title:'W',intro:'',groups:[{title:'G',notes:'',items:Array.from({length:n},(_,i)=>({id:line(i+1),html:'Open the sample project and switch to <b>Map</b>',sub:[],plain:'x',subPlain:[]}))}]}]});
const everything=[['feedbackInbox'],['feedbackItem',null,'&id='+itemId],['feedbackProgress'],['feedbackExport'],['feedbackCounts'],['testContentStatus'],
  ['feedbackAction',{id:itemId,revision:1,action:'triage'}],['feedbackBulkFix',{ids:[itemId],build:'0.26.0'}],['feedbackAttachmentUrl',{id:itemId}],
  ['testContentUpload',content()],['testImport',{testerId:actor,file:{format:'quadrion-test-results/1',results:{}}}],['memberTester',{userId:actor,revision:1,tester:true}]];

test('members get 403 and no RPC runs',async()=>{
  for(const [action,body,query] of everything){
    const f=fixture('member');const r=await f.handler(req(action,body||undefined,query||''),context);
    assert.equal(r.status,403,action);assert.equal(f.calls.length,0,action);
  }
});
test('admins triage but only owners upload content, import or set the tester flag',async()=>{
  const admin=fixture('admin');
  for(const [action,body,query] of everything.filter(([a])=>['testContentUpload','testImport','memberTester'].includes(a))){
    assert.equal((await admin.handler(req(action,body,query||''),context)).status,403,action);
  }
  assert.equal(admin.calls.length,0);
  for(const [action,body,query] of everything.filter(([a])=>!['testContentUpload','testImport','memberTester'].includes(a))){
    assert.equal((await admin.handler(req(action,body||undefined,query||''),context)).status,200,action);
  }
  const owner=fixture('owner');
  for(const [action,body,query] of everything)assert.equal((await owner.handler(req(action,body||undefined,query||''),context)).status,200,action);
  const names=owner.calls.map(c=>c.name);
  for(const name of ['portal_feedback_inbox','portal_feedback_item','portal_tests_progress','portal_feedback_export','portal_feedback_counts','portal_tests_content_status','portal_feedback_owner_action',
    'portal_feedback_bulk_fix','portal_feedback_attachment_get','portal_tests_content_upload','portal_tests_import','portal_member_tester'])assert.ok(names.includes(name),name);
  const wrongMethod=fixture('owner');
  assert.equal((await wrongMethod.handler(req('feedbackInbox',{}),context)).status,405);
  assert.equal((await wrongMethod.handler(req('feedbackAction',undefined),context)).status,405);
  assert.equal(wrongMethod.calls.length,0);
});
test('the actor comes from Auth and extra keys are refused',async()=>{
  const f=fixture('owner');
  assert.equal((await f.handler(req('feedbackAction',{id:itemId,revision:2,action:'priority',data:{priority:'high'}}),context)).status,200);
  assert.equal(f.calls[0].args.p_actor,actor);assert.equal(f.calls[0].args.p_aal,'aal1');
  assert.deepEqual(f.calls[0].args,{p_actor:actor,p_aal:'aal1',p_id:itemId,p_revision:2,p_action:'priority',p_data:{priority:'high'}});
  f.calls.length=0;
  for(const [action,body] of [['feedbackAction',{id:itemId,revision:1,action:'triage',actor:'forged'}],['feedbackAction',{id:itemId,revision:1,action:'triage',data:{priority:'high'}}],
    ['feedbackAction',{id:itemId,revision:1,action:'priority',data:{priority:'urgent'}}],['feedbackAction',{id:itemId,revision:1,action:'decline',data:{}}],['feedbackAction',{id:itemId,revision:1,action:'decline',data:{reason:'  '}}],
    ['feedbackAction',{id:itemId,revision:0,action:'triage'}],['feedbackAction',{id:itemId,revision:1,action:'delete'}],['feedbackAction',{id:'../x',revision:1,action:'triage'}],
    ['feedbackAction',{id:itemId,revision:1,action:'merge',data:{into:'nope'}}],['feedbackAction',{id:itemId,revision:1,action:'fix',data:{build:'bad/build'}}],
    ['feedbackBulkFix',{ids:[itemId],build:'0.26.0',p_actor:actor}],['feedbackBulkFix',{ids:[],build:'0.26.0'}],['feedbackBulkFix',{ids:Array(201).fill(itemId),build:'0.26.0'}],['feedbackBulkFix',{ids:['x'],build:'0.26.0'}],
    ['feedbackAttachmentUrl',{id:itemId,object_path:'x'}],['memberTester',{userId:actor,revision:1,tester:'yes'}],['memberTester',{userId:actor,revision:1,tester:true,actor:'x'}],
    ['testContentUpload',{...content(),actor:'x'}],['testImport',{testerId:actor,file:{format:'quadrion-test-results/2',results:{}}}],['testImport',{testerId:actor,file:{format:'quadrion-test-results/1',results:{'not a line':{}}}}],['testImport',{testerId:actor,file:{format:'quadrion-test-results/1',results:{}},actor}]]){
    assert.equal((await f.handler(req(action,body),context)).status,400,JSON.stringify(body).slice(0,80));
  }
  assert.equal(f.calls.length,0);
  assert.equal((await f.handler(req('feedbackAction',{id:itemId,revision:1,action:'merge',data:{into:otherId}}),context)).status,200);
  assert.equal((await f.handler(req('feedbackAction',{id:itemId,revision:1,action:'decline',data:{reason:'Works as intended'}}),context)).status,200);
  const query=await f.handler(req('feedbackInbox',undefined,'&status=new,fixed&kind=bug&priority=high&build=0.26.0&offset=100&tester='+actor+'&actor=forged'),context);
  assert.equal(query.status,200);
  assert.deepEqual(f.calls.at(-1).args.p_filter,{tester:actor,kind:'bug',status:['new','fixed'],priority:'high',build:'0.26.0',offset:100});
  for(const bad of ['&status=gone','&kind=idea','&priority=urgent','&build=%3Cb%3E','&offset=-1','&tester=x'])assert.equal((await f.handler(req('feedbackInbox',undefined,bad),context)).status,400,bad);
  assert.equal((await f.handler(req('feedbackItem'),context)).status,400);
});
test('content over 4 MB is too_large and over 32 KB is fine for upload only',async()=>{
  const f=fixture('owner');
  const big=content(400);assert.ok(JSON.stringify(big).length>32768);
  assert.equal((await f.handler(req('testContentUpload',big),context)).status,200);
  assert.equal(f.calls.at(-1).name,'portal_tests_content_upload');assert.equal(f.calls.at(-1).args.p_model.stages[0].groups[0].items.length,400);
  const pad='x'.repeat(40000);
  assert.equal((await f.handler(req('feedbackAction',{id:itemId,revision:1,action:'comment',data:{body:pad}}),context)).status,413);
  assert.equal((await f.handler(req('testImport',{testerId:actor,file:{format:'quadrion-test-results/1',results:{},pad:'x'.repeat(2000000)}}),context)).status,413);
  const huge=content(1);huge.title='x'.repeat(4100000);
  assert.equal((await f.handler(req('testContentUpload',huge),context)).status,413);
  const calls=f.calls.length;
  const bad=content(1);bad.stages[0].groups[0].items[0].html='<img src=x onerror=1>';
  assert.equal((await f.handler(req('testContentUpload',bad),context)).status,400);
  assert.equal(f.calls.length,calls,'content is validated before the RPC');
});
test('only the export signs links for 24 hours',async()=>{
  const files=[{id:'a1',bucket:'quadrion-feedback',object_path:'i/a1/shot.png',filename:'shot.png',mime_type:'image/png'}];
  const f=fixture('owner',{portal_feedback_export:{items:[{number:5,title:'Broken',priority:'high',build:'0.26.0',body:'It breaks.',line:{plain:'Open the sample project',sub:[]},thread:[],attachments:files}]},
    portal_feedback_attachment_get:files[0]});
  const exported=await f.handler(req('feedbackExport',undefined,'&status=new'),context),body=await exported.json();
  assert.equal(exported.status,200);assert.equal(body.count,1);assert.equal(body.expiresIn,86400);
  assert.match(body.text,/^# Quadrion open bugs \(1\)\n/);assert.match(body.text,/## #5 Broken/);assert.match(body.text,/ttl=86400/);
  assert.deepEqual(f.signed.map(s=>s.ttl),[86400]);
  assert.deepEqual(f.calls[0].args.p_filter,{status:['new']});
  const single=await f.handler(req('feedbackAttachmentUrl',{id:'20000000-0000-4000-8000-0000000000a1'}),context),one=await single.json();
  assert.equal(single.status,200);assert.equal(one.expiresIn,300);assert.equal(f.signed.at(-1).ttl,300);assert.match(one.url,/ttl=300/);
  const empty=fixture('owner',{portal_feedback_export:{items:[]}});
  const none=await (await empty.handler(req('feedbackExport'),context)).json();
  assert.equal(none.count,0);assert.match(none.text,/No open bugs in this filter\./);assert.equal(empty.signed.length,0);
});
