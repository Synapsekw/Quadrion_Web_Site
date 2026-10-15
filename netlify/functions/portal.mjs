import {portalConfig,available} from '../lib/portal/config.mjs';
import {createBackend} from '../lib/portal/supabase.mjs';
import {createMemberHandler} from '../lib/portal/member-api.mjs';
import {errorResponse} from '../lib/portal/http.mjs';
export default async(request,context)=>{
  const config=portalConfig();
  if(!available(config,request,context))return errorResponse(new Error('portal:unavailable'));
  return createMemberHandler({config,backend:createBackend(config)})(request,context);
};
export const config={path:'/api/portal'};
