// Loopback-only fixture server for visual QA. No production keys or remote data.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('directions'),port=5190,origin=`http://127.0.0.1:${port}`;
const user={id:'10000000-0000-4000-8000-000000000003',aud:'authenticated',role:'authenticated',email:'preview@quadrion.invalid',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,iss:origin+'/auth/v1',aud:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture-only'].join('.');
const isAdmin=process.argv.includes('--admin');
const member={userId:user.id,role:isAdmin?'owner':'member',tier:isAdmin?null:3,status:'active',expiresAt:null,displayName:'Local preview',company:'Synapse',revision:1,tester:true};
const release={id:'10000000-0000-4000-8000-000000000011',artifact_id:'10000000-0000-4000-8000-000000000012',kind:'app',version:'0.14.0',platform:'windows',minimum_app_version:'',bytes:216000000,sha256:'a'.repeat(64),notes:'Preview data only. No downloadable binary.'};
const projects=['Coastal infrastructure','Industrial facility','Terrain & earthworks'].map((title,i)=>({id:`10000000-0000-4000-8000-00000000002${i}`,title,description:'Local preview of an authorized AIO project in your library.',category:i===1?'oil_gas':'basic',minimum_tier:i===1?3:2,version:'1.0',bytes:(i+12)*1024**3}));
const adminProjects=projects.map(p=>({...p,status:'draft',audience:'assigned',revision:1,versions:[],assignments:[]}));
const adminReleases=[],manualUsers=[],manualCreations=[],uploads=new Map();
// Feedback fixtures: made-up lines and items only (two stages, five lines, three items in different states).
const lineIds=['walk:open-map:0a1b2c3d4e','walk:open-map:1b2c3d4e5f','walk:measure:2c3d4e5f60','report:export-pdf:3d4e5f6071','report:export-pdf:4e5f607182'];
// Tester fixtures in the real shapes of portal_tests_content, portal_tests_answers, portal_feedback_mine and portal_feedback_item.
const testLine=(id,html,plain,sub=[])=>({id,html,plain,sub,subPlain:sub.map(s=>s.replace(/<[^>]+>/g,''))});
const testContent={version:1,title:'Sample test round',unit:'stage',guide:[{html:'<p>Install the latest build, open the <b>sample project</b>, then work down the list. Mark every line.</p>'}],stages:[
  {id:'walk',title:'Stage 1: Getting around',intro:'<p>Made-up preview content.</p>',groups:[
    {title:'Map',items:[testLine(lineIds[0],'Open the sample project and switch to <b>Map</b>','Open the sample project and switch to Map',['<code>Zoom in</code> twice']),testLine(lineIds[1],'Pan the map with the mouse','Pan the map with the mouse')]},
    {title:'Measure',items:[testLine(lineIds[2],'Draw a line between two points','Draw a line between two points',['Read the length'])]}]},
  {id:'report',title:'Stage 2: Reports',groups:[{title:'Export',items:[testLine(lineIds[3],'Export the sample report to PDF','Export the sample report to PDF'),testLine(lineIds[4],'Open the exported PDF','Open the exported PDF')]}]}]};
const testerItem=(n,over)=>({id:`20000000-0000-4000-8000-00000000020${n}`,number:n,kind:'bug',title:'',body:'',line_id:null,build_seen:'0.26.0',screen:'map',priority:'normal',status:'new',merged_into:null,fixed_in:null,reason:null,revision:1,created_at:'2026-10-24T10:05:00Z',updated_at:'2026-10-25T08:00:00Z',mine:true,confirmed:false,waiting:false,...over});
const testerItems=[testerItem(1,{title:'Line length shows zero',status:'fixed',fixed_in:'0.26.1',line_id:lineIds[2],revision:3,waiting:true}),testerItem(2,{title:'Export never finishes on the sample report',status:'question',screen:'report',line_id:lineIds[3],revision:2,waiting:true,updated_at:'2026-10-25T09:00:00Z'}),testerItem(3,{kind:'feature',title:'Remember the last map position',status:'triaged',updated_at:'2026-10-24T12:00:00Z'})];
const testerEvent=(item,n,kind,body,actor,createdAt)=>({id:`50000000-0000-4000-8000-0000000000${item}${n}`,itemId:testerItems[item-1].id,kind,body,details:null,createdAt,actor});
const testerEvents={[testerItems[0].id]:[testerEvent(1,1,'comment','The length shows zero.','you','2026-10-24T10:05:00Z'),testerEvent(1,2,'fixed','Fixed in 0.26.1.','quadrion','2026-10-25T08:00:00Z')],
  [testerItems[1].id]:[testerEvent(2,1,'comment','The export never finishes.','you','2026-10-23T09:00:00Z'),testerEvent(2,2,'question','Which sample report did you use, the short or the long one?','quadrion','2026-10-25T09:00:00Z')],
  [testerItems[2].id]:[testerEvent(3,1,'comment','It would help to reopen the map where I left it.','you','2026-10-24T11:00:00Z')]};
const testerAnswers=[{lineId:lineIds[0],status:'pass',comment:'',build:'0.26.0',updatedAt:'2026-10-24T10:00:00Z',itemId:null},{lineId:lineIds[2],status:'fail',comment:'The length shows zero.',build:'0.26.0',updatedAt:'2026-10-24T10:05:00Z',itemId:testerItems[0].id}];
const testerLine=id=>{for(const s of testContent.stages)for(const g of s.groups)for(const l of g.items)if(l.id===id)return {plain:l.plain,html:l.html,sub:l.subPlain,stageTitle:s.title,groupTitle:g.title};return null;};
const feedbackItems=[
  {id:'20000000-0000-4000-8000-000000000001',number:1,kind:'bug',title:'Line length shows zero',status:'fixed',priority:'high',build:'0.26.0',fixed_in_build:'0.26.1',screen:'map',line_id:lineIds[2],reporter_id:user.id,reporter_name:'Tester One',revision:3,created_at:'2026-10-24T10:05:00Z',updated_at:'2026-10-25T08:00:00Z',confirmed:false},
  {id:'20000000-0000-4000-8000-000000000002',number:2,kind:'feature',title:'Remember the last map position',status:'triaged',priority:'normal',build:'0.26.0',fixed_in_build:null,screen:'map',line_id:null,reporter_id:user.id,reporter_name:'Tester One',revision:2,created_at:'2026-10-24T11:00:00Z',updated_at:'2026-10-24T12:00:00Z',confirmed:false},
  {id:'20000000-0000-4000-8000-000000000003',number:3,kind:'bug',title:'PDF export stalls',status:'question',priority:'normal',build:'unknown',fixed_in_build:null,screen:'report',line_id:lineIds[3],reporter_id:'10000000-0000-4000-8000-000000000041',reporter_name:'Tester Two',revision:2,created_at:'2026-10-23T09:00:00Z',updated_at:'2026-10-25T09:00:00Z',confirmed:false}];
const feedbackEvents={
  [feedbackItems[0].id]:[{id:'30000000-0000-4000-8000-000000000001',kind:'answer',body:'The length shows zero.',actor_name:'Tester One',created_at:'2026-10-24T10:05:00Z'},{id:'30000000-0000-4000-8000-000000000002',kind:'fixed',body:'Fixed in 0.26.1.',actor_name:'Owner',created_at:'2026-10-25T08:00:00Z'}],
  [feedbackItems[1].id]:[{id:'30000000-0000-4000-8000-000000000003',kind:'comment',body:'It would help to reopen the map where I left it.',actor_name:'Tester One',created_at:'2026-10-24T11:00:00Z'}],
  [feedbackItems[2].id]:[{id:'30000000-0000-4000-8000-000000000004',kind:'comment',body:'The export never finishes.',actor_name:'Tester Two',created_at:'2026-10-23T09:00:00Z'},{id:'30000000-0000-4000-8000-000000000005',kind:'question',body:'Which sample report did you use?',actor_name:'Owner',created_at:'2026-10-25T09:00:00Z'}]};
const ownerReporters=[{id:'10000000-0000-4000-8000-000000000041',name:'Tester One',confirmedAt:null,confirmedBuild:null}];
const ownerItem=(n,over)=>({id:`20000000-0000-4000-8000-00000000010${n}`,number:n,kind:'bug',title:'',body:'',line_id:null,build_seen:'0.26.0',screen:'map',priority:'normal',status:'new',merged_into:null,fixed_in:null,reason:null,owner_attention:true,revision:1,created_at:'2026-10-24T10:05:00Z',updated_at:'2026-10-25T08:00:00Z',reporters:ownerReporters,...over});
const ownerItems=[ownerItem(1,{title:'Line length shows zero',priority:'high',status:'reopened',line_id:lineIds[2],revision:3}),ownerItem(2,{kind:'feature',title:'Remember the last map position',status:'triaged',owner_attention:false}),ownerItem(3,{title:'PDF export stalls',status:'new',build_seen:'unknown',screen:'report',reporters:[{id:'10000000-0000-4000-8000-000000000042',name:'Tester Two',confirmedAt:null,confirmedBuild:null}]}),ownerItem(4,{title:'Pan stutters on the sample map',status:'question',owner_attention:false}),ownerItem(5,{title:'Export button label is cut off',status:'fixed',fixed_in:'0.26.1',priority:'low'})];
const ownerEvents={[ownerItems[0].id]:[{id:'40000000-0000-4000-8000-000000000001',itemId:ownerItems[0].id,kind:'comment',body:'The length shows zero after I draw it.',details:null,createdAt:'2026-10-24T10:05:00Z',actor:'Tester One'},{id:'40000000-0000-4000-8000-000000000002',itemId:ownerItems[0].id,kind:'fixed',body:'Fixed in 0.26.1.',details:null,createdAt:'2026-10-25T08:00:00Z',actor:'Local preview'},{id:'40000000-0000-4000-8000-000000000003',itemId:ownerItems[0].id,kind:'reopen',body:'Still zero in 0.26.1.',details:null,createdAt:'2026-10-25T09:00:00Z',actor:'Tester One'}]};
const feedbackCounts=()=>Object.fromEntries(['new','triaged','question','fixed','confirmed','reopened','parked','declined','merged'].map(s=>[s,feedbackItems.filter(i=>i.status===s).length]));
const feedbackDetail=id=>{const item=feedbackItems.find(i=>i.id===id);return item?{item,events:feedbackEvents[id]||[],attachments:[]}:null;};
createServer(async(req,res)=>{
  const respond=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
    if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
    const url=new URL(req.url,origin);
    if(url.pathname==='/api/portal'){
      const action=url.searchParams.get('action');
      if(action==='config')return respond({enabled:true,url:origin,publishableKey:'fixture-publishable-only'});
      if(req.headers.authorization!==`Bearer ${token}`)return respond({message:'Sign in to the local preview.'},401);
      if(action==='me')return respond({member,email:user.email,aal:isAdmin?'aal2':'aal1',requiresMfa:false});
      if(action==='releases')return respond({items:[release,{...release,kind:'pipeline',version:'0.7.0',minimum_app_version:'0.14.0',bytes:470000000}],total:2});
      if(action==='projects')return respond({items:projects.filter(p=>p.title.toLowerCase().includes((url.searchParams.get('search')||'').toLowerCase())),total:projects.length});
      return respond({message:'This action is disabled in the local preview.'},503);
    }
    if(url.pathname==='/api/portal-feedback'){
      if(req.headers.authorization!==`Bearer ${token}`)return respond({message:'Sign in to the local preview.'},401);
      const action=url.searchParams.get('action');let body={};if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);}
      const conflict=()=>respond({error:'conflict',message:'This record changed. Refresh it before saving.'},409);
      if(action==='content')return respond(testContent);
      if(action==='answers')return respond(testerAnswers);
      if(action==='mine')return respond({items:[...testerItems].sort((x,y)=>(y.waiting-x.waiting)||y.updated_at.localeCompare(x.updated_at))});
      if(action==='counts')return respond({waiting:testerItems.filter(i=>i.waiting).length});
      if(action==='item'){const item=testerItems.find(i=>i.id===url.searchParams.get('id'));if(!item)return respond({error:'not_found',message:'This item is unavailable.'},404);const line=item.line_id&&testerLine(item.line_id);return respond({item,line:line||null,retired:Boolean(item.line_id&&!line),events:testerEvents[item.id]||[],attachments:[]});}
      if(action==='answer'){
        if(!lineIds.includes(body.lineId))return conflict();
        if(body.status==='fail'&&!String(body.comment||'').trim())return respond({error:'invalid',message:'Check the submitted fields.'},400);
        const at=testerAnswers.findIndex(x=>x.lineId===body.lineId);
        if(body.status===null){if(at>=0)testerAnswers.splice(at,1);return respond({answer:null,itemId:null});}
        let itemId=at>=0?testerAnswers[at].itemId:null;
        if(body.status==='fail'&&!itemId){const item=testerItem(testerItems.length+1,{title:body.comment.split('\n')[0].slice(0,120),body:body.comment,line_id:body.lineId,build_seen:body.build||'unknown',screen:null});testerItems.push(item);testerEvents[item.id]=[testerEvent(testerItems.length,1,'comment',body.comment,'you',item.created_at)];itemId=item.id;}
        const answer={lineId:body.lineId,status:body.status,comment:body.comment||'',build:body.build||'unknown',updatedAt:new Date().toISOString()};
        if(at<0)testerAnswers.push({...answer,itemId});else testerAnswers[at]={...answer,itemId};return respond({answer,itemId});
      }
      if(action==='create'){
        if(body.lineId&&!lineIds.includes(body.lineId))return conflict();
        const now=new Date().toISOString(),item=testerItem(testerItems.length+1,{kind:body.kind,title:body.title,body:body.body||'',line_id:body.lineId||null,build_seen:body.build||'unknown',screen:body.screen||null,created_at:now,updated_at:now});
        testerItems.push(item);testerEvents[item.id]=[{...testerEvent(testerItems.length,1,'comment',item.body,'you',now)}];return respond(item);
      }
      if(action==='act'){
        const item=testerItems.find(i=>i.id===body.id);if(!item)return respond({error:'not_found',message:'This item is unavailable.'},404);
        if(body.action==='confirm'&&item.confirmed)return respond(item);
        if(body.revision!==item.revision)return conflict();
        if(body.action==='confirm'){if(item.status!=='fixed')return conflict();Object.assign(item,{status:'confirmed',confirmed:true,waiting:false});}
        if(body.action==='reopen'){if(item.status!=='fixed')return conflict();Object.assign(item,{status:'reopened',waiting:false});}
        if(body.action==='answer'){if(item.status!=='question')return conflict();Object.assign(item,{status:'triaged',waiting:false});}
        item.revision++;item.updated_at=new Date().toISOString();testerEvents[item.id].push({id:crypto.randomUUID(),itemId:item.id,kind:body.action,body:body.body||'',details:null,createdAt:item.updated_at,actor:'you'});return respond(item);
      }
      return respond({message:'Attachments are disabled in the local preview.'},503);
    }
    if(url.pathname==='/api/portal-admin'&&isAdmin){
      if(req.headers.authorization!==`Bearer ${token}`)return respond({message:'Sign in to the local preview.'},401);
      const action=url.searchParams.get('action');let body={};if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);}
      if(action==='overview')return respond({members:3,invited:0,projects:0,releases:0,limits:{projectBytes:100000000000,releaseBytes:10000000000}});
      if(action==='users')return respond({items:[{user_id:user.id,email:user.email,role:'owner',tier:null,status:'active',revision:1,tester:false},...[1,2,3].map(tier=>({user_id:`10000000-0000-4000-8000-00000000003${tier}`,email:`tier${tier}@quadrion.invalid`,display_name:`Preview T${tier}`,role:'member',tier,status:'active',revision:1})),...manualUsers],total:4+manualUsers.length,offset:0});
      if(action==='creations')return respond({items:manualCreations});
      if(action==='createUser'){
        // UI fixture only: no Auth account, email or password is persisted.
        if(!body.email?.endsWith('@quadrion.invalid'))return respond({message:'Use a fictional @quadrion.invalid address for this local fixture.'},400);
        const item={user_id:crypto.randomUUID(),email:body.email,role:'member',tier:body.tier,status:'active',expires_at:body.expiresAt,revision:1};manualUsers.push(item);
        const result={id:crypto.randomUUID(),email:body.email,tier:body.tier,status:'created',user_id:item.user_id};manualCreations.unshift(result);return respond(result);
      }
      // Owner feedback fixtures (T12): real response shapes of the owner API.
      if(action==='feedbackInbox'){const q=n=>url.searchParams.get(n)||'';const list=ownerItems.filter(i=>(!q('status')||q('status').split(',').includes(i.status))&&(!q('kind')||i.kind===q('kind'))&&(!q('priority')||i.priority===q('priority'))&&(!q('build')||i.build_seen===q('build')||i.fixed_in===q('build'))&&(!q('tester')||i.reporters.some(r=>r.id===q('tester'))));return respond({items:list,total:list.length,offset:0});}
      if(action==='feedbackCounts')return respond({waiting:0,inbox:ownerItems.filter(i=>i.owner_attention).length});
      if(action==='feedbackItem'){const item=ownerItems.find(i=>i.id===url.searchParams.get('id'));return item?respond({item,line:item.line_id?{plain:'Draw a line between two points',sub:['Read the length'],stageTitle:'Stage 1: Getting around',groupTitle:null}:null,retired:false,events:ownerEvents[item.id]||[],attachments:[]}):respond({message:'Item not found.'},404);}
      if(action==='feedbackProgress')return respond({version:1,testers:[{userId:'10000000-0000-4000-8000-000000000041',name:'Tester One',stages:[{stageId:'walk',title:'Stage 1: Getting around',total:3,answered:2,pass:1,fail:1,skip:0,lastBuild:'0.26.0'},{stageId:'report',title:'Stage 2: Reports',total:2,answered:0,pass:0,fail:0,skip:0,lastBuild:null}]},{userId:'10000000-0000-4000-8000-000000000042',name:'Tester Two',stages:[]}],retired:[{userId:'10000000-0000-4000-8000-000000000041',lineId:'walk:old-line:5f60718293',status:'pass'}]});
      if(action==='testContentStatus')return respond({version:1,lines:lineIds.length,uploadedAt:'2026-10-24T09:00:00Z',testers:[{id:'t1',name:'Tester One'}],retiredAnswers:1});
      if(action==='feedbackAction'){const item=ownerItems.find(i=>i.id===body.id);if(!item)return respond({message:'Item not found.'},404);if(body.revision!==item.revision)return respond({error:'conflict',message:'This item changed. Reload and try again.'},409);if(body.action==='seen'){item.owner_attention=false;return respond(item);}const d=body.data||{};if(body.action==='priority')item.priority=d.priority;if(body.action==='fix'){item.status='fixed';item.fixed_in=d.build;}if(body.action==='triage'||body.action==='restore')item.status='triaged';if(body.action==='park')item.status='parked';if(body.action==='decline'){item.status='declined';item.reason=d.reason;}if(body.action==='ask')item.status='question';item.revision++;if(d.body||body.action==='fix')(ownerEvents[item.id]=ownerEvents[item.id]||[]).push({id:crypto.randomUUID(),itemId:item.id,kind:body.action==='ask'?'question':body.action==='fix'?'fixed':'comment',body:d.body||'Fixed in '+d.build+'.',details:null,createdAt:new Date().toISOString(),actor:'Local preview'});return respond(item);}
      if(action==='feedbackBulkFix'){const hit=ownerItems.filter(i=>body.ids.includes(i.id));for(const i of hit){i.status='fixed';i.fixed_in=body.build;i.revision++;}return respond({fixed:hit.length,build:body.build,bugs:hit.filter(i=>i.kind==='bug').length,features:hit.filter(i=>i.kind==='feature').length,testers:1});}
      if(action==='feedbackExport')return respond({text:'# Quadrion open bugs ('+ownerItems.filter(i=>i.kind==='bug').length+')\n\nPreview fixture text.\n',count:ownerItems.filter(i=>i.kind==='bug').length,expiresIn:86400});
      if(action==='testContentUpload')return respond({version:2,lines:lineIds.length,kept:2,retired:0});
      if(action==='testImport')return respond({imported:4,skipped:1,bugs:1,retired:0});
      if(action==='memberTester')return respond({ok:true});
      if(action==='invitations'||action==='activity')return respond({items:[],total:0,offset:0});
      if(action==='projects')return respond({items:adminProjects,total:adminProjects.length,offset:0});
      if(action==='releases')return respond({items:adminReleases,total:adminReleases.length,offset:0});
      if(action==='release'){const r={...body,id:crypto.randomUUID(),minimum_app_version:body.minimumAppVersion,status:'draft',revision:1,files:[]};adminReleases.push(r);return respond(r);}
      if(action==='project'){let p=adminProjects.find(p=>p.id===body.id);if(!p){p={id:crypto.randomUUID(),status:'draft',revision:1,versions:[],assignments:[]};adminProjects.push(p);}Object.assign(p,body,{minimum_tier:body.minimumTier});return respond(p);}
      if(action==='version'){const v={id:crypto.randomUUID(),version:body.version,notes:body.notes,minimum_app_version:body.minimumAppVersion,files:[]};adminProjects.find(p=>p.id===body.projectId).versions.push(v);return respond(v);}
      if(action==='assignments'){const p=adminProjects.find(p=>p.id===body.projectId);p.assignments=body.assignments;p.revision++;return respond(p);}
      if(action==='upload'){const id=crypto.randomUUID(),file={id:crypto.randomUUID(),filename:body.filename,bytes:body.bytes,sha256:body.sha256,state:'pending',upload_session_id:id,kind:body.kind};const files=body.releaseId?adminReleases.find(r=>r.id===body.releaseId).files:adminProjects.flatMap(p=>p.versions).find(v=>v.id===body.projectVersionId).files;files.push(file);uploads.set(id,{id,artifactId:file.id,bytes:file.bytes,verifiedBytes:0,state:'pending',file});return respond({id,endpoint:origin+'/fixture-tus/'+id,token:'local-fixture',bucket:'fixture',objectPath:id+'/'+body.filename,contentType:'application/octet-stream'});}
      if(action==='finalize'){const s=uploads.get(body.id);s.state='verified';s.verifiedBytes=s.bytes;s.file.state='verified';return respond(s);}
      if(action==='uploadStatus')return respond(uploads.get(body.id));
      if(action==='resumeUpload'){const s=uploads.get(body.id);return respond({id:s.id,endpoint:origin+'/fixture-tus/'+s.id,token:'local-fixture',bucket:'fixture',objectPath:s.id+'/'+s.file.filename,contentType:'application/octet-stream'});}
      if(action==='abandonUpload'){const s=uploads.get(body.id);s.state='cancelled';for(const r of [...adminReleases,...adminProjects.flatMap(p=>p.versions)])r.files=r.files.filter(f=>f.id!==s.file.id);return respond(s);}
      if(action==='publish'||action==='archive'){const item=(body.kind==='project'?adminProjects:adminReleases).find(i=>i.id===body.id);item.status=action==='publish'?'published':body.kind==='project'?'archived':'retired';if(body.versionId)item.current_version_id=body.versionId;item.revision++;return respond(item);}
      return respond({message:'This mutation is disabled in the preview.'},503);
    }
    if(url.pathname.startsWith('/fixture-tus/')){let received=0;for await(const chunk of req)received+=chunk.length;const session=uploads.get(url.pathname.split('/').at(-1));if(session?.file.filename==='slow.aio')await new Promise(r=>setTimeout(r,20000));res.writeHead(req.method==='POST'?201:204,{'Tus-Resumable':'1.0.0',Location:origin+url.pathname,'Upload-Offset':String(received)}).end();return;}
    if(url.pathname==='/auth/v1/token'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);if(body.email!=='preview@quadrion.invalid'||body.password!=='preview-only')return respond({msg:'Use the documented local preview credentials.'},400);return respond({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user});}
    if(url.pathname==='/auth/v1/user')return respond(user);
    if(url.pathname==='/auth/v1/logout')return respond({});
    let path=decodeURIComponent(url.pathname);if(path.startsWith('/portal/'))path='/portal/index.html';if(path.startsWith('/admin/'))path='/admin/index.html';
    const file=resolve(root,'.'+path);if(!file.startsWith(root+sep)||path.split(/[\\/]/).some(p=>p.startsWith('.')))return respond({},404);
    const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{respond({message:'Preview request unavailable.'},404);}
}).listen(port,'127.0.0.1',()=>console.log(`Portal fixture preview: ${origin}/portal/ (preview@quadrion.invalid / preview-only)`));
