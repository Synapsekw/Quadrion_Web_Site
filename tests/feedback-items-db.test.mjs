import test from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
const line='map:switch-view:0123456789',other='map:measure-area:abcdef0123';
// Each test gets its own database so counts and ordering never depend on another test.
const withDb=(name,fn)=>test(name,async()=>{
  const db=await portalDb({testers:true});
  try{
    await db.query("insert into public.test_content(id,version,title,model,line_count,current,uploaded_by) values ('20000000-0000-4000-8000-000000000001',1,'Sample tests','{}',1,true,$1)",[ids.owner]);
    await db.query("insert into public.test_lines(content_id,line_id,position,plain,html,sub) values ('20000000-0000-4000-8000-000000000001',$1,0,'Open the sample project and switch to Map','<p>Open the sample project and switch to Map</p>','[\"Check the tiles load\"]')",[line]);
    await fn(api(db),db);
  }finally{await db.close();}
});
const json=v=>v===undefined?null:JSON.stringify(v);
function api(db){
  return {
    create:(actor,data)=>rpc(db,'portal_feedback_create',[actor,json(data)]),
    mine:async actor=>(await rpc(db,'portal_feedback_mine',[actor])).items,
    item:(actor,id,aal='aal1')=>rpc(db,'portal_feedback_item',[actor,aal,id]),
    tester:(actor,id,revision,action,body=null,build=null)=>rpc(db,'portal_feedback_tester_action',[actor,id,revision,action,body,build]),
    counts:actor=>rpc(db,'portal_feedback_counts',[actor]),
    inbox:(actor,filter={},aal='aal1')=>rpc(db,'portal_feedback_inbox',[actor,aal,json(filter)]),
    owner:(actor,id,revision,action,data={},aal='aal1')=>rpc(db,'portal_feedback_owner_action',[actor,aal,id,revision,action,json(data)]),
    bulk:(actor,list,build,aal='aal1')=>rpc(db,'portal_feedback_bulk_fix',[actor,aal,list,build]),
    exported:(actor,filter={},aal='aal1')=>rpc(db,'portal_feedback_export',[actor,aal,json(filter)]),
  };
}
const bug=(title,extra={})=>({kind:'bug',title,body:'What I saw for '+title,build:'0.25.0',...extra});
const rev=async(db,id)=>(await db.query('select revision from public.feedback_items where id=$1',[id])).rows[0].revision;

withDb("a tester cannot read another tester's item or the inbox",async(a)=>{
  const item=await a.create(ids.testerA,bug('Map stays blank',{screen:'workspace:map'}));
  assert.equal(item.kind,'bug');assert.equal(item.status,'new');assert.equal(item.screen,'workspace:map');assert.equal(item.mine,true);
  assert.equal('created_by' in item,false);assert.equal('owner_attention' in item,false);
  await assert.rejects(a.item(ids.testerB,item.id),/portal:not_found/);
  await assert.rejects(a.tester(ids.testerB,item.id,item.revision,'comment','Me too'),/portal:not_found/);
  await assert.rejects(a.inbox(ids.testerB),/portal:forbidden/);
  await assert.rejects(a.exported(ids.testerA),/portal:forbidden/);
  await assert.rejects(a.create(ids.t1,bug('Outsider')),/portal:forbidden/);
  await assert.rejects(a.mine(ids.t1),/portal:forbidden/);
  await assert.rejects(a.item(ids.t1,item.id),/portal:forbidden/);
  await assert.rejects(a.counts(ids.t1),/portal:forbidden/);
  assert.deepEqual((await a.mine(ids.testerB)),[]);
  const view=await a.item(ids.testerA,item.id);
  assert.equal(view.item.id,item.id);assert.equal(view.line,null);assert.equal(view.retired,false);
  assert.deepEqual(view.events.map(e=>[e.kind,e.actor,e.body]),[['comment','you','What I saw for Map stays blank']]);
  // Bad input is refused as invalid, never as a raw check violation; a line that is not current is a conflict.
  for(const data of [{...bug('x'),kind:'idea'},{...bug('x'),actor:ids.owner},{...bug('x'),title:'   '},{...bug('x'),build:'-bad'},{...bug('x'),build:'x'.repeat(81)},
    {...bug('x'),lineId:'Map:Bad'},{...bug('x'),screen:'s'.repeat(81)},{...bug('x'),title:5},null,[]])
    await assert.rejects(a.create(ids.testerA,data),/portal:invalid/,JSON.stringify(data));
  await assert.rejects(a.create(ids.testerA,bug('Retired',{lineId:other})),/portal:conflict/);
  const feature=await a.create(ids.testerA,{kind:'feature',title:'  Export the map\nas a picture ',lineId:line});
  assert.equal(feature.title,'Export the map as a picture');assert.equal(feature.build_seen,'unknown');assert.equal(feature.line_id,line);
  assert.equal((await a.create(ids.testerA,{kind:'feature',title:'Dark theme'})).line_id,null);
});

