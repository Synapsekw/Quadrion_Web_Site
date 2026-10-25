import {available} from './config.mjs';
import {activeMember} from './policy.mjs';
import {json,errorResponse,checkOrigin,readJson,keys,uuid,string,memberDto,identity,alongside,fail} from './http.mjs';
export function createMemberHandler({config,backend,clock=Date.now}){
  return async(request,context)=>{try{
    if(!available(config,request,context))fail('unavailable');
    checkOrigin(request,config);
    const url=new URL(request.url),action=url.searchParams.get('action')||'me';
    if(!['config','me','releases','projects','project','download','profile','preview'].includes(action))fail('not_found');
    if(request.method!==(action==='download'||action==='profile'||action==='preview'?'POST':'GET'))fail('method');
    if(action==='config')return json({enabled:true,url:config.url,publishableKey:config.publishableKey});
    const user=await identity(request,backend);
    // The membership check. Reads run alongside it; nothing is returned or signed until it has passed.
    const member=async()=>{const m=memberDto(await backend.account(user.userId));if(!activeMember(m,clock()))fail('forbidden');return m;};
    if(action==='me')return json({member:await member(),email:user.email,aal:user.aal,requiresMfa:false});
    if(action==='releases'||action==='projects')return json(await alongside(member,async()=>{
      const search=string(url.searchParams.get('search')||'',160),offset=Number(url.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('invalid');
      return backend.catalog(user.userId,user.aal,action,search,offset);
    }));
    if(action==='project')return json(await alongside(member,async()=>backend.project(user.userId,user.aal,uuid(url.searchParams.get('id')))));
    if(action==='profile'){
      await member();const body=await readJson(request);keys(body,['displayName','company']);
      return json({member:memberDto(await backend.updateProfile(user.userId,{displayName:string(body.displayName,120),company:string(body.company,160)}))});
    }
    // The body is read once; a body error is reported only after the membership check, as before.
    const read=readJson(request).then(body=>{keys(body,['artifactId']);uuid(body.artifactId);return body;});read.catch(()=>{});
    if(action==='preview'){
      const file=await alongside(member,async()=>{const body=await read;return backend.rpc('portal_preview',{p_actor:user.userId,p_aal:user.aal,p_id:body.artifactId});});
      return json({url:await backend.signDownload(file,300,false),expiresIn:300});
    }
    // portal_download re-checks the member itself and rolls back when it refuses, so it runs alongside the check.
    // A reservation made for a request the check then refuses is closed as failed and never signed.
    const artifact=await alongside(member,async()=>{const body=await read;return backend.reserveDownload(user.userId,user.aal,body.artifactId);},
      {onDropped:found=>backend.recordDownload(user.userId,found.id,false)});
    try{
      const signedUrl=await backend.signDownload(artifact,300);
      await backend.recordDownload(user.userId,artifact.id,true);
      return json({url:signedUrl,filename:artifact.filename,bytes:artifact.bytes,sha256:artifact.sha256,expiresIn:300});
    }catch(error){await backend.recordDownload(user.userId,artifact.id,false).catch(()=>{});throw error;}
  }catch(error){return errorResponse(error);}};
}
