import test from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';

const lineA='testing:stage-a-map:0123456789',lineB='testing:stage-a-map:0123456789-2',lineC='testing:stage-b-photos:abcdef0123';
const names=['Sample Person One','Sample Person Two'];
const item=(id,text)=>({id,html:`<p>${text}</p>`,sub:['<em>the view stays still</em>'],plain:text,subPlain:['_the view stays still_']});
const model=(lines=[lineA,lineB,lineC])=>({
  format:'quadrion-test-content/1',builtAt:'2026-10-25T08:00:00.000Z',title:'Sample test board',source:'TESTING.md',owner:'owner-1',unit:'stage',
  guide:[{title:'How to test',html:'<p>Use the sample project.</p>'}],
  testers:[{id:'tester-1',name:names[0]},{id:'tester-2',name:names[1]}],
  stages:[
    {id:'stage-a',title:'Stage A: map',short:'A',name:'Map',intro:'',groups:[{title:'Map view',notes:'',items:[lineA,lineB].filter(l=>lines.includes(l)).map(l=>item(l,'Open the sample project and switch to Map'))}]},
    {id:'stage-b',title:'Stage B: photos',short:'B',name:'Photos',intro:'',groups:[{title:'Photos',notes:'',items:[lineC].filter(l=>lines.includes(l)).map(l=>item(l,'Open a sample photo'))}]},
  ].filter(s=>s.groups[0].items.length),
});
const upload=(db,m=model(),actor=ids.owner)=>rpc(db,'portal_tests_content_upload',[actor,'aal2',m]);
const answer=(db,tester,line,status,comment=null,build='0.25.0')=>rpc(db,'portal_tests_answer',[tester,line,status,comment,build]);
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
async function withDb(fn){const db=await portalDb({testers:true});try{await fn(db);}finally{await db.close();}}

test('upload is owner only and moves the current version',()=>withDb(async db=>{
  await assert.rejects(upload(db,model(),ids.admin),/portal:forbidden/);
  await assert.rejects(upload(db,model(),ids.testerA),/portal:forbidden/);
  await assert.rejects(upload(db,{...model(),format:'quadrion-test-content/2'}),/portal:invalid/);
  await assert.rejects(upload(db,{...model(),stages:[{id:'x',title:'X',groups:[{title:'G',items:[{id:'Bad Id',plain:'x'}]}]}]}),/portal:invalid/);
  await assert.rejects(upload(db,{...model(),stages:[...model().stages,...model().stages]}),/portal:invalid/);
  await assert.rejects(upload(db,{...model(),stages:'none'}),/portal:invalid/);
  assert.equal((await one(db,'select count(*)::int as n from public.test_content')).n,0);
  assert.deepEqual(await upload(db),{version:1,lines:3,kept:0,retired:0});
  assert.deepEqual(await upload(db,model([lineA,lineC])),{version:2,lines:2,kept:0,retired:0});
  const rows=(await db.query('select version,current,line_count,uploaded_by from public.test_content order by version')).rows;
  assert.deepEqual(rows,[{version:1,current:false,line_count:3,uploaded_by:ids.owner},{version:2,current:true,line_count:2,uploaded_by:ids.owner}]);
  const lines=(await db.query('select line_id,position,stage_id,stage_title,group_title,plain,sub from public.test_lines l join public.test_content c on c.id=l.content_id where c.current order by position')).rows;
  assert.deepEqual(lines.map(l=>[l.line_id,l.position,l.stage_id,l.group_title]),[[lineA,0,'stage-a','Map view'],[lineC,1,'stage-b','Photos']]);
  assert.equal(lines[0].stage_title,'Stage A: map');assert.equal(lines[0].plain,'Open the sample project and switch to Map');
  assert.deepEqual(lines[0].sub,['_the view stays still_']);
  const status=await rpc(db,'portal_tests_content_status',[ids.admin,'aal2']);
  assert.equal(status.version,2);assert.equal(status.lines,2);assert.ok(status.uploadedAt);assert.equal(status.retiredAnswers,0);
  assert.deepEqual(status.testers,[{id:'tester-1',name:names[0]},{id:'tester-2',name:names[1]}]);
  await assert.rejects(rpc(db,'portal_tests_content_status',[ids.testerA,'aal2']),/portal:forbidden/);
}));

test('testers never receive tester names',()=>withDb(async db=>{
  await upload(db);
  const stored=await one(db,'select model,testers from public.test_content where current');
  assert.equal('testers' in stored.model,false);assert.equal(stored.testers.length,2);
  const content=await rpc(db,'portal_tests_content',[ids.testerA]);
  assert.deepEqual(Object.keys(content).sort(),['guide','stages','title','unit','version']);
  assert.equal(content.version,1);assert.equal(content.title,'Sample test board');assert.equal(content.stages.length,2);
  const text=JSON.stringify(content);
  for(const name of names)assert.equal(text.includes(name),false,name);
  assert.equal(text.includes('tester-1'),false);
}));

