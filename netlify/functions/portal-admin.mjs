import {portalConfig,available} from '../lib/portal/config.mjs';
import {getBackend} from '../lib/portal/supabase.mjs';
import {createAdminHandler} from '../lib/portal/admin-api.mjs';
import {errorResponse} from '../lib/portal/http.mjs';
import {createFeedbackAdminActions} from '../lib/portal/feedback-admin-api.mjs';
import {createUploadActions} from '../lib/portal/uploads.mjs';
export default async(request,context)=>{
  const config=portalConfig();if(!available(config,request,context))return errorResponse(new Error('portal:unavailable'));
  const backend=getBackend(config);
  return createAdminHandler({config,backend,uploads:createUploadActions({config,backend}),feedback:createFeedbackAdminActions({config,backend})})(request,context);
};
// Singapore is the self-serve Netlify region nearest the Supabase database in Mumbai (no Mumbai region is offered).
export const config={path:'/api/portal-admin',region:'sin'};