withDb('item shows the current line text, or retired once the line is gone',async(a,db)=>{
  const item=await a.create(ids.testerA,bug('Tiles missing',{lineId:line}));
  let view=await a.item(ids.testerA,item.id);
  assert.equal(view.line.plain,'Open the sample project and switch to Map');assert.deepEqual(view.line.sub,['Check the tiles load']);assert.equal(view.retired,false);
  await db.query("update public.test_content set current=false");
  await db.query("insert into public.test_content(version,title,model,line_count,current,uploaded_by) values (2,'Sample tests','{}',0,true,$1)",[ids.owner]);
  view=await a.item(ids.owner,item.id);
  assert.equal(view.line,null);assert.equal(view.retired,true);
});

withDb('owner and admin act, members cannot',async(a,db)=>{
  await db.query("update public.portal_members set display_name='Sample Owner' where user_id=$1",[ids.owner]);
  const one=await a.create(ids.testerA,bug('One'));
  const two=await a.create(ids.testerB,{kind:'feature',title:'Two'});
  let result=await a.owner(ids.owner,one.id,one.revision,'priority',{priority:'high'});
  assert.equal(result.priority,'high');assert.equal(result.revision,one.revision+1);assert.equal(result.owner_attention,false);
  assert.deepEqual(result.reporters.map(r=>r.id),[ids.testerA]);
  result=await a.owner(ids.admin,one.id,result.revision,'triage');
  assert.equal(result.status,'triaged');
  for(const actor of [ids.testerA,ids.t1])
    await assert.rejects(a.owner(actor,one.id,result.revision,'comment',{body:'Hi'}),/portal:forbidden/);
  await assert.rejects(a.bulk(ids.testerA,[one.id],'0.26.0'),/portal:forbidden/);
  await assert.rejects(a.owner(ids.admin,one.id,result.revision,'comment',{body:'Hi'},null),/portal:unauthorized/);
  for(const [action,data] of [['priority',{priority:'urgent'}],['comment',{}],['comment',{body:'  '}],['comment',{body:'x',actor:ids.owner}],['fix',{build:'unknown'}],['fix',{}],['bogus',{}],['merge',{into:'nope'}],['merge',{into:one.id}]])
    await assert.rejects(a.owner(ids.owner,one.id,result.revision,action,data),/portal:invalid/,action);
  await a.owner(ids.owner,one.id,result.revision,'comment',{body:'Looking at it'});
  const view=await a.item(ids.admin,one.id);
  assert.deepEqual(view.events.map(e=>e.actor),['testerA@example.com','Sample Owner','admin@example.com','Sample Owner']);
  assert.equal((await a.item(ids.testerA,one.id)).events.at(-1).actor,'quadrion');
  // Bulk fix is all or nothing and counts what it fixed.
  await assert.rejects(a.bulk(ids.owner,[],'0.26.0'),/portal:invalid/);
  await assert.rejects(a.bulk(ids.owner,Array.from({length:201},(_,i)=>`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`),'0.26.0'),/portal:invalid/);
  await assert.rejects(a.bulk(ids.owner,[one.id,'30000000-0000-4000-8000-000000000000'],'0.26.0'),/portal:not_found/);
  const three=await a.create(ids.testerA,bug('Three'));
  await a.owner(ids.owner,three.id,three.revision,'decline',{reason:'Works as designed'});
  await assert.rejects(a.bulk(ids.owner,[one.id,three.id],'0.26.0'),/portal:conflict/);
  assert.equal((await a.item(ids.owner,one.id)).item.status,'triaged');
  assert.deepEqual(await a.bulk(ids.owner,[one.id,two.id,one.id],' 0.26.0 '),{fixed:2,bugs:1,features:1,testers:2,build:'0.26.0'});
  assert.equal((await a.item(ids.testerB,two.id)).item.fixed_in,'0.26.0');
});

