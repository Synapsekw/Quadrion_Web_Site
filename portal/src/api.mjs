const memberActions=new Set(['me','releases','projects','project','download','profile']);
const adminActions=new Set(['overview','users','invitations','projects','releases','activity','member','invite','assignments','project','version','release','publish','archive','upload','finalize','uploadStatus','retryVerification']);
export function createPortalApi({fetcher=fetch,getToken,onDenied=()=>{},admin=false}){
  async function call(action,params,method){
    if(!(admin?adminActions:memberActions).has(action))throw new Error('Unknown portal action');
    const token=await getToken();
    const url=new URLSearchParams({action,...(method==='GET'?params:{})});
    let response;
    try{response=await fetcher('/api/portal'+(admin?'-admin':'')+'?'+url,{method,cache:'no-store',credentials:'omit',headers:{Authorization:'Bearer '+(token||''),...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(params)}:{})});}
    catch{onDenied(0);throw new Error('Check your connection, then try again.');}
    let body;try{body=await response.json();}catch{onDenied(0);throw new Error('The portal is temporarily unavailable.');}
    if(!response.ok){if([401,403,404,503].includes(response.status))onDenied(response.status);const error=new Error(body.message||'This request could not be completed.');error.status=response.status;error.code=body.error;throw error;}
    return body;
  }
  return {get:(action,params={})=>call(action,params,'GET'),post:(action,params={})=>call(action,params,'POST')};
}
