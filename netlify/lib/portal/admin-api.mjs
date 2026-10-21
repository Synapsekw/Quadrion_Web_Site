import {available,uploadsConfigured} from './config.mjs';
import {canAdminister} from './policy.mjs';
import {validateReleaseMetadata} from './updates.mjs';
import {json,errorResponse,checkOrigin,readJson,keys,uuid,string,memberDto,identity,fail} from './http.mjs';
const reads=['overview','users','invitations','releases','projects','activity'];
const revision=v=>{if(!Number.isSafeInteger(v)||v<1)fail('invalid');return v;};
const expiry=v=>{if(v===null)return null;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('invalid');return new Date(v).toISOString();};
function roleTier(body,member){
  if(!['member','admin','owner'].includes(body.role))fail('invalid');
  if(member.role!=='owner'&&body.role!=='member')fail('forbidden');
  if(body.role==='member'?![1,2,3].includes(body.tier):body.tier!==null)fail('invalid');
}
export function createAdminHandler({config,backend,clock=Date.now,uploads}){
  return async(request,context)=>{try{
    if(!available(config,request,context))fail('unavailable');checkOrigin(request,config);
    const user=await identity(request,backend),member=memberDto(await backend.account(user.userId));
    if(!canAdminister({member,aal:user.aal,now:clock()}))fail('forbidden');
    const url=new URL(request.url),action=url.searchParams.get('action'),base={p_actor:user.userId,p_aal:user.aal};
    if(action==='creations'){
      if(member.role!=='owner')fail('forbidden');if(request.method!=='GET')fail('method');
      return json(await backend.rpc('portal_user_creation_list',base));
    }
    if(reads.includes(action)){
      if(request.method!=='GET')fail('method');const offset=Number(url.searchParams.get('offset')||0);
      if(!Number.isInteger(offset)||offset<0||offset>100000)fail('invalid');
      const result=await backend.rpc('portal_admin_list',{...base,p_kind:action,p_search:string(url.searchParams.get('search')||'',160),p_offset:offset});
      return json({...result,...(action==='overview'?{limits:{releaseBytes:config.releaseMaxBytes,projectBytes:config.projectMaxBytes,uploadsReady:uploadsConfigured(config)}}:{})});
    }
    if(request.method!=='POST')fail('method');const body=await readJson(request);let result;
    if(action==='createUser'){
      if(member.role!=='owner')fail('forbidden');
      keys(body,['email','password','tier','expiresAt','idempotencyKey']);
      const email=string(body.email,254,{empty:false}).toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||![1,2,3].includes(body.tier)||typeof body.password!=='string'||body.password.length<12||body.password.length>128||!body.password.trim())fail('invalid');
      uuid(body.idempotencyKey);const expiresAt=expiry(body.expiresAt);if(expiresAt&&Date.parse(expiresAt)<=clock())fail('invalid');
      const intent=await backend.rpc('portal_create_user_begin',{...base,p_data:{email,tier:body.tier,expiresAt,idempotencyKey:body.idempotencyKey}});
      let definiteFailure=false;
      if(intent.dispatch){
        try{const {error}=await backend.service.auth.admin.createUser({email,password:body.password,email_confirm:true,app_metadata:{quadrion_creation_id:intent.id}});definiteFailure=!!error&&error.status>=400&&error.status<500&&error.status!==408;}
        catch{/* A lost response is reconciled by a server-written identity marker, never retried blindly. */}
      }
      body.password='';
      result=await backend.rpc('portal_create_user_resolve',{...base,p_id:intent.id,p_action:definiteFailure?'failed':'reconcile'});
    }else if(action==='creationRecovery'){
      if(member.role!=='owner')fail('forbidden');keys(body,['id','action']);uuid(body.id);
      if(!['reconcile','cancel'].includes(body.action))fail('invalid');
      result=await backend.rpc('portal_create_user_resolve',{...base,p_id:body.id,p_action:body.action});
    }else if(action==='member'){
      keys(body,['userId','role','tier','status','expiresAt','revision']);uuid(body.userId);revision(body.revision);roleTier(body,member);
      if(!['active','invited','suspended','revoked'].includes(body.status))fail('invalid');
      result=await backend.rpc('portal_member_change',{...base,p_target:body.userId,p_revision:body.revision,p_role:body.role,p_tier:body.tier,p_status:body.status,p_expires_at:expiry(body.expiresAt)});
    }else if(action==='invite'){
      keys(body,['email','role','tier','expiresAt','idempotencyKey','resend']);roleTier(body,member);if(body.role==='owner')fail('invalid');
      const email=string(body.email,254,{empty:false}).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('invalid');uuid(body.idempotencyKey);expiry(body.expiresAt);
      const intent=await backend.rpc('portal_invite_begin',{...base,p_data:{...body,email}});
      let userId=null,definiteFailure=false;
      if(intent.dispatch){
        try{const {data,error}=await backend.service.auth.admin.inviteUserByEmail(email,{redirectTo:config.origin+'/portal/account/'});if(!error)userId=data?.user?.id||null;else definiteFailure=error.status>=400&&error.status<500&&error.status!==408;}
        catch{/* The persisted dispatch stays uncertain; reconciliation never re-sends. */}
      }
      result=definiteFailure?await backend.rpc('portal_invite_recover',{...base,p_id:intent.id,p_action:'failed'}):await backend.rpc('portal_invite_resolve',{...base,p_id:intent.id,p_user_id:userId});
    }else if(action==='inviteRecovery'){
      keys(body,['id','action']);uuid(body.id);if(!['cancel','reconcile'].includes(body.action))fail('invalid');
      result=await backend.rpc('portal_invite_recover',{...base,p_id:body.id,p_action:body.action});
    }else if(action==='assignments'){
      keys(body,['projectId','revision','assignments']);uuid(body.projectId);revision(body.revision);
      if(!Array.isArray(body.assignments)||body.assignments.length>1000)fail('invalid');
      const assignments=body.assignments.map(a=>{keys(a,['userId','expiresAt']);return {userId:uuid(a.userId),expiresAt:expiry(a.expiresAt)};});
      result=await backend.rpc('portal_set_assignments',{...base,p_project:body.projectId,p_revision:body.revision,p_assignments:assignments});
    }else if(action==='project'){
      keys(body,['id','revision','title','description','category','minimumTier','audience']);if(body.id){uuid(body.id);revision(body.revision);}
      string(body.title,160,{empty:false});string(body.description||'',12000);
      if(!['basic','oil_gas','restricted'].includes(body.category)||![2,3].includes(body.minimumTier)||(body.category!=='basic'&&body.minimumTier!==3)||!['tier','assigned'].includes(body.audience))fail('invalid');
      result=await backend.rpc('portal_save_project',{...base,p_data:body});
    }else if(action==='version'){
      keys(body,['projectId','version','minimumAppVersion','notes']);uuid(body.projectId);string(body.version,80,{empty:false});string(body.minimumAppVersion||'',80);string(body.notes||'',16000);
      result=await backend.rpc('portal_save_version',{...base,p_data:body});
    }else if(action==='release'){
      keys(body,['id','revision','kind','version','platform','minimumAppVersion','notes','autoUpdateEnabled','architecture','packageFormat','appRange','pipelineReleaseId']);if(body.id!=null){uuid(body.id);revision(body.revision);}else if(body.revision!==undefined)fail('invalid');if(!['app','pipeline'].includes(body.kind)||!['windows','macos','linux','all'].includes(body.platform))fail('invalid');string(body.version,80,{empty:false});string(body.minimumAppVersion||'',80);string(body.notes||'',16000);validateReleaseMetadata(body);
      result=await backend.rpc('portal_save_release',{...base,p_data:body});
    }else if(action==='publish'||action==='archive'){
      keys(body,action==='publish'?['kind','id','revision','versionId']:['kind','id','revision']);uuid(body.id);revision(body.revision);if(!['project','release'].includes(body.kind))fail('invalid');
      if(action==='publish'&&body.kind==='project')uuid(body.versionId);
      result=await backend.rpc(action==='publish'?'portal_publish':'portal_archive',{...base,p_kind:body.kind,p_id:body.id,p_revision:body.revision,...(action==='publish'?{p_version:body.kind==='project'?body.versionId:null}:{})});
    }else if(['upload','resumeUpload','finalize','uploadStatus','retryVerification','abandonUpload'].includes(action)&&uploads){result=await uploads(action,body,user,context);}
    else fail('not_found');
    return json(result);
  }catch(error){return errorResponse(error);}};
}
