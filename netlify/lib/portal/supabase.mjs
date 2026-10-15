import {createClient} from '@supabase/supabase-js';
import {fail} from './http.mjs';
export function createBackend(config){
  const boundedFetch=(url,options={})=>{
    if(new URL(url).origin!==config.url)throw new Error('portal:unavailable');
    return fetch(url,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  };
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}};
  const service=createClient(config.url,config.secretKey,options);
  async function rpc(name,args){const {data,error}=await service.rpc(name,args);if(error){const code=/portal:[a-z_]+/.exec(error.message)?.[0];throw new Error(code||'portal:unavailable');}return data;}
  return {
    service,rpc,
    async verifyUser(token){
      const auth=createClient(config.url,config.publishableKey,options).auth;
      const [{data:userData,error:userError},{data:claimData,error:claimError}]=await Promise.all([auth.getUser(token),auth.getClaims(token)]);
      const user=userData?.user,claims=claimData?.claims;
      if(userError||claimError||!user||!claims||claims.sub!==user.id||claims.iss!==config.url+'/auth/v1'||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()||claims.aud!=='authenticated'||user.is_anonymous||!user.email_confirmed_at)fail('unauthorized');
      return {userId:user.id,email:user.email,emailConfirmed:true,aal:claims.aal,mfaEnrolled:!!user.factors?.some(f=>f.status==='verified')};
    },
    account:userId=>rpc('portal_account',{p_actor:userId}),
    catalog:(userId,aal,kind,search,offset)=>rpc('portal_catalog',{p_actor:userId,p_aal:aal,p_kind:kind,p_search:search,p_offset:offset}),
    project:(userId,aal,id)=>rpc('portal_project',{p_actor:userId,p_aal:aal,p_id:id}),
    updateProfile:(userId,profile)=>rpc('portal_profile',{p_actor:userId,p_name:profile.displayName,p_company:profile.company}),
    reserveDownload:(userId,aal,id)=>rpc('portal_download',{p_actor:userId,p_aal:aal,p_artifact:id}),
    async signDownload(artifact,ttl,download=true){const {data,error}=await service.storage.from(artifact.bucket).createSignedUrl(artifact.object_path,ttl,download?{download:artifact.filename}:{});if(error||!data?.signedUrl)fail('unavailable');return data.signedUrl;},
    recordDownload:(userId,id,success)=>rpc('portal_download_result',{p_actor:userId,p_artifact:id,p_success:success}),
  };
}
