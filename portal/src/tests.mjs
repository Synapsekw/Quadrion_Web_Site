import {Upload} from 'tus-js-client';
import {el,button,link,field,heading,empty,notice} from './ui.mjs';
import {statusBadge,buildLabel,prefillFromQuery,buildSuggestions,attachmentKind,threadView} from './feedback-ui.mjs';
// Tester pages: Waiting for you, My tests, My reports, Request a feature, and the report form the app opens.
// Every tester-written or server-sent text goes in as text; only the test content's allowlisted HTML is rebuilt by richText().
export const RETIRED_MESSAGE='This line was changed or retired. Reload the tests.';
const CHANGED_MESSAGE='This report changed in the meantime. Reload to see the latest.';
const BUILD=/^[0-9A-Za-z][0-9A-Za-z._+ -]{0,79}$/,SCREEN=/^[A-Za-z0-9:_-]{1,80}$/;
const BUILD_KEY='quadrion-test-build';
const changed=()=>window.dispatchEvent(new Event('quadrion:feedback-changed'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const validBuild=value=>!value||value==='unknown'||BUILD.test(value);
// Fixed items to re-check come first, then questions; newest first inside each.
export function waitingList(items){
  return (items||[]).filter(i=>i.waiting).sort((a,b)=>(b.status==='fixed')-(a.status==='fixed')||String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
}
// Sends one answer. A fail without a comment and a malformed build never leave the page; a 409 means the line was retired.
export async function sendAnswer(api,{lineId,status,comment='',build=''}){
  const note=String(comment||'').trim(),version=String(build||'').trim();
  if(status==='fail'&&!note)return {ok:false,message:'Say what went wrong before you mark this line failed.'};
  if(note.length>8000)return {ok:false,message:'Keep the comment under 8,000 characters.'};
  if(!validBuild(version))return {ok:false,message:'Enter the build like 0.26.0, as shown in Help > About.'};
  try{return {ok:true,...await api.post('answer',{lineId,status,comment:note,build:version})};}
  catch(error){return error.status===409?{ok:false,conflict:true,message:RETIRED_MESSAGE}:{ok:false,message:error.message};}
}
// The result Save records: the choice being made, else the one already saved; null means nothing was chosen yet.
export const saveStatus=(pending,saved)=>pending||saved||null;
// One-click lines. The tick toggles "works"; unticking a line that still has a comment turns it into a problem.
export const tickStatus=(saved,text)=>saved==='pass'?(String(text||'').trim()?'fail':null):'pass';
// A comment left on a line: ticked or skipped keeps its result with the note; otherwise the comment is a problem.
// Emptying the comment of a reported line clears the answer; undefined means there is nothing to save.
export function commentStatus(saved,text){
  if(saved==='pass'||saved==='skip')return saved;
  if(String(text||'').trim())return 'fail';
  return saved==='fail'?null:undefined;
}
// The step to open: the remembered one, else the first with unchecked lines, else the first.
export function startStep(remembered,stepCounts){
  if(Number.isInteger(remembered)&&remembered>=0&&remembered<stepCounts.length)return remembered;
  const open=stepCounts.findIndex(c=>c.done<c.total);
  return open<0?0:open;
}
// "Stage 3: Measuring" reads as "Measuring" under a "Step 3 of 8" label.
export const stepTitle=stage=>String(stage?.title||'').replace(/^stage\s*\d+\s*[:.\-–]\s*/i,'')||'Untitled step';
const STEP_KEY='quadrion-test-step';
function readStep(){try{const v=sessionStorage.getItem(STEP_KEY);return v===null?null:Number(v);}catch{return null;}}
function keepStep(i){try{sessionStorage.setItem(STEP_KEY,String(i));}catch{}}
// After a save the comment panel closes, unless screenshots were kept back (they only go with a fail).
export const keepDetailOpen=filesLeft=>filesLeft>0;
// Meter segments get their width through the CSSOM: the production CSP (style-src 'self') refuses style attributes.
export function fillMeter(bar,{pass,fail,skip,total}){
  const segment=(cls,n)=>{const node=el('i',{class:cls});node.style.width=total?n/total*100+'%':'0%';return node;};
  bar.replaceChildren(segment('m-pass',pass),segment('m-fail',fail),segment('m-skip',skip));
}
export function answerProblem(result,reload){
  return el('div',{class:'line-problem'},notice(result.message,'error'),result.conflict?button('Reload',reload,true):null);
}
const SAVED_MESSAGE='Saved. The page could not refresh to show it; reload to see the latest.';
// One tester action on a report. A failed post reads as failed (false); once the post is in, the action counts as
// saved (true) even when the refresh after it fails, so a second click cannot trip over the new revision.
export function createAct({api,refresh,reload,currentBuild}){
  return async function act(item,action,body,feedback,after){
    const version=currentBuild();
    try{await api.post('act',{id:item.id,revision:item.revision,action,body,build:validBuild(version)?version:''});}
    catch(error){feedback.replaceChildren(error.status===409?answerProblem({message:CHANGED_MESSAGE,conflict:true},reload):notice(error.message,'error'));return false;}
    try{await refresh();}catch{feedback.replaceChildren(el('div',{class:'line-problem'},notice(SAVED_MESSAGE),button('Reload',reload,true)));return true;}
    after?.();return true;
  };
}
// A note in a report thread: the files upload first, then the comment goes; either one alone is enough.
// When a file fails the comment is held back, so the tester adds the file again and sends both.
export async function sendThreadNote({text,files,upload,comment,refresh}){
  const note=String(text||'').trim();
  if(!note&&!files.length)return {ok:false,message:'Write a comment or attach a file first.'};
  if(files.length&&!await upload(files))return {ok:false,uploadFailed:true};
  return {ok:Boolean(note?await comment(note):await refresh())};
}
// Test content HTML was allowlisted on upload; it is still rebuilt node by node so nothing outside the list reaches the page.
const RICH=new Set(['P','UL','OL','LI','PRE','B','I','CODE','H4','DETAILS','SUMMARY','A']);
function copyRich(node){
  if(node.nodeType===3)return document.createTextNode(node.textContent);
  if(node.nodeType!==1)return null;
  const kids=[...node.childNodes].map(copyRich);
  if(!RICH.has(node.tagName))return kids;
  if(node.tagName==='A'){const href=node.getAttribute('href')||'';return /^https:\/\/[^\s"<>]+$/.test(href)?el('a',{href,target:'_blank',rel:'noreferrer'},kids):kids;}
  return el(node.tagName.toLowerCase(),{},kids);
}
function richText(html,cls='rich'){
  if(!html)return null;
  const doc=new DOMParser().parseFromString('<body>'+html+'</body>','text/html');
  return el('div',{class:cls},[...doc.body.childNodes].map(copyRich));
}
function readBuild(){try{return sessionStorage.getItem(BUILD_KEY)||'';}catch{return '';}}
function keepBuild(value){try{sessionStorage.setItem(BUILD_KEY,value);}catch{}}
function buildField(id,suggestions,value,help){
  const list=id+'-options',f=field('Build',id,{value,maxLength:80,autocomplete:'off',help});
  f.input.setAttribute('list',list);f.input.setAttribute('spellcheck','false');
  f.node.append(el('datalist',{id:list},suggestions.map(v=>el('option',{value:v}))));
  return f;
}
function textArea(label,id,{value='',rows=4,maxLength=16000,required=false,help}={}){
  const input=el('textarea',{id,name:id,rows,maxlength:maxLength,required});input.value=value;
  return {input,node:el('div',{class:'field'},el('label',{for:id},label),input,help?el('small',{},help):null)};
}
// --- Attachments: picked or pasted, checked by attachmentKind, uploaded after the report exists. ---
const EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','application/zip':'zip'};
export function safeFilename(name,mime){
  const base=String(name||'').replace(/\.[^.]*$/,'').replace(/[^a-zA-Z0-9 _().-]+/g,'-').replace(/\.{2,}/g,'.').replace(/^[^a-zA-Z0-9]+/,'').replace(/[\s.]+$/,'').slice(0,120);
  return (base||'attachment')+'.'+EXT[mime];
}
function stamp(){return new Date().toISOString().slice(0,19).replace(/[-:]/g,'').replace('T','-');}
function attachmentPicker(id,label){
  const files=[],list=el('ul',{class:'attach-list'}),message=el('p',{class:'attach-message','aria-live':'polite'});
  const input=el('input',{type:'file',id,class:'sr-only',multiple:true,accept:'.png,.jpg,.jpeg,.webp,.mp4,.webm,.zip',onchange:()=>{[...input.files].forEach(f=>add(f));input.value='';}});
  function draw(){list.replaceChildren(...files.map((f,i)=>el('li',{},el('span',{class:'attach-name'},f.name),el('button',{type:'button',class:'link-button','aria-label':'Remove '+f.name,onclick:()=>{files.splice(i,1);draw();input.focus();}},'Remove'))));}
  function add(file,pasted=false){
    const kind=attachmentKind(file);
    if(!kind.ok){message.textContent=(file.name||'This file')+': '+kind.reason+'. Nothing was attached.';return;}
    if(files.length>=10){message.textContent='Ten files is the most one report can hold.';return;}
    const named=pasted?new File([file],'screenshot-'+stamp()+'.'+EXT[kind.mime],{type:kind.mime}):file;
    files.push(named);message.textContent=named.name+' will upload when you send.';draw();
  }
  // Ctrl+V with a file on the clipboard attaches it; a plain text paste is left alone.
  function onPaste(event){const pasted=[...(event.clipboardData?.files||[])];if(!pasted.length)return;event.preventDefault();pasted.forEach(f=>add(f,true));}
  const node=el('div',{class:'attach'},el('label',{for:id,class:'attach-button'},el('span',{'aria-hidden':'true'},'+'),label),input,el('small',{},'PNG, JPG, WebP, MP4, WebM or ZIP. You can also paste a screenshot with Ctrl+V.'),list,message);
  return {node,files,onPaste,clear(){files.splice(0);draw();message.textContent='';}};
}
function hashFile(file){
  return new Promise((resolve,reject)=>{
    const worker=new Worker('/assets/portal/hash-worker.js',{type:'module'});
    worker.onmessage=({data})=>{if(data.sha256){worker.terminate();resolve(data.sha256);}if(data.error){worker.terminate();reject(new Error(data.error));}};
    worker.onerror=()=>{worker.terminate();reject(new Error('The checksum worker could not start.'));};
    worker.postMessage({file});
  });
}
async function uploadOne(api,itemId,file,say){
  const kind=attachmentKind(file);if(!kind.ok)throw new Error(file.name+': '+kind.reason);
  const filename=safeFilename(file.name,kind.mime);
  say('Preparing '+filename+'…');
  const session=await api.post('attachmentBegin',{itemId,filename,bytes:file.size,sha256:await hashFile(file)});
  try{
    await new Promise((resolve,reject)=>new Upload(file,{endpoint:session.endpoint,headers:{'x-signature':session.token,'x-upsert':'false'},chunkSize:6*1024*1024,uploadDataDuringCreation:true,storeFingerprintForResuming:false,retryDelays:[0,3000,5000,10000],
      metadata:{bucketName:session.bucket,objectName:session.objectPath,contentType:session.contentType,cacheControl:'0'},
      onProgress:(done,total)=>say('Uploading '+filename+' · '+Math.round(done/total*100)+'%'),onError:()=>reject(new Error(filename+' did not upload.')),onSuccess:resolve}).start());
    let state=await api.post('attachmentFinalize',{id:session.id});
    for(let i=0;i<40&&state.state==='verifying';i++){await wait(1500);state=await api.post('attachmentStatus',{id:session.id});}
    if(state.state==='verified'||state.state==='verifying')return;
    throw new Error(filename+' could not be verified.');
  }catch(error){await api.post('attachmentAbandon',{id:session.id}).catch(()=>{});throw error;}
}
// Uploads one after another; a failed file is reported and the rest still go.
async function uploadAll(api,itemId,files,status){
  const say=text=>{status.textContent=text;},failed=[];
  for(const file of files){try{await uploadOne(api,itemId,file,say);}catch(error){failed.push(error.message);}}
  say(failed.length?failed.join(' ')+' Add it again from the report thread.':files.length?(files.length===1?'Attachment':files.length+' attachments')+' added.':'');
  return !failed.length;
}
// attachmentUrl takes {id}; feedback-ui's attachmentView asks with {attachmentId}.
const attachmentApi=api=>({post:(action,body)=>api.post(action,{id:body.attachmentId})});
const ACTORS={you:'You',quadrion:'Quadrion',tester:'Another tester'};
function itemThread(api,detail){
  const byEvent=new Map(),loose=[];
  for(const a of detail.attachments||[])(a.eventId&&byEvent.has(a.eventId)?byEvent.get(a.eventId):a.eventId?byEvent.set(a.eventId,[]).get(a.eventId):loose).push(a);
  const events=(detail.events||[]).map(e=>({...e,created_at:e.createdAt,actor_name:ACTORS[e.actor]||e.actor,attachments:byEvent.get(e.id)||[]}));
  if(events.length&&loose.length)events[0].attachments=[...events[0].attachments,...loose];
  return threadView(events,{api:attachmentApi(api),action:'attachmentUrl'});
}
// Redraws a page in place; a failure shows its message with a way to try again, and focus goes to the new h1.
async function redraw(content,render){
  content.replaceChildren();
  try{await render();}catch(error){content.replaceChildren(notice(error.message,'error'),button('Try again',()=>redraw(content,render),true));}
  content.querySelector('h1')?.focus({preventScroll:true});
}
function notTester(content){content.append(empty('This area is for Quadrion testers.','Testing access is given by Quadrion. Contact info@synapse-solutions.ai if you expected to see your tests here.',link('Overview','/portal/')));}
const itemLabel=item=>'#'+item.number+' '+(item.kind==='feature'?'Feature':'Bug');
// --- The tester page ---
export async function renderTests(ctx){
  const {content,api,member,releases,current}=ctx;
  content.append(heading('TESTING','Tests','Go through the steps in order. Tick each line that works; if something is wrong, write it in its comment field. Anything you report comes back here when it is fixed.'));
  if(!member?.tester){notTester(content);return;}
  const [model,answerRows,mine]=await Promise.all([api.get('content'),api.get('answers'),api.get('mine')]);
  if(!current())return;
  const suggestions=buildSuggestions(releases),answers=new Map((answerRows||[]).map(a=>[a.lineId,a]));
  const reload=()=>redraw(content,()=>renderTests(ctx));
  const waitingBox=el('section',{class:'section-block',id:'waiting','aria-labelledby':'waiting-title'}),reportsBox=el('section',{class:'section-block',id:'reports','aria-labelledby':'reports-title'});
  let items=mine.items||[];
  const build=buildField('test-build',suggestions,readBuild()||suggestions[0]||'','The version you are testing, from Help > About.');
  build.input.addEventListener('change',()=>keepBuild(build.input.value.trim()));
  const currentBuild=()=>build.input.value.trim();
  async function refresh(){const next=await api.get('mine');items=next.items||[];fillWaiting();fillReports();changed();}
  const act=createAct({api,refresh,reload,currentBuild});
  function fillWaiting(){
    const list=waitingList(items);
    waitingBox.replaceChildren(el('div',{class:'section-title'},el('h2',{id:'waiting-title'},'Waiting for you'),el('span',{class:'count'},String(list.length))));
    if(!list.length){waitingBox.append(el('p',{class:'muted quiet'},'Nothing to re-check right now.'));return;}
    waitingBox.append(el('div',{class:'waiting-list'},list.map(waitingRow)));
  }
  function waitingRow(item){
    const feedback=el('div',{'aria-live':'polite'}),row=el('article',{class:'waiting-row'});
    const head=el('div',{class:'waiting-head'},el('span',{class:'item-number'},itemLabel(item)),el('h3',{},item.title),statusBadge(item.status));
    if(item.status==='fixed'){
      const reason=textArea('What still goes wrong?','sendback-'+item.id,{rows:1}),back=el('form',{class:'inline-form',hidden:true,onsubmit:async e=>{e.preventDefault();const text=reason.input.value.trim();if(!text){feedback.replaceChildren(notice('Say what still goes wrong so it can be fixed.','error'));reason.input.focus();return;}send.disabled=true;if(!await act(item,'reopen',text,feedback))send.disabled=false;}},reason.node);
      const send=el('button',{type:'submit',class:'primary'},'Send back');back.append(el('div',{class:'actions'},send,button('Cancel',()=>{back.hidden=true;open.hidden=false;open.focus();},true)));
      const confirm=button('Confirm it works',async e=>{e.currentTarget.disabled=true;const target=e.currentTarget;if(!await act(item,'confirm','',feedback))target.disabled=false;});
      const open=button('Send back',()=>{back.hidden=false;open.hidden=true;reason.input.focus();},true);
      row.append(head,el('p',{class:'muted'},'Fixed in ',el('strong',{},buildLabel(item.fixed_in)),'. Check it on that build or a later one.'),el('div',{class:'actions'},confirm,open),back,feedback);
    }else{
      const question=el('div',{class:'question-text'},el('span',{class:'muted'},'Loading the question…'));
      api.get('item',{id:item.id}).then(detail=>{const asked=[...(detail.events||[])].reverse().find(e=>e.kind==='question');question.replaceChildren(el('span',{class:'eyebrow'},'QUADRION ASKS'),el('p',{class:'preserve'},asked?.body||'Open the report below to see the question.'));}).catch(()=>question.replaceChildren(el('p',{class:'muted'},'The question could not be loaded. It is in the report thread below.')));
      const reply=textArea('Your answer','answer-'+item.id,{rows:1});
      const form=el('form',{class:'inline-form',onsubmit:async e=>{e.preventDefault();const text=reply.input.value.trim();if(!text){feedback.replaceChildren(notice('Write an answer first.','error'));reply.input.focus();return;}const submit=e.target.querySelector('button[type=submit]');submit.disabled=true;if(!await act(item,'answer',text,feedback))submit.disabled=false;}},reply.node,el('div',{class:'actions'},el('button',{type:'submit',class:'primary'},'Send answer')));
      row.append(head,question,form,feedback);
    }
    return row;
  }
  function fillReports(){
    reportsBox.replaceChildren(el('div',{class:'section-title'},el('h2',{id:'reports-title'},'My reports'),el('span',{class:'count'},String(items.length))));
    if(!items.length){reportsBox.append(el('p',{class:'muted quiet'},'Your bug reports and feature requests will appear here.'));return;}
    reportsBox.append(el('div',{class:'report-list'},items.map(reportRow)));
  }
  function reportRow(item){
    const body=el('div',{class:'report-body'},el('p',{class:'muted'},'Loading the thread…'));let loaded=false;
    const details=el('details',{class:'report',id:'item-'+item.id,ontoggle:()=>{if(details.open&&!loaded){loaded=true;loadThread();}}},
      el('summary',{},el('span',{class:'item-number'},itemLabel(item)),el('span',{class:'report-title'},item.title),statusBadge(item.status),el('span',{class:'report-build'},buildLabel(item.build_seen))),body);
    async function loadThread(){
      try{
        const detail=await api.get('item',{id:item.id}),feedback=el('div',{'aria-live':'polite'});
        const parts=[detail.retired?el('p',{class:'muted'},'This test line was retired.'):detail.line?el('p',{class:'muted'},'Test line: ',detail.line.plain||''):null,itemThread(api,detail)];
        if(item.status!=='merged'){
          // Also the way back in for an attachment that failed, such as the diagnostics ZIP from the app's report form.
          const note=textArea('Add a comment','comment-'+item.id,{rows:3}),picker=attachmentPicker('thread-attach-'+item.id,'Attach a file'),status=el('p',{class:'muted','aria-live':'polite'});
          const reopen=()=>document.getElementById('item-'+item.id)?.setAttribute('open','');
          parts.push(el('form',{class:'inline-form',onpaste:e=>picker.onPaste(e),onsubmit:async e=>{
            e.preventDefault();feedback.replaceChildren();const submit=e.target.querySelector('button[type=submit]');submit.disabled=true;
            const result=await sendThreadNote({text:note.input.value,files:[...picker.files],
              upload:async files=>{const ok=await uploadAll(api,item.id,files,status);picker.clear();return ok;},
              comment:text=>act({...item,revision:detail.item?.revision??item.revision},'comment',text,feedback,reopen),
              refresh:async()=>{try{await refresh();reopen();return true;}catch{feedback.replaceChildren(el('div',{class:'line-problem'},notice('Added. The page could not refresh to show it; reload to see the latest.'),button('Reload',reload,true)));return true;}}});
            if(result.message)feedback.replaceChildren(notice(result.message,'error'));
            if(!result.ok)submit.disabled=false;
          }},note.node,picker.node,status,el('div',{class:'actions'},el('button',{type:'submit',class:'secondary'},'Send'))));
        }else parts.push(el('p',{class:'muted'},'This report was merged into another one that covers the same problem.'));
        body.replaceChildren(...parts.filter(Boolean),feedback);
      }catch(error){loaded=false;body.replaceChildren(notice(error.message,'error'));}
    }
    return details;
  }
  // My tests: one step per stage, one step open at a time, a rail to move between them.
  // Each line is a tick (works) plus a comment field. A comment on a line that is not ticked goes in as a problem
  // (a fail with that comment, which opens a bug as before); ticked plus a comment is a pass with a note.
  const testsBox=el('section',{class:'section-block',id:'tests','aria-labelledby':'tests-title'},el('div',{class:'section-title'},el('h2',{id:'tests-title'},'My tests')));
  function counts(lines){let pass=0,fail=0,skip=0;for(const l of lines){const s=answers.get(l.id)?.status;if(s==='pass')pass++;else if(s==='fail')fail++;else if(s==='skip')skip++;}return {pass,fail,skip,total:lines.length,done:pass+fail+skip};}
  const plural=(n,one,many)=>n+' '+(n===1?one:many);
  let openMenu=null,onTally=()=>{};
  function closeMenu(focus=false){if(!openMenu)return;const m=openMenu;openMenu=null;m.menu.hidden=true;m.toggle.setAttribute('aria-expanded','false');if(focus)m.toggle.focus();}
  document.addEventListener('click',e=>{if(openMenu&&!openMenu.wrap.contains(e.target))closeMenu();});
  function lineRow(line){
    const id=line.id.replace(/[^a-z0-9-]/g,'-'),saved=()=>answers.get(line.id),about=line.plain||'this line';
    const feedback=el('div',{class:'line-feedback','aria-live':'polite'}),state=el('p',{class:'line-state','aria-live':'polite'});
    const note=el('textarea',{id:'note-'+id,class:'line-note',rows:1,maxlength:8000,placeholder:'Something wrong? Write it here','aria-label':'Comment on: '+about});
    note.value=saved()?.comment||'';
    const picker=attachmentPicker('attach-'+id,'Attach a screenshot');
    const tick=el('button',{type:'button',class:'tick','aria-pressed':'false','aria-label':'Works: '+about,onclick:()=>save(tickStatus(saved()?.status,note.value))});
    const toggle=el('button',{type:'button',class:'line-more','aria-haspopup':'true','aria-expanded':'false','aria-label':'More for this line'},el('span',{'aria-hidden':'true'},'⋯'));
    const featureForm=featureRequest({lineId:line.id,idPrefix:'line-'+id,compact:true});featureForm.hidden=true;
    const pick=fn=>()=>{closeMenu();fn();};
    const skipItem=el('button',{type:'button',role:'menuitem',onclick:pick(()=>save(saved()?.status==='skip'?null:'skip'))});
    const clearItem=el('button',{type:'button',role:'menuitem',onclick:pick(()=>save(null))},'Clear my answer');
    const menuItems=[skipItem,
      el('button',{type:'button',role:'menuitem',onclick:pick(()=>picker.node.querySelector('input[type=file]').click())},'Attach a screenshot'),
      el('button',{type:'button',role:'menuitem',onclick:pick(()=>{featureForm.hidden=!featureForm.hidden;if(!featureForm.hidden)featureForm.querySelector('input')?.focus();})},'Request a feature about this'),
      clearItem];
    const menu=el('div',{class:'line-menu',role:'menu','aria-label':'More for this line',hidden:true,onkeydown:e=>{
      const shown=menuItems.filter(b=>!b.hidden),at=shown.indexOf(document.activeElement);
      if(e.key==='Escape'){e.preventDefault();closeMenu(true);}
      else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();shown[(at+(e.key==='ArrowDown'?1:shown.length-1))%shown.length]?.focus();}
      else if(e.key==='Tab')closeMenu();
    }},menuItems);
    const wrap=el('div',{class:'line-menu-wrap'},toggle,menu);
    toggle.addEventListener('click',()=>{const was=openMenu?.menu===menu;closeMenu();if(was)return;draw();menu.hidden=false;toggle.setAttribute('aria-expanded','true');openMenu={menu,toggle,wrap};menuItems.find(b=>!b.hidden)?.focus();});
    const row=el('li',{class:'test-line'},tick,
      el('div',{class:'line-main'},el('div',{class:'line-text'},richText(line.html),line.sub?.length?el('ul',{class:'line-sub'},line.sub.map(s=>el('li',{},richText(s,'rich inline')))):null),
        el('div',{class:'line-entry'},note,state),el('div',{class:'line-files'},picker.node),feedback,featureForm),wrap);
    let busy=false;
    function draw(){
      const a=saved(),status=a?.status||null,text=note.value.trim(),draft=text!==(a?.comment||'').trim();
      const problem=draft&&text&&status!=='pass'&&status!=='skip';
      row.dataset.state=status||'open';
      if(problem)row.dataset.draft='problem';else delete row.dataset.draft;
      tick.setAttribute('aria-pressed',String(status==='pass'));
      tick.title=status==='pass'?'Works. Click again to undo.':'Click if this works';
      note.placeholder=status==='pass'||status==='skip'?'Add a note':'Something wrong? Write it here';
      skipItem.textContent=status==='skip'?'Undo skip':'Skip this line';
      clearItem.hidden=!a;
      if(busy)return;
      const linked=a?.itemId&&items.find(i=>i.id===a.itemId),on=a?' · '+buildLabel(a.build):'';
      state.replaceChildren(...[(problem?[el('span',{class:'tone-fail'},'Goes in as a problem when you leave the field.'),' Tick the circle first if it works and this is only a note.']
        :draft&&text?['Your note saves when you leave the field.']
        :draft&&status==='fail'?['Leave it empty to clear this answer.']
        :status==='pass'?[el('span',{class:'tone-pass'},text?'Works, with a note':'Works'),on]
        :status==='fail'?[el('span',{class:'tone-fail'},'Reported'),linked?[' as ',link(itemLabel(linked),'#item-'+linked.id,'line-report')]:' as a problem',on]
        :status==='skip'?['Skipped',on]:[])].flat(2));
    }
    async function save(status){
      if(busy)return;busy=true;feedback.replaceChildren();row.classList.add('saving');state.replaceChildren('Saving…');
      const result=await sendAnswer(api,{lineId:line.id,status,comment:status===null?'':note.value,build:currentBuild()});
      busy=false;row.classList.remove('saving');
      if(!result.ok){feedback.replaceChildren(answerProblem(result,reload));draw();if(status==='fail'&&!result.conflict)note.focus();return;}
      if(result.answer)answers.set(line.id,{...result.answer,itemId:result.itemId});else answers.delete(line.id);
      if(status===null)note.value='';
      keepBuild(currentBuild());
      if(picker.files.length&&result.itemId&&status==='fail'){const upload=el('p',{class:'muted','aria-live':'polite'});feedback.replaceChildren(upload);await uploadAll(api,result.itemId,[...picker.files],upload);picker.clear();}
      else if(picker.files.length&&status!=='fail')feedback.replaceChildren(notice('Screenshots go with a problem. They were kept here; untick the line and say what went wrong to send them.'));
      draw();onTally();
      if(status==='fail'||result.itemId){await refresh().catch(()=>{});draw();}
    }
    function commit(){const a=saved(),text=note.value.trim();if(text===(a?.comment||'').trim())return;const next=commentStatus(a?.status,text);if(next!==undefined)save(next);}
    note.addEventListener('change',commit);
    note.addEventListener('input',draw);
    note.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();note.blur();}});
    note.addEventListener('paste',e=>picker.onPaste(e));
    draw();return row;
  }
  function featureRequest({lineId=null,idPrefix,compact=false}){
    const title=field('Title',idPrefix+'-feature-title',{required:true,maxLength:200}),body=textArea('What should it do?',idPrefix+'-feature-body',{rows:compact?3:5});
    const picker=attachmentPicker(idPrefix+'-feature-attach','Attach a file'),feedback=el('div',{'aria-live':'polite'}),submit=el('button',{type:'submit',class:compact?'secondary':'primary'},'Send request');
    const form=el('form',{class:compact?'inline-form feature-inline':'feature-form',onpaste:e=>picker.onPaste(e),onsubmit:async e=>{
      e.preventDefault();feedback.replaceChildren();
      if(!title.input.value.trim()){feedback.replaceChildren(notice('Give the request a short title.','error'));title.input.focus();return;}
      submit.disabled=true;
      try{
        const version=currentBuild(),item=await api.post('create',{kind:'feature',title:title.input.value.trim(),body:body.input.value.trim(),...(lineId?{lineId}:{}),build:validBuild(version)?version:''});
        const upload=el('p',{class:'muted'});feedback.replaceChildren(upload);
        if(picker.files.length)await uploadAll(api,item.id,[...picker.files],upload);
        feedback.prepend(notice('Thanks. Feature request #'+item.number+' is in.'));title.input.value='';body.input.value='';picker.clear();await refresh();
      }catch(error){feedback.replaceChildren(error.status===409?answerProblem({message:RETIRED_MESSAGE,conflict:true},reload):notice(error.message,'error'));}
      finally{submit.disabled=false;}
    }},compact?el('p',{class:'eyebrow'},'REQUEST A FEATURE ABOUT THIS LINE'):null,title.node,body.node,picker.node,el('div',{class:'actions'},submit,compact?button('Close',()=>{form.hidden=true;},true):null),feedback);
    return form;
  }
  if(!model?.version||!model.stages?.length)testsBox.append(empty('No tests yet','The next test round will appear here when it is ready.'));
  else{
    testsBox.querySelector('.section-title').append(el('div',{class:'build-bar'},build.node));
    if(model.guide?.length)testsBox.append(el('details',{class:'guide'},el('summary',{},'How to test'),model.guide.map(g=>el('div',{class:'guide-part'},typeof g.title==='string'&&g.title?el('h3',{},g.title):null,richText(g.html)))));
    const steps=model.stages,stepLines=steps.map(s=>(s.groups||[]).flatMap(g=>g.items||[])),allLines=stepLines.flat();
    let current=startStep(readStep(),stepLines.map(counts));
    const overallBar=el('span',{class:'meter','aria-hidden':'true'}),overallText=el('span',{class:'overall-text'});
    const railItems=steps.map((s,i)=>{
      const bar=el('span',{class:'meter','aria-hidden':'true'}),num=el('span',{class:'rail-num','aria-hidden':'true'}),meta=el('span',{class:'rail-meta'});
      const go_=el('button',{type:'button',class:'rail-step',onclick:()=>go(i)},num,el('span',{class:'rail-body'},el('span',{class:'rail-title'},el('span',{class:'sr-only'},'Step '+(i+1)+': '),stepTitle(s)),el('span',{class:'rail-progress'},bar,meta)));
      return {node:el('li',{},go_),button:go_,update(){
        const c=counts(stepLines[i]),done=c.total>0&&c.done===c.total;fillMeter(bar,c);
        meta.textContent=c.done+'/'+c.total+(c.fail?' · '+c.fail+' reported':'');
        num.textContent=done?'✓':String(i+1);go_.dataset.done=String(done);
        if(i===current)go_.setAttribute('aria-current','step');else go_.removeAttribute('aria-current');
      }};
    });
    const rail=el('nav',{class:'rail','aria-label':'Test steps'},el('div',{class:'overall'},overallText,overallBar),el('ol',{class:'rail-steps'},railItems.map(r=>r.node)));
    const panel=el('section',{class:'step','aria-labelledby':'step-title'});
    let stepUpdate=()=>{};
    onTally=()=>{const c=counts(allLines);fillMeter(overallBar,c);overallText.textContent=c.done+' of '+c.total+' checked'+(c.fail?' · '+c.fail+' reported':'');railItems.forEach(r=>r.update());stepUpdate();};
    function renderStep(focus){
      const s=steps[current],lines=stepLines[current],count=el('p',{class:'step-count'}),left=el('p',{class:'step-left'});
      const title=el('h2',{id:'step-title',tabindex:'-1'},stepTitle(s));
      stepUpdate=()=>{const c=counts(lines),open=c.total-c.done;count.textContent=c.done+' of '+c.total+' checked'+(c.fail?' · '+c.fail+' reported':'');
        left.textContent=open?plural(open,'line','lines')+' in this step '+(open===1?'is':'are')+' not checked yet. You can come back to '+(open===1?'it':'them')+' later.':'Every line in this step is checked.';};
      const nextStep=current<steps.length-1?el('button',{type:'button',class:'primary next-step',onclick:()=>go(current+1)},'Next step: '+stepTitle(steps[current+1]),el('span',{'aria-hidden':'true'},' →')):null;
      panel.replaceChildren(el('header',{class:'step-head'},el('p',{class:'eyebrow'},'STEP '+(current+1)+' OF '+steps.length),title,count),richText(s.intro,'rich stage-intro'),
        ...(s.groups||[]).map(g=>el('section',{class:'group'},el('div',{class:'group-head'},el('h3',{},g.title||'Checks'),el('span',{class:'count'},plural((g.items||[]).length,'line','lines'))),richText(g.notes,'rich group-notes'),el('ol',{class:'test-lines'},(g.items||[]).map(lineRow)))),
        el('footer',{class:'step-foot'},left,el('div',{class:'actions'},current>0?button('Previous step',()=>go(current-1),true):null,nextStep||el('p',{class:'step-end'},'This is the last step. Thank you for going all the way through.'))));
      onTally();
      if(focus){panel.scrollIntoView({block:'start'});title.focus({preventScroll:true});const b=railItems[current].button,list=b.closest('.rail-steps');if(list&&list.scrollWidth>list.clientWidth)list.scrollLeft=b.parentElement.offsetLeft-list.offsetLeft-16;}
    }
    function go(i){closeMenu();current=i;keepStep(i);renderStep(true);}
    testsBox.append(el('div',{class:'journey'},rail,panel));
    renderStep(false);
  }
  const featureBox=el('section',{class:'section-block',id:'feature','aria-labelledby':'feature-title'},el('div',{class:'section-title'},el('h2',{id:'feature-title'},'Request a feature')),el('p',{class:'muted quiet'},'Something you wish the app did? Describe it here.'),featureRequest({idPrefix:'page'}));
  fillWaiting();fillReports();
  const waiting=waitingList(items).length;
  content.append(el('nav',{class:'tests-jump','aria-label':'On this page'},link('Waiting for you'+(waiting?' ('+waiting+')':''),'#waiting'),link('My tests','#tests'),link('My reports','#reports'),link('Request a feature','#feature'),link('Report a problem','/portal/report/')),waitingBox,testsBox,reportsBox,featureBox);
}
// --- The report form the app's "Report a problem" dialog opens ---
export async function renderReport(ctx){
  const {content,api,member,releases}=ctx;
  content.append(heading('REPORT A PROBLEM','Report a problem','Tell us what went wrong. Attach the diagnostics file the app saved, or a screenshot.'));
  if(!member?.tester){notTester(content);return;}
  const prefill=prefillFromQuery(location.search),suggestions=buildSuggestions(releases);
  const build=buildField('report-build',suggestions,prefill.build||readBuild()||suggestions[0]||'',prefill.build?'Filled in by the app.':'The version you were using, from Help > About.');
  const screen=field('Screen','report-screen',{value:prefill.screen,maxLength:80,autocomplete:'off',help:prefill.screen?'Filled in by the app.':'Optional. Where in the app it happened.'});
  const title=field('Title','report-title',{required:true,maxLength:200,help:'One line, like “Map stays blank after switching projects”.'});
  const what=textArea('What happened?','report-what',{rows:5,required:true}),steps=textArea('Steps to reproduce','report-steps',{rows:4,help:'Optional. What you clicked, in order.'});
  const picker=attachmentPicker('report-attach','Attach the diagnostics ZIP or a screenshot'),feedback=el('div',{'aria-live':'polite'}),submit=el('button',{type:'submit',class:'primary'},'Send report');
  const form=el('form',{class:'report-form',onpaste:e=>picker.onPaste(e),onsubmit:async e=>{
    e.preventDefault();feedback.replaceChildren();
    const version=build.input.value.trim(),where=screen.input.value.trim(),body=what.input.value.trim()+(steps.input.value.trim()?'\n\nSteps to reproduce:\n'+steps.input.value.trim():'');
    const problem=!title.input.value.trim()?[title,'Give the report a short title.']:!what.input.value.trim()?[what,'Say what happened.']:!validBuild(version)?[build,'Enter the build like 0.26.0, as shown in Help > About.']:where&&!SCREEN.test(where)?[screen,'Use letters, numbers, colons, dashes or underscores for the screen.']:body.length>16000?[what,'Keep the description under 16,000 characters.']:null;
    if(problem){feedback.replaceChildren(notice(problem[1],'error'));problem[0].input.focus();return;}
    submit.disabled=true;
    try{
      const item=await api.post('create',{kind:'bug',title:title.input.value.trim(),body,build:version,...(where?{screen:where}:{})});
      keepBuild(version);changed();
      const upload=el('p',{class:'muted','aria-live':'polite'});form.replaceChildren(upload);
      const ok=!picker.files.length||await uploadAll(api,item.id,[...picker.files],upload);
      const done=el('section',{class:'report-done',tabindex:'-1'},el('span',{class:'eyebrow'},'REPORT SENT'),el('h2',{},'Thanks. Report #'+item.number+' is in.'),el('p',{class:'muted'},ok?'You will see replies and fixes under My reports on your Tests page.':'The report is in, but an attachment did not make it. Add it from the report thread.'),upload,
        el('div',{class:'actions'},link('Go to my reports','/portal/tests/#reports','button-link'),button('Report another problem',()=>redraw(content,()=>renderReport(ctx)),true)));
      form.replaceWith(done);done.focus();
    }catch(error){feedback.replaceChildren(notice(error.message,'error'));submit.disabled=false;}
  }},el('div',{class:'form-pair'},build.node,screen.node),title.node,what.node,steps.node,picker.node,el('div',{class:'actions'},submit),feedback);
  content.append(form);
}
