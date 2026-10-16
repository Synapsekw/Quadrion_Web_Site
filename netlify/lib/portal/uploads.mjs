import {keys,uuid,string,fail} from './http.mjs';
import {uploadsConfigured} from './config.mjs';
export async function dispatchVerification(config,id){
  const response=await fetch(config.origin+'/api/portal-verify',{method:'POST',headers:{'Content-Type':'application/json','X-Portal-Verify':config.verifySecret},body:JSON.stringify({id}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==202)fail('unavailable');
}
const statusDto=s=>({id:s.id,artifactId:s.artifact_id,state:s.state,verifiedBytes:Number(s.verified_bytes),bytes:Number(s.file.bytes),error:s.error_code,expiresAt:s.expires_at});
export function createUploadActions({config,backend,dispatch=id=>dispatchVerification(config,id)}){
  async function signedSession(session){
    const file=session.file;
    const {data,error}=await backend.service.storage.from(file.bucket).createSignedUploadUrl(file.object_path,{upsert:false});if(error||!data?.token)fail('unavailable');
    return {...statusDto(session),bucket:file.bucket,objectPath:file.object_path,token:data.token,contentType:file.mime_type,endpoint:config.url.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable/sign'};
  }
  return async(action,body,user)=>{
    const base={p_actor:user.userId,p_aal:user.aal};
    if(!uploadsConfigured(config))fail('upload_not_configured');
    if(action==='upload'){
      keys(body,['releaseId','projectVersionId','kind','filename','bytes','sha256']);
      if(!!body.releaseId===!!body.projectVersionId)fail('invalid');uuid(body.releaseId||body.projectVersionId);
      const filename=string(body.filename,200,{empty:false});if(!/^[a-zA-Z0-9][a-zA-Z0-9 _().-]*$/.test(filename)||filename.includes('..'))fail('invalid');
      const extension=filename.toLowerCase().split('.').pop();let mimeType='application/octet-stream';
      if(body.kind==='preview'){
        if(body.releaseId||!['png','jpg','jpeg','webp'].includes(extension))fail('invalid');mimeType=extension==='png'?'image/png':extension==='webp'?'image/webp':'image/jpeg';
      }else if(body.kind!=='binary'||!(body.releaseId?['exe','msi','zip','dmg','pkg','deb','appimage'].includes(extension):extension==='aio'))fail('invalid');
      const maxBytes=body.kind==='preview'?10000000:body.releaseId?config.releaseMaxBytes:config.projectMaxBytes;
      if(!Number.isSafeInteger(body.bytes)||body.bytes<=0||!Number.isSafeInteger(maxBytes)||maxBytes<=0||body.bytes>maxBytes)fail('too_large');
      if(typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256))fail('invalid');
      const session=await backend.rpc('portal_upload_begin',{...base,p_data:{...body,filename,mimeType,maxBytes}});
      return signedSession(session);
    }
    if(action==='resumeUpload'){
      keys(body,['id','filename','bytes','sha256']);uuid(body.id);
      const session=await backend.rpc('portal_upload_command',{...base,p_id:body.id,p_action:'resume'});
      if(session.state!=='pending'||Date.parse(session.expires_at)<=Date.now())fail('conflict');
      if(body.filename!==session.file.filename||body.bytes!==Number(session.file.bytes)||body.sha256!==session.file.sha256)fail('upload_file_mismatch');
      return signedSession(session);
    }
    keys(body,['id']);uuid(body.id);
    const session=await backend.rpc('portal_upload_command',{...base,p_id:body.id,p_action:'status'});
    if(action==='uploadStatus')return statusDto(session);
    if(action==='abandonUpload')return statusDto(await backend.rpc('portal_upload_command',{...base,p_id:body.id,p_action:'abandon'}));
    if(action==='finalize'){
      if(session.state==='pending'){
        const {data,error}=await backend.service.storage.from(session.file.bucket).info(session.file.object_path);
        if(error||!data||Number(data.size)!==Number(session.file.bytes))fail('unverified');
      }
      const result=await backend.rpc('portal_upload_command',{...base,p_id:body.id,p_action:'finalize'});
      if(result.state==='verifying')await dispatch(body.id);return statusDto(result);
    }
    if(action==='retryVerification'){
      const result=await backend.rpc('portal_upload_command',{...base,p_id:body.id,p_action:'retry'});
      if(result.state==='verifying')await dispatch(body.id);return statusDto(result);
    }
    fail('not_found');
  };
}
