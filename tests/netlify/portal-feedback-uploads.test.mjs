import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFeedbackUploads,FEEDBACK_TYPES} from '../../netlify/lib/portal/feedback-uploads.mjs';
import {errorResponse} from '../../netlify/lib/portal/http.mjs';

const item='10000000-0000-4000-8000-0000000000a1',id='10000000-0000-4000-8000-0000000000b1';
const user={userId:'10000000-0000-4000-8000-000000000006',aal:'aal1'};
const config={url:'https://fixture.supabase.co',verifySecret:'x'.repeat(32)};
const row=(extra={})=>({id,item_id:item,event_id:null,bucket:'quadrion-feedback',object_path:`${item}/${id}/screen.png`,filename:'screen.png',bytes:100,sha256:'a'.repeat(64),mime_type:'image/png',state:'pending',verified_bytes:0,error_code:null,expires_at:'2099-01-01T00:00:00Z',...extra});
function fake({rows={},size=100}={}){
  const calls=[],signed=[],dispatched=[];
  const backend={
    rpc:async(name,args)=>{calls.push({name,args});const action=args.p_action||name;return row(typeof rows==='function'?rows(action,args):rows[action]);},
    service:{storage:{from(bucket){assert.equal(bucket,'quadrion-feedback');return {
      createSignedUploadUrl:async(path,options)=>{signed.push({path,options});return {data:{token:'upload-token'},error:null};},
      info:async()=>({data:{size},error:null}),
    };}}},
    signDownload:async(file,ttl,download)=>{signed.push({file,ttl,download});return 'https://fixture.supabase.co/signed';},
  };
  const actions=createFeedbackUploads({config,backend,dispatch:async value=>{dispatched.push(value);}});
  return {actions,calls,signed,dispatched};
}
const begin={itemId:item,filename:'screen.png',bytes:100,sha256:'a'.repeat(64)};

test('types and caps follow FEEDBACK_TYPES',async()=>{
  assert.deepEqual(Object.keys(FEEDBACK_TYPES).sort(),['jpeg','jpg','mp4','png','webm','webp','zip']);
  assert.deepEqual(FEEDBACK_TYPES.png,{mime:'image/png',maxBytes:10000000});
  assert.deepEqual(FEEDBACK_TYPES.zip,{mime:'application/zip',maxBytes:50000000});
  const {actions,calls}=fake();
  await assert.rejects(actions('attachmentBegin',{...begin,bytes:10000001},user),/portal:too_large/);
  await assert.rejects(actions('attachmentBegin',{...begin,filename:'photo.heic'},user),/portal:invalid/);
  await assert.rejects(actions('attachmentBegin',{...begin,filename:'png'},user),/portal:invalid/);
  await assert.rejects(actions('attachmentBegin',{...begin,filename:'diagnostics.zip',bytes:50000001},user),/portal:too_large/);
  assert.equal(calls.length,0);
  await actions('attachmentBegin',{...begin,filename:'Clip.MP4',bytes:100000000},user);
  assert.deepEqual(calls[0],{name:'portal_feedback_attachment_begin',args:{p_actor:user.userId,p_aal:'aal1',p_data:{itemId:item,eventId:null,filename:'Clip.MP4',bytes:100000000,sha256:'a'.repeat(64),mimeType:'video/mp4',maxBytes:100000000}}});
  await assert.rejects(actions('attachmentBegin',{...begin,filename:'clip.mp4',bytes:100000001},user),/portal:too_large/);
});

test('attachmentBegin returns the upload session shape',async()=>{
  const {actions,signed}=fake();
  const result=await actions('attachmentBegin',begin,user);
  assert.deepEqual(signed,[{path:`${item}/${id}/screen.png`,options:{upsert:false}}]);
  assert.equal(result.endpoint,'https://fixture.storage.supabase.co/storage/v1/upload/resumable/sign');
  assert.equal(result.token,'upload-token');assert.equal(result.bucket,'quadrion-feedback');
  assert.equal(result.objectPath,`${item}/${id}/screen.png`);assert.equal(result.contentType,'image/png');
  assert.equal(result.id,id);assert.equal(result.itemId,item);assert.equal(result.state,'pending');assert.equal(result.bytes,100);
});

test('filenames with paths or dot-dot are refused',async()=>{
  const {actions,calls}=fake();
  for(const filename of ['../screen.png','a/screen.png','a\\screen.png','screen..png','.png','/screen.png',' screen.png','x'.repeat(197)+'.png'])
    await assert.rejects(actions('attachmentBegin',{...begin,filename},user),/portal:invalid/,filename);
  for(const extra of [{objectPath:'own/path'},{actor:user.userId},{itemId:'nope'},{eventId:'nope'},{sha256:'A'.repeat(64)},{bytes:1.5}])
    await assert.rejects(actions('attachmentBegin',{...begin,...extra},user),/portal:(invalid|too_large)/,JSON.stringify(extra));
  assert.equal(calls.length,0);
});

