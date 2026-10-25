import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedbackHandler} from '../../netlify/lib/portal/feedback-api.mjs';
import {createFeedbackUploads} from '../../netlify/lib/portal/feedback-uploads.mjs';
const config={enabled:true,url:'https://example.supabase.co',publishableKey:'sb_publishable_example',secretKey:'secret',origin:'https://quadrion.ai'};
const production={deploy:{context:'production',published:true}};
const userId='20000000-0000-4000-8000-000000000001';
const itemId='10000000-0000-4000-8000-000000000001';
const lineId='stage-1:group-a:0123456789';
function fixture({tester=true,role='member',tier=2}={}){
  const calls=[],attachmentCalls=[];
  const backend={
    async verifyUser(token){if(token!=='valid')throw new Error('portal:unauthorized');return {userId,emailConfirmed:true,aal:'aal1',email:'tester-1@example.com'};},
    async account(){calls.push({name:'account'});return {user_id:userId,role,tier,status:'active',expires_at:null,revision:1,tester};},
    async rpc(name,args){calls.push({name,args});return {ok:true,name};},
  };
  const attachments=async(action,body,user)=>{attachmentCalls.push({action,body,user});return {id:itemId,state:'pending'};};
  return {backend,calls,attachmentCalls,rpcs:()=>calls.filter(c=>c.name!=='account'),handler:createFeedbackHandler({config,backend,attachments})};
}
const req=(action,body,{headers={},query=''}={})=>new Request('https://quadrion.ai/api/portal-feedback?action='+action+query,{method:body?'POST':'GET',headers:{authorization:'Bearer valid',...(body?{'content-type':'application/json',origin:config.origin}:{}),...headers},body:body?JSON.stringify(body):undefined});
const status=async(f,...args)=>(await f.handler(req(...args),production)).status;

test('preview deploys return 503 and touch no provider',async()=>{
  const f=fixture();f.backend.verifyUser=()=>{throw new Error('must not run');};f.backend.rpc=()=>{throw new Error('must not run');};
  for(const context of [{},{deploy:{context:'deploy-preview',published:true}},{deploy:{context:'production',published:false}}]){
    assert.equal((await f.handler(req('content'),context)).status,503);
    assert.equal((await f.handler(req('answer',{lineId,status:'pass',comment:'',build:'0.25.2'}),context)).status,503);
  }
  const off=createFeedbackHandler({config:{...config,enabled:false},backend:f.backend,attachments:f.backend.rpc});
  assert.equal((await off(req('mine'),production)).status,503);
  assert.equal(f.calls.length,0);
});

test('a logged-out request gets 401 and no data',async()=>{
  const f=fixture();
  for(const headers of [{authorization:''},{authorization:'Bearer wrong'},{authorization:'Basic valid'}]){
    const r=await f.handler(req('content',undefined,{headers}),production);
    assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'unauthorized',message:'Please sign in again.'});
  }
  assert.equal(f.calls.length,0);
});

test('a member without the tester flag gets 403 before any RPC',async()=>{
  for(const opts of [{tester:false},{tester:false,role:'owner',tier:null},{tester:null}]){
    const f=fixture(opts);
    for(const [action,body,query] of [['content'],['mine'],['counts'],['item',undefined,'&id='+itemId],['answer',{lineId,status:'pass',comment:'',build:'0.25.2'}],['create',{kind:'bug',title:'Blank map'}],['attachmentStatus',{id:itemId}]])
      assert.equal(await status(f,action,body,{query}),403,action);
    assert.deepEqual(f.rpcs(),[]);assert.deepEqual(f.attachmentCalls,[]);
  }
  const f=fixture();f.backend.account=async()=>({user_id:userId,role:'member',tier:2,status:'disabled',expires_at:null,tester:true});
  assert.equal(await status(f,'content'),403);assert.deepEqual(f.rpcs(),[]);
});

test('reads map to the tester RPCs with the token actor',async()=>{
  const f=fixture();
  for(const action of ['content','answers','mine','counts'])assert.equal(await status(f,action),200,action);
  assert.equal(await status(f,'item',undefined,{query:'&id='+itemId}),200);
  assert.deepEqual(f.rpcs(),[
    {name:'portal_tests_content',args:{p_actor:userId}},{name:'portal_tests_answers',args:{p_actor:userId}},
    {name:'portal_feedback_mine',args:{p_actor:userId}},{name:'portal_feedback_counts',args:{p_actor:userId}},
    {name:'portal_feedback_item',args:{p_actor:userId,p_aal:'aal1',p_id:itemId}},
  ]);
  const r=await f.handler(req('mine'),production);assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal(await status(f,'mine',{}),405);assert.equal(await status(f,'answer'),405);assert.equal(await status(f,'delete'),404);
});

