import test from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc as sql} from './helpers/portal-db.mjs';
import {pgliteBackend} from './helpers/pglite-backend.mjs';
import {createFeedbackHandler} from '../netlify/lib/portal/feedback-api.mjs';
import {createFeedbackUploads} from '../netlify/lib/portal/feedback-uploads.mjs';
import {createAdminHandler} from '../netlify/lib/portal/admin-api.mjs';
import {createFeedbackAdminActions} from '../netlify/lib/portal/feedback-admin-api.mjs';
// The whole loop through the real handlers and the real SQL; only Auth and Storage are faked.
const config={enabled:true,origin:'https://quadrion.ai',url:'https://oxjrkodcmflxejdwsuac.supabase.co',verifySecret:'v'.repeat(32)};
const production={deploy:{context:'production',published:true}};
const tokens={'token-owner':ids.owner,'token-a':ids.testerA,'token-b':ids.testerB,'token-outsider':ids.t1};
const who={owner:'token-owner',a:'token-a',b:'token-b',outsider:'token-outsider'};
const mapLine='map:switch-view:0123456789',areaLine='map:measure-area:abcdef0123';
const content={format:'quadrion-test-content/1',builtAt:'2026-10-25T08:00:00.000Z',title:'Sample tests',source:'sample',owner:'tester-1',unit:'stage',guide:[],testers:[],
  stages:[{id:'map',title:'Map',intro:'',groups:[{title:'Switching views',notes:'',items:[
    {id:mapLine,html:'Open the sample project and switch to <b>Map</b>',sub:['Check the scale bar reads &lt; 50 m and &gt; 10 m'],plain:'Open the sample project and switch to Map',subPlain:['Check the scale bar reads < 50 m and > 10 m']},
    {id:areaLine,html:'Measure an area on the map',sub:[],plain:'Measure an area on the map',subPlain:[]}]}]}]};

