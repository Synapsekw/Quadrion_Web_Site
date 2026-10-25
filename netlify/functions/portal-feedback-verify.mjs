import {timingSafeEqual} from 'node:crypto';
import {portalConfig,available} from '../lib/portal/config.mjs';
import {createBackend} from '../lib/portal/supabase.mjs';
import {readJson,keys,uuid} from '../lib/portal/http.mjs';
import {verifySlice} from '../lib/portal/verification.mjs';
// Feedback attachment twin of portal-verify.mjs: same secret, same bounded slices, feedback RPCs.
export default async(request,context)=>{
  const settings=portalConfig(),provided=request.headers.get('x-portal-verify')||'';
  if(!available(settings,request,context)||request.method!=='POST'||settings.verifySecret.length<32||Buffer.byteLength(provided)!==Buffer.byteLength(settings.verifySecret)||!timingSafeEqual(Buffer.from(provided),Buffer.from(settings.verifySecret)))return;
  const body=await readJson(request);keys(body,['id']);uuid(body.id);
  const backend=createBackend(settings),job=await backend.rpc('portal_feedback_verify_claim',{p_id:body.id});if(!job)return;
  try{
    const signed=await backend.service.storage.from(job.bucket).createSignedUrl(job.object_path,600);
    if(signed.error||!signed.data?.signedUrl)throw new Error('storage_unavailable');
    const url=new URL(signed.data.signedUrl);if(url.origin!==settings.url)throw new Error('storage_unavailable');
    const result=await verifySlice({job,readRange:(start,end,etag)=>fetch(url,{headers:{Range:`bytes=${start}-${end}`,...(etag?{'If-Match':etag}:{})},redirect:'error',signal:AbortSignal.timeout(90000)}),checkpoint:async value=>{
      await backend.rpc('portal_feedback_verify_checkpoint',{p_id:body.id,p_lease:job.lease_id,p_offset:value.offset,p_hash:value.hashState,p_etag:value.etag,p_digest:null});
    }});
    if(result.done)await backend.rpc('portal_feedback_verify_checkpoint',{p_id:body.id,p_lease:job.lease_id,p_offset:result.offset,p_hash:null,p_etag:result.etag,p_digest:result.sha256});
    else await backend.rpc('portal_feedback_verify_release',{p_id:body.id,p_lease:job.lease_id,p_error:null});
  }catch(error){
    const code=['size_mismatch','checksum_mismatch','object_changed','invalid_range'].includes(error.message)?error.message:'verification_interrupted';
    await backend.rpc('portal_feedback_verify_release',{p_id:body.id,p_lease:job.lease_id,p_error:code});
  }
};
export const config={path:'/api/portal-feedback-verify',background:true};
