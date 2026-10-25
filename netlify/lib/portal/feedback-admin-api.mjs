import {readJson,keys,uuid,string,fail} from './http.mjs';
import {validateTestContent} from './test-content.mjs';
import {formatForAgent} from './feedback-export.mjs';
const gets=new Set(['feedbackInbox','feedbackItem','feedbackProgress','feedbackExport','feedbackCounts','testContentStatus']);
const posts=new Set(['feedbackAction','feedbackBulkFix','feedbackAttachmentUrl','testContentUpload','testImport','memberTester']);
export const feedbackAdminActions=new Set([...gets,...posts]);
export const feedbackAdminReads=gets;
const ownerOnly=new Set(['testContentUpload','testImport','memberTester']);
const statuses=['new','triaged','question','fixed','confirmed','reopened','parked','declined','merged'];
const ownerActions=['priority','triage','ask','comment','park','decline','restore','fix','merge','seen'];
const contentKeys=['format','builtAt','title','source','owner','unit','guide','testers','stages'];
const linePattern=/^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$/;
const build=v=>{if(typeof v!=='string')fail('invalid');const t=v.trim();if(t!=='unknown'&&!/^[0-9A-Za-z][0-9A-Za-z._+ -]{0,79}$/.test(t))fail('invalid');return t;};
// A fix names a real build; 'unknown' only stands for answers whose build was not recorded.
const fixBuild=v=>{const t=build(v);if(t==='unknown')fail('invalid');return t;};
const revision=v=>{if(!Number.isSafeInteger(v)||v<1)fail('invalid');return v;};
const word=(v,list)=>{if(!list.includes(v))fail('invalid');return v;};
const text=(v,max)=>string(v,max,{empty:false});
// The inbox and export filter comes from the query string; only known keys survive.
function filter(url,{paged}){
  const q=name=>url.searchParams.get(name)||'',out={};
  if(q('tester'))out.tester=uuid(q('tester'));
  if(q('kind'))out.kind=word(q('kind'),['bug','feature']);
  if(q('status')){const list=q('status').split(',');if(list.length>statuses.length)fail('invalid');out.status=list.map(s=>word(s,statuses));}
  if(q('priority'))out.priority=word(q('priority'),['high','normal','low']);
  if(q('build'))out.build=build(q('build'));
  if(paged){const offset=Number(q('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('invalid');out.offset=offset;}
  return out;
}
function ownerData(action,data){
  if(data===undefined)data={};if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid');
  const one=(name,check)=>{keys(data,[name]);return {[name]:check(data[name])};};
  if(action==='priority')return one('priority',v=>word(v,['high','normal','low']));
  if(action==='ask'||action==='comment')return one('body',v=>text(v,8000));
  if(action==='park'||action==='decline'){
    if(action==='decline')return one('reason',v=>text(v,2000));
    keys(data,['reason']);return data.reason===undefined?{}:{reason:string(data.reason,2000)};
  }
  if(action==='fix')return one('build',fixBuild);
  if(action==='merge')return one('into',uuid);
  keys(data,[]);return {};
}
export function createFeedbackAdminActions({config,backend,clock=Date.now}){
  return async(action,{request,url,user,member})=>{
    if(!feedbackAdminActions.has(action))fail('not_found');
    if(request.method!==(gets.has(action)?'GET':'POST'))fail('method');
    // Reads run alongside the administrator check and get no member: an owner-only action without one is refused.
    if(ownerOnly.has(action)&&member?.role!=='owner')fail('forbidden');
    const base={p_actor:user.userId,p_aal:user.aal};
    if(action==='feedbackInbox')return backend.rpc('portal_feedback_inbox',{...base,p_filter:filter(url,{paged:true})});
    if(action==='feedbackItem')return backend.rpc('portal_feedback_item',{...base,p_id:uuid(url.searchParams.get('id'))});
    if(action==='feedbackProgress')return backend.rpc('portal_tests_progress',base);
    if(action==='feedbackCounts')return backend.rpc('portal_feedback_counts',{p_actor:user.userId});
    if(action==='testContentStatus')return backend.rpc('portal_tests_content_status',base);
    if(action==='feedbackExport'){
      const found=await backend.rpc('portal_feedback_export',{...base,p_filter:filter(url,{paged:false})});
      const items=Array.isArray(found)?found:Array.isArray(found?.items)?found.items:[];
      const exported=await formatForAgent(items,{origin:config.origin,now:clock(),link:file=>backend.signDownload(file,86400)});
      return {text:exported,count:items.length,expiresIn:86400};
    }
    const body=await readJson(request,{maxBytes:action==='testContentUpload'?4000000:action==='testImport'?1000000:32768});
    if(action==='feedbackAction'){
      keys(body,['id','revision','action','data']);uuid(body.id);revision(body.revision);word(body.action,ownerActions);
      return backend.rpc('portal_feedback_owner_action',{...base,p_id:body.id,p_revision:body.revision,p_action:body.action,p_data:ownerData(body.action,body.data)});
    }
    if(action==='feedbackBulkFix'){
      keys(body,['ids','build']);
      if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>200)fail('invalid');body.ids.forEach(uuid);
      return backend.rpc('portal_feedback_bulk_fix',{...base,p_ids:[...new Set(body.ids)],p_build:fixBuild(body.build)});
    }
    if(action==='feedbackAttachmentUrl'){
      keys(body,['id']);
      const file=await backend.rpc('portal_feedback_attachment_get',{...base,p_id:uuid(body.id)});
      return {url:await backend.signDownload(file,300,false),filename:file.filename,expiresIn:300};
    }
    if(action==='memberTester'){
      keys(body,['userId','revision','tester']);uuid(body.userId);revision(body.revision);if(typeof body.tester!=='boolean')fail('invalid');
      return backend.rpc('portal_member_tester',{...base,p_target:body.userId,p_revision:body.revision,p_tester:body.tester});
    }
    if(action==='testContentUpload'){
      keys(body,contentKeys);validateTestContent(body);
      return backend.rpc('portal_tests_content_upload',{...base,p_model:body});
    }
    keys(body,['testerId','file']);uuid(body.testerId);
    const file=body.file;
    if(!file||typeof file!=='object'||file.format!=='quadrion-test-results/1'||!file.results||typeof file.results!=='object'||Array.isArray(file.results))fail('invalid');
    for(const [id,entry] of Object.entries(file.results))if(id.length>200||!linePattern.test(id)||!entry||typeof entry!=='object'||Array.isArray(entry))fail('invalid');
    return backend.rpc('portal_tests_import',{...base,p_tester:body.testerId,p_results:file.results});
  };
}
