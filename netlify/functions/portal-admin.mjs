import {portalConfig,available} from '../lib/portal/config.mjs';
import {createBackend} from '../lib/portal/supabase.mjs';
import {createAdminHandler} from '../lib/portal/admin-api.mjs';
import {errorResponse} from '../lib/portal/http.mjs';
import {createUploadActions} from '../lib/portal/uploads.mjs';
export default async(request,context)=>{
  const config=portalConfig();if(!available(config,request,context))return errorResponse(new Error('portal:unavailable'));
  const backend=createBackend(config);
  return createAdminHandler({config,backend,uploads:createUploadActions({config,backend})})(request,context);
};
export const config={path:'/api/portal-admin'};
