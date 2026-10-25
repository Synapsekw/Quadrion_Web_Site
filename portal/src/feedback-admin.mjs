import {el,button,link,field,heading,empty,notice,date,busy} from './ui.mjs';
import {statusBadge,statusLabel,buildLabel,threadView,attachmentView,testerMessage} from './feedback-ui.mjs';
import {submitMutation} from './mutations.mjs';
// ctx: {api, member, content, navigate(path), dialog(title,description,body), render(), search, origin, clipboard}.
// Everything that is not allowlisted HTML is rendered as text through el().
const FILTER_KEYS=['tester','kind','status','priority','build'];
const OPEN='new,triaged,question,fixed,reopened';
const plural=(n,one,many)=>n+' '+(n===1?one:many);
export function filterFromSearch(search){
  const query=new URLSearchParams(search||''),out={};
  for(const key of FILTER_KEYS){const value=(query.get(key)||'').trim();if(value)out[key]=value;}
  return out;
}
// render() builds a new <main>, so a notice for the owner goes into ctx.content as it is after the render.
export async function showAfterRender(ctx,build){await ctx.render();ctx.content.prepend(build());}
// A button that stays disabled while its request runs, so a double click sends one request.
const busyButton=(label,run)=>{const node=button(label,async()=>{const done=busy(node);try{await run();}finally{done();}},true);return node;};
export async function copyForAi({api,search,clipboard}){
  const result=await api.get('feedbackExport',filterFromSearch(search));
  try{await clipboard.writeText(result.text);}catch{throw new Error('Copy was blocked by the browser. Allow clipboard access for this page and try again.');}
  return 'Copied '+plural(result.count,'bug','bugs')+'. Links work for 24 hours.';
}
export async function bulkFix({api,ids,build,origin}){
  const unique=[...new Set(ids)],label=String(build||'').trim();
  if(!unique.length)throw new Error('Select at least one item first.');
  if(!label)throw new Error('Enter the build the fix is in.');
  const result=await api.post('feedbackBulkFix',{ids:unique,build:label});
  return {...result,message:testerMessage({fixes:result.bugs||0,features:result.features||0,build:result.build||label,origin})};
}
// The tester message for one item marked fixed: the same wording as a bulk fix of one.
export const fixMessage=(item,build,origin)=>testerMessage({fixes:item.kind==='bug'?1:0,features:item.kind==='feature'?1:0,build:String(build||'').trim(),origin});
function fixedNotice(ctx,summary,message){
  const copy=button('Copy message for testers',async()=>{try{await ctx.clipboard.writeText(message);copy.textContent='Copied';}catch{copy.textContent='Copy was blocked';}},true);
  return el('div',{class:'fb-fixed'},notice(summary),el('p',{class:'fb-tester-message'},message),copy);
}
// Owners only; null for everyone else. payload(checked) is the memberTester body, with the row's revision.
export function testerToggle(role,user){
  if(role!=='owner')return null;
  return {checked:user.tester===true,payload:checked=>({userId:user.user_id,revision:user.revision,tester:checked})};
}
export function testerSection(ctx,user,saveForm){
  const toggle=testerToggle(ctx.member.role,user);if(!toggle)return null;
  const input=el('input',{type:'checkbox',id:'edit-tester',name:'tester',checked:toggle.checked});
  const row=el('div',{class:'field check-field'},el('label',{for:'edit-tester'},input,' Tester'),el('small',{},'Testers see the test board and can report problems. Saved separately from access.'));
  return el('section',{class:'section-block tester-section'},el('h3',{},'Test feedback'),saveForm([row],'memberTester',()=>toggle.payload(input.checked),'Save tester access'));
}
function tabs(path,role){
  const items=[['Inbox','/admin/feedback/'],['Progress','/admin/feedback/progress/'],...(role==='owner'?[['Test content','/admin/feedback/content/']]:[])];
  return el('nav',{class:'fb-tabs','aria-label':'Feedback'},items.map(([name,href])=>link(name,href,path===href?'active':'')));
}
function head(ctx,title,description){
  ctx.content.append(heading('FEEDBACK',title,description),tabs(location.pathname,ctx.member.role));
}
function selectField(label,name,options,value){
  const input=el('select',{id:name,name},options.map(([v,text])=>el('option',{value:v,selected:String(v)===String(value)},text)));
  return {input,node:el('div',{class:'field'},el('label',{for:name},label),input)};
}
const clock=value=>value?new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
const priorityTag=priority=>el('span',{class:'priority priority-'+priority},priority);
// Tester names for the filters come from the progress report, the only list there is; it is kept for five minutes
// so the inbox does not fetch the whole report on every visit. Saving a member's tester flag forgets it.
let testerCache=null;
const testerNames=progress=>(progress.testers||[]).map(t=>({id:t.userId,name:t.name}));
export function forgetTesters(){testerCache=null;}
function testerList(ctx,now=Date.now()){
  if(testerCache&&testerCache.api===ctx.api&&now-testerCache.at<300000)return testerCache.promise;
  const promise=ctx.api.get('feedbackProgress').then(testerNames);
  testerCache={api:ctx.api,at:now,promise};
  promise.catch(()=>{if(testerCache?.promise===promise)testerCache=null;});
  return promise;
}
// Runs one owner action against the item's current revision; the item is repainted on success.
function actions(ctx,detail,repaint,showError,onFixed){
  const item=detail.item;
  const act=(action,data={},refresh=repaint)=>submitMutation({send:()=>ctx.api.post('feedbackAction',{id:item.id,revision:item.revision,action,data}),refresh,showError});
  const form=(fields,label,run,{secondary=true}={})=>{
    const submit=el('button',{type:'submit',class:secondary?'secondary':'primary'},label);
    return el('form',{class:'fb-action',onsubmit:async e=>{e.preventDefault();const done=busy(submit,'Saving…');try{await run();}finally{done();}}},...fields,submit);
  };
  const priority=selectField('Priority','fb-priority',[['high','High'],['normal','Normal'],['low','Low']],item.priority);
  const ask=el('textarea',{id:'fb-ask',rows:3,maxlength:8000,required:true,'aria-label':'Question for the tester'});
  const comment=el('textarea',{id:'fb-comment',rows:3,maxlength:8000,required:true,'aria-label':'Comment'});
  const reason=field('Reason (required to decline)','fb-reason',{maxLength:2000});
  const fixBuild=field('Fixed in build','fb-fix',{maxLength:80,required:true,value:item.fixed_in||''});
  const mergeBox=el('details',{class:'fb-merge'},el('summary',{},'Merge into another item'));
  let mergeLoaded=false;
  mergeBox.addEventListener('toggle',async()=>{
    if(!mergeBox.open||mergeLoaded)return;mergeLoaded=true;
    try{
      const candidates=[];
      for(let offset=0;offset<500;offset+=100){const page=await ctx.api.get('feedbackInbox',{status:OPEN,kind:item.kind,offset});candidates.push(...page.items);if(offset+100>=page.total)break;}
      const options=candidates.filter(c=>c.id!==item.id).map(c=>[c.id,'#'+c.number+' '+c.title]);
      if(!options.length){mergeBox.append(el('p',{class:'muted'},'No other open items of this kind.'));return;}
      const into=selectField('Keep item','fb-merge-into',options,options[0][0]);
      mergeBox.append(form([into.node],'Merge',()=>act('merge',{into:into.input.value})));
    }catch(error){showError(error.message);}
  });
  const open=['new','triaged','question','fixed','reopened'].includes(item.status);
  const closed=['parked','declined'].includes(item.status);
  return el('div',{class:'fb-actions'},
    el('h3',{},'Respond'),
    form([priority.node],'Set priority',()=>act('priority',{priority:priority.input.value})),
    form([el('div',{class:'field'},el('label',{for:'fb-ask'},'Ask a question'),ask)],'Ask a question',async()=>{await act('ask',{body:ask.value});}),
    form([el('div',{class:'field'},el('label',{for:'fb-comment'},'Comment'),comment)],'Comment',async()=>{await act('comment',{body:comment.value});}),
    open?form([fixBuild.node],'Mark fixed in build',()=>{const build=fixBuild.input.value.trim();return act('fix',{build},()=>onFixed(build));}):null,
    el('div',{class:'actions'},
      item.status==='new'?busyButton('Move to the queue',()=>act('triage')):null,
      open?busyButton('Park',()=>act('park',reason.input.value.trim()?{reason:reason.input.value.trim()}:{})):null,
      open?busyButton('Decline',()=>{if(!reason.input.value.trim()){showError('Give a reason to decline this item.');return;}return act('decline',{reason:reason.input.value.trim()});}):null,
      closed?busyButton('Restore',()=>act('restore')):null),
    open?reason.node:null,
    open?mergeBox:null);
}
function itemBody(ctx,detail,repaint,showError,onFixed){
  const item=detail.item,lineText=detail.retired?el('p',{class:'fb-line retired'},'Retired line: this test line is not in the current test content.'):detail.line?el('p',{class:'fb-line'},el('span',{class:'muted'},[detail.line.stageTitle,detail.line.groupTitle].filter(Boolean).join(' / ')),el('br'),detail.line.plain):null;
  const names=(item.reporters||[]).map(r=>r.name+(r.confirmedAt?' (confirmed '+buildLabel(r.confirmedBuild)+')':''));
  const attachmentApi={post:(action,body)=>ctx.api.post(action,{id:body.attachmentId})};
  const byEvent=new Map(),loose=[];
  for(const a of detail.attachments||[]){if(a.eventId)byEvent.set(a.eventId,[...(byEvent.get(a.eventId)||[]),a]);else loose.push(a);}
  const events=(detail.events||[]).map(e=>({kind:e.kind,body:e.kind==='merge'?'Merged into #'+(e.details?.number??'?'):e.body,created_at:e.createdAt,actor_name:e.actor,attachments:byEvent.get(e.id)||[]}));
  const meta=[['Status',statusBadge(item.status,'owner')],['Priority',priorityTag(item.priority)],['Kind',item.kind],['Seen in',buildLabel(item.build_seen)],['Fixed in',item.fixed_in||'Not yet'],['Screen',item.screen||'Not recorded'],['Reported',clock(item.created_at)],['Reporters',names.join(', ')||'None']];
  return el('div',{class:'fb-item'},
    el('dl',{class:'fb-meta'},meta.map(([name,value])=>el('div',{},el('dt',{},name),el('dd',{},value)))),
    item.reason?el('p',{class:'notice'},'Reason: '+item.reason):null,
    lineText,
    el('h3',{},'Thread'),threadView(events,{api:attachmentApi,action:'feedbackAttachmentUrl'}),
    loose.length?el('div',{class:'fb-loose'},loose.map(attachment=>attachmentView({api:attachmentApi,action:'feedbackAttachmentUrl',attachment}))):null,
    actions(ctx,detail,repaint,showError,onFixed));
}
async function openItem(ctx,summary){
  let changed=false;
  const holder=el('div'),feedback=el('div',{'aria-live':'polite'});
  const showError=message=>feedback.replaceChildren(notice(message,'error'));
  async function paint(){
    const detail=await ctx.api.get('feedbackItem',{id:summary.id});
    changed=true;feedback.replaceChildren();
    holder.replaceChildren(itemBody(ctx,detail,paint,showError,fixed));
    return detail;
  }
  // After a fix the dialog closes and the page renders once, with the tester message to copy on top.
  async function fixed(build){
    changed=false;dlg.close();
    await showAfterRender(ctx,()=>fixedNotice(ctx,'Marked #'+summary.number+' fixed in '+build+'.',fixMessage(summary,build,ctx.origin)));
  }
  const dlg=ctx.dialog('#'+summary.number+' '+summary.title,statusLabel(summary.status,'owner')+' · '+summary.kind,el('div',{},holder,feedback));
  dlg.addEventListener('close',()=>{if(changed)ctx.render();});
  try{
    const detail=await paint();changed=false;
    // Only items that need attention are marked seen. Opening an item marks it seen; a refusal here is harmless.
    if(detail.item.owner_attention)ctx.api.post('feedbackAction',{id:detail.item.id,revision:detail.item.revision,action:'seen',data:{}}).then(()=>{changed=true;},()=>{});
  }catch(error){showError(error.message);}
}
// testers is a promise: the inbox draws without waiting for it and the Tester list fills in when it arrives.
function filterForm(ctx,testers,current){
  const tester=selectField('Tester','fb-f-tester',[['','Anyone'],...(current.tester?[[current.tester,'Selected tester']]:[])],current.tester||'');
  testers.then(list=>{const chosen=tester.input.value||current.tester||'';tester.input.replaceChildren(...[['','Anyone'],...list.map(t=>[t.id,t.name])].map(([v,text])=>el('option',{value:v,selected:String(v)===String(chosen)},text)));},()=>{});
  const kind=selectField('Kind','fb-f-kind',[['','Bugs and features'],['bug','Bugs'],['feature','Features']],current.kind||'');
  const status=selectField('Status','fb-f-status',[['','Any status'],[OPEN,'Open'],...['new','triaged','question','fixed','confirmed','reopened','parked','declined','merged'].map(s=>[s,statusLabel(s,'owner')])],current.status||'');
  const priority=selectField('Priority','fb-f-priority',[['','Any priority'],['high','High'],['normal','Normal'],['low','Low']],current.priority||'');
  const build=field('Build','fb-f-build',{value:current.build||'',maxLength:80});
  return el('form',{class:'fb-filters',onsubmit:e=>{
    e.preventDefault();const query=new URLSearchParams();
    for(const [key,input] of [['tester',tester],['kind',kind],['status',status],['priority',priority]])if(input.input.value)query.set(key,input.input.value);
    if(build.input.value.trim())query.set('build',build.input.value.trim());
    ctx.navigate(location.pathname+(query.size?'?'+query:''));
  }},tester.node,kind.node,status.node,priority.node,build.node,el('button',{type:'submit',class:'secondary'},'Filter'),Object.keys(current).length?link('Clear','/admin/feedback/','clear-filters'):null);
}
export async function renderInbox(ctx){
  const current=filterFromSearch(ctx.search),query=new URLSearchParams(ctx.search||'');
  const offset=Math.max(0,Number(query.get('offset'))||0);
  const testers=testerList(ctx),data=await ctx.api.get('feedbackInbox',{...current,...(offset?{offset}:{})});
  head(ctx,'Feedback inbox','Bugs and feature requests from testers, newest attention first.');
  const selected=new Set(),message=el('div',{'aria-live':'polite'}),count=el('span',{class:'muted'},'0 selected');
  const fixBuild=field('Fixed in build','fb-bulk-build',{maxLength:80});
  const fixButton=el('button',{type:'button',class:'primary',onclick:async()=>{
    const done=busy(fixButton,'Marking…');
    try{
      const result=await bulkFix({api:ctx.api,ids:[...selected],build:fixBuild.input.value,origin:ctx.origin});
      await showAfterRender(ctx,()=>fixedNotice(ctx,'Marked '+plural(result.fixed,'item','items')+' fixed in '+result.build+' for '+plural(result.testers||0,'tester','testers')+'.',result.message));
    }catch(error){message.replaceChildren(notice(error.message,'error'));}
    finally{done();}
  }},'Mark fixed');
  const copyButton=el('button',{type:'button',class:'secondary',onclick:async()=>{
    const done=busy(copyButton,'Copying…');
    try{message.replaceChildren(notice(await copyForAi({api:ctx.api,search:ctx.search,clipboard:ctx.clipboard})));}
    catch(error){message.replaceChildren(notice(error.message,'error'));}
    finally{done();}
  }},'Copy for AI');
  const update=()=>{count.textContent=selected.size+' selected';};
  const all=el('input',{type:'checkbox','aria-label':'Select all on this page',onchange:e=>{for(const box of ctx.content.querySelectorAll('.fb-pick')){box.checked=e.target.checked;box.dispatchEvent(new Event('change'));}}});
  const rows=data.items.map(item=>{
    const box=el('input',{type:'checkbox',class:'fb-pick','aria-label':'Select #'+item.number,onchange:e=>{if(e.target.checked)selected.add(item.id);else selected.delete(item.id);update();}});
    return el('tr',{class:item.owner_attention?'attention':''},
      el('td',{},box),el('td',{class:'num'},'#'+item.number),
      el('td',{class:'fb-title'},el('strong',{},item.title),el('small',{class:'table-sub'},[item.kind,(item.reporters||[]).map(r=>r.name).join(', ')].filter(Boolean).join(' · '))),
      el('td',{},statusBadge(item.status,'owner')),el('td',{},priorityTag(item.priority)),
      el('td',{},buildLabel(item.build_seen),item.fixed_in?el('small',{class:'table-sub'},'fixed in '+item.fixed_in):null),
      el('td',{},date(item.updated_at)),
      el('td',{},button('Open',()=>openItem(ctx,item),true)));
  });
  ctx.content.append(el('div',{class:'feedback-admin'},
    filterForm(ctx,testers,current),
    el('div',{class:'fb-toolbar'},copyButton,el('div',{class:'fb-bulk'},count,fixBuild.node,fixButton)),
    message,
    rows.length?el('div',{class:'table-scroll'},el('table',{class:'data-table fb-table'},el('thead',{},el('tr',{},el('th',{scope:'col'},all),['#','Item','Status','Priority','Build','Updated',''].map(h=>el('th',{scope:'col'},h)))),el('tbody',{},rows))):empty('Nothing here','No items match this filter.')));
  if(offset>0||offset+data.items.length<data.total){
    const go=to=>{const q=new URLSearchParams(ctx.search||'');q.set('offset',Math.max(0,to));ctx.navigate(location.pathname+'?'+q);};
    ctx.content.append(el('div',{class:'pagination'},offset>0?button('Previous',()=>go(offset-100),true):null,offset+data.items.length<data.total?button('Next',()=>go(offset+100),true):null));
  }
}
export async function renderProgress(ctx){
  const data=await ctx.api.get('feedbackProgress');
  testerCache={api:ctx.api,at:Date.now(),promise:Promise.resolve(testerNames(data))};
  head(ctx,'Test progress','Per tester and stage, with the last build each tester answered on.');
  const names=new Map((data.testers||[]).map(t=>[t.userId,t.name]));
  const blocks=(data.testers||[]).map(t=>el('section',{class:'section-block'},el('h2',{},t.name),t.stages.length?el('div',{class:'table-scroll'},el('table',{class:'data-table'},el('thead',{},el('tr',{},['Stage','Answered','Pass','Fail','Skip','Last build'].map(h=>el('th',{scope:'col'},h)))),el('tbody',{},t.stages.map(s=>el('tr',{},el('td',{},s.title),el('td',{},s.answered+' of '+s.total),el('td',{},s.pass),el('td',{class:s.fail?'fail-count':''},s.fail),el('td',{},s.skip),el('td',{},buildLabel(s.lastBuild))))))):el('p',{class:'muted'},'No test content uploaded yet.')));
  ctx.content.append(el('div',{class:'feedback-admin'},blocks.length?blocks:empty('No testers yet','Turn on Tester for a member in Users.'),
    el('section',{class:'section-block'},el('h2',{},'Retired answers'),
      (data.retired||[]).length?el('div',{class:'table-scroll'},el('table',{class:'data-table'},el('thead',{},el('tr',{},['Tester','Line','Answer'].map(h=>el('th',{scope:'col'},h)))),el('tbody',{},data.retired.map(r=>el('tr',{},el('td',{},names.get(r.userId)||'Former tester'),el('td',{class:'id-cell'},r.lineId),el('td',{},r.status)))))):el('p',{class:'muted'},'No answers belong to a retired line.'))));
}
async function readJsonFile(input,maxBytes){
  const file=input.files?.[0];
  if(!file)throw new Error('Choose a .json file first.');
  if(file.size>maxBytes)throw new Error('That file is larger than '+maxBytes/1000000+' MB.');
  try{return JSON.parse(await file.text());}catch{throw new Error('That file is not valid JSON.');}
}
export async function renderContent(ctx){
  const [status,testers]=await Promise.all([ctx.api.get('testContentStatus'),testerList(ctx)]);
  head(ctx,'Test content','The test lines testers answer. A new version keeps answers on lines that still exist.');
  const loaded=status.version!=null;
  const upload=el('input',{type:'file',id:'fb-content-file',accept:'.json,application/json'}),uploadMessage=el('div',{'aria-live':'polite'});
  const uploadButton=el('button',{type:'submit',class:'primary'},'Upload test content');
  const uploadForm=el('form',{class:'fb-upload',onsubmit:async e=>{
    e.preventDefault();const done=busy(uploadButton,'Uploading…');
    try{
      const model=await readJsonFile(upload,4000000),result=await ctx.api.post('testContentUpload',model);
      await showAfterRender(ctx,()=>notice('Uploaded version '+result.version+' with '+plural(result.lines,'line','lines')+'. '+result.kept+' answers kept, '+result.retired+' retired.'));
    }catch(error){uploadMessage.replaceChildren(notice(error.message,'error'));}
    finally{done();}
  }},el('div',{class:'field'},el('label',{for:'fb-content-file'},'Test content file (.json)'),upload),uploadButton,uploadMessage);
  const results=el('input',{type:'file',id:'fb-results-file',accept:'.json,application/json'}),importMessage=el('div',{'aria-live':'polite'}),fileTester=el('p',{class:'muted'});
  const member=selectField('Member','fb-import-member',testers.length?testers.map(t=>[t.id,t.name]):[['','No testers yet']],testers[0]?.id||'');
  results.addEventListener('change',async()=>{
    fileTester.textContent='';
    try{const file=await readJsonFile(results,1000000);if(typeof file.tester==='string')fileTester.textContent='This file is for tester id: '+file.tester.slice(0,80);}catch{}
  });
  const importButton=el('button',{type:'submit',class:'primary'},'Import answers');
  const importForm=el('form',{class:'fb-upload',onsubmit:async e=>{
    e.preventDefault();const done=busy(importButton,'Importing…');
    try{
      if(!member.input.value)throw new Error('Mark a member as a tester in Users first.');
      const file=await readJsonFile(results,1000000),result=await ctx.api.post('testImport',{testerId:member.input.value,file});
      importMessage.replaceChildren(notice('Imported '+result.imported+', skipped '+result.skipped+', retired '+result.retired+'; '+plural(result.bugs,'bug','bugs')+' raised.'));
    }catch(error){importMessage.replaceChildren(notice(error.message,'error'));}
    finally{done();}
  }},el('div',{class:'field'},el('label',{for:'fb-results-file'},'Results file (.json)'),results),fileTester,member.node,importButton,importMessage);
  ctx.content.append(el('div',{class:'feedback-admin'},
    el('section',{class:'fb-current'},loaded?el('div',{},el('h2',{},'Version '+status.version),el('p',{class:'muted'},plural(status.lines,'line','lines')+' · uploaded '+clock(status.uploadedAt)+' · '+plural(status.retiredAnswers||0,'retired answer','retired answers'))):el('div',{},el('h2',{},'No test content yet'),el('p',{class:'muted'},'Upload the file from the private test board build.'))),
    el('section',{class:'section-block'},el('h2',{},'Upload test content'),uploadForm),
    el('section',{class:'section-block'},el('h2',{},'Import answers'),el('p',{class:'muted'},'Bring one tester\'s earlier results in under their member account.'),importForm)));
}
