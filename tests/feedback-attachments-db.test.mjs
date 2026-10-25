import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {portalDb,ids,rpc} from './helpers/portal-db.mjs';
let db;
before(async()=>{db=await portalDb({testers:true});});
after(async()=>{await db?.close();});
const api=['portal_feedback_attachment_begin','portal_feedback_attachment_command','portal_feedback_attachment_get','portal_feedback_verify_claim','portal_feedback_verify_checkpoint','portal_feedback_verify_release','portal_feedback_verify_queue','portal_feedback_cleanup'];
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let lines=0;
const bug=tester=>rpc(db,'portal_feedback_open_bug',[tester,`map:switch-view:${String(++lines).padStart(10,'0')}`,'The map stays blank','1.0.0','answer']);
const input=(itemId,extra={})=>({itemId,eventId:null,filename:'screen.png',bytes:100,sha256:'a'.repeat(64),mimeType:'image/png',maxBytes:10000000,...extra});
const begin=(actor,data)=>rpc(db,'portal_feedback_attachment_begin',[actor,'aal1',data]);
const command=(actor,id,action)=>rpc(db,'portal_feedback_attachment_command',[actor,'aal1',id,action]);
const verify=async id=>{const job=await rpc(db,'portal_feedback_verify_claim',[id]);await rpc(db,'portal_feedback_verify_checkpoint',[id,job.lease_id,job.bytes,null,'"v1"',job.sha256]);};

test('only someone who can see the item may attach',async()=>{
  const item=await bug(ids.testerA);
  const own=await begin(ids.testerA,input(item));
  assert.equal(own.state,'pending');assert.equal(own.object_path,`${item}/${own.id}/screen.png`);assert.equal(own.bucket,'quadrion-feedback');
  assert.equal((await begin(ids.owner,input(item,{filename:'owner.png'}))).uploader_id,ids.owner);
  await assert.rejects(begin(ids.testerB,input(item)),/portal:not_found/);
  await assert.rejects(begin(ids.t1,input(item)),/portal:not_found/);
  await assert.rejects(rpc(db,'portal_feedback_attachment_begin',[ids.testerA,null,input(item)]),/portal:unauthorized/);
  await db.query("update public.portal_members set status='revoked' where user_id=$1",[ids.testerA]);
  try{await assert.rejects(begin(ids.testerA,input(item)),/portal:not_found|portal:forbidden/);}
  finally{await db.query("update public.portal_members set status='active' where user_id=$1",[ids.testerA]);}
  for(const bad of [{filename:'../x.png'},{filename:'a/b.png'},{mimeType:'image/heic'},{bytes:0},{sha256:'xyz'},{eventId:'10000000-0000-4000-8000-0000000000ff'}])
    await assert.rejects(begin(ids.testerA,input(item,bad)),/portal:invalid/,JSON.stringify(bad));
  await assert.rejects(begin(ids.testerA,input(item,{bytes:10000001,maxBytes:20000000})),/portal:too_large/);
  const event=(await one('select id from public.feedback_events where item_id=$1',[item])).id;
  assert.equal((await begin(ids.testerA,input(item,{eventId:event,filename:'clip.mp4',mimeType:'video/mp4',bytes:100000000,maxBytes:100000000}))).event_id,event);
});

test('an eleventh attachment is refused',async()=>{
  const item=await bug(ids.testerA),made=[];
  for(let i=0;i<10;i++)made.push(await begin(ids.testerA,input(item,{filename:`shot-${i}.png`})));
  await assert.rejects(begin(ids.testerA,input(item,{filename:'shot-10.png'})),/portal:conflict/);
  await command(ids.testerA,made[0].id,'abandon');
  assert.equal((await begin(ids.testerA,input(item,{filename:'shot-10.png'}))).state,'pending');
});

