import {keys,uuid,string,fail} from './http.mjs';
import {uploadsConfigured} from './config.mjs';
// Canonical MIME types and per-file caps; the attachment table and bucket enforce the same values.
export const FEEDBACK_TYPES=Object.freeze({
  png:{mime:'image/png',maxBytes:10000000},jpg:{mime:'image/jpeg',maxBytes:10000000},jpeg:{mime:'image/jpeg',maxBytes:10000000},webp:{mime:'image/webp',maxBytes:10000000},
  mp4:{mime:'video/mp4',maxBytes:100000000},webm:{mime:'video/webm',maxBytes:100000000},zip:{mime:'application/zip',maxBytes:50000000},
});
export const FEEDBACK_URL_TTL=300;
export async function dispatchFeedbackVerification(config,id){
  const response=await fetch(config.origin+'/api/portal-feedback-verify',{method:'POST',headers:{'Content-Type':'application/json','X-Portal-Verify':config.verifySecret},body:JSON.stringify({id}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==202)fail('unavailable');
}
const statusDto=a=>({id:a.id,itemId:a.item_id,eventId:a.event_id,state:a.state,filename:a.filename,mimeType:a.mime_type,verifiedBytes:Number(a.verified_bytes),bytes:Number(a.bytes),error:a.error_code,expiresAt:a.expires_at});
export function createFeedbackUploads({config,backend,dispatch=id=>dispatchFeedbackVerification(config,id)}){
  async function signedSession(a){
    const {data,error}=await backend.service.storage.from(a.bucket).createSignedUploadUrl(a.object_path,{upsert:false});if(error||!data?.token)fail('unavailable');
    return {...statusDto(a),bucket:a.bucket,objectPath:a.object_path,token:data.token,contentType:a.mime_type,endpoint:config.url.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable/sign'};
  }
  return async(action,body,user)=>{
    const base={p_actor:user.userId,p_aal:user.aal};
    if(!uploadsConfigured(config))fail('upload_not_configured');
    if(action==='attachmentBegin'){
      keys(body,['itemId','eventId','filename','bytes','sha256']);uuid(body.itemId);if(body.eventId!=null)uuid(body.eventId);
      const filename=string(body.filename,200,{empty:false});
      if(filename!==body.filename||!/^[a-zA-Z0-9][a-zA-Z0-9 _().-]*\.([a-zA-Z0-9]+)$/.test(filename)||filename.includes('..'))fail('invalid');
      const type=FEEDBACK_TYPES[filename.toLowerCase().split('.').pop()];if(!type)fail('invalid');
      if(!Number.isSafeInteger(body.bytes)||body.bytes<=0||body.bytes>type.maxBytes)fail('too_large');
      if(typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256))fail('invalid');
      const attachment=await backend.rpc('portal_feedback_attachment_begin',{...base,p_data:{itemId:body.itemId,eventId:body.eventId??null,filename,bytes:body.bytes,sha256:body.sha256,mimeType:type.mime,maxBytes:type.maxBytes}});
      return signedSession(attachment);
    }
    if(action==='attachmentResume'){
      keys(body,['id','filename','bytes','sha256']);uuid(body.id);
      const a=await backend.rpc('portal_feedback_attachment_command',{...base,p_id:body.id,p_action:'resume'});
      if(a.state!=='pending'||Date.parse(a.expires_at)<=Date.now())fail('conflict');
      if(body.filename!==a.filename||body.bytes!==Number(a.bytes)||body.sha256!==a.sha256)fail('upload_file_mismatch');
      return signedSession(a);
    }
    keys(body,['id']);uuid(body.id);
    if(action==='attachmentUrl'){
      const a=await backend.rpc('portal_feedback_attachment_get',{...base,p_id:body.id});
      return {id:a.id,url:await backend.signDownload(a,FEEDBACK_URL_TTL,false),filename:a.filename,mimeType:a.mime_type,bytes:Number(a.bytes),expiresIn:FEEDBACK_URL_TTL};
    }
    if(!['attachmentStatus','attachmentAbandon','attachmentFinalize'].includes(action))fail('not_found');
    const a=await backend.rpc('portal_feedback_attachment_command',{...base,p_id:body.id,p_action:'status'});
    if(action==='attachmentStatus')return statusDto(a);
    if(action==='attachmentAbandon')return statusDto(await backend.rpc('portal_feedback_attachment_command',{...base,p_id:body.id,p_action:'abandon'}));
    if(a.state==='pending'){
      const {data,error}=await backend.service.storage.from(a.bucket).info(a.object_path);
      if(error||!data||Number(data.size)!==Number(a.bytes))fail('unverified');
    }
    const result=await backend.rpc('portal_feedback_attachment_command',{...base,p_id:body.id,p_action:'finalize'});
    if(result.state==='verifying')await dispatch(body.id);return statusDto(result);
  };
}
