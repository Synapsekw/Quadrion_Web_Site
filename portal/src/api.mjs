const memberActions=new Set(['me','releases','projects','project','download','profile','preview']);
const adminActions=new Set(['overview','users','invitations','projects','releases','activity','member','invite','assignments','project','version','release','publish','archive','upload','resumeUpload','finalize','uploadStatus','retryVerification','abandonUpload','inviteRecovery']);
for(const action of ['createUser','creationRecovery','creations'])adminActions.add(action);
export function createPortalApi({fetcher=fetch,getToken,onDenied=()=>{},admin=false}){
  async function call(action,params,method){
    if(!(admin?adminActions:memberActions).has(action))throw new Error('Unknown portal action');
    const token=await getToken();
    const url=new URLSearchParams({action,...(method==='GET'?params:{})});
    let response;
    try{response=await fetcher('/api/portal'+(admin?'-admin':'')+'?'+url,{method,cache:'no-store',credentials:'omit',headers:{Authorization:'Bearer '+(token||''),...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(params)}:{})});}
    catch{const error=new Error('Check your connection, then try again.');onDenied(0,error);throw error;}
    let body;try{body=await response.json();}catch{const error=new Error('The portal is temporarily unavailable.');onDenied(0,error);throw error;}
    if(!response.ok){const error=new Error(body.message||'This request could not be completed.');error.status=response.status;error.code=body.error;if([401,403,404,503].includes(response.status))onDenied(response.status,error);throw error;}
    return body;
  }
  return {get:(action,params={})=>call(action,params,'GET'),post:(action,params={})=>call(action,params,'POST')};
}