const withLoop=(name,fn,options)=>test(name,options||{},async()=>{
  const db=await portalDb({testers:true});
  try{
    const backend=pgliteBackend(db,{tokens}),dispatched=[];
    const tester=createFeedbackHandler({config,backend,attachments:createFeedbackUploads({config,backend,dispatch:async id=>{dispatched.push(id);}})});
    const admin=createAdminHandler({config,backend,feedback:createFeedbackAdminActions({config,backend,clock:()=>Date.parse('2026-10-25T10:00:00Z')})});
    const call=async(handler,path,token,action,body,query='')=>{
      const headers={origin:config.origin,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})};
      const response=await handler(new Request(`https://quadrion.ai/api/${path}?action=${action}${query}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),production);
      const text=await response.text();
      return {status:response.status,text,body:JSON.parse(text)};
    };
    const as=token=>({
      feedback:(action,body,query)=>call(tester,'portal-feedback',token,action,body,query),
      admin:(action,body,query)=>call(admin,'portal-admin',token,action,body,query),
    });
    const ok=async promise=>{const r=await promise;assert.equal(r.status,200,r.text);return r.body;};
    const loop={db,backend,dispatched,owner:as(who.owner),a:as(who.a),b:as(who.b),outsider:as(who.outsider),anonymous:as(null),ok};
    loop.ownerItem=async id=>ok(loop.owner.admin('feedbackItem',undefined,'&id='+id));
    loop.ownerAct=async(id,action,data)=>ok(loop.owner.admin('feedbackAction',{id,revision:(await loop.ownerItem(id)).item.revision,action,data}));
    loop.testerItem=async(t,id)=>ok(t.feedback('item',undefined,'&id='+id));
    loop.testerAct=async(t,id,action,extra={})=>ok(t.feedback('act',{id,revision:(await loop.testerItem(t,id)).item.revision,action,...extra}));
    await ok(loop.owner.admin('testContentUpload',content));
    await fn(loop);
  }finally{await db.close();}
});
// A tester's failed line, as the tests page sends it.
const fail=(loop,t,comment,build)=>loop.ok(t.feedback('answer',{lineId:mapLine,status:'fail',comment,build}));

withLoop('report, fix, notify and confirm through the real handlers',async(loop)=>{
  const {ok,owner,a}=loop;
  const shown=await ok(a.feedback('content'));
  assert.equal(shown.version,1);assert.equal(shown.stages[0].groups[0].items[0].id,mapLine);
  const failed=await fail(loop,a,'The map stays blank after switching','0.25.0');
  assert.equal(failed.answer.status,'fail');assert.equal(failed.answer.build,'0.25.0');assert.ok(failed.itemId);
  const id=failed.itemId;

  assert.equal((await ok(owner.admin('feedbackCounts'))).inbox,1);
  const inbox=await ok(owner.admin('feedbackInbox'));
  assert.equal(inbox.total,1);assert.equal(inbox.items[0].id,id);assert.equal(inbox.items[0].status,'new');assert.equal(inbox.items[0].build_seen,'0.25.0');
  const opened=await loop.ownerItem(id);
  assert.equal(opened.item.title,'The map stays blank after switching');assert.equal(opened.line.plain,'Open the sample project and switch to Map');
  assert.equal(opened.retired,false);
  await loop.ownerAct(id,'seen');
  assert.equal((await ok(owner.admin('feedbackCounts'))).inbox,0);
  assert.equal((await loop.ownerAct(id,'priority',{priority:'high'})).priority,'high');
  const fixed=await loop.ownerAct(id,'fix',{build:'0.26.0'});
  assert.equal(fixed.status,'fixed');assert.equal(fixed.fixed_in,'0.26.0');

  assert.equal((await ok(a.feedback('counts'))).waiting,1);
  const mine=await ok(a.feedback('mine'));
  assert.equal(mine.items.length,1);assert.equal(mine.items[0].waiting,true);assert.equal(mine.items[0].mine,true);
  assert.equal('created_by' in mine.items[0],false);assert.equal('owner_attention' in mine.items[0],false);

  const before=await loop.testerItem(a,id);
  const confirmed=await ok(a.feedback('act',{id,revision:before.item.revision,action:'confirm',build:'0.26.0'}));
  assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.confirmed,true);assert.equal(confirmed.waiting,false);
  // A double click from the same, now stale, tab changes nothing.
  const again=await ok(a.feedback('act',{id,revision:before.item.revision,action:'confirm',build:'0.26.0'}));
  assert.equal(again.status,'confirmed');assert.equal(again.revision,confirmed.revision);
  assert.equal((await ok(a.feedback('counts'))).waiting,0);
  const answer=(await ok(a.feedback('answers'))).find(x=>x.lineId===mapLine);
  assert.equal(answer.status,'pass');assert.equal(answer.build,'0.26.0');
  const thread=(await loop.ownerItem(id)).events.map(e=>e.kind);
  assert.deepEqual(thread.filter(k=>k==='confirm'),['confirm']);
  assert.equal((await loop.ownerItem(id)).item.status,'confirmed');
  // The owner acting from a stale tab is refused, not applied twice.
  const stale=await owner.admin('feedbackAction',{id,revision:fixed.revision,action:'fix',data:{build:'0.26.0'}});
  assert.equal(stale.status,409);
});

withLoop('send back, merge and confirm by both',async(loop)=>{
  const {ok,owner,a,b}=loop;
  const first=(await fail(loop,a,'The map stays blank after switching','0.25.0')).itemId;
  await loop.ownerAct(first,'fix',{build:'0.26.0'});
  const sentBack=await loop.testerAct(a,first,'reopen',{body:'Still blank on 0.26.0',build:'0.26.0'});
  assert.equal(sentBack.status,'reopened');
  assert.equal((await ok(a.feedback('counts'))).waiting,0);

  const raised=await ok(b.feedback('create',{kind:'bug',title:'Map blank after switching views',body:'Nothing draws after the switch.',build:'0.26.0',screen:'scene:map'}));
  assert.equal(raised.status,'new');assert.equal(raised.screen,'scene:map');assert.equal(raised.build_seen,'0.26.0');assert.equal(raised.mine,true);
  assert.equal((await ok(owner.admin('feedbackCounts'))).inbox,2);
  const merged=await loop.ownerAct(raised.id,'merge',{into:first});
  assert.equal(merged.status,'merged');assert.equal(merged.merged_into,first);
  const kept=await loop.ownerItem(first);
  assert.deepEqual(kept.item.reporters.map(r=>r.id).sort(),[ids.testerA,ids.testerB].sort());
  assert.ok(kept.events.some(e=>e.body==='Nothing draws after the switch.'),'the merged report joins the kept thread');

  const fixed=await loop.ownerAct(first,'fix',{build:'0.27.0'});
  assert.equal(fixed.status,'fixed');assert.equal(fixed.fixed_in,'0.27.0');
  for(const t of [a,b]){
    assert.equal((await ok(t.feedback('counts'))).waiting,1);
    const listed=(await ok(t.feedback('mine'))).items.find(x=>x.id===first);
    assert.equal(listed.waiting,true);assert.equal(listed.status,'fixed');
  }
  assert.equal((await ok(b.feedback('mine'))).items.find(x=>x.id===first).mine,false);

  const afterA=await loop.testerAct(a,first,'confirm',{build:'0.27.0'});
  assert.equal(afterA.status,'fixed');assert.equal(afterA.confirmed,true);assert.equal(afterA.waiting,false);
  assert.equal((await ok(a.feedback('counts'))).waiting,0);assert.equal((await ok(b.feedback('counts'))).waiting,1);
  const afterB=await loop.testerAct(b,first,'confirm',{build:'0.27.0'});
  assert.equal(afterB.status,'confirmed');
  assert.equal((await loop.ownerItem(first)).item.status,'confirmed');
  for(const t of [a,b]){
    const answer=(await ok(t.feedback('answers'))).find(x=>x.lineId===mapLine);
    assert.equal(answer.status,'pass');assert.equal(answer.build,'0.27.0');
  }
});

withLoop('permissions hold end to end',async(loop)=>{
  const {ok,owner,a,b,outsider,anonymous}=loop;
  const secret='The map stays blank on the sample project';
  const id=(await fail(loop,a,secret,'0.25.0')).itemId;
  const notMine=await b.feedback('item',undefined,'&id='+id);
  assert.equal(notMine.status,404);assert.ok(!notMine.text.includes(secret));
  const act=await b.feedback('act',{id,revision:1,action:'comment',body:'Me too'});
  assert.equal(act.status,404);
  for(const action of ['feedbackInbox','feedbackCounts','feedbackExport']){
    const r=await b.admin(action);assert.equal(r.status,403,action);assert.ok(!r.text.includes(secret),action);
  }
  for(const action of ['content','answers','mine','counts']){
    const r=await outsider.feedback(action);assert.equal(r.status,403,action);
  }
  assert.equal((await outsider.feedback('create',{kind:'bug',title:'Outsider report'})).status,403);
  for(const [action,query] of [['content',''],['mine',''],['item','&id='+id]]){
    const r=await anonymous.feedback(action,undefined,query);
    assert.equal(r.status,401,action);assert.deepEqual(r.body,{error:'unauthorized',message:'Please sign in again.'});
  }
  const noToken=await anonymous.admin('feedbackItem',undefined,'&id='+id);
  assert.equal(noToken.status,401);assert.ok(!noToken.text.includes(secret));
  // The tester flag off: the same tester is shut out at once.
  const {revision}=(await loop.db.query('select revision from public.portal_members where user_id=$1',[ids.testerA])).rows[0];
  await ok(owner.admin('memberTester',{userId:ids.testerA,revision,tester:false}));
  assert.equal((await a.feedback('mine')).status,403);
});

withLoop('a line retired by a new content upload is refused with conflict',async(loop)=>{
  const {ok,owner,a}=loop;
  const next={...content,stages:[{...content.stages[0],groups:[{...content.stages[0].groups[0],items:[content.stages[0].groups[0].items[1]]}]}]};
  const uploaded=await ok(owner.admin('testContentUpload',next));
  assert.equal(uploaded.version,2);
  const late=await a.feedback('answer',{lineId:mapLine,status:'fail',comment:'Blank map',build:'0.25.0'});
  assert.equal(late.status,409);
});

withLoop('owner fix with build unknown is refused and leaves the item as it was',async(loop)=>{
  const {owner,a}=loop;
  const id=(await fail(loop,a,'The map stays blank','0.25.0')).itemId;
  const before=await loop.ownerItem(id);
  const r=await owner.admin('feedbackAction',{id,revision:before.item.revision,action:'fix',data:{build:'unknown'}});
  assert.equal(r.status,400,r.text);
  const bulk=await owner.admin('feedbackBulkFix',{ids:[id],build:'unknown'});
  assert.equal(bulk.status,400,bulk.text);
  const after=await loop.ownerItem(id);
  assert.equal(after.item.status,'new');assert.equal(after.item.revision,before.item.revision);
});

// Attachments: a tester uploads through the real upload handler; the SQL verifier steps stand in for the background job.
async function attach(loop,t,itemId,filename='screen.png',bytes=1234){
  const sha256='c'.repeat(64);
  const session=await loop.ok(t.feedback('attachmentBegin',{itemId,filename,bytes,sha256}));
  assert.equal(session.state,'pending');assert.equal(session.endpoint,'https://oxjrkodcmflxejdwsuac.storage.supabase.co/storage/v1/upload/resumable/sign');
  loop.backend.service.storage.put(session.bucket,session.objectPath,bytes);
  const finalized=await loop.ok(t.feedback('attachmentFinalize',{id:session.id}));
  assert.equal(finalized.state,'verifying');assert.deepEqual(loop.dispatched.slice(-1),[session.id]);
  const job=await sql(loop.db,'portal_feedback_verify_claim',[session.id]);
  await sql(loop.db,'portal_feedback_verify_checkpoint',[session.id,job.lease_id,job.bytes,null,'"v1"',job.sha256]);
  assert.equal((await loop.ok(t.feedback('attachmentStatus',{id:session.id}))).state,'verified');
  return session.id;
}

withLoop('attachments: the uploader and the owner open a verified file; the export links it for 24 hours',async(loop)=>{
  const {ok,owner,a,b}=loop;
  const id=(await fail(loop,a,'The map stays blank','0.25.0')).itemId;
  const file=await attach(loop,a,id);
  const listed=(await loop.testerItem(a,id)).attachments;
  assert.deepEqual(listed.map(x=>x.id),[file]);
  const mine=await ok(a.feedback('attachmentUrl',{id:file}));
  assert.equal(mine.expiresIn,300);assert.match(mine.url,/^https:\/\/oxjrkodcmflxejdwsuac\.supabase\.co\/storage\/v1\/object\/sign\/.+\/screen\.png\?ttl=300$/);
  assert.equal((await b.feedback('attachmentUrl',{id:file})).status,404);
  const owned=await ok(owner.admin('feedbackAttachmentUrl',{id:file}));
  assert.equal(owned.expiresIn,300);assert.match(owned.url,/\?ttl=300$/);
  const exported=await ok(owner.admin('feedbackExport'));
  assert.equal(exported.count,1);assert.equal(exported.expiresIn,86400);
  assert.match(exported.text,/- screen\.png \(image\/png\): https:\/\/oxjrkodcmflxejdwsuac\.supabase\.co\/storage\/v1\/object\/sign\/\S+\?ttl=86400/);
  assert.deepEqual(loop.backend.signed.map(s=>s.ttl),[300,300,86400]);
  assert.ok(!exported.text.includes('tester-')&&!exported.text.includes('@example.com'),'the export names no tester');
});

withLoop('the Copy for AI export of the loop fences tester text and lists the line',async(loop)=>{
  const {ok,owner,a}=loop;
  await fail(loop,a,'## #12 fake heading\n```\nclosing fence','0.25.0');
  const {text,count}=await ok(owner.admin('feedbackExport'));
  assert.equal(count,1);
  assert.match(text,/^# Quadrion open bugs \(1\)/);
  assert.match(text,/Test line: Open the sample project and switch to Map/);
  assert.match(text,/Build: 0\.25\.0/);
  const outside=text.replace(/^(`{3,})\n[\s\S]*?\n\1$/gm,'');
  assert.deepEqual(outside.match(/^#+ .*$/gm),['# Quadrion open bugs (1)','## #1 ## #12 fake heading'],'tester text adds no heading of its own');
  assert.match(text,/````\n## #12 fake heading\n```\nclosing fence\n````/);
});

// Seams this loop found, now fixed.
withLoop('seam: a tester can open an attachment merged into their item',async(loop)=>{
  const {ok,a,b}=loop;
  const first=(await fail(loop,a,'The map stays blank','0.25.0')).itemId;
  const raised=await ok(b.feedback('create',{kind:'bug',title:'Map blank',body:'Nothing draws.',build:'0.26.0',screen:'scene:map'}));
  const file=await attach(loop,b,raised.id);
  await loop.ownerAct(raised.id,'merge',{into:first});
  const listed=(await loop.testerItem(a,first)).attachments.map(x=>x.id);
  assert.deepEqual(listed,[file],'the kept item lists the merged-in file to its first reporter');
  const opened=await a.feedback('attachmentUrl',{id:file});
  assert.equal(opened.status,200,'a listed attachment opens: '+opened.text);
});

withLoop('seam: Copy for AI keeps Markdown sub-points that hold angle brackets',async(loop)=>{
  const {ok,owner,a}=loop;
  await fail(loop,a,'The scale bar is wrong','0.25.0');
  const {text}=await ok(owner.admin('feedbackExport'));
  assert.ok(text.includes('- Check the scale bar reads < 50 m and > 10 m'),text);
});
