// Loopback-only fixture server for visual QA. No production keys or remote data.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('directions'),port=5190,origin=`http://127.0.0.1:${port}`;
const user={id:'10000000-0000-4000-8000-000000000003',aud:'authenticated',role:'authenticated',email:'preview@quadrion.invalid',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,iss:origin+'/auth/v1',aud:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture-only'].join('.');
const member={userId:user.id,role:'member',tier:3,status:'active',expiresAt:null,displayName:'Local preview',company:'Synapse',revision:1};
const release={id:'10000000-0000-4000-8000-000000000011',artifact_id:'10000000-0000-4000-8000-000000000012',kind:'app',version:'0.14.0',platform:'windows',minimum_app_version:'',bytes:216000000,sha256:'a'.repeat(64),notes:'Preview data only. No downloadable binary.'};
const projects=['Coastal infrastructure','Industrial facility','Terrain & earthworks'].map((title,i)=>({id:`10000000-0000-4000-8000-00000000002${i}`,title,description:'Local preview of an authorized AIO project in your library.',category:i===1?'oil_gas':'basic',minimum_tier:i===1?3:2,version:'1.0',bytes:(i+12)*1024**3}));
createServer(async(req,res)=>{
  const respond=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
    if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
    const url=new URL(req.url,origin);
    if(url.pathname==='/api/portal'){
      const action=url.searchParams.get('action');
      if(action==='config')return respond({enabled:true,url:origin,publishableKey:'fixture-publishable-only'});
      if(req.headers.authorization!==`Bearer ${token}`)return respond({message:'Sign in to the local preview.'},401);
      if(action==='me')return respond({member,email:user.email,aal:'aal1',requiresMfa:false});
      if(action==='releases')return respond({items:[release,{...release,kind:'pipeline',version:'0.7.0',minimum_app_version:'0.14.0',bytes:470000000}],total:2});
      if(action==='projects')return respond({items:projects.filter(p=>p.title.toLowerCase().includes((url.searchParams.get('search')||'').toLowerCase())),total:projects.length});
      return respond({message:'This action is disabled in the local preview.'},503);
    }
    if(url.pathname==='/auth/v1/token'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);if(body.email!=='preview@quadrion.invalid'||body.password!=='preview-only')return respond({msg:'Use the documented local preview credentials.'},400);return respond({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user});}
    if(url.pathname==='/auth/v1/user')return respond(user);
    if(url.pathname==='/auth/v1/logout')return respond({});
    let path=decodeURIComponent(url.pathname);if(path.startsWith('/portal/'))path='/portal/index.html';if(path.startsWith('/admin/'))path='/admin/index.html';
    const file=resolve(root,'.'+path);if(!file.startsWith(root+sep)||path.split(/[\\/]/).some(p=>p.startsWith('.')))return respond({},404);
    const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{respond({message:'Preview request unavailable.'},404);}
}).listen(port,'127.0.0.1',()=>console.log(`Portal fixture preview: ${origin}/portal/ (preview@quadrion.invalid / preview-only)`));
