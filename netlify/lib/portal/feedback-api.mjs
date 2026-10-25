import {available} from './config.mjs';
import {isTester} from './policy.mjs';
import {json,errorResponse,checkOrigin,readJson,keys,uuid,string,memberDto,identity,fail} from './http.mjs';
// The tester side of the feedback loop. Every RPC re-checks the tester flag; this frame refuses non-testers before any RPC.
const gets=new Set(['content','answers','mine','item','counts']);
const attachmentActions=new Set(['attachmentBegin','attachmentResume','attachmentFinalize','attachmentStatus','attachmentAbandon','attachmentUrl']);
const posts=new Set(['answer','create','act',...attachmentActions]);
const testerActions=['comment','answer','confirm','reopen','title'];
const linePattern=/^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$/;
const line=v=>{if(typeof v!=='string'||v.length>200||!linePattern.test(v))fail('invalid');return v;};
// Blank stays blank (the RPC records it as `unknown`); anything else is the build pattern or the literal `unknown`.
const build=v=>{if(v===undefined)return '';const t=string(v,200);if(t&&t!=='unknown'&&!/^[0-9A-Za-z][0-9A-Za-z._+ -]{0,79}$/.test(t))fail('invalid');return t;};
const screen=v=>{if(v===undefined||v===null)return null;const t=string(v,80);if(t&&!/^[A-Za-z0-9:_-]+$/.test(t))fail('invalid');return t||null;};
const note=(v,max)=>v===undefined?'':string(v,max);
export function createFeedbackHandler({config,backend,clock=Date.now,attachments}){
  return async(request,context)=>{try{
    if(!available(config,request,context))fail('unavailable');
    checkOrigin(request,config);
    const url=new URL(request.url),action=url.searchParams.get('action')||'';
    if(!gets.has(action)&&!posts.has(action))fail('not_found');
    if(request.method!==(gets.has(action)?'GET':'POST'))fail('method');
    const user=await identity(request,backend),member=memberDto(await backend.account(user.userId));
    if(!isTester(member,clock()))fail('forbidden');
    const actor={p_actor:user.userId};
    if(action==='content')return json(await backend.rpc('portal_tests_content',actor));
    if(action==='answers')return json(await backend.rpc('portal_tests_answers',actor));
    if(action==='mine')return json(await backend.rpc('portal_feedback_mine',actor));
    if(action==='counts')return json(await backend.rpc('portal_feedback_counts',actor));
    if(action==='item')return json(await backend.rpc('portal_feedback_item',{...actor,p_aal:user.aal,p_id:uuid(url.searchParams.get('id'))}));
    const body=await readJson(request,{maxBytes:131072});
    if(attachmentActions.has(action)){if(!attachments)fail('unavailable');return json(await attachments(action,body,user));}
    if(action==='answer'){
      keys(body,['lineId','status','comment','build']);
      if(body.status!==null&&!['pass','fail','skip'].includes(body.status))fail('invalid');
      const comment=note(body.comment,8000);if(body.status==='fail'&&!comment)fail('invalid');
      return json(await backend.rpc('portal_tests_answer',{...actor,p_line:line(body.lineId),p_status:body.status,p_comment:comment,p_build:build(body.build)}));
    }
    if(action==='create'){
      keys(body,['kind','title','body','lineId','build','screen']);
      if(!['bug','feature'].includes(body.kind))fail('invalid');
      const data={kind:body.kind,title:string(body.title,200,{empty:false}),body:note(body.body,16000),lineId:body.lineId===undefined||body.lineId===null?null:line(body.lineId),build:build(body.build),screen:screen(body.screen)};
      return json(await backend.rpc('portal_feedback_create',{...actor,p_data:data}));
    }
    keys(body,['id','revision','action','body','build']);uuid(body.id);
    if(!Number.isSafeInteger(body.revision)||body.revision<1||!testerActions.includes(body.action))fail('invalid');
    const text=note(body.body,body.action==='title'?200:16000);
    return json(await backend.rpc('portal_feedback_tester_action',{...actor,p_id:body.id,p_revision:body.revision,p_action:body.action,p_body:text,p_build:build(body.build)}));
  }catch(error){return errorResponse(error);}};
}
