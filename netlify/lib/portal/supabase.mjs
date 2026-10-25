import {createClient} from '@supabase/supabase-js';
import {createRemoteJWKSet,customFetch,decodeJwt,decodeProtectedHeader,jwtVerify} from 'jose';
import {fail} from './http.mjs';
// Supabase signs session tokens with an asymmetric key (ES256 or RS256) published at the project's JWKS URL.
// Those are verified here with no Auth round trip. Legacy HS256 tokens can only be checked by Supabase Auth.
const ASYMMETRIC=['ES256','RS256'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Errors that are about the token itself are refusals. Anything else (the key set could not be fetched or read)
// falls back to asking Supabase Auth, which is the check every request made before.
const TOKEN_ERRORS=new Set(['ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWT_EXPIRED','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JOSE_NOT_SUPPORTED','ERR_JWS_INVALID','ERR_JWT_INVALID','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWKS_NO_MATCHING_KEY','ERR_JWKS_MULTIPLE_MATCHING_KEYS']);
// One key set per Supabase URL for the life of the container: cached 10 minutes, refetched early (at most every
// cooldown) when a token names a key id the cache does not hold, so a key rotation is picked up.
const keySets=new Map();
function remoteKeys(url,fetchImpl,cooldownDuration=30000){
  const key=url+'|'+cooldownDuration;
  if(!keySets.has(key))keySets.set(key,createRemoteJWKSet(new URL(url+'/auth/v1/.well-known/jwks.json'),{cacheMaxAge:600000,cooldownDuration,timeoutDuration:5000,[customFetch]:fetchImpl}));
  return keySets.get(key);
}
function sessionClaims(claims,config){
  if(!claims||typeof claims.sub!=='string'||!UUID.test(claims.sub)||claims.iss!==config.url+'/auth/v1'||claims.aud!=='authenticated'||claims.role!=='authenticated'
    ||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()||claims.is_anonymous===true||!['aal1','aal2'].includes(claims.aal))fail('unauthorized');
  return claims;
}
export function createBackend(config,{fetch:fetchImpl=fetch,keys,keyCooldown}={}){
  const boundedFetch=(url,options={})=>{
    if(new URL(url).origin!==config.url)throw new Error('portal:unavailable');
    return fetchImpl(url,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  };
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}};
  const service=createClient(config.url,config.secretKey,options),auth=createClient(config.url,config.publishableKey,options).auth;
  const jwks=keys||remoteKeys(config.url,boundedFetch,keyCooldown);
  async function rpc(name,args){const {data,error}=await service.rpc(name,args);if(error){const code=/portal:[a-z_]+/.exec(error.message)?.[0];throw new Error(code||'portal:unavailable');}return data;}
  // The Auth server check: a valid signature plus a live, confirmed, non-anonymous user and session.
  async function authUser(token){
    let claims;try{claims=decodeJwt(token);}catch{fail('unauthorized');}
    sessionClaims(claims,config);
    const {data,error}=await auth.getUser(token),user=data?.user;
    if(error||!user||user.id!==claims.sub||user.is_anonymous||!user.email_confirmed_at)fail('unauthorized');
    return {userId:user.id,email:user.email,emailConfirmed:true,aal:claims.aal,sessionChecked:true};
  }
  return {
    service,rpc,
    async verifyUser(token){
      let header;try{header=decodeProtectedHeader(token);}catch{fail('unauthorized');}
      if(header.alg==='HS256')return authUser(token);
      if(!ASYMMETRIC.includes(header.alg)||typeof header.kid!=='string'||!header.kid)fail('unauthorized');
      let claims;
      try{({payload:claims}=await jwtVerify(token,jwks,{algorithms:ASYMMETRIC,issuer:config.url+'/auth/v1',audience:'authenticated',requiredClaims:['sub','exp','role','aal']}));}
      catch(error){if(TOKEN_ERRORS.has(error?.code))fail('unauthorized');return authUser(token);}
      sessionClaims(claims,config);
      // Email confirmation, bans and deletion are not in the token: portal_account and every portal RPC check them in auth.users.
      return {userId:claims.sub,email:typeof claims.email==='string'?claims.email:'',emailConfirmed:true,aal:claims.aal,sessionChecked:false};
    },
    // Admin requests also ask Supabase Auth (in parallel), so a signed-out session stops working there before the token expires.
    async confirmSession(token,user){
      if(user?.sessionChecked===true)return;
      const {data,error}=await auth.getUser(token),found=data?.user;
      if(error||!found||found.id!==user?.userId||found.is_anonymous||!found.email_confirmed_at)fail('unauthorized');
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
// One backend (both Supabase clients and the key cache) per container, reused by every warm invocation.
const backends=new Map();
export function getBackend(config){
  const key=[config.url,config.publishableKey,config.secretKey].join('\n');
  if(!backends.has(key))backends.set(key,createBackend(config));
  return backends.get(key);
}
