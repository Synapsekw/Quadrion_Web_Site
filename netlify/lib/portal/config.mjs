import {isPublishedProduction} from '../runtime.mjs';
export function portalConfig(env=process.env){
  const url=env.SUPABASE_URL||'';
  const origin=env.PORTAL_ALLOWED_ORIGIN||'https://quadrion.ai';
  const publishableKey=env.SUPABASE_PUBLISHABLE_KEY||'';
  const secretKey=env.SUPABASE_SECRET_KEY||'';
  const valid=/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && origin==='https://quadrion.ai' && publishableKey.length>20 && secretKey.length>20;
  return {enabled:env.PORTAL_ENABLED==='true'&&valid,url,origin,publishableKey,secretKey,localDev:env.PORTAL_LOCAL_DEV==='true',verifySecret:env.PORTAL_VERIFY_SECRET||'',projectMaxBytes:Number(env.PORTAL_PROJECT_MAX_BYTES||0),releaseMaxBytes:1024**3};
}
export function available(config,request,context){
  if(!config.enabled)return false;
  if(isPublishedProduction(context))return true;
  return config.localDev===true && context?.localDevelopment===true && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
}
