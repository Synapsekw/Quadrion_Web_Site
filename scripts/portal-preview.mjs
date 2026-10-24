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
