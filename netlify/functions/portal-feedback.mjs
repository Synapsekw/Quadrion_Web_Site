import {portalConfig,available} from '../lib/portal/config.mjs';
import {createBackend} from '../lib/portal/supabase.mjs';
import {createFeedbackHandler} from '../lib/portal/feedback-api.mjs';
import {createFeedbackUploads} from '../lib/portal/feedback-uploads.mjs';
import {errorResponse} from '../lib/portal/http.mjs';
export default async(request,context)=>{
  const config=portalConfig();
  if(!available(config,request,context))return errorResponse(new Error('portal:unavailable'));
  const backend=createBackend(config);
  return createFeedbackHandler({config,backend,attachments:createFeedbackUploads({config,backend})})(request,context);
};
export const config={path:'/api/portal-feedback'};