withDb('every move follows the status table',async(a,db)=>{
  const item=await a.create(ids.testerA,bug('Walk the table',{lineId:line}));
  const step=async(promise,status)=>{const r=await promise;assert.equal(r.status,status);return r;};
  let r=await step(a.owner(ids.owner,item.id,item.revision,'triage'),'triaged');
  await assert.rejects(a.owner(ids.owner,item.id,r.revision,'restore'),/portal:conflict/);
  await assert.rejects(a.tester(ids.testerA,item.id,r.revision,'answer','Early'),/portal:conflict/);
  r=await step(a.owner(ids.owner,item.id,r.revision,'ask',{body:'Which project?'}),'question');
  assert.equal((await a.mine(ids.testerA))[0].waiting,true);
  await assert.rejects(a.tester(ids.testerA,item.id,r.revision,'answer','  '),/portal:invalid/);
  r=await step(a.tester(ids.testerA,item.id,r.revision,'answer','The sample one'),'triaged');
  await assert.rejects(a.tester(ids.testerA,item.id,r.revision,'confirm'),/portal:conflict/);
  r=await step(a.owner(ids.owner,item.id,(await rev(db,item.id)),'fix',{build:'0.26.0'}),'fixed');
  assert.equal(r.fixed_in,'0.26.0');
  await assert.rejects(a.tester(ids.testerA,item.id,r.revision,'title','Too late'),/portal:conflict/);
  await assert.rejects(a.tester(ids.testerA,item.id,r.revision,'reopen',''),/portal:invalid/);
  await assert.rejects(a.tester(ids.testerA,item.id,r.revision,'shout','x'),/portal:invalid/);
  r=await step(a.tester(ids.testerA,item.id,r.revision,'reopen','Still blank','0.26.0'),'reopened');
  r=await step(a.owner(ids.owner,item.id,(await rev(db,item.id)),'fix',{build:'0.26.1'}),'fixed');
  r=await step(a.tester(ids.testerA,item.id,r.revision,'confirm',null,'0.26.1'),'confirmed');
  assert.equal(r.waiting,false);
  assert.deepEqual((await db.query('select status,build from public.test_answers where tester_id=$1 and line_id=$2',[ids.testerA,line])).rows,[{status:'pass',build:'0.26.1'}]);
  const kinds=(await a.item(ids.testerA,item.id)).events.map(e=>e.kind);
  assert.deepEqual(kinds,['comment','status','question','answer','fixed','reopen','fixed','confirm']);
  await assert.rejects(a.owner(ids.owner,item.id,(await rev(db,item.id)),'park'),/portal:conflict/);
  // Title edits: the creator only, while the item is still open for triage.
  const other=await a.create(ids.testerA,bug('Old title'));
  await db.query('insert into public.feedback_reporters(item_id,tester_id) values ($1,$2)',[other.id,ids.testerB]);
  await assert.rejects(a.tester(ids.testerB,other.id,other.revision,'title','Mine now'),/portal:forbidden/);
  r=await a.tester(ids.testerA,other.id,other.revision,'title','New title');
  assert.equal(r.title,'New title');assert.equal(r.revision,other.revision+1);
  assert.equal((await db.query('select owner_attention from public.feedback_items where id=$1',[other.id])).rows[0].owner_attention,true);
  r=await step(a.owner(ids.owner,other.id,r.revision,'park'),'parked');
  r=await step(a.owner(ids.owner,other.id,r.revision,'restore'),'triaged');
});

