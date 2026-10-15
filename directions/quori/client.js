/** Same-origin transport. Credentials and authoritative history never enter this module. */
export function createQuoriClient({fetch:fetcher=globalThis.fetch,endpoint='/api/quori'}={}){
 let token='',ready=false;
 async function request(action,body,signal){
  const response=await fetcher(endpoint+'?action='+action,{
   method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
   headers:body===undefined?{}:{'Content-Type':'application/json','X-Quori-Token':token},
   body:body===undefined?undefined:JSON.stringify(body),signal:signal||AbortSignal.timeout(35000),
  });
  let data;try{data=await response.json();}catch{throw new Error('Quori is not connected yet. You can contact the team directly.');}
  if(!response.ok){if(response.status===403)ready=false;const error=new Error(typeof data.error==='string'?data.error:'Quori could not complete that request. Please try again.');error.status=response.status;throw error;}
  return data;
 }
 return {
  async connect(signal){const data=await request('status',undefined,signal);ready=data.mode==='live'&&typeof data.token==='string'&&!!data.token;token=ready?data.token:'';return {...data,mode:ready?'live':'preview'};},
  async respond(message,{signal,requestId}){if(!ready)throw new Error('Quori is not connected. Close and reopen to reconnect, or contact the team directly.');return request('chat',{message,request_id:requestId},signal);},
  async reset(){if(!ready)throw new Error('Please reconnect before starting a new conversation.');return request('reset',{});},
  async request(action,body){if(!ready)throw new Error('Your session expired. Please contact the team directly if a previous delivery was uncertain.');return request(action,body);},
  get ready(){return ready;},
 };
}