test('writes map to the tester RPCs with the token actor',async()=>{
  const f=fixture();
  assert.equal(await status(f,'answer',{lineId,status:'fail',comment:'  Map stays blank ',build:' 0.25.2 '}),200);
  assert.equal(await status(f,'answer',{lineId,status:null,comment:'',build:'0.25.2'}),200);
  assert.equal(await status(f,'create',{kind:'feature',title:'Export to CSV',body:'Would help',lineId,build:'0.25.2',screen:'scene:map'}),200);
  assert.equal(await status(f,'create',{kind:'bug',title:'Blank map'}),200);
  assert.equal(await status(f,'act',{id:itemId,revision:3,action:'reopen',body:'Still blank',build:'0.25.3'}),200);
  assert.equal(await status(f,'act',{id:itemId,revision:4,action:'confirm'}),200);
  assert.deepEqual(f.rpcs(),[
    {name:'portal_tests_answer',args:{p_actor:userId,p_line:lineId,p_status:'fail',p_comment:'Map stays blank',p_build:'0.25.2'}},
    {name:'portal_tests_answer',args:{p_actor:userId,p_line:lineId,p_status:null,p_comment:'',p_build:'0.25.2'}},
    {name:'portal_feedback_create',args:{p_actor:userId,p_data:{kind:'feature',title:'Export to CSV',body:'Would help',lineId,build:'0.25.2',screen:'scene:map'}}},
    {name:'portal_feedback_create',args:{p_actor:userId,p_data:{kind:'bug',title:'Blank map',body:'',lineId:null,build:'',screen:null}}},
    {name:'portal_feedback_tester_action',args:{p_actor:userId,p_id:itemId,p_revision:3,p_action:'reopen',p_body:'Still blank',p_build:'0.25.3'}},
    {name:'portal_feedback_tester_action',args:{p_actor:userId,p_id:itemId,p_revision:4,p_action:'confirm',p_body:'',p_build:''}},
  ]);
});

test('the actor comes from the token; p_actor or userId in a body is refused',async()=>{
  const f=fixture(),other='30000000-0000-4000-8000-000000000003';
  for(const [action,body] of [
    ['answer',{lineId,status:'pass',comment:'',build:'0.25.2',p_actor:other}],['answer',{lineId,status:'pass',comment:'',build:'0.25.2',userId:other}],
    ['create',{kind:'bug',title:'Blank map',p_actor:other}],['create',{kind:'bug',title:'Blank map',actor:other}],
    ['act',{id:itemId,revision:1,action:'comment',body:'Hi',userId:other}],
  ])assert.equal(await status(f,action,body),400,action+' '+Object.keys(body).join());
  assert.equal(await status(f,'mine',undefined,{query:'&p_actor='+other}),200);
  assert.deepEqual(f.rpcs(),[{name:'portal_feedback_mine',args:{p_actor:userId}}]);
  assert.equal(await status(f,'attachmentBegin',{itemId,filename:'shot.png',bytes:10,sha256:'a'.repeat(64)}),200);
  assert.deepEqual(f.attachmentCalls[0].user,{userId,emailConfirmed:true,aal:'aal1',email:'tester-1@example.com'});
  assert.deepEqual(f.attachmentCalls.map(c=>c.action),['attachmentBegin']);
  // With the real attachment module, a body actor is refused there and the RPC actor is the token's.
  const real=fixture(),handler=createFeedbackHandler({config,backend:real.backend,attachments:createFeedbackUploads({config:{...config,verifySecret:'v'.repeat(32)},backend:real.backend})});
  assert.equal((await handler(req('attachmentStatus',{id:itemId,p_actor:other}),production)).status,400);
  real.backend.rpc=async(name,args)=>{real.calls.push({name,args});return {id:itemId,item_id:itemId,state:'pending',bytes:1,verified_bytes:0};};
  assert.equal((await handler(req('attachmentStatus',{id:itemId}),production)).status,200);
  assert.deepEqual(real.rpcs(),[{name:'portal_feedback_attachment_command',args:{p_actor:userId,p_aal:'aal1',p_id:itemId,p_action:'status'}}]);
});