test('a member without the flag and an admin without it get forbidden from tester RPCs',()=>withDb(async db=>{
  await upload(db);
  for(const actor of [ids.t1,ids.admin,ids.owner]){
    await assert.rejects(rpc(db,'portal_tests_content',[actor]),/portal:forbidden/);
    await assert.rejects(rpc(db,'portal_tests_answers',[actor]),/portal:forbidden/);
    await assert.rejects(answer(db,actor,lineA,'pass'),/portal:forbidden/);
  }
  await db.query("update public.portal_members set status='suspended' where user_id=$1",[ids.testerB]);
  await assert.rejects(rpc(db,'portal_tests_content',[ids.testerB]),/portal:forbidden/);
}));

test('a tester reads only their own answers',()=>withDb(async db=>{
  await upload(db);
  await answer(db,ids.testerA,lineA,'pass');
  await answer(db,ids.testerB,lineB,'skip',null,'0.25.1');
  const mine=await rpc(db,'portal_tests_answers',[ids.testerA]);
  assert.equal(mine.length,1);
  assert.deepEqual({...mine[0],updatedAt:undefined},{lineId:lineA,status:'pass',comment:'',build:'0.25.0',updatedAt:undefined,itemId:null});
  assert.ok(mine[0].updatedAt);
  assert.deepEqual((await rpc(db,'portal_tests_answers',[ids.testerB])).map(a=>[a.lineId,a.status,a.build]),[[lineB,'skip','0.25.1']]);
  const cleared=await answer(db,ids.testerA,lineA,null);
  assert.deepEqual(cleared,{answer:null,itemId:null});
  assert.deepEqual(await rpc(db,'portal_tests_answers',[ids.testerA]),[]);
}));

test('a fail needs a comment and opens one bug per line',()=>withDb(async db=>{
  await upload(db);
  await assert.rejects(answer(db,ids.testerA,lineA,'fail'),/portal:invalid/);
  await assert.rejects(answer(db,ids.testerA,lineA,'fail','   '),/portal:invalid/);
  await assert.rejects(answer(db,ids.testerA,lineA,'maybe'),/portal:invalid/);
  await assert.rejects(answer(db,ids.testerA,'Not A Line','pass'),/portal:invalid/);
  await assert.rejects(answer(db,ids.testerA,lineA,'pass',null,'bad/build'),/portal:invalid/);
  await assert.rejects(answer(db,ids.testerA,lineA,'pass',null,'x'.repeat(81)),/portal:invalid/);
  await assert.rejects(answer(db,ids.testerA,lineA,'pass','x'.repeat(16001)),/portal:invalid/);
  const first=await answer(db,ids.testerA,lineA,'fail','Map stays blank');
  assert.equal(first.answer.status,'fail');assert.equal(first.answer.comment,'Map stays blank');assert.ok(first.itemId);
  const again=await answer(db,ids.testerA,lineA,'fail','Still blank','0.25.1');
  assert.equal(again.itemId,first.itemId);
  const other=await answer(db,ids.testerA,lineC,'fail','Photo does not open');
  assert.notEqual(other.itemId,first.itemId);
  const theirs=await answer(db,ids.testerB,lineA,'fail','Blank for me too');
  assert.notEqual(theirs.itemId,first.itemId);
  assert.equal((await one(db,"select count(*)::int as n from public.feedback_items where kind='bug'")).n,3);
  assert.equal((await one(db,'select count(*)::int as n from public.feedback_events where item_id=$1',[first.itemId])).n,2);
  assert.deepEqual((await rpc(db,'portal_tests_answers',[ids.testerA])).map(a=>[a.lineId,a.itemId]),[[lineA,first.itemId],[lineC,other.itemId]]);
  const blank=await answer(db,ids.testerA,lineB,'skip',null,'  ');
  assert.equal(blank.answer.build,'unknown');
}));

