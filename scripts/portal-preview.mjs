// Loopback-only fixture server for visual QA. No production keys or remote data.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('directions'),port=5190,origin=`http://127.0.0.1:${port}`;
const user={id:'10000000-0000-4000-8000-000000000003',aud:'authenticated',role:'authenticated',email:'preview@quadrion.invalid',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,iss:origin+'/auth/v1',aud:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture-only'].join('.');
const isAdmin=process.argv.includes('--admin');
const member={userId:user.id,role:isAdmin?'owner':'member',tier:isAdmin?null:3,status:'active',expiresAt:null,displayName:'Local preview',company:'Synapse',revision:1};
const release={id:'10000000-0000-4000-8000-000000000011',artifact_id:'10000000-0000-4000-8000-000000000012',kind:'app',version:'0.14.0',platform:'windows',minimum_app_version:'',bytes:216000000,sha256:'a'.repeat(64),notes:'Preview data only. No downloadable binary.'};
const projects=['Coastal infrastructure','Industrial facility','Terrain & earthworks'].map((title,i)=>({id:`10000000-0000-4000-8000-00000000002${i}`,title,description:'Local preview of an authorized AIO project in your library.',category:i===1?'oil_gas':'basic',minimum_tier:i===1?3:2,version:'1.0',bytes:(i+12)*1024**3}));
const adminProjects=projects.map(p=>({...p,status:'draft',audience:'assigned',revision:1,versions:[],assignments:[]}));
const adminReleases=[],manualUsers=[],manualCreations=[],uploads=new Map();
// Feedback fixtures: made-up lines and items only (two stages, five lines, three items in different states).
const lineIds=['walk:open-map:0a1b2c3d4e','walk:open-map:1b2c3d4e5f','walk:measure:2c3d4e5f60','report:export-pdf:3d4e5f6071','report:export-pdf:4e5f607182'];
const testContent={version:1,title:'Sample test round',guide:'Made-up preview content.',stages:[
  {id:'walk',title:'Stage 1: Getting around',lines:[
    {id:lineIds[0],html:'Open the sample project and switch to <b>Map</b>',sub:['<code>Zoom in</code> twice'],plain:'Open the sample project and switch to Map',subPlain:['`Zoom in` twice']},
    {id:lineIds[1],html:'Pan the map with the mouse',sub:[],plain:'Pan the map with the mouse',subPlain:[]},
    {id:lineIds[2],html:'Draw a line between two points',sub:['Read the length'],plain:'Draw a line between two points',subPlain:['Read the length']}]},
  {id:'report',title:'Stage 2: Reports',lines:[
    {id:lineIds[3],html:'Export the sample report to PDF',sub:[],plain:'Export the sample report to PDF',subPlain:[]},
    {id:lineIds[4],html:'Open the exported PDF',sub:[],plain:'Open the exported PDF',subPlain:[]}]}]};
const feedbackAnswers=[{line_id:lineIds[0],status:'pass',comment:'',build:'0.26.0',updated_at:'2026-10-24T10:00:00Z'},{line_id:lineIds[2],status:'fail',comment:'The length shows zero.',build:'0.26.0',updated_at:'2026-10-24T10:05:00Z'}];
const feedbackItems=[
  {id:'20000000-0000-4000-8000-000000000001',number:1,kind:'bug',title:'Line length shows zero',status:'fixed',priority:'high',build:'0.26.0',fixed_in_build:'0.26.1',screen:'map',line_id:lineIds[2],reporter_id:user.id,reporter_name:'Tester One',revision:3,created_at:'2026-10-24T10:05:00Z',updated_at:'2026-10-25T08:00:00Z',confirmed:false},
  {id:'20000000-0000-4000-8000-000000000002',number:2,kind:'feature',title:'Remember the last map position',status:'triaged',priority:'normal',build:'0.26.0',fixed_in_build:null,screen:'map',line_id:null,reporter_id:user.id,reporter_name:'Tester One',revision:2,created_at:'2026-10-24T11:00:00Z',updated_at:'2026-10-24T12:00:00Z',confirmed:false},
  {id:'20000000-0000-4000-8000-000000000003',number:3,kind:'bug',title:'PDF export stalls',status:'question',priority:'normal',build:'unknown',fixed_in_build:null,screen:'report',line_id:lineIds[3],reporter_id:'10000000-0000-4000-8000-000000000041',reporter_name:'Tester Two',revision:2,created_at:'2026-10-23T09:00:00Z',updated_at:'2026-10-25T09:00:00Z',confirmed:false}];
const feedbackEvents={
  [feedbackItems[0].id]:[{id:'30000000-0000-4000-8000-000000000001',kind:'answer',body:'The length shows zero.',actor_name:'Tester One',created_at:'2026-10-24T10:05:00Z'},{id:'30000000-0000-4000-8000-000000000002',kind:'fixed',body:'Fixed in 0.26.1.',actor_name:'Owner',created_at:'2026-10-25T08:00:00Z'}],
  [feedbackItems[1].id]:[{id:'30000000-0000-4000-8000-000000000003',kind:'comment',body:'It would help to reopen the map where I left it.',actor_name:'Tester One',created_at:'2026-10-24T11:00:00Z'}],
  [feedbackItems[2].id]:[{id:'30000000-0000-4000-8000-000000000004',kind:'comment',body:'The export never finishes.',actor_name:'Tester Two',created_at:'2026-10-23T09:00:00Z'},{id:'30000000-0000-4000-8000-000000000005',kind:'question',body:'Which sample report did you use?',actor_name:'Owner',created_at:'2026-10-25T09:00:00Z'}]};
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
      if(action==='content')return respond({content:testContent,version:testContent.version});
      if(action==='answers')return respond({items:feedbackAnswers});
      if(action==='mine'){const mine=feedbackItems.filter(i=>i.reporter_id===user.id);return respond({items:mine,total:mine.length});}
      if(action==='counts')return respond(feedbackCounts());
      if(action==='item'){const detail=feedbackDetail(body.itemId||url.searchParams.get('itemId'));return detail?respond(detail):respond({message:'Item not found.'},404);}
      if(action==='answer'){
        if(!lineIds.includes(body.lineId))return respond({error:'conflict',message:'This line was retired. Reload the page.'},409);
        if(body.status==='fail'&&!String(body.comment||'').trim())return respond({message:'A failed line needs a comment.'},400);
        const answer={line_id:body.lineId,status:body.status,comment:body.comment||'',build:body.build||'unknown',updated_at:new Date().toISOString()};
        const at=feedbackAnswers.findIndex(a=>a.line_id===body.lineId);if(at<0)feedbackAnswers.push(answer);else feedbackAnswers[at]=answer;return respond(answer);
      }
      if(action==='create'){
        const item={id:crypto.randomUUID(),number:feedbackItems.length+1,kind:body.kind==='feature'?'feature':'bug',title:body.title||'Untitled',status:'new',priority:'normal',build:body.build||'unknown',fixed_in_build:null,screen:body.screen||null,line_id:null,reporter_id:user.id,reporter_name:'Tester One',revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),confirmed:false};
        feedbackItems.push(item);feedbackEvents[item.id]=[{id:crypto.randomUUID(),kind:'comment',body:body.body||'',actor_name:'Tester One',created_at:item.created_at}];return respond(feedbackDetail(item.id));
      }
      if(action==='act'){
        const item=feedbackItems.find(i=>i.id===body.itemId);if(!item)return respond({message:'Item not found.'},404);
        if(body.revision!=null&&body.revision!==item.revision)return respond({error:'conflict',message:'This item changed. Reload and try again.'},409);
        const next={confirm:'confirmed',reopen:'reopened'}[body.act];if(next){item.status=next;item.confirmed=next==='confirmed';}
        item.revision++;feedbackEvents[item.id].push({id:crypto.randomUUID(),kind:body.act==='confirm'?'confirm':body.act==='reopen'?'reopen':'comment',body:body.body||'',actor_name:'Tester One',created_at:new Date().toISOString()});return respond(feedbackDetail(item.id));
      }
      return respond({message:'Attachments are disabled in the local preview.'},503);
    }
    if(url.pathname==='/api/portal-admin'&&isAdmin){
      if(req.headers.authorization!==`Bearer ${token}`)return respond({message:'Sign in to the local preview.'},401);
      const action=url.searchParams.get('action');let body={};if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);}
      if(action==='overview')return respond({members:3,invited:0,projects:0,releases:0,limits:{projectBytes:100000000000,releaseBytes:10000000000}});
      if(action==='users')return respond({items:[{user_id:user.id,email:user.email,role:'owner',tier:null,status:'active',revision:1},...[1,2,3].map(tier=>({user_id:`10000000-0000-4000-8000-00000000003${tier}`,email:`tier${tier}@quadrion.invalid`,display_name:`Preview T${tier}`,role:'member',tier,status:'active',revision:1})),...manualUsers],total:4+manualUsers.length,offset:0});
      if(action==='creations')return respond({items:manualCreations});
      if(action==='createUser'){
        // UI fixture only: no Auth account, email or password is persisted.
        if(!body.email?.endsWith('@quadrion.invalid'))return respond({message:'Use a fictional @quadrion.invalid address for this local fixture.'},400);
        const item={user_id:crypto.randomUUID(),email:body.email,role:'member',tier:body.tier,status:'active',expires_at:body.expiresAt,revision:1};manualUsers.push(item);
        const result={id:crypto.randomUUID(),email:body.email,tier:body.tier,status:'created',user_id:item.user_id};manualCreations.unshift(result);return respond(result);
      }
      if(action==='feedbackInbox')return respond({items:feedbackItems.filter(i=>!url.searchParams.get('status')||i.status===url.searchParams.get('status')),total:feedbackItems.length,counts:feedbackCounts()});
      if(action==='feedbackCounts')return respond(feedbackCounts());
      if(action==='feedbackItem'){const detail=feedbackDetail(url.searchParams.get('itemId')||body.itemId);return detail?respond(detail):respond({message:'Item not found.'},404);}
      if(action==='feedbackProgress')return respond({testers:[{id:'tester-1',name:'Tester One',pass:1,fail:1,skip:0,open:3},{id:'tester-2',name:'Tester Two',pass:0,fail:0,skip:0,open:5}],lines:lineIds.length});
      if(action==='testContentStatus')return respond({loaded:true,version:testContent.version,title:testContent.title,stages:testContent.stages.length,lines:lineIds.length,builtAt:'2026-10-24T09:00:00Z'});
      if(action==='feedbackAction'){const item=feedbackItems.find(i=>i.id===body.itemId);if(!item)return respond({message:'Item not found.'},404);if(body.revision!=null&&body.revision!==item.revision)return respond({error:'conflict',message:'This item changed. Reload and try again.'},409);if(body.status)item.status=body.status;if(body.priority)item.priority=body.priority;if(body.fixedInBuild)item.fixed_in_build=body.fixedInBuild;item.revision++;feedbackEvents[item.id].push({id:crypto.randomUUID(),kind:body.body?'comment':'status',body:body.body||'',actor_name:'Owner',created_at:new Date().toISOString()});return respond(feedbackDetail(item.id));}
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