test('invalid line ids, builds and screens are refused',async()=>{
  const f=fixture(),answer={lineId,status:'pass',comment:'',build:'0.25.2'},report={kind:'bug',title:'Blank map'};
  const badLines=['Stage:a:0123456789','stage:0123456789','stage:a:012345678g','stage:a:0123456789-x','stage:a:'+'0'.repeat(11),'stage-'+'a'.repeat(190)+':b:0123456789',12,null];
  for(const bad of badLines)assert.equal(await status(f,'answer',{...answer,lineId:bad}),400,String(bad));
  for(const bad of ['stage:a:0123456789/x','../stage:a:0123456789',5])assert.equal(await status(f,'create',{...report,lineId:bad}),400,String(bad));
  const badBuilds=['-0.25','0.25;drop','<b>0.25</b>','a'.repeat(81),'0.25\n2',7,null];
  for(const bad of badBuilds){
    assert.equal(await status(f,'answer',{...answer,build:bad}),400,String(bad));
    assert.equal(await status(f,'create',{...report,build:bad}),400,String(bad));
    assert.equal(await status(f,'act',{id:itemId,revision:1,action:'confirm',build:bad}),400,String(bad));
  }
  for(const bad of ['scene map','scene/map','<x>','scene:'+'m'.repeat(80),'scene%3Amap',3])assert.equal(await status(f,'create',{...report,screen:bad}),400,String(bad));
  assert.equal(await status(f,'answer',{...answer,status:'maybe'}),400);
  assert.equal(await status(f,'answer',{...answer,status:'fail',comment:'  '}),400);
  assert.equal(await status(f,'answer',{...answer,comment:'x'.repeat(8001)}),400);
  assert.equal(await status(f,'create',{...report,kind:'question'}),400);
  assert.equal(await status(f,'create',{...report,title:'  '}),400);
  assert.equal(await status(f,'create',{...report,title:'x'.repeat(201)}),400);
  assert.equal(await status(f,'create',{...report,body:'x'.repeat(16001)}),400);
  assert.equal(await status(f,'act',{id:itemId,revision:1,action:'comment',body:'x'.repeat(16001)}),400);
  assert.equal(await status(f,'act',{id:itemId,revision:1,action:'title',body:'x'.repeat(201)}),400);
  for(const action of ['fix','merge','priority','seen',''])assert.equal(await status(f,'act',{id:itemId,revision:1,action,body:'x'}),400,action);
  for(const revision of [0,-1,1.5,'1',null])assert.equal(await status(f,'act',{id:itemId,revision,action:'comment',body:'x'}),400,String(revision));
  assert.deepEqual(f.rpcs(),[]);
  assert.equal(await status(f,'answer',{...answer,build:'unknown'}),200);
  assert.equal(await status(f,'create',{...report,screen:'scene:map_2-a',build:'0.25.2+win x64'}),200);
});

test('item ids are uuids',async()=>{
  const f=fixture();
  for(const id of ['','1','../secret',itemId+'0','10000000-0000-4000-8000-00000000000g'])
    assert.equal(await status(f,'item',undefined,{query:'&id='+encodeURIComponent(id)}),400,id);
  assert.equal(await status(f,'item'),400);
  assert.equal(await status(f,'act',{id:'1',revision:1,action:'comment',body:'x'}),400);
  assert.deepEqual(f.rpcs(),[]);
});

test('attachment actions go to the attachment module; bodies stay bounded',async()=>{
  const f=fixture();
  for(const action of ['attachmentResume','attachmentFinalize','attachmentStatus','attachmentAbandon','attachmentUrl'])assert.equal(await status(f,action,{id:itemId}),200,action);
  assert.deepEqual(f.attachmentCalls.map(c=>c.action),['attachmentResume','attachmentFinalize','attachmentStatus','attachmentAbandon','attachmentUrl']);
  assert.equal(await status(f,'attachmentUrl'),405);
  assert.equal(await status(f,'create',{kind:'bug',title:'Blank map',body:'x'.repeat(200000)}),413);
  assert.equal(await status(f,'create',{kind:'bug',title:'Blank map'},{headers:{origin:'https://evil.example'}}),403);
  assert.equal(await status(f,'create',{kind:'bug',title:'Blank map'},{headers:{'content-type':'text/plain'}}),415);
  assert.deepEqual(f.rpcs(),[]);
});

test('backend errors come back as safe portal errors',async()=>{
  const f=fixture();f.backend.rpc=async()=>{throw new Error('portal:conflict');};
  const r=await f.handler(req('answer',{lineId,status:'pass',comment:'',build:'0.25.2'}),production);
  assert.equal(r.status,409);assert.equal((await r.json()).error,'conflict');
  f.backend.rpc=async()=>{throw new Error('connection failed secret-key');};
  const o=await f.handler(req('content'),production);assert.equal(o.status,503);assert.doesNotMatch(await o.text(),/secret/);
});