test('a fail on a fixed bug reopens it and a fail on a merged bug goes to the kept item',()=>withDb(async db=>{
  await upload(db);
  const {itemId}=await answer(db,ids.testerA,lineA,'fail','Map stays blank');
  await db.query("update public.feedback_items set status='fixed',fixed_in='0.25.2' where id=$1",[itemId]);
  await db.query('update public.feedback_reporters set confirmed_at=now() where item_id=$1',[itemId]);
  const reopened=await answer(db,ids.testerA,lineA,'fail','Blank again','0.25.2');
  assert.equal(reopened.itemId,itemId);
  const row=await one(db,'select status,owner_attention from public.feedback_items where id=$1',[itemId]);
  assert.deepEqual(row,{status:'reopened',owner_attention:true});
  assert.equal((await one(db,'select confirmed_at from public.feedback_reporters where item_id=$1',[itemId])).confirmed_at,null);
  assert.equal((await one(db,"select body from public.feedback_events where item_id=$1 and kind='reopen'",[itemId])).body,'Blank again');
  const kept=(await answer(db,ids.testerB,lineB,'fail','Second map is blank')).itemId;
  await db.query("update public.feedback_items set status='merged',merged_into=$2 where id=$1",[itemId,kept]);
  const merged=await answer(db,ids.testerA,lineA,'fail','Still blank after merge');
  assert.equal(merged.itemId,kept);
  assert.equal((await one(db,'select count(*)::int as n from public.feedback_reporters where item_id=$1 and tester_id=$2',[kept,ids.testerA])).n,1);
  assert.equal((await one(db,"select count(*)::int as n from public.feedback_items where kind='bug'")).n,2);
}));

test('answer on a retired line is refused with conflict',()=>withDb(async db=>{
  await assert.rejects(answer(db,ids.testerA,lineA,'pass'),/portal:conflict/);
  await upload(db);
  await upload(db,model([lineA,lineC]));
  await assert.rejects(answer(db,ids.testerA,lineB,'pass'),/portal:conflict/);
  await assert.rejects(answer(db,ids.testerA,lineB,'fail','Gone'),/portal:conflict/);
  assert.deepEqual(await rpc(db,'portal_tests_answers',[ids.testerA]),[]);
  assert.equal((await one(db,'select count(*)::int as n from public.feedback_items')).n,0);
}));

test('re-upload keeps answers by line id and counts retired ones',()=>withDb(async db=>{
  await upload(db);
  await answer(db,ids.testerA,lineA,'pass');
  await answer(db,ids.testerA,lineB,'skip');
  await answer(db,ids.testerB,lineB,'pass');
  assert.deepEqual(await upload(db,model([lineA,lineC])),{version:2,lines:2,kept:1,retired:2});
  assert.equal((await rpc(db,'portal_tests_answers',[ids.testerA])).length,2);
  assert.equal((await rpc(db,'portal_tests_content_status',[ids.owner,'aal2'])).retiredAnswers,2);
  assert.deepEqual(await upload(db),{version:3,lines:3,kept:3,retired:0});
}));

test('pass on a fixed own bug confirms it',()=>withDb(async db=>{
  await upload(db);
  const {itemId}=await answer(db,ids.testerA,lineA,'fail','Map stays blank');
  const other=(await answer(db,ids.testerA,lineC,'fail','Photo does not open')).itemId;
  await db.query("update public.feedback_items set status='fixed',fixed_in='0.25.2',owner_attention=false where id=$1",[itemId]);
  await db.query('update public.feedback_items set owner_attention=false where id=$1',[other]);
  const result=await answer(db,ids.testerA,lineA,'pass',null,'0.25.2');
  assert.equal(result.itemId,itemId);assert.equal(result.answer.status,'pass');
  const row=await one(db,'select status,owner_attention from public.feedback_items where id=$1',[itemId]);
  assert.deepEqual(row,{status:'confirmed',owner_attention:true});
  assert.equal((await one(db,'select confirmed_build from public.feedback_reporters where item_id=$1',[itemId])).confirmed_build,'0.25.2');
  const passed=await answer(db,ids.testerA,lineC,'pass');
  assert.equal(passed.itemId,other);
  const otherRow=await one(db,'select status,owner_attention from public.feedback_items where id=$1',[other]);
  assert.deepEqual(otherRow,{status:'new',owner_attention:true});
  assert.equal((await one(db,"select count(*)::int as n from public.feedback_events where item_id=$1 and kind='line_passed'",[other])).n,1);
  await answer(db,ids.testerA,lineC,'pass');
  assert.equal((await one(db,"select count(*)::int as n from public.feedback_events where item_id=$1 and kind='line_passed'",[other])).n,1);
}));

