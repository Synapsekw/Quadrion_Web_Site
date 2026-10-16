const errors={invalid:[400,'Check the submitted fields.'],unauthorized:[401,'Please sign in again.'],forbidden:[403,'Your account does not have access.'],mfa_required:[403,'Verify your authenticator code to continue.'],not_found:[404,'This item is unavailable.'],method:[405,'This request method is unavailable.'],conflict:[409,'This record changed. Refresh it before saving.'],last_owner:[409,'At least one active owner must remain.'],unverified:[409,'The file must finish verification before publication.'],empty_audience:[409,'Assign at least one eligible user before publishing.'],too_large:[413,'This request is too large.'],content_type:[415,'Use JSON for this request.'],rate_limited:[429,'Please wait before trying again.'],unavailable:[503,'The portal is temporarily unavailable.']};
errors.account_exists=[409,'This email already has an account. Manage the existing user; their password was not changed.'];
errors.creation_pending=[409,'An account creation is still unresolved for this email. Check Recent manual accounts before trying again.'];
errors.upload_not_configured=[503,'Uploads are unavailable because file verification is not configured. The site administrator needs to complete the upload service setup.'];
export const fail=code=>{throw new Error('portal:'+code);};
export function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Vary':'Authorization'}});}
export function errorResponse(error){
  const match=/^portal:([a-z_]+)$/.exec(error?.message||'');
  const code=match&&errors[match[1]]?match[1]:'unavailable';
  return json({error:code,message:errors[code][1]},errors[code][0]);
}
export function checkOrigin(request,config){
  const origin=request.headers.get('origin');
  const allowed=config.localDev && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)?new URL(request.url).origin:config.origin;
  if((request.method==='POST' && origin!==allowed)||(origin&&origin!==allowed))fail('forbidden');
  if(!['GET','POST'].includes(request.method))fail('method');
}
export async function readJson(request){
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('content_type');
  if(Number(request.headers.get('content-length')||0)>32768)fail('too_large');
  const reader=request.body?.getReader();let size=0;const chunks=[];
  if(!reader)fail('invalid');
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();fail('too_large');}chunks.push(value);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid');}
  if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid');return value;
}
export function keys(value,allowed){if(Object.keys(value).some(k=>!allowed.includes(k)))fail('invalid');}
export function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('invalid');return value;}
export function string(value,max,{empty=true}={}){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))fail('invalid');return value.trim();}
export function memberDto(m){return {userId:m.user_id,role:m.role,tier:m.tier,status:m.status,expiresAt:m.expires_at,displayName:m.display_name||'',company:m.company||'',revision:m.revision};}
export async function identity(request,backend){
  const token=/^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization')||'')?.[1];
  if(!token||token.length>16000)fail('unauthorized');
  const user=await backend.verifyUser(token);
  if(!user?.userId||!user.emailConfirmed||!['aal1','aal2'].includes(user.aal))fail('unauthorized');
  return user;
}
