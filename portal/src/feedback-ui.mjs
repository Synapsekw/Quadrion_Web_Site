import {el} from './ui.mjs';
export const STATUS_LABELS={new:'New',triaged:'In the queue',question:'Question for you',fixed:'Fixed, re-check',confirmed:'Confirmed',reopened:'Sent back',parked:'Parked',declined:'Declined',merged:'Merged'};
export const statusLabel=(status,viewer='tester')=>status==='question'&&viewer==='owner'?'Waiting on tester':STATUS_LABELS[status]||String(status);
export const buildLabel=build=>!build||build==='unknown'?'build not recorded':build;
const BUILD=/^[0-9A-Za-z][0-9A-Za-z._+ -]*$/,SCREEN=/^[a-z0-9][a-z0-9._:-]{0,63}$/i;
export function prefillFromQuery(search){
  const params=new URLSearchParams(search||''),build=(params.get('build')||'').trim(),screen=(params.get('screen')||'').trim();
  return {kind:'bug',build:build.length>=1&&build.length<=80&&BUILD.test(build)?build:'',screen:SCREEN.test(screen)?screen:''};
}
const versionParts=v=>String(v).split(/[.+-]/).map(p=>/^\d+$/.test(p)?Number(p):0);
function newer(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(y[i]||0)-(x[i]||0);if(d)return d;}return 0;}
export function buildSuggestions(releases){return [...new Set((releases||[]).filter(r=>r.kind==='app'&&r.version).map(r=>r.version))].sort(newer);}
const TYPES={'image/png':10000000,'image/jpeg':10000000,'image/webp':10000000,'video/mp4':100000000,'video/webm':100000000,'application/zip':50000000};
const ALIAS={'application/x-zip-compressed':'application/zip','application/x-zip':'application/zip','image/jpg':'image/jpeg'};
const EXT={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',webm:'video/webm',zip:'application/zip'};
export function attachmentKind(file){
  const refuse=reason=>({ok:false,reason}),type=String(file?.type||'').toLowerCase();
  const mime=ALIAS[type]||type||EXT[String(file?.name||'').split('.').at(-1).toLowerCase()];
  if(!Object.hasOwn(TYPES,mime||''))return refuse('PNG, JPG, WebP, MP4, WebM or ZIP only');
  const size=Number(file.size);
  if(!(size>0))return refuse('The file is empty');
  if(size>TYPES[mime])return refuse('Larger than '+TYPES[mime]/1000000+' MB');
  return {ok:true,mime};
}
export function testerMessage({fixes=0,features=0,build,origin}){
  const parts=[];
  if(fixes)parts.push(`${fixes} ${fixes===1?'fix':'fixes'} in ${build} ${fixes===1?'is':'are'} ready to re-check`);
  if(features)parts.push(`${features} ${features===1?'feature':'features'} built in ${build} ${features===1?'is':'are'} ready to try`);
  return parts.join('; ')+': '+origin+'/portal/tests/';
}
export const statusBadge=(status,viewer='tester')=>el('span',{class:'badge status-'+status},statusLabel(status,viewer));
const EVENT_LABELS={comment:'Comment',question:'Question',answer:'Answer',status:'Status',priority:'Priority',merge:'Merged',fixed:'Marked fixed',confirm:'Confirmed',reopen:'Sent back',title:'Title changed',line_passed:'Line passed',import:'Imported'};
// events: [{kind, body, created_at, actor_name?, attachments?}]; attachmentCtx: {api, action} for signed URLs.
export function threadView(events,attachmentCtx={}){
  return el('ol',{class:'thread'},(events||[]).map(e=>el('li',{class:'thread-event kind-'+e.kind},
    el('div',{class:'thread-head'},el('strong',{},e.actor_name||EVENT_LABELS[e.kind]||e.kind),' ',el('span',{class:'thread-kind'},EVENT_LABELS[e.kind]||e.kind),' ',e.created_at?el('time',{datetime:e.created_at},new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(e.created_at))):null),
    e.body?el('p',{class:'thread-body'},e.body):null,
    attachmentCtx.api?(e.attachments||[]).map(attachment=>attachmentView({api:attachmentCtx.api,action:attachmentCtx.action,attachment})):null)));
}
// Asks `action` ({attachmentId}) for a signed URL, then renders an image, a video or a download link.
export function attachmentView({api,action='attachmentUrl',attachment}){
  const mime=attachment.mime_type||attachment.mime||'',name=attachment.filename||'attachment',box=el('div',{class:'attachment'},el('span',{class:'attachment-name'},name));
  async function load(){
    try{
      const result=await api.post(action,{attachmentId:attachment.id}),url=new URL(result.url);
      if(url.protocol!=='https:'||url.hostname!=='oxjrkodcmflxejdwsuac.supabase.co')throw new Error('The attachment link could not be verified.');
      if(mime.startsWith('image/'))box.replaceChildren(el('img',{src:url.href,alt:name,referrerpolicy:'no-referrer',loading:'lazy'}));
      else if(mime.startsWith('video/'))box.replaceChildren(el('video',{src:url.href,controls:true,preload:'metadata'}));
      else box.replaceChildren(el('a',{href:url.href,download:name,rel:'noreferrer'},'Download '+name));
    }catch(error){box.replaceChildren(el('span',{class:'attachment-error',role:'alert'},name+': '+(error.message||'could not be loaded')));}
  }
  setTimeout(load,0);
  return box;
}