test('the uploader alone finalizes or abandons',async()=>{
  const item=await bug(ids.testerA),a=await begin(ids.testerA,input(item));
  for(const action of ['finalize','abandon','resume','status'])await assert.rejects(command(ids.owner,a.id,action),/portal:not_found/,action);
  await assert.rejects(command(ids.testerA,a.id,'publish'),/portal:invalid/);
  assert.equal((await command(ids.testerA,a.id,'resume')).state,'pending');
  assert.equal((await command(ids.testerA,a.id,'finalize')).state,'verifying');
  assert.equal((await command(ids.testerA,a.id,'finalize')).state,'verifying');
  await assert.rejects(command(ids.testerA,a.id,'abandon'),/portal:conflict/);
  const job=await rpc(db,'portal_feedback_verify_claim',[a.id]);assert.ok(job.lease_id);
  assert.equal(await rpc(db,'portal_feedback_verify_claim',[a.id]),null);
  await assert.rejects(rpc(db,'portal_feedback_verify_checkpoint',[a.id,job.lease_id,100,null,'"v1"','b'.repeat(64)]),/portal:checksum_mismatch/);
  await rpc(db,'portal_feedback_verify_release',[a.id,job.lease_id,'checksum_mismatch']);
  assert.equal((await command(ids.testerA,a.id,'status')).state,'failed');
  assert.equal((await command(ids.testerA,a.id,'retry')).state,'verifying');
  await verify(a.id);assert.equal((await command(ids.testerA,a.id,'status')).state,'verified');
  await assert.rejects(command(ids.testerA,a.id,'abandon'),/portal:conflict/);
  const b=await begin(ids.testerA,input(item,{filename:'other.png'}));
  assert.equal((await command(ids.testerA,b.id,'abandon')).state,'abandoned');
  await assert.rejects(command(ids.testerA,b.id,'finalize'),/portal:conflict/);
  const c=await begin(ids.testerA,input(item,{filename:'late.png'}));
  await db.query("update public.feedback_attachments set expires_at=now()-interval '1 minute' where id=$1",[c.id]);
  await assert.rejects(command(ids.testerA,c.id,'finalize'),/portal:conflict/);
  await assert.rejects(command(ids.testerA,c.id,'resume'),/portal:conflict/);
});

test('a pending attachment is never returned by get',async()=>{
  const item=await bug(ids.testerA),a=await begin(ids.testerA,input(item));
  const get=(actor,id)=>rpc(db,'portal_feedback_attachment_get',[actor,'aal1',id]);
  await assert.rejects(get(ids.testerA,a.id),/portal:not_found/);
  await command(ids.testerA,a.id,'finalize');await assert.rejects(get(ids.testerA,a.id),/portal:not_found/);
  await verify(a.id);
  assert.equal((await get(ids.testerA,a.id)).object_path,a.object_path);
  assert.equal((await get(ids.owner,a.id)).id,a.id);
  await assert.rejects(get(ids.testerB,a.id),/portal:not_found/);
  await assert.rejects(get(ids.t1,a.id),/portal:not_found/);
});

test('verification queue and cleanup follow their release twins',async()=>{
  const item=await bug(ids.testerB),a=await begin(ids.testerB,input(item)),stale=await begin(ids.testerB,input(item,{filename:'stale.png'}));
  await command(ids.testerB,a.id,'finalize');
  assert.ok((await rpc(db,'portal_feedback_verify_queue')).includes(a.id));
  await db.query("update public.feedback_attachments set expires_at=now()-interval '6 days' where id=$1",[stale.id]);
  assert.equal((await rpc(db,'portal_feedback_cleanup',[null])).some(c=>c.id===stale.id),false);
  await db.query("update public.feedback_attachments set expires_at=now()-interval '8 days' where id=$1",[stale.id]);
  const found=(await rpc(db,'portal_feedback_cleanup',[null])).filter(c=>c.id===stale.id);
  assert.deepEqual(found,[{id:stale.id,bucket:'quadrion-feedback',object_path:stale.object_path}]);
  await assert.rejects(command(ids.testerB,stale.id,'retry'),/portal:conflict/);
  await rpc(db,'portal_feedback_cleanup',[stale.id]);
  assert.equal((await rpc(db,'portal_feedback_cleanup',[null])).some(c=>c.id===stale.id),false);
  assert.equal((await command(ids.testerB,a.id,'status')).state,'verifying');
});

test('functions are service-only',async()=>{
  const fns=(await db.query("select p.oid::regprocedure::text as sig,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1)",[api])).rows;
  assert.equal(fns.length,api.length);
  for(const f of fns){
    assert.equal(f.prosecdef,true,f.proname);assert.deepEqual(f.proconfig,['search_path=""'],f.proname);
    assert.equal((await one("select has_function_privilege('service_role',$1,'execute') as ok",[f.sig])).ok,true,f.proname);
    for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,$3) as ok',[role,f.sig,'execute'])).ok,false,`${role} ${f.proname}`);
  }
});