test('unconfigured verification refuses before any call',async()=>{
  let called=false;
  const actions=createFeedbackUploads({config:{verifySecret:''},backend:{rpc:async()=>{called=true;}}});
  await assert.rejects(actions('attachmentBegin',begin,user),/portal:upload_not_configured/);assert.equal(called,false);
});

test('finalize checks the stored size before verifying',async()=>{
  const short=fake({size:99,rows:{status:{},finalize:{state:'verifying'}}});
  await assert.rejects(short.actions('attachmentFinalize',{id},user),/portal:unverified/);
  assert.deepEqual(short.calls.map(c=>c.args.p_action),['status']);assert.deepEqual(short.dispatched,[]);
  const ok=fake({rows:{status:{},finalize:{state:'verifying'}}});
  const result=await ok.actions('attachmentFinalize',{id},user);
  assert.deepEqual(ok.calls.map(c=>c.args.p_action),['status','finalize']);assert.deepEqual(ok.dispatched,[id]);assert.equal(result.state,'verifying');
  const done=fake({rows:{status:{state:'verified'},finalize:{state:'verified'}},size:0});
  assert.equal((await done.actions('attachmentFinalize',{id},user)).state,'verified');assert.deepEqual(done.dispatched,[]);
});

test('status and abandon pass through the uploader command',async()=>{
  const {actions,calls}=fake({rows:{status:{},abandon:{state:'abandoned'}}});
  assert.equal((await actions('attachmentStatus',{id},user)).state,'pending');
  assert.equal((await actions('attachmentAbandon',{id},user)).state,'abandoned');
  assert.deepEqual(calls.map(c=>[c.name,c.args.p_action]),[['portal_feedback_attachment_command','status'],['portal_feedback_attachment_command','status'],['portal_feedback_attachment_command','abandon']]);
  await assert.rejects(actions('attachmentStatus',{id,extra:1},user),/portal:invalid/);
  await assert.rejects(actions('attachmentPublish',{id},user),/portal:not_found/);
});

test('attachmentUrl signs for 300 seconds',async()=>{
  const {actions,calls,signed}=fake({rows:{portal_feedback_attachment_get:{state:'verified'}}});
  const result=await actions('attachmentUrl',{id},user);
  assert.deepEqual(calls[0],{name:'portal_feedback_attachment_get',args:{p_actor:user.userId,p_aal:'aal1',p_id:id}});
  assert.equal(signed[0].ttl,300);assert.equal(signed[0].download,false);assert.equal(signed[0].file.object_path,`${item}/${id}/screen.png`);
  assert.deepEqual(result,{id,url:'https://fixture.supabase.co/signed',filename:'screen.png',mimeType:'image/png',bytes:100,expiresIn:300});
});

test('a resume with a different file is upload_file_mismatch',async()=>{
  const {actions,signed}=fake({rows:{resume:{}}});
  for(const change of [{filename:'other.png'},{bytes:200},{sha256:'b'.repeat(64)}])
    await assert.rejects(actions('attachmentResume',{id,filename:'screen.png',bytes:100,sha256:'a'.repeat(64),...change},user),error=>{
      assert.equal(error.message,'portal:upload_file_mismatch');assert.equal(errorResponse(error).status,409);return true;
    });
  assert.equal(signed.length,0);
  const expired=fake({rows:{resume:{expires_at:'2000-01-01T00:00:00Z'}}});
  await assert.rejects(expired.actions('attachmentResume',{id,filename:'screen.png',bytes:100,sha256:'a'.repeat(64)},user),/portal:conflict/);
  const result=await actions('attachmentResume',{id,filename:'screen.png',bytes:100,sha256:'a'.repeat(64)},user);
  assert.equal(result.token,'upload-token');assert.equal(signed.length,1);
});

test('feedback bucket migration creates the private bucket with its limits',async()=>{
  const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
  try{
    await db.exec('create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);');
    const sql=await readFile(new URL('../../supabase/migrations/202610250005_feedback_bucket.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql);
    const b=(await db.query("select id,name,public,file_size_limit::text as l,allowed_mime_types as m from storage.buckets")).rows;
    assert.deepEqual(b,[{id:'quadrion-feedback',name:'quadrion-feedback',public:false,l:'100000000',m:['image/png','image/jpeg','image/webp','video/mp4','video/webm','application/zip']}]);
  }finally{await db.close();}
});

test('both portal CSP lines allow blob previews and storage media',async()=>{
  const toml=await readFile(new URL('../../netlify.toml',import.meta.url),'utf8');
  const csp=[...toml.matchAll(/Content-Security-Policy = "([^"]+)"/g)].map(m=>m[1]);assert.equal(csp.length,2);
  for(const line of csp){
    assert.match(line,/img-src 'self' data: blob: https:\/\/oxjrkodcmflxejdwsuac\.supabase\.co;/);
    assert.match(line,/media-src 'self' blob: https:\/\/oxjrkodcmflxejdwsuac\.supabase\.co;/);
  }
});
