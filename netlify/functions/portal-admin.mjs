import {portalConfig,available} from '../lib/portal/config.mjs';
import {createBackend} from '../lib/portal/supabase.mjs';
import {createAdminHandler} from '../lib/portal/admin-api.mjs';
import {errorResponse} from '../lib/portal/http.mjs';
export default async(request,context)=>{
  const config=portalConfig();if(!available(config,request,context))return errorResponse(new Error('portal:unavailable'));
  return createAdminHandler({config,backend:createBackend(config)})(request,context);
};
export const config={path:'/api/portal-admin'};