withDb('stale revision is refused and a repeated confirm changes nothing',async(a,db)=>{
  const item=await a.create(ids.testerA,bug('Double click'));
  const fixed=await a.owner(ids.owner,item.id,item.revision,'fix',{build:'0.26.0'});
  await assert.rejects(a.owner(ids.owner,item.id,item.revision,'fix',{build:'0.26.0'}),/portal:conflict/);
  const events=async()=>(await db.query('select kind from public.feedback_events where item_id=$1',[item.id])).rows.map(e=>e.kind);
  assert.deepEqual((await events()).filter(k=>k==='fixed'),['fixed']);
  await assert.rejects(a.tester(ids.testerA,item.id,item.revision,'comment','From a stale tab'),/portal:conflict/);
  const first=await a.tester(ids.testerA,item.id,fixed.revision,'confirm');
  assert.equal(first.status,'confirmed');
  const count=(await events()).length;
  const again=await a.tester(ids.testerA,item.id,fixed.revision,'confirm');
  assert.equal(again.revision,first.revision);assert.equal(again.status,'confirmed');assert.equal((await events()).length,count);
  await assert.rejects(a.tester(ids.testerA,item.id,fixed.revision,'reopen','Broken again'),/portal:conflict/);
  await assert.rejects(a.tester(ids.testerA,item.id,first.revision,'reopen','Broken again'),/portal:conflict/);
});

withDb('merge folds reporters and thread and notifies both on fix',async(a,db)=>{
  const kept=await a.create(ids.testerA,bug('Map blank'));
  const dup=await a.create(ids.testerB,bug('Map is empty'));
  const said=await a.tester(ids.testerB,dup.id,dup.revision,'comment','Happens on every project');
  await assert.rejects(a.owner(ids.owner,dup.id,said.revision,'merge',{into:dup.id}),/portal:invalid/);
  await assert.rejects(a.owner(ids.owner,dup.id,said.revision,'merge',{into:'30000000-0000-4000-8000-000000000000'}),/portal:not_found/);
  const merged=await a.owner(ids.owner,dup.id,said.revision,'merge',{into:kept.id});
  assert.equal(merged.status,'merged');assert.equal(merged.merged_into,kept.id);
  await assert.rejects(a.owner(ids.owner,dup.id,merged.revision,'triage'),/portal:conflict/);
  const third=await a.create(ids.testerA,bug('Third'));
  await assert.rejects(a.owner(ids.owner,third.id,third.revision,'merge',{into:dup.id}),/portal:conflict/);
  const view=await a.item(ids.testerB,kept.id);
  assert.deepEqual(view.events.filter(e=>e.kind==='comment').map(e=>[e.actor,e.body]),[['tester','What I saw for Map blank'],['you','What I saw for Map is empty'],['you','Happens on every project']]);
  assert.deepEqual((await a.item(ids.owner,kept.id)).item.reporters.map(r=>r.id).sort(),[ids.testerA,ids.testerB].sort());
  await a.owner(ids.owner,kept.id,await rev(db,kept.id),'fix',{build:'0.26.0'});
  const waiting=async actor=>(await a.mine(actor)).find(i=>i.id===kept.id).waiting;
  assert.equal(await waiting(ids.testerA),true);assert.equal(await waiting(ids.testerB),true);
  assert.equal((await a.mine(ids.testerB)).find(i=>i.id===dup.id).status,'merged');
  let r=await a.tester(ids.testerA,kept.id,await rev(db,kept.id),'confirm');
  assert.equal(r.status,'fixed');assert.equal(r.waiting,false);
  assert.equal(await waiting(ids.testerB),true);
  // Sending it back clears every confirmation, so a re-fix needs everyone again.
  r=await a.tester(ids.testerB,kept.id,r.revision,'reopen','Still empty here');
  assert.equal(r.status,'reopened');
  await a.owner(ids.owner,kept.id,r.revision,'fix',{build:'0.26.1'});
  assert.equal(await waiting(ids.testerA),true);
  r=await a.tester(ids.testerA,kept.id,await rev(db,kept.id),'confirm');
  assert.equal(r.status,'fixed');
  r=await a.tester(ids.testerB,kept.id,r.revision,'confirm');
  assert.equal(r.status,'confirmed');
});

