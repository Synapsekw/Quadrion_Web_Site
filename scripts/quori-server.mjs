import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createQuoriHandler } from '../netlify/lib/quori.mjs';
import { readConfig } from '../netlify/lib/config.mjs';
import { PostgresStore } from '../netlify/lib/store.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),publicRoot=resolve(root,'directions');
let env={};try{env=parseEnv(await readFile(resolve(root,'.env.local'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
env={...env,...process.env};const mock=env.QUORI_MOCK==='true',port=Number(env.PORT)||5186;
const config=readConfig({...env,CONTEXT:'production',QUORI_ALLOWED_ORIGINS:'https://quadrion.invalid',
  QUORI_ENABLED:env.QUORI_LOCAL_ENABLED==='true'||mock?'true':'false',
  ...(mock?{OPENAI_API_KEY:'fixture',QUORI_SESSION_SECRET:randomBytes(32).toString('hex'),GROKBOT_WEBHOOK_URL:'https://api2.cursor.sh/automations/webhook/fixture',GROKBOT_WEBHOOK_KEY:'fixture',GROKBOT_AUTHORIZATION_HEADER:''}:{})});
config.local=true;config.mock=mock;config.origins=[];
if(!mock&&env.QUORI_LOCAL_CALLBACKS_ENABLED!=='true')config.callback=null;
let db,store;
if(config.ready){
  if(!mock)await mkdir(resolve(root,'.quori-data'),{recursive:true});
  db=new PGlite(mock?undefined:resolve(root,'.quori-data','database'));
  if(!(await db.query("SELECT to_regclass('public.quori_sessions') AS table_name")).rows[0].table_name)
    await db.exec(await readFile(resolve(root,'netlify/database/migrations/0001_quori.sql'),'utf8'));
  let tail=Promise.resolve();const pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query:(sql,args)=>db.query(sql,args),release};},async query(sql,args){const client=await this.connect();try{return await client.query(sql,args);}finally{client.release();}}};
  store=new PostgresStore(pool,config.secret);await store.cleanup();
}
const fake=async(url,options)=>{
  if(url.includes('api2.cursor.sh'))return Response.json({test:true});
  const body=JSON.parse(options.body),message=body.messages.at(-1).content;
  const reply=/[\u0600-\u06ff]/.test(message)?'معاينة اختبارية: يجمع Quadrion نماذج الموقع والصور ونتائج الفحص في مساحة عمل واحدة. ما نوع المشروع الذي تريد استكشافه؟':'Test reply: Quadrion brings models, photos, drone video and findings into one scene. Core desktop work is designed to run offline. This website chat is online. What would you like to explore?';
  return Response.json({choices:[{message:{content:JSON.stringify({reply,topic:'product',source_ids:['S1'],analysis:{intent:'product',urgency:'normal',summary:'Test',next_step:'Explore'},contact_request:/contact|call|demo/i.test(message)?{name:'',phone:'',email:'',company:'',reason:'Discuss a Quadrion walkthrough',preferred_time:'',timezone:''}:null})}}]});
};
const handler=createQuoriHandler({config,store,knowledge:await readFile(resolve(root,'server/knowledge.txt'),'utf8'),...(mock?{fetch:fake}:{})});
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.json':'application/json','.mp4':'video/mp4'};
const server=createServer(async(req,res)=>{
  try{
    const origin='http://'+req.headers.host,address=req.socket.remoteAddress;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)){res.writeHead(403).end();return;}
    const url=new URL(req.url,origin);
    if(url.pathname==='/api/quori'){
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const result=await handler(request,{ip:address,localOrigin:origin});
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    let path=decodeURIComponent(url.pathname);if(path==='/overview')path='/index.html';if(path==='/')path='/quori/';if(path.endsWith('/'))path+='index.html';
    const file=resolve(publicRoot,'.'+path);
    if(!file.startsWith(publicRoot+sep)||path.split(/[\\/]/).some(p=>p.startsWith('.'))){res.writeHead(403).end();return;}
    if((await stat(file)).isDirectory()){res.writeHead(301,{location:url.pathname+'/'}).end();return;}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Quori: http://127.0.0.1:${port}/quori/ (${mock?'mock':config.ready?'connected locally':'not connected'})`));
const cleanup=setInterval(()=>store?.cleanup().catch(()=>{}),3600000);cleanup.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(cleanup);server.close(async()=>{await db?.close();process.exit(0);});});
