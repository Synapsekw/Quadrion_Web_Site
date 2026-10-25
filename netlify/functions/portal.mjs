import {portalConfig,available} from '../lib/portal/config.mjs';
import {getBackend} from '../lib/portal/supabase.mjs';
import {createMemberHandler} from '../lib/portal/member-api.mjs';
import {errorResponse} from '../lib/portal/http.mjs';
export default async(request,context)=>{
  const config=portalConfig();
  if(!available(config,request,context))return errorResponse(new Error('portal:unavailable'));
  return createMemberHandler({config,backend:getBackend(config)})(request,context);
};
// Singapore is the self-serve Netlify region nearest the Supabase database in Mumbai (no Mumbai region is offered).
export const config={path:'/api/portal',region:'sin'};