withDb('decline needs a reason the tester sees',async(a)=>{
  const item=await a.create(ids.testerA,{kind:'feature',title:'Make it purple'});
  for(const data of [{},{reason:'   '},{reason:'x'.repeat(2001)}])
    await assert.rejects(a.owner(ids.owner,item.id,item.revision,'decline',data),/portal:invalid/);
  const declined=await a.owner(ids.owner,item.id,item.revision,'decline',{reason:'Out of scope for now'});
  assert.equal(declined.status,'declined');
  const view=await a.item(ids.testerA,item.id);
  assert.equal(view.item.reason,'Out of scope for now');
  assert.deepEqual(view.events.at(-1),{...view.events.at(-1),kind:'status',actor:'quadrion',body:'Out of scope for now'});
  assert.deepEqual(view.events.at(-1).details,{from:'new',to:'declined'});
  const restored=await a.owner(ids.owner,item.id,declined.revision,'restore');
  assert.equal(restored.status,'triaged');assert.equal(restored.reason,null);
});

withDb('counts drop when the owner opens an item',async(a)=>{
  const one=await a.create(ids.testerA,bug('One'));
  const two=await a.create(ids.testerB,bug('Two'));
  assert.deepEqual(await a.counts(ids.owner),{waiting:0,inbox:2});
  assert.deepEqual(await a.counts(ids.testerA),{waiting:0});
  const seen=await a.owner(ids.owner,one.id,999,'seen');
  assert.equal(seen.revision,one.revision);assert.equal(seen.owner_attention,false);
  assert.deepEqual(await a.counts(ids.admin),{waiting:0,inbox:1});
  await a.tester(ids.testerA,one.id,one.revision,'comment','More detail');
  assert.equal((await a.counts(ids.owner)).inbox,2);
  const asked=await a.owner(ids.owner,two.id,two.revision,'ask',{body:'Which build?'});
  assert.deepEqual(await a.counts(ids.owner),{waiting:0,inbox:1});
  assert.deepEqual(await a.counts(ids.testerB),{waiting:1});
  await a.tester(ids.testerB,two.id,asked.revision,'answer','0.25.0');
  assert.deepEqual(await a.counts(ids.testerB),{waiting:0});
  assert.equal((await a.counts(ids.owner)).inbox,2);
});

withDb('inbox sorts by priority then age and filters by tester and build',async(a)=>{
  const i1=await a.create(ids.testerA,bug('First'));
  const i2=await a.create(ids.testerB,bug('Second',{build:'0.25.1'}));
  const i3=await a.create(ids.testerA,{kind:'feature',title:'Third',build:'0.25.1'});
  const i4=await a.create(ids.testerB,bug('Fourth'));
  await a.owner(ids.owner,i3.id,i3.revision,'priority',{priority:'high'});
  await a.owner(ids.owner,i1.id,i1.revision,'priority',{priority:'low'});
  const titles=async filter=>{const r=await a.inbox(ids.owner,filter);return [r.items.map(i=>i.title),r.total];};
  assert.deepEqual(await titles({}),[['Third','Second','Fourth','First'],4]);
  assert.deepEqual(await titles({tester:ids.testerB}),[['Second','Fourth'],2]);
  assert.deepEqual(await titles({build:'0.25.1'}),[['Third','Second'],2]);
  assert.deepEqual(await titles({kind:'bug',priority:'normal'}),[['Second','Fourth'],2]);
  assert.deepEqual(await titles({status:['new'],offset:3}),[['First'],4]);
  await a.owner(ids.owner,i4.id,i4.revision,'fix',{build:'0.25.1'});
  assert.deepEqual(await titles({status:['fixed']}),[['Fourth'],1]);
  assert.deepEqual(await titles({build:'0.25.1',status:['new','fixed']}),[['Third','Second','Fourth'],3]);
  const unrecorded=await a.create(ids.testerA,{kind:'feature',title:'No build'});
  assert.deepEqual(await titles({build:'unknown'}),[[unrecorded.title],1]);
  for(const filter of [{who:'x'},{build:'  '},{tester:'nope'},{kind:'idea'},{status:'new'},{status:['done']},{priority:'urgent'},{offset:-1},{offset:1.5},{build:'-x'},[]])
    await assert.rejects(a.inbox(ids.owner,filter),/portal:invalid/,JSON.stringify(filter));
  void i2;
});

