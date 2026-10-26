import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
let db;
before(async()=>{db=await portalDb({testers:true});});
after(async()=>{await db?.close();});
const tables=['test_content','test_lines','test_answers','feedback_items','feedback_reporters','feedback_events','feedback_attachments'];
const internal=['portal_is_tester','portal_tester_active','portal_feedback_visible','portal_feedback_next_status','portal_feedback_log','portal_feedback_open_bug','portal_feedback_confirm'];
const line='map:switch-view:0123456789';
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const confirm=(item,tester,build)=>one('select * from public.portal_feedback_confirm($1,$2,$3)',[item,tester,build]);

test('new tables force RLS and give browser roles nothing',async()=>{
  for(const t of tables){
    const row=await one('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass',['public.'+t]);
    assert.deepEqual(row,{relrowsecurity:true,relforcerowsecurity:true},t);
    for(const role of ['anon','authenticated'])for(const privilege of ['select','insert','update','delete'])
      assert.equal((await one('select has_table_privilege($1,$2,$3) as ok',[role,'public.'+t,privilege])).ok,false,`${role} ${privilege} ${t}`);
    assert.equal((await one("select has_table_privilege('service_role',$1,'insert') as ok",['public.'+t])).ok,false,t);
  }
  assert.equal((await one("select count(*)::int as n from pg_policies where tablename = any($1)",[tables])).n,0);
});

test('only API functions are executable by service_role and none by browser roles',async()=>{
  const fns=(await db.query("select p.oid::regprocedure::text as sig,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1)",[[...internal,'portal_member_tester']])).rows;
  assert.equal(fns.length,internal.length+1);
  for(const f of fns){
    assert.equal(f.prosecdef,true,f.proname);assert.deepEqual(f.proconfig,['search_path=""'],f.proname);
    assert.equal((await one("select has_function_privilege('service_role',$1,'execute') as ok",[f.sig])).ok,f.proname==='portal_member_tester',f.proname);
    for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,$3) as ok',[role,f.sig,'execute'])).ok,false,`${role} ${f.proname}`);
  }
});

test('status machine allows exactly the listed moves',async()=>{
  const open={triage:'triaged',ask:'question',fix:'fixed',park:'parked',decline:'declined',merge:'merged'};
  const table={
    new:open,
    triaged:{...open,triage:undefined},
    question:{ask:undefined,answer:'triaged',fix:'fixed',park:'parked',decline:'declined',merge:'merged'},
    fixed:{fix:'fixed',confirm:'confirmed',reopen:'reopened'},
    reopened:open,
    parked:{restore:'triaged'},declined:{restore:'triaged'},confirmed:{},merged:{},
  };
  const actions=['triage','ask','answer','fix','confirm','reopen','park','decline','restore','merge','priority','bogus'];
  for(const [from,moves] of Object.entries(table))for(const action of actions)
    assert.equal(await rpc(db,'portal_feedback_next_status',[from,action]),moves[action]??null,`${from} ${action}`);
  for(const [from,action] of [['confirmed','reopen'],['merged','restore'],['fixed','merge'],['new','confirm'],[null,'triage'],['new',null]])
    assert.equal(await rpc(db,'portal_feedback_next_status',[from,action]),null);
});

test('only the owner sets the tester flag, revision checked and audited',async()=>{
  const target=ids.t2,before=(await one('select revision,tester from public.portal_members where user_id=$1',[target]));
  assert.equal(before.tester,false);
  await assert.rejects(rpc(db,'portal_member_tester',[ids.admin,'aal2',target,before.revision,true]),/portal:forbidden/);
  await assert.rejects(rpc(db,'portal_member_tester',[ids.t3,'aal2',target,before.revision,true]),/portal:forbidden/);
  await assert.rejects(rpc(db,'portal_member_tester',[ids.owner,'aal2',target,before.revision+5,true]),/portal:conflict/);
  await assert.rejects(rpc(db,'portal_member_tester',[ids.owner,'aal2',target,before.revision,null]),/portal:invalid/);
  const result=await rpc(db,'portal_member_tester',[ids.owner,'aal1',target,before.revision,true]);
  assert.equal(result.tester,true);assert.equal(result.revision,before.revision+1);
  const events=(await db.query("select actor_id,details from public.portal_events where action='member_tester_changed' and subject_id=$1",[target])).rows;
  assert.deepEqual(events,[{actor_id:ids.owner,details:{tester:true}}]);
  await rpc(db,'portal_member_tester',[ids.owner,'aal2',target,before.revision+1,false]);
});

test('portal_tester_active refuses a member without the flag and passes an active owner or admin',async()=>{
  await assert.rejects(rpc(db,'portal_tester_active',[ids.t1]),/portal:forbidden/);
  assert.equal((await one('select (public.portal_tester_active($1)).user_id as id',[ids.testerA])).id,ids.testerA);
  for(const id of [ids.owner,ids.admin])assert.equal((await one('select (public.portal_tester_active($1)).user_id as id',[id])).id,id);
  for(const status of ['suspended','revoked','invited']){
    await db.query('update public.portal_members set status=$2 where user_id=$1',[ids.admin,status]);
    try{await assert.rejects(rpc(db,'portal_tester_active',[ids.admin]),/portal:forbidden/,status);}
    finally{await db.query("update public.portal_members set status='active' where user_id=$1",[ids.admin]);}
  }
  await db.query("update public.portal_members set expires_at=now()-interval '1 day' where user_id=$1",[ids.admin]);
  try{await assert.rejects(rpc(db,'portal_tester_active',[ids.admin]),/portal:forbidden/);}
  finally{await db.query('update public.portal_members set expires_at=null where user_id=$1',[ids.admin]);}
  await db.query("update public.portal_members set status='suspended' where user_id=$1",[ids.testerB]);
  try{await assert.rejects(rpc(db,'portal_tester_active',[ids.testerB]),/portal:forbidden/);}
  finally{await db.query("update public.portal_members set status='active' where user_id=$1",[ids.testerB]);}
});

