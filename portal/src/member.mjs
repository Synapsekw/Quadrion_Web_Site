import './portal.css';
import {createPortalAuth} from './auth.mjs';
import {createPortalApi} from './api.mjs';
import {el,button,link,field,heading,empty,notice,bytes,date,runButton} from './ui.mjs';
const root=document.querySelector('#app');let auth,api,member,content,sequence=0;
function navigate(path){history.pushState(null,'',path);render();}
document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.origin===location.origin&&a.pathname.startsWith('/portal/')&&!e.ctrlKey&&!e.metaKey){e.preventDefault();navigate(a.pathname+a.search);}});
window.addEventListener('popstate',()=>render());
function clear(){sequence++;member=null;content?.replaceChildren(notice('Your workspace access needs to be checked. Reload to continue.','error'),button('Reload workspace',render,true),button('Sign out',()=>auth.signOut(),true));}
async function download(file,event){await runButton(event.currentTarget,async()=>{try{const result=await api.post('download',{artifactId:file.artifact_id||file.id});const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='oxjrkodcmflxejdwsuac.supabase.co')throw new Error('The download link could not be verified.');const a=el('a',{href:url.href,download:result.filename,rel:'noreferrer'});document.body.append(a);a.click();a.remove();}catch(error){content.prepend(notice(error.message,'error'));}});}
function shell(){
  const path=location.pathname;const items=[['Overview','/portal/','◈'],['Downloads','/portal/downloads/','↓'],['Projects','/portal/projects/','▦'],['Account','/portal/account/','◎']];
  content=el('main',{id:'main',class:'workspace-main'});
  const sidebar=el('aside',{class:'sidebar'},link(el('img',{src:'/assets/quadrion-horizontal-on-dark.svg',alt:'Quadrion',width:168}),'/d3-quarter/','brand'),el('span',{class:'nav-label'},'WORKSPACE'),el('nav',{'aria-label':'Workspace'},items.map(([name,href,icon])=>el('a',{href,class:path===href||(href!=='/portal/'&&path.startsWith(href))?'nav-item active':'nav-item','aria-current':path===href?'page':null},el('span',{'aria-hidden':'true'},icon),name))),el('div',{class:'sidebar-bottom'},member.role!=='member'?link('Administration ↗','/admin/','nav-item'):null,el('p',{class:'account-label'},member.displayName||'Your account'),el('span',{class:'badge'},member.role==='member'?'T'+member.tier+' MEMBER':member.role.toUpperCase()),button('Sign out',()=>{clear();auth.signOut();},true)));
  root.replaceChildren(el('div',{class:'workspace'},sidebar,el('div',{class:'workspace-body'},el('header',{class:'topbar'},el('span',{},'Client portal'),el('span',{class:'status-dot'},'Private workspace')),content,el('footer',{class:'workspace-footer'},el('span',{},'Quadrion · Synapse Solutions'),link('Support','mailto:info@synapse-solutions.ai')))));
}
function fileRow(file){return el('article',{class:'file-row'},el('div',{class:'file-mark','aria-hidden':'true'},file.kind==='pipeline'?'↳':'↓'),el('div',{class:'file-info'},el('h2',{},file.kind==='app'?'Quadrion Player':file.kind==='pipeline'?'Processing pipeline':file.filename),el('p',{class:'muted'},'Version '+file.version+' · '+(file.platform||'AIO project')+' · '+bytes(file.bytes)),file.minimum_app_version?el('p',{class:'compatibility'},'Requires Player '+file.minimum_app_version+' or later'):null,el('details',{},el('summary',{},'Release notes & checksum'),el('p',{class:'preserve'},file.notes||'No release notes.'),el('small',{},'SHA-256'),el('code',{class:'checksum'},file.sha256))),button('Download',e=>download(file,e)));}
async function overview(ticket){
  const [releases,projects]=await Promise.all([api.get('releases'),api.get('projects')]);if(ticket!==sequence)return;
  content.append(heading('YOUR WORKSPACE','Welcome'+(member.displayName?', '+member.displayName.split(' ')[0]:'')+'.','Everything you need to work with Quadrion, kept together.'),el('section',{class:'access-strip'},el('div',{},el('span',{class:'eyebrow'},'YOUR ACCESS'),el('h2',{},member.role==='member'?'Tier '+member.tier:member.role==='owner'?'Workspace owner':'Administrator')),el('p',{},member.role==='member'?(member.tier===1?'Player and processing pipelines.':member.tier===2?'Software, pipelines and basic project datasets.':'Software, pipelines and all project categories.'):'Manage access, publish software and curate the project library.'),member.expiresAt?el('small',{},'Access expires '+date(member.expiresAt)):el('small',{},'Active membership')),
    el('section',{class:'section-block'},el('div',{class:'section-title'},el('h2',{},'Ready for your next project'),link('View downloads →','/portal/downloads/')),releases.items.length?releases.items.slice(0,2).map(fileRow):empty('Your software library is getting ready','Published installers and processing pipelines will appear here.')),
    el('section',{class:'section-block'},el('div',{class:'section-title'},el('h2',{},'Project library'),link('Browse projects →','/portal/projects/')),projects.items.length?projectGrid(projects.items.slice(0,3)):empty('No projects available yet',member.tier===1?'Project datasets are available with T2 and T3 access.':'Projects shared with your account will appear here.')));
}
function projectCover(id,label,category){
  const box=el('div',{class:'project-art','aria-label':label+' cover'},el('span',{},category==='oil_gas'?'O&G':category==='restricted'?'R':'AIO'));
  if(!id)return box;
  const ticket=sequence;
  async function load(){try{
    const result=await api.post('preview',{artifactId:id});if(ticket!==sequence||!box.isConnected)return;
    const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='oxjrkodcmflxejdwsuac.supabase.co')return;
    const img=el('img',{src:url.href,alt:label+' project cover',referrerpolicy:'no-referrer'});
    img.addEventListener('error',()=>box.replaceChildren(el('span',{},'AIO')),{once:true});box.replaceChildren(img);
    setTimeout(()=>{if(ticket===sequence&&box.isConnected){box.replaceChildren(el('span',{},'Loading cover…'));load();}},Math.min(result.expiresIn,300)*1000-10000);
  }catch{if(box.isConnected)box.replaceChildren(el('span',{},'AIO'));}}
  setTimeout(load,0);return box;
}
function projectGrid(items){return el('div',{class:'project-grid'},items.map(p=>el('a',{href:'/portal/projects/'+p.id+'/',class:'project-card'},projectCover(p.preview_id,p.title,p.category),el('div',{class:'project-meta'},el('span',{class:'badge'},p.category.replace('_',' & ')),el('h2',{},p.title),el('p',{},p.description||'Quadrion project dataset'),el('div',{class:'project-bottom'},el('span',{},'v'+p.version+' · '+bytes(p.bytes)),el('span',{'aria-hidden':'true'},'↗'))))));}
async function downloads(ticket){
  const params=new URLSearchParams(location.search),search=params.get('search')||'',offset=Number(params.get('offset')||0);
  const data=await api.get('releases',{search,offset});if(ticket!==sequence)return;
  const query=field('Search releases','release-search',{value:search,maxLength:160});
  content.append(heading('SOFTWARE','Downloads','Install Quadrion Player and keep your processing tools up to date.'),el('form',{class:'search-form',onsubmit:e=>{e.preventDefault();navigate('/portal/downloads/?search='+encodeURIComponent(query.input.value));}},query.node,el('button',{type:'submit',class:'secondary'},'Search')),data.items.length?el('section',{class:'file-list'},data.items.map(fileRow)):empty('No matching releases','Try another search or check back when your administrator publishes software.'),el('p',{class:'muted'},'Choose a release compatible with your operating system and Player version. The website cannot detect your installed version.'));
  if(offset>0||offset+24<data.total)content.append(el('div',{class:'pagination'},offset>0?link('← Previous','/portal/downloads/?search='+encodeURIComponent(search)+'&offset='+Math.max(0,offset-24)):null,offset+24<data.total?link('Next →','/portal/downloads/?search='+encodeURIComponent(search)+'&offset='+(offset+24)):null));
}
async function projects(ticket){
  const search=new URLSearchParams(location.search).get('search')||'',offset=Number(new URLSearchParams(location.search).get('offset')||0);
  const data=await api.get('projects',{search,offset});if(ticket!==sequence)return;
  const query=field('Search projects','project-search',{value:search,maxLength:160});
  content.append(heading('LIBRARY','Your projects','AIO datasets available to your account. Private projects also require an assignment.'),el('form',{class:'search-form',onsubmit:e=>{e.preventDefault();navigate('/portal/projects/?search='+encodeURIComponent(query.input.value));}},query.node,el('button',{type:'submit',class:'secondary'},'Search')),el('p',{class:'result-count'},data.total+' available project'+(data.total===1?'':'s')),data.items.length?projectGrid(data.items):empty(search?'No matching projects':'Your library is empty',search?'Try a different search.':'Your administrator can publish projects for your tier or assign them to you.'));
  if(offset>0||offset+24<data.total)content.append(el('div',{class:'pagination'},offset>0?link('← Previous','/portal/projects/?search='+encodeURIComponent(search)+'&offset='+Math.max(0,offset-24)):null,offset+24<data.total?link('Next →','/portal/projects/?search='+encodeURIComponent(search)+'&offset='+(offset+24)):null));
}
async function project(ticket,id){
  const p=await api.get('project',{id});if(ticket!==sequence)return;
  const cover=p.files.find(f=>f.kind==='preview');
  if(cover)content.append(projectCover(cover.id,p.title,p.category));
  content.append(link('← Project library','/portal/projects/','back-link'),heading(p.category.replace('_',' & '),p.title,p.description),el('div',{class:'detail-facts'},el('span',{},'Version '+p.version),el('span',{},'Published '+date(p.published_at)),el('span',{},p.minimum_app_version?'Player '+p.minimum_app_version+' or later':'Quadrion Player')),
    el('section',{class:'section-block'},el('h2',{},'Project files'),p.files.filter(f=>f.kind==='binary').map(f=>fileRow({...f,version:p.version,minimum_app_version:p.minimum_app_version,notes:p.notes}))),el('p',{class:'muted'},'Download the .aio file, then open it in Quadrion Player. Processing runs on your computer.'));
}
async function account(){
  const name=field('Display name','display-name',{value:member.displayName,maxLength:120,autocomplete:'name'}),company=field('Company','company',{value:member.company,maxLength:160,autocomplete:'organization'}),feedback=el('div',{'aria-live':'polite'});
  content.append(heading('SETTINGS','Your account','Manage your profile and sign-in security.'),el('section',{class:'account-section'},el('div',{},el('h2',{},'Profile'),el('p',{class:'muted'},'Your access tier is managed by your administrator.')),el('form',{onsubmit:async e=>{e.preventDefault();const submit=e.target.querySelector('button');await runButton(submit,async()=>{try{const result=await api.post('profile',{displayName:name.input.value,company:company.input.value});member=result.member;feedback.replaceChildren(notice('Profile saved.'));}catch(error){feedback.replaceChildren(notice(error.message,'error'));}});}},name.node,company.node,el('button',{type:'submit',class:'primary'},'Save profile'),feedback)),el('section',{class:'account-section'},el('div',{},el('h2',{},'Security'),el('p',{class:'muted'},'Sign in with your email and password. You can change your password here.')),el('div',{class:'security-actions'},button('Change password',()=>{sessionStorage.setItem('quadrion-password-setup','true');auth.showPassword();},true))),el('section',{class:'account-section'},el('h2',{},'Need different access?'),el('p',{},'Contact ',link('info@synapse-solutions.ai','mailto:info@synapse-solutions.ai'),' to discuss your tier or project assignments.')));
}
async function render(){
  const ticket=++sequence;
  try{
    if(!auth)return;if(!await auth.getToken()){member=null;auth.showLogin();return;}
    if(auth.needsPassword()){auth.showPassword();return;}
    const me=await api.get('me');if(ticket!==sequence)return;member=me.member;
    if(auth.enterWorkspace(member))return;
    shell();content.append(notice('Loading your workspace…'));
    const path=location.pathname;content.replaceChildren();
    if(path==='/portal/'||path==='/portal/index.html')await overview(ticket);
    else if(path==='/portal/downloads/')await downloads(ticket);
    else if(path==='/portal/projects/')await projects(ticket);
    else if(/^\/portal\/projects\/[0-9a-f-]{36}\/$/i.test(path))await project(ticket,path.split('/')[3]);
    else if(path==='/portal/account/')await account();
    else content.append(empty('Page unavailable','Return to your workspace.',link('Overview','/portal/')));
    content.querySelector('h1')?.focus({preventScroll:true});
  }catch(error){if(error.status===401){await auth.signOut();return;}if(content){content.replaceChildren(notice(error.message,'error'),button('Try again',render,true),button('Sign out',()=>auth.signOut(),true));}else root.replaceChildren(notice(error.message,'error'));}
}
try{auth=await createPortalAuth({root,onChange:render});api=createPortalApi({getToken:auth.getToken,onDenied:clear});await render();}
catch(error){root.replaceChildren(el('div',{class:'unavailable'},link(el('img',{src:'/assets/quadrion-horizontal-on-dark.svg',alt:'Quadrion',width:180}),'/d3-quarter/'),heading('CLIENT PORTAL','Your workspace is on its way.',error.message),link('Return to Quadrion','/d3-quarter/','button-link')));}
