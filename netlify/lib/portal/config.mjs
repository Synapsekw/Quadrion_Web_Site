import {isPublishedProduction} from '../runtime.mjs';
export const uploadsConfigured=config=>typeof config.verifySecret==='string'&&config.verifySecret.length>=32;
export const DEFAULT_RELEASE_MAX_BYTES=10000000000;
// Unset uses the 10 GB default; any other value is taken as given, so an invalid one fails closed like PORTAL_PROJECT_MAX_BYTES.
const releaseMaxBytes=env=>env.PORTAL_RELEASE_MAX_BYTES===undefined||env.PORTAL_RELEASE_MAX_BYTES===''?DEFAULT_RELEASE_MAX_BYTES:Number(env.PORTAL_RELEASE_MAX_BYTES);
export function portalConfig(env=process.env){
  const url=env.SUPABASE_URL||'';
  const origin=env.PORTAL_ALLOWED_ORIGIN||'https://quadrion.ai';
  const publishableKey=env.SUPABASE_PUBLISHABLE_KEY||'';
  const secretKey=env.SUPABASE_SECRET_KEY||'';
  const valid=/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && origin==='https://quadrion.ai' && publishableKey.length>20 && secretKey.length>20;
  return {enabled:env.PORTAL_ENABLED==='true'&&valid,url,origin,publishableKey,secretKey,localDev:env.PORTAL_LOCAL_DEV==='true',verifySecret:env.PORTAL_VERIFY_SECRET||'',projectMaxBytes:Number(env.PORTAL_PROJECT_MAX_BYTES||0),releaseMaxBytes:releaseMaxBytes(env)};
}
export function available(config,request,context){
  if(!config.enabled)return false;
  if(isPublishedProduction(context))return true;
  return config.localDev===true && context?.localDevelopment===true && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
}