test('import is idempotent, keeps newer answers and records build unknown',()=>withDb(async db=>{
  await upload(db);
  await answer(db,ids.testerA,lineB,'pass');
  const retiredLine='testing:stage-z-old:fedcba9876';
  const results={
    [lineA]:{s:'fail',c:'Map stays blank',t:'2020-10-01T10:00:00.000Z'},
    [lineB]:{s:'fail',c:'Older answer',t:'2020-10-01T10:00:00.000Z'},
    [lineC]:{s:'',c:'Only a note',t:'2020-10-01T10:00:00.000Z'},
    [retiredLine]:{s:'skip',c:'',t:'2020-10-01T10:00:00.000Z'},
    'Not A Line':{s:'pass',c:'',t:''},
  };
  await assert.rejects(rpc(db,'portal_tests_import',[ids.admin,'aal2',ids.testerA,results]),/portal:forbidden/);
  await assert.rejects(rpc(db,'portal_tests_import',[ids.owner,'aal2',ids.t1,results]),/portal:invalid/);
  await assert.rejects(rpc(db,'portal_tests_import',[ids.owner,'aal2',ids.testerA,[1]]),/portal:invalid/);
  const first=await rpc(db,'portal_tests_import',[ids.owner,'aal2',ids.testerA,results]);
  assert.deepEqual(first,{imported:2,skipped:3,bugs:1,retired:1});
  const rows=(await db.query('select line_id,status,comment,build,updated_at from public.test_answers where tester_id=$1 order by line_id',[ids.testerA])).rows;
  assert.deepEqual(rows.map(r=>[r.line_id,r.status,r.build]),[[lineA,'fail','unknown'],[lineB,'pass','0.25.0'],[retiredLine,'skip','unknown']]);
  assert.equal(rows[0].updated_at.toISOString(),'2020-10-01T10:00:00.000Z');
  const bug=await one(db,"select id,build_seen from public.feedback_items where line_id=$1",[lineA]);
  assert.equal(bug.build_seen,'unknown');
  assert.equal((await one(db,"select count(*)::int as n from public.feedback_events where item_id=$1 and kind='import'",[bug.id])).n,1);
  const second=await rpc(db,'portal_tests_import',[ids.owner,'aal2',ids.testerA,results]);
  assert.deepEqual(second,{imported:0,skipped:5,bugs:0,retired:0});
  assert.equal((await one(db,'select count(*)::int as n from public.feedback_items')).n,1);
  assert.equal((await one(db,'select count(*)::int as n from public.feedback_events')).n,1);
  const newer=await rpc(db,'portal_tests_import',[ids.owner,'aal2',ids.testerA,{[lineA]:{s:'pass',c:'',t:'2020-10-02T10:00:00.000Z'}}]);
  assert.deepEqual(newer,{imported:1,skipped:0,bugs:0,retired:0});
  assert.equal((await one(db,'select status from public.test_answers where tester_id=$1 and line_id=$2',[ids.testerA,lineA])).status,'pass');
}));

test('progress counts per tester and stage',()=>withDb(async db=>{
  await upload(db);
  await answer(db,ids.testerA,lineA,'pass',null,'0.25.0');
  await answer(db,ids.testerA,lineB,'fail','Second map is blank','0.25.1');
  await answer(db,ids.testerA,lineC,'skip',null,'0.25.1');
  await answer(db,ids.testerB,lineC,'pass',null,'0.25.2');
  await db.query("update public.portal_members set display_name='Sample display' where user_id=$1",[ids.testerA]);
  await upload(db,model([lineA,lineB]));
  await assert.rejects(rpc(db,'portal_tests_progress',[ids.testerA,'aal2']),/portal:forbidden/);
  const progress=await rpc(db,'portal_tests_progress',[ids.admin,'aal2']);
  assert.equal(progress.version,2);
  const a=progress.testers.find(t=>t.userId===ids.testerA),b=progress.testers.find(t=>t.userId===ids.testerB);
  assert.equal(progress.testers.length,2);assert.equal(a.name,'Sample display');
  assert.deepEqual(a.stages,[{stageId:'stage-a',title:'Stage A: map',total:2,answered:2,pass:1,fail:1,skip:0,lastBuild:'0.25.1'}]);
  assert.deepEqual(b.stages,[{stageId:'stage-a',title:'Stage A: map',total:2,answered:0,pass:0,fail:0,skip:0,lastBuild:null}]);
  assert.deepEqual(progress.retired.map(r=>[r.userId,r.lineId,r.status]).sort(),[[ids.testerA,lineC,'skip'],[ids.testerB,lineC,'pass']].sort());
}));

test('the seven API functions are definer, service_role only',()=>withDb(async db=>{
  const names=['portal_tests_content_upload','portal_tests_content_status','portal_tests_content','portal_tests_answers','portal_tests_answer','portal_tests_progress','portal_tests_import'];
  const fns=(await db.query("select p.oid::regprocedure::text as sig,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'portal_tests_%'")).rows;
  assert.deepEqual(fns.map(f=>f.proname).sort(),[...names].sort());
  for(const f of fns){
    assert.equal(f.prosecdef,true,f.proname);assert.deepEqual(f.proconfig,['search_path=""'],f.proname);
    assert.equal((await one(db,"select has_function_privilege('service_role',$1,'execute') as ok",[f.sig])).ok,true,f.proname);
    for(const role of ['anon','authenticated'])assert.equal((await one(db,'select has_function_privilege($1,$2,$3) as ok',[role,f.sig,'execute'])).ok,false,`${role} ${f.proname}`);
  }
}));
