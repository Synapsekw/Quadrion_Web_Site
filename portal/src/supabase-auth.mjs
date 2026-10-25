// The browser side only signs in: it needs Supabase Auth and none of the database, storage, realtime or functions
// clients that createClient() builds. This mirrors supabase-js's own auth client setup (same URL and headers),
// so esbuild can leave the rest of supabase-js out of the bundle.
import {AuthClient} from '@supabase/supabase-js';
export function createClient(url,key,{auth={}}={}){
  const base=new URL(url.endsWith('/')?url:url+'/');
  return {auth:new AuthClient({...auth,url:new URL('auth/v1',base).href,headers:{Authorization:'Bearer '+key,apikey:key}})};
}