test("open_bug reuses the tester's open bug on the same line and confirm needs every reporter",async()=>{
  const comment='Map stays blank after switching\nSecond line with `code` and ## #12';
  const first=await rpc(db,'portal_feedback_open_bug',[ids.testerA,line,comment,'0.25.0','answer']);
  const again=await rpc(db,'portal_feedback_open_bug',[ids.testerA,line,'Still blank','0.25.1','answer']);
  assert.equal(again,first);
  const item=await one('select kind,title,line_id,build_seen,status,priority,created_by,owner_attention from public.feedback_items where id=$1',[first]);
  assert.deepEqual(item,{kind:'bug',title:'Map stays blank after switching',line_id:line,build_seen:'0.25.0',status:'new',priority:'normal',created_by:ids.testerA,owner_attention:true});
  assert.deepEqual((await db.query('select kind from public.feedback_events where item_id=$1 order by created_at,kind',[first])).rows.map(r=>r.kind),['comment','comment']);
  const long='x'.repeat(300);
  const imported=await rpc(db,'portal_feedback_open_bug',[ids.testerB,'map:other-line:abcdef0123',long,'unknown','import']);
  assert.equal((await one('select title from public.feedback_items where id=$1',[imported])).title.length,120);
  assert.equal((await one('select kind from public.feedback_events where item_id=$1',[imported])).kind,'import');
  await assert.rejects(rpc(db,'portal_feedback_open_bug',[ids.t1,line,'Outsider','0.25.0','answer']),/portal:forbidden/);
  await assert.rejects(rpc(db,'portal_feedback_open_bug',[ids.testerA,line,'  ','0.25.0','answer']),/portal:invalid/);
  await assert.rejects(rpc(db,'portal_feedback_open_bug',[ids.testerA,line,'Bad source','0.25.0','mail']),/portal:invalid/);

  assert.equal(await rpc(db,'portal_feedback_visible',[ids.testerA,first]),true);
  assert.equal(await rpc(db,'portal_feedback_visible',[ids.testerB,first]),false);
  assert.equal(await rpc(db,'portal_feedback_visible',[ids.admin,first]),true);
  await db.query('insert into public.feedback_reporters(item_id,tester_id) values ($1,$2)',[first,ids.testerB]);
  assert.equal(await rpc(db,'portal_feedback_visible',[ids.testerB,first]),true);
  await assert.rejects(rpc(db,'portal_feedback_confirm',[first,ids.testerA,null]),/portal:conflict/);
  await db.query("update public.feedback_items set status='fixed',fixed_in='0.26.0' where id=$1",[first]);
  await assert.rejects(rpc(db,'portal_feedback_confirm',[first,ids.t1,null]),/portal:forbidden/);
  const events=async()=>(await one('select count(*)::int as n from public.feedback_events where item_id=$1',[first])).n;
  let result=await confirm(first,ids.testerA,null);
  assert.equal(result.status,'fixed');
  const count=await events(),revision=result.revision;
  result=await confirm(first,ids.testerA,'0.26.1');
  assert.equal(result.status,'fixed');assert.equal(result.revision,revision);assert.equal(await events(),count);
  result=await confirm(first,ids.testerB,'0.26.1');
  assert.equal(result.status,'confirmed');
  assert.deepEqual(await one('select status,build from public.test_answers where tester_id=$1 and line_id=$2',[ids.testerA,line]),{status:'pass',build:'0.26.0'});
  assert.deepEqual(await one('select status,build from public.test_answers where tester_id=$1 and line_id=$2',[ids.testerB,line]),{status:'pass',build:'0.26.1'});
  const fresh=await rpc(db,'portal_feedback_open_bug',[ids.testerA,line,'Broke again','0.27.0','answer']);
  assert.notEqual(fresh,first);
});

test('schema checks reject bad answers, builds, line ids and attachments',async()=>{
  const answer=(status,comment,build='0.25.0',lineId=line)=>db.query('insert into public.test_answers(tester_id,line_id,status,comment,build) values ($1,$2,$3,$4,$5) on conflict (tester_id,line_id) do update set status=excluded.status,comment=excluded.comment,build=excluded.build',[ids.testerB,lineId,status,comment,build]);
  await assert.rejects(answer('fail',''),/check constraint/);
  await assert.rejects(answer('fail','   '),/check constraint/);
  await assert.rejects(answer('maybe','x'),/check constraint/);
  await assert.rejects(answer('pass','',' 0.25.0'),/check constraint/);
  await assert.rejects(answer('pass','','-bad'),/check constraint/);
  await assert.rejects(answer('pass','','0.25.0','Map:Bad'),/check constraint/);
  await answer('skip','','unknown');
  const item=(await one('select id from public.feedback_items limit 1')).id;
  const attach=(mime,bytes,bucket='quadrion-feedback')=>db.query("insert into public.feedback_attachments(item_id,uploader_id,bucket,object_path,filename,mime_type,bytes,sha256) values ($1,$2,$3,$4,'shot.png',$5,$6,$7)",[item,ids.testerA,bucket,'items/'+Math.random(),mime,bytes,'a'.repeat(64)]);
  await attach('image/png',10000000);
  await assert.rejects(attach('image/png',10000001),/check constraint/);
  await attach('video/mp4',100000000);
  await attach('application/zip',50000000);
  await assert.rejects(attach('application/zip',50000001),/check constraint/);
  await assert.rejects(attach('image/heic',10),/check constraint/);
  await assert.rejects(attach('image/png',10,'quadrion-software'),/check constraint/);
});