withDb('export carries no names or emails',async(a,db)=>{
  const names={[ids.testerA]:'Sample Person A',[ids.testerB]:'Sample Person B',[ids.owner]:'Sample Owner',[ids.admin]:'Sample Admin'};
  for(const [id,name] of Object.entries(names))await db.query('update public.portal_members set display_name=$2 where user_id=$1',[id,name]);
  const open=await a.create(ids.testerA,bug('Tiles missing',{lineId:line,body:'```\n## #12 fake heading'}));
  const asked=await a.owner(ids.owner,open.id,open.revision,'ask',{body:'Which zoom level?'});
  await a.tester(ids.testerA,open.id,asked.revision,'answer','Zoom 14');
  const dup=await a.create(ids.testerB,bug('No tiles'));
  await a.owner(ids.admin,dup.id,dup.revision,'merge',{into:open.id});
  await db.query("insert into public.feedback_attachments(item_id,uploader_id,object_path,filename,mime_type,bytes,sha256,state) values ($1,$2,'items/a/shot.png','shot.png','image/png',10,$3,'verified'),($1,$2,'items/a/pending.png','pending.png','image/png',10,$3,'pending')",[open.id,ids.testerA,'a'.repeat(64)]);
  await a.create(ids.testerA,{kind:'feature',title:'Not a bug'});
  const done=await a.create(ids.testerB,bug('Already fixed'));
  await a.owner(ids.owner,done.id,done.revision,'fix',{build:'0.26.0'});
  const result=await a.exported(ids.owner);
  assert.equal(result.items.length,1);
  const [item]=result.items;
  assert.equal(item.number,open.number);assert.equal(item.build,'0.25.0');assert.equal(item.body,'```\n## #12 fake heading');
  assert.deepEqual(item.line,{plain:'Open the sample project and switch to Map',subPlain:['Check the tiles load']});
  assert.deepEqual(item.thread.map(e=>[e.kind,e.role,e.body]),[['question','quadrion','Which zoom level?'],['answer','tester','Zoom 14'],['comment','tester','What I saw for No tiles'],['merge','quadrion','']]);
  assert.deepEqual(item.attachments,[{id:item.attachments[0].id,bucket:'quadrion-feedback',object_path:'items/a/shot.png',filename:'shot.png',mime_type:'image/png'}]);
  const text=JSON.stringify(result);
  for(const id of Object.keys(names))for(const word of [names[id]])assert.equal(text.includes(word),false,word);
  for(const name of ['owner','admin','testerA','testerB'])assert.equal(text.includes(name+'@example.com'),false,name);
  for(const id of Object.keys(names))assert.equal(text.includes(id),false,id);
  assert.deepEqual((await a.exported(ids.owner,{kind:'feature'})).items,[]);
  assert.deepEqual((await a.exported(ids.owner,{tester:ids.testerB})).items.map(i=>i.title),['Tiles missing']);
  await assert.rejects(a.exported(ids.owner,{status:'open'}),/portal:invalid/);
});

withDb('only the item API is executable by service_role and nothing by browser roles',async(_a,db)=>{
  const api=['create','mine','item','tester_action','counts','inbox','owner_action','bulk_fix','export'].map(n=>'portal_feedback_'+n);
  const internal=['build_text','note','keys','str','uuid','tree','dto','line','match'].map(n=>'portal_feedback_'+n);
  const fns=(await db.query("select p.oid::regprocedure::text as sig,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1)",[[...api,...internal]])).rows;
  assert.equal(fns.length,api.length+internal.length);
  const can=async(role,sig)=>(await db.query('select has_function_privilege($1,$2,$3) as ok',[role,sig,'execute'])).rows[0].ok;
  for(const f of fns){
    assert.equal(f.prosecdef,true,f.proname);assert.deepEqual(f.proconfig,['search_path=""'],f.proname);
    assert.equal(await can('service_role',f.sig),api.includes(f.proname),f.proname);
    for(const role of ['anon','authenticated'])assert.equal(await can(role,f.sig),false,`${role} ${f.proname}`);
  }
});
