import './portal.css';
import './admin.css';
import './feedback-admin.css';
import {createPortalAuth} from './auth.mjs';
import {createPortalApi} from './api.mjs';
import {uploadControl} from './upload.mjs';
import {submitMutation} from './mutations.mjs';
import {el,button,link,field,heading,empty,notice,bytes,date} from './ui.mjs';
import {renderInbox,renderProgress,renderContent,testerSection} from './feedback-admin.mjs';
const root=document.querySelector('#app');let auth,api,memberApi,badgeApi,member,content,sequence=0,limits,feedbackInbox=0;
const stateLabel=s=>el('span',{class:'badge state-'+s},s);
function select(label,name,options,value){const input=el('select',{id:name,name},options.map(([v,text])=>el('option',{value:v,selected:String(v)===String(value)},text)));return {input,node:el('div',{class:'field'},el('label',{for:name},label),input)};}
function area(label,name,value=''){const input=el('textarea',{id:name,name,rows:4,maxlength:16000},value);return {input,node:el('div',{class:'field'},el('label',{for:name},label),input)};}
function clear(status,error){sequence++;content?.replaceChildren();document.querySelectorAll('dialog').forEach(d=>d.remove());window.dispatchEvent(new Event('quadrion:signout'));if(error&&content)content.append(notice(error.message,'error'),button('Refresh',render,true),button('Sign out',()=>auth.signOut(),true));}
function navigate(path){history.pushState(null,'',path);render();}
document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.origin===location.origin&&a.pathname.startsWith('/admin/')&&!e.ctrlKey&&!e.metaKey){e.preventDefault();navigate(a.pathname+a.search);}});window.addEventListener('popstate',()=>render());
function dialog(title,description,body){const d=el('dialog',{class:'editor-dialog'},el('header',{class:'dialog-header'},el('div',{},el('h2',{},title),el('p',{class:'muted'},description)),button('Close',()=>d.close(),true)),body);d.addEventListener('close',()=>{window.dispatchEvent(new Event('quadrion:uploads-pause'));d.remove();});document.body.append(d);d.showModal();return d;}
function saveForm(fields,action,payload,label='Save changes',confirmation){
  const feedback=el('div',{'aria-live':'polite'}),review=el('div'),save=el('button',{type:'submit',class:'primary'},label);let reviewed=false;
  const form=el('form',{onsubmit:async e=>{e.preventDefault();if(confirmation&&!reviewed){review.replaceChildren(notice(confirmation(payload())));save.textContent='Confirm '+label.toLowerCase();reviewed=true;return;}save.disabled=true;await submitMutation({send:()=>api.post(action,payload()),refresh:async()=>{form.closest('dialog')?.close();await render();},showError:message=>feedback.replaceChildren(notice(message,'error')),clear});save.disabled=false;}},...fields,review,el('div',{class:'actions'},save),feedback);
  form.addEventListener('input',()=>{reviewed=false;review.replaceChildren();save.textContent=label;});return form;
}
function confirmAction(title,description,action,payload){dialog(title,description,saveForm([],action,()=>payload,title));}
function shell(){
  const path=location.pathname,items=[['Overview','/admin/'],['Users','/admin/users/'],['Projects','/admin/projects/'],['Releases','/admin/releases/'],['Feedback','/admin/feedback/'],['Activity','/admin/activity/'],...(member.role==='owner'?[['Administrators','/admin/settings/']]:[])];
  content=el('main',{id:'main',class:'workspace-main'});
  root.replaceChildren(el('div',{class:'workspace admin-workspace'},el('aside',{class:'sidebar'},link(el('img',{src:'/assets/quadrion-horizontal-on-dark.svg',alt:'Quadrion',width:168}),'/d3-quarter/','brand'),el('span',{class:'nav-label'},'ADMINISTRATION'),el('nav',{'aria-label':'Administration'},items.map(([name,href])=>link(href==='/admin/feedback/'?[name,feedbackInbox?el('span',{class:'nav-count','aria-label':feedbackInbox+' waiting'},feedbackInbox):null]:name,href,'nav-item'+(path===href||(href==='/admin/feedback/'&&path.startsWith(href))?' active':'')))),el('div',{class:'sidebar-bottom'},link('Downloads & projects ↗','/portal/','nav-item'),el('p',{class:'account-label'},member.displayName||'Workspace administrator'),el('span',{class:'badge'},member.role.toUpperCase()),button('Sign out',()=>{clear();auth.signOut();},true))),el('div',{class:'workspace-body'},el('header',{class:'topbar'},el('span',{},'Administration'),el('span',{class:'status-dot'},'Private workspace')),content,el('footer',{class:'workspace-footer'},'Quadrion · Synapse Solutions',link('Client portal','/portal/')))));
}
function toolbar(title,description,action){content.append(el('div',{class:'page-toolbar'},heading('ADMINISTRATION',title,description),action));}
function table(headers,rows){return el('div',{class:'table-scroll'},el('table',{class:'data-table'},el('thead',{},el('tr',{},headers.map(h=>el('th',{scope:'col'},h)))),el('tbody',{},rows)));}
function searchForm(kind){const query=new URLSearchParams(location.search),search=field('Search '+kind,'search',{value:query.get('search')||'',maxLength:160});return el('form',{class:'search-form',onsubmit:e=>{e.preventDefault();navigate(location.pathname+'?search='+encodeURIComponent(search.input.value));}},search.node,el('button',{type:'submit',class:'secondary'},'Search'));}
function pagination(result){if(result.offset>0||result.offset+50<result.total){const q=new URLSearchParams(location.search);content.append(el('div',{class:'pagination'},result.offset>0?button('Previous',()=>{q.set('offset',Math.max(0,result.offset-50));navigate(location.pathname+'?'+q);},true):null,result.offset+50<result.total?button('Next',()=>{q.set('offset',result.offset+50);navigate(location.pathname+'?'+q);},true):null));}}
function list(kind){const params=new URLSearchParams(location.search);return api.get(kind,{search:params.get('search')||'',offset:params.get('offset')||0});}
async function overview(ticket){
  const stats=await api.get('overview');if(ticket!==sequence)return;limits=stats.limits;
  toolbar('Workspace overview','Control who has access and what is ready to download.');
  content.append(el('section',{class:'admin-summary'},el('h2',{},stats.members+' active members'),el('p',{class:'muted'},stats.invited+' invited · '+stats.projects+' published projects · '+stats.releases+' published releases')),
    el('div',{class:'admin-destinations'},[['Users & access','Create client accounts, set their tier and manage private assignments.','/admin/users/'],['Project library','Create AIO project versions and choose their audience.','/admin/projects/'],['Software releases','Publish Player installers and processing pipeline updates.','/admin/releases/']].map(([title,text,href])=>el('a',{href,class:'admin-destination'},el('h2',{},title),el('p',{},text),el('span',{},'Open →')))),notice('Uploads remain drafts until their stored bytes are verified and you explicitly publish them.'),el('p',{class:'muted'},'Project uploads: '+bytes(limits.projectBytes)+' per file. Software releases: '+bytes(limits.releaseBytes)+'. Hosted files are stored in the Supabase Mumbai region.'));
}
function invite(){
  const email=field('Email address','invite-email',{type:'email',required:true}),role=select('Role','invite-role',member.role==='owner'?[['member','Member'],['admin','Administrator']]:[['member','Member']],'member'),tier=select('Access tier','invite-tier',[[1,'T1 · Software and pipelines'],[2,'T2 · Basic projects'],[3,'T3 · All project categories']],1),expiry=field('Access expiry (optional)','invite-expiry',{type:'date'});let id=crypto.randomUUID();
  role.input.addEventListener('change',()=>{tier.node.hidden=role.input.value!=='member';});
  const feedback=el('div',{'aria-live':'polite'}),send=el('button',{type:'submit',class:'primary'},'Send invitation');
  const form=el('form',{onsubmit:async e=>{e.preventDefault();send.disabled=true;try{const result=await api.post('invite',{email:email.input.value,role:role.input.value,tier:role.input.value==='member'?Number(tier.input.value):null,expiresAt:expiry.input.value?new Date(expiry.input.value+'T23:59:59').toISOString():null,idempotencyKey:id});feedback.replaceChildren(notice(result.status==='sent'?'Invitation submitted. Email delivery is tracked separately.':result.status==='failed'||result.status==='cancelled'?'Invitation did not complete. Close this form and retry from Recent invitations after the ten-minute recipient cooldown.':'Dispatch is uncertain. Use this same form to check again without sending another email.'));if(result.status==='sent')send.disabled=true;else send.textContent='Check invitation';}catch(error){feedback.replaceChildren(notice(error.message,'error'));}finally{if(send.textContent==='Check invitation'||feedback.querySelector('.error'))send.disabled=false;}}},email.node,role.node,tier.node,expiry.node,notice('Only invite recipients you intend to grant access to. Private assignments never override their tier.'),send,feedback);
  form.addEventListener('input',()=>{id=crypto.randomUUID();send.textContent='Send invitation';send.disabled=false;});dialog('Invite a user','Send a secure account setup link from Quadrion.',form);
}
function createUser(){
  const email=field('Email address','create-email',{type:'email',required:true,maxLength:254,autocomplete:'off'}),password=field('Password','create-password',{type:'password',required:true,maxLength:128,autocomplete:'new-password',help:'Use at least 12 characters. Keep a copy to share directly; it cannot be viewed later.'}),tier=select('Access tier','create-tier',[[1,'T1 · Software and pipelines'],[2,'T2 · Basic projects'],[3,'T3 · All project categories']],1),expiry=field('Access expiry (optional)','create-expiry',{type:'date'});
  password.input.minLength=12;let id=crypto.randomUUID();
  const reveal=button('Show password',()=>{password.input.type=password.input.type==='password'?'text':'password';reveal.textContent=password.input.type==='password'?'Show password':'Hide password';},true);
  const feedback=el('div',{'aria-live':'polite'}),save=el('button',{type:'submit',class:'primary'},'Create active user');
  const form=el('form',{autocomplete:'off',onsubmit:async e=>{
    e.preventDefault();save.disabled=true;
    const payload={email:email.input.value,password:password.input.value,tier:Number(tier.input.value),expiresAt:expiry.input.value?new Date(expiry.input.value+'T23:59:59').toISOString():null,idempotencyKey:id};
    password.input.value='';password.input.type='password';reveal.textContent='Show password';
    try{
      const result=await api.post('createUser',payload);d.close();await render();
      content.prepend(notice(result.status==='created'?'Account ready. Share the email, password you chose and quadrion.ai/portal/ directly. No invitation or confirmation email was sent.':result.status==='failed'?'Account creation was rejected. Check the email and password requirements, then create the user again.':'The result is not confirmed yet. Use Check account in Recent manual accounts; do not send another creation request.'));
    }catch(error){feedback.replaceChildren(notice(error.message,'error'));}finally{payload.password='';save.disabled=false;}
  }},email.node,password.node,reveal,tier.node,expiry.node,notice('This member can sign in immediately. No invitation or confirmation email will be sent. Private projects still require the matching tier and assignment.'),save,feedback);
  form.addEventListener('input',()=>{id=crypto.randomUUID();});
  const d=dialog('Create a user','Owner access · Set the password and share the login directly.',form);
  d.addEventListener('close',()=>{password.input.value='';});
}
function editUser(u){
  const tier=select('Access tier','edit-tier',[[1,'T1 · Software'],[2,'T2 · Basic projects'],[3,'T3 · All categories']],u.tier||1),role=select('Role','edit-role',member.role==='owner'?[['member','Member'],['admin','Administrator'],['owner','Owner']]:[['member','Member']],u.role),status=select('Account status','edit-status',[['active','Active'],['invited','Invited'],['suspended','Suspended'],['revoked','Revoked']],u.status),expiry=field('Access expiry (optional)','edit-expiry',{type:'date',value:u.expires_at?u.expires_at.slice(0,10):''});
  const roleChange=()=>{tier.node.hidden=role.input.value!=='member';expiry.node.hidden=role.input.value==='owner';};role.input.addEventListener('change',roleChange);roleChange();
  const payload=()=>({userId:u.user_id,revision:u.revision,role:role.input.value,tier:role.input.value==='member'?Number(tier.input.value):null,status:status.input.value,expiresAt:role.input.value==='owner'?null:expiry.input.value===(u.expires_at?.slice(0,10)||'')?u.expires_at:expiry.input.value?new Date(expiry.input.value+'T23:59:59').toISOString():null});
  const access=saveForm([role.node,tier.node,status.node,expiry.node],'member',payload,'Save access',data=>u.email+' will have '+data.role+(data.tier?' / T'+data.tier:'')+' access with status '+data.status+'. Existing downloaded files cannot be recalled.');
  dialog('Manage access',u.email,el('div',{},access,testerSection(feedbackContext(),u,saveForm)));
}
async function users(ticket,administrators=false){
  const data=await list('users');if(ticket!==sequence)return;toolbar(administrators?'Administrators':'Users & access',administrators?'Owner access includes management of other administrators. At least one active owner must remain.':'Tiers determine the library. Roles determine who can administer it.',el('div',{class:'actions'},member.role==='owner'&&!administrators?button('Create user',createUser):null,button('Invite user',invite,true)));content.append(searchForm('users'));
  const items=administrators?data.items.filter(u=>u.role!=='member'):data.items;
  content.append(items.length?table(['User','Access','Status','Expiry',''],items.map(u=>el('tr',{},el('td',{},el('strong',{},u.display_name||u.email),el('small',{class:'table-sub'},u.display_name?u.email:u.company)),el('td',{},u.role==='member'?'T'+u.tier:u.role),el('td',{},stateLabel(u.status)),el('td',{},date(u.expires_at)),el('td',{},(member.role==='owner'||u.role==='member')?button('Manage',()=>editUser(u),true):null)))):empty('No users found','Try another search or invite a user.'));pagination(data);
  const invitations=await api.get('invitations');if(ticket!==sequence)return;
  if(invitations.items.length){
    const rows=invitations.items.slice(0,10).map(i=>{
      const controls=i.status==='dispatching'?el('div',{class:'actions'},
        button('Reconcile',()=>confirmAction('Check invitation','Check Auth without sending another email.','inviteRecovery',{id:i.id,action:'reconcile'}),true),
        button('Cancel unresolved',()=>confirmAction('Cancel unresolved invitation','Available after ten minutes, only if Auth confirms no account was created. You can then retry explicitly.','inviteRecovery',{id:i.id,action:'cancel'}),true)):
        button(i.status==='sent'?'Resend':'Retry invitation',()=>confirmAction('Send invitation','Send a setup email to '+i.email+'. A ten-minute recipient cooldown applies.','invite',{email:i.email,role:i.role,tier:i.tier,expiresAt:i.expires_at,idempotencyKey:crypto.randomUUID(),resend:!!i.user_id}),true);
      return el('tr',{},el('td',{},i.email),el('td',{},stateLabel(i.status)),el('td',{},date(i.created_at)),el('td',{},controls));
    });
    content.append(el('section',{class:'section-block'},el('h2',{},'Recent invitations'),table(['Recipient','Status','Requested',''],rows)));
  }
  if(member.role==='owner'&&!administrators){
    const creations=await api.get('creations');if(ticket!==sequence)return;
    if(creations.items.length)content.append(el('section',{class:'section-block'},el('h2',{},'Recent manual accounts'),table(['User','Tier','Status',''],creations.items.map(c=>el('tr',{},el('td',{},c.email),el('td',{},'T'+c.tier),el('td',{},stateLabel(c.status)),el('td',{},c.status==='creating'?el('div',{class:'actions'},button('Check account',()=>confirmAction('Check account','Reconcile '+c.email+' without sending email or changing a password.','creationRecovery',{id:c.id,action:'reconcile'}),true),button('Cancel unresolved',()=>confirmAction('Cancel account creation','Available after ten minutes only if no Auth account exists.','creationRecovery',{id:c.id,action:'cancel'}),true)):null))))));
  }
}
function projectEditor(p){
  const title=field('Project title','project-title',{value:p?.title||'',required:true,maxLength:160}),description=area('Description','project-description',p?.description),category=select('Category','project-category',[['basic','Basic dataset'],['oil_gas','Oil & gas'],['restricted','Restricted project']],p?.category||'restricted'),tier=select('Minimum tier','project-tier',[[2,'T2'],[3,'T3']],p?.minimum_tier||3),audience=select('Audience','project-audience',[['tier','Tier library'],['assigned','Selected users only']],p?.audience||'assigned');
  const lockTier=()=>{tier.input.disabled=category.input.value!=='basic';if(tier.input.disabled)tier.input.value='3';};category.input.addEventListener('change',lockTier);lockTier();
  dialog(p?'Edit project':'Create a project',p?'Saving metadata returns this project to draft for review.':'New projects start as private drafts.',saveForm([title.node,description.node,category.node,tier.node,audience.node],'project',()=>({...p?{id:p.id,revision:p.revision}:{},title:title.input.value,description:description.input.value,category:category.input.value,minimumTier:Number(tier.input.value),audience:audience.input.value}),'Save draft'));
}
function versionEditor(p){const version=field('Version','version',{required:true,maxLength:80}),minimum=field('Minimum Player version','minimum-version',{maxLength:80}),notes=area('Release notes','notes');dialog('Add project version',p.title,saveForm([version.node,minimum.node,notes.node],'version',()=>({projectId:p.id,version:version.input.value,minimumAppVersion:minimum.input.value,notes:notes.input.value}),'Create version'));}
async function assignments(p){
  let users=[];for(let offset=0;offset<1000;offset+=50){const data=await api.get('users',{offset});if(data.total>1000)throw new Error('This workspace needs the searchable assignment manager before editing more than 1,000 users. Existing assignments are unchanged.');users.push(...data.items);if(users.length>=data.total)break;}
  const selections=new Set(p.assignments.map(a=>a.userId)),expiry=field('Assignment expiry (optional)','assignment-expiry',{type:'date'}),checks=[];
  const rows=users.filter(u=>u.role==='member').map(u=>{const eligible=u.status==='active'&&u.tier>=p.minimum_tier&&(!u.expires_at||Date.parse(u.expires_at)>Date.now());const input=el('input',{type:'checkbox',value:u.user_id,checked:eligible&&selections.has(u.user_id),disabled:!eligible,'aria-label':'Assign '+u.email});checks.push(input);return el('label',{class:'assignment-row'},input,el('span',{},u.email,el('small',{class:'table-sub'},'T'+u.tier+' · '+u.status+(eligible?'':' · not eligible'))));});
  dialog('Project assignments',p.title+' · Minimum T'+p.minimum_tier,saveForm([notice('Assignments are used only with “Selected users only”. A user must also meet the tier requirement. Ineligible assignments are removed when saved.'),expiry.node,el('div',{class:'assignment-list'},rows)],'assignments',()=>({projectId:p.id,revision:p.revision,assignments:checks.filter(c=>c.checked&&!c.disabled).map(c=>({userId:c.value,expiresAt:expiry.input.value?new Date(expiry.input.value+'T23:59:59').toISOString():p.assignments.find(a=>a.userId===c.value)?.expiresAt||null}))}),'Save assignments'));
}
function uploadPanel(file,options){
  if(file?.state==='verified')return el('div',{},stateLabel('verified'),el('p',{},file.filename+' · '+bytes(file.bytes)));
  if(limits.uploadsReady===false)return notice('Uploads are unavailable because file verification is not configured. The site administrator needs to complete the upload service setup.','error');
  const panel=el('div');
  const completed=state=>{
    if(state==='abandoned'){panel.replaceChildren(uploadControl({api,...options,onVerified:completed}));return;}
    panel.replaceChildren(stateLabel('verified'),notice('Stored size and checksum verified. Finish any other uploads, then refresh details to publish.'),button('Refresh details',render,true));
  };
  panel.append(uploadControl({api,...options,existing:file,onVerified:completed}));return panel;
}
function projectDetail(p){
  const body=el('div',{},el('div',{class:'actions'},button('Edit project',()=>{d.close();projectEditor(p);},true),button('Assignments',()=>{d.close();assignments(p).catch(e=>content.prepend(notice(e.message,'error')));},true),button('Add version',()=>{d.close();versionEditor(p);},true)),el('p',{class:'muted'},'T'+p.minimum_tier+' · '+(p.audience==='tier'?'Tier library':'Selected users only')));
  for(const v of p.versions){
    const binary=v.files.find(f=>f.kind==='binary'),preview=v.files.find(f=>f.kind==='preview'),published=p.status==='published'&&p.current_version_id===v.id;
    body.append(el('section',{class:'version-section'},el('div',{class:'section-title'},el('h3',{},'Version '+v.version),stateLabel(published?'published':binary?.state||'draft')),el('p',{class:'muted'},v.minimum_app_version?'Requires Player '+v.minimum_app_version+' or later':'Set compatibility in the version notes.'),el('p',{class:'preserve'},v.notes),
      el('h4',{},'AIO project file'),uploadPanel(binary,{projectVersionId:v.id,limit:limits.projectBytes}),
      el('h4',{},'Cover image (optional)'),preview||!published?uploadPanel(preview,{projectVersionId:v.id,kind:'preview',limit:10000000}):el('p',{class:'muted'},'No cover image. Add one with the next version.'),
      binary?.state==='verified'&&!published?button('Publish this version',()=>{d.close();confirmAction('Publish project',p.title+' / '+v.version+' will become available to '+(p.audience==='tier'?'eligible tier members.':'assigned, eligible users.'),'publish',{kind:'project',id:p.id,revision:p.revision,versionId:v.id});}):null));
  }
  if(!p.versions.length)body.append(empty('Add the first version','Each version has an immutable file and its own checksum.'));
  if(p.status==='published')body.append(button('Archive project',()=>{d.close();confirmAction('Archive project','New download links for '+p.title+' will be disabled. Existing links last up to five minutes.','archive',{kind:'project',id:p.id,revision:p.revision});},true));
  const d=dialog(p.title,p.description,body);
}
async function projects(ticket){const data=await list('projects');if(ticket!==sequence)return;toolbar('Project library','Draft, verify and publish AIO datasets with controlled access.',button('Create project',()=>projectEditor()));content.append(searchForm('projects'),data.items.length?table(['Project','Audience','Status','Versions',''],data.items.map(p=>el('tr',{},el('td',{},el('strong',{},p.title),el('small',{class:'table-sub'},p.category.replace('_',' & '))),el('td',{},'T'+p.minimum_tier+' · '+(p.audience==='tier'?'Tier library':'Selected users')),el('td',{},stateLabel(p.status)),el('td',{},p.versions.length),el('td',{},button('Open',()=>projectDetail(p),true))))):empty('Create your first project','Upload a dataset, choose its audience and publish it when verified.'));pagination(data);}
function releaseEditor(){const kind=select('Release type','release-kind',[['app','Quadrion Player'],['pipeline','Processing pipeline']],'app'),version=field('Version','release-version',{required:true,maxLength:80}),platform=select('Platform','release-platform',[['windows','Windows'],['macos','macOS'],['linux','Linux'],['all','All platforms']],'windows'),minimum=field('Minimum Player version','release-minimum',{maxLength:80}),notes=area('Release notes','release-notes');dialog('Create a software release','Upload the matching installer or pipeline package after saving.',saveForm([kind.node,version.node,platform.node,minimum.node,notes.node],'release',()=>({kind:kind.input.value,version:version.input.value,platform:platform.input.value,minimumAppVersion:minimum.input.value,notes:notes.input.value}),'Create draft'));}
function releaseDetail(r){const file=r.files[0],d=dialog((r.kind==='app'?'Player':'Pipeline')+' '+r.version,r.platform,el('div',{},el('p',{class:'preserve'},r.notes),uploadPanel(file,{releaseId:r.id,limit:limits.releaseBytes}),file?.state==='verified'&&r.status!=='published'?button('Publish release',()=>{d.close();confirmAction('Publish release','This release will be available to all active T1–T3 members.','publish',{kind:'release',id:r.id,revision:r.revision,versionId:null});}):null,r.status==='published'?button('Retire release',()=>{d.close();confirmAction('Retire release','Disable new download links for this release.','archive',{kind:'release',id:r.id,revision:r.revision});},true):null));}
async function releases(ticket){const data=await list('releases');if(ticket!==sequence)return;toolbar('Software releases','Publish versioned Player installers and processing pipelines.',button('Create release',releaseEditor));content.append(searchForm('releases'),data.items.length?table(['Release','Platform','Status','File',''],data.items.map(r=>el('tr',{},el('td',{},el('strong',{},(r.kind==='app'?'Player':'Pipeline')+' '+r.version),el('small',{class:'table-sub'},r.minimum_app_version?'Player '+r.minimum_app_version+'+':'')),el('td',{},r.platform),el('td',{},stateLabel(r.status)),el('td',{},r.files[0]?stateLabel(r.files[0].state):'No file'),el('td',{},button('Open',()=>releaseDetail(r),true))))):empty('No software releases yet','Create a draft release and upload its installer or package.'));pagination(data);}
async function activity(ticket){const data=await list('activity');if(ticket!==sequence)return;toolbar('Activity','Permission changes, publication and download-link activity. Link issuance is not proof of a completed download.');content.append(searchForm('events'),table(['Time','Event','Actor','Resource'],data.items.map(e=>el('tr',{},el('td',{},new Date(e.created_at).toLocaleString()),el('td',{},e.action.replaceAll('_',' ')),el('td',{class:'id-cell'},e.actor_id||'System'),el('td',{class:'id-cell'},e.resource_id||e.subject_id||'—')))));pagination(data);}
function feedbackContext(){return {api,member,get content(){return content;},navigate,dialog,render,search:location.search,origin:location.origin,clipboard:navigator.clipboard};}
async function render(){const ticket=++sequence;try{
  if(!auth)return;if(!await auth.getToken()){location.replace('/portal/?login');return;}if(auth.needsPassword()){auth.showPassword();return;}
  const me=await memberApi.get('me');if(ticket!==sequence)return;member=me.member;
  if(member.role==='member'){location.replace('/portal/');return;}
  document.querySelectorAll('dialog').forEach(d=>d.close());
  // The badge has its own API without onDenied: a failed count only hides the badge, never the page.
  feedbackInbox=await badgeApi.get('feedbackCounts').then(counts=>Number(counts.inbox)||0,()=>0);if(ticket!==sequence)return;shell();
  if(!limits)limits=(await api.get('overview')).limits;if(ticket!==sequence)return;
  const path=location.pathname;if(path==='/admin/'||path==='/admin/index.html')await overview(ticket);else if(path==='/admin/users/')await users(ticket);else if(path==='/admin/settings/'&&member.role==='owner')await users(ticket,true);else if(path==='/admin/projects/')await projects(ticket);else if(path==='/admin/releases/')await releases(ticket);else if(path==='/admin/feedback/'||path==='/admin/feedback')await renderInbox(feedbackContext());else if(path==='/admin/feedback/progress/')await renderProgress(feedbackContext());else if(path==='/admin/feedback/content/'&&member.role==='owner')await renderContent(feedbackContext());else if(path==='/admin/activity/')await activity(ticket);else content.append(empty('Page unavailable','Return to administration.',link('Overview','/admin/')));
  content.querySelector('h1')?.focus({preventScroll:true});
}catch(error){if(error.status===401){await auth.signOut();return;}if(content)content.replaceChildren(notice(error.message,'error'),button('Refresh',render,true),button('Sign out',()=>auth.signOut(),true));else root.replaceChildren(notice(error.message,'error'));}}
try{auth=await createPortalAuth({root,onChange:render});api=createPortalApi({getToken:auth.getToken,onDenied:clear,admin:true});badgeApi=createPortalApi({getToken:auth.getToken,admin:true});memberApi=createPortalApi({getToken:auth.getToken,onDenied:clear});await render();}catch(error){root.replaceChildren(el('main',{class:'unavailable'},heading('ADMINISTRATION','Workspace setup in progress',error.message),link('Return to Quadrion','/d3-quarter/','button-link')));}
