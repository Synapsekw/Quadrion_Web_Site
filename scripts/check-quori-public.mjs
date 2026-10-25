import {readdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
const formatMarkers=['quadrion-test-content/','quadrion-test-results/'];
const testLineId=/(?<![a-z0-9:-])(?:testing|setup|extra)(?::[a-z0-9-]+)+:[0-9a-f]{10}(?:-[0-9]+)?(?![a-z0-9-])/;
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function findPrivateContent(text,terms=[]){
  const reasons=[];
  for(const marker of formatMarkers)if(text.includes(marker))reasons.push('Test content format marker: '+marker);
  if(testLineId.test(text))reasons.push('Test line id in public artifacts.');
  for(const term of terms){
    if(typeof term!=='string'||!term.trim())continue;
    if(new RegExp('(?<![\\p{L}\\p{N}_])'+escapeRegExp(term.trim())+'(?![\\p{L}\\p{N}_])','iu').test(text))reasons.push('Private term in public artifacts.');
  }
  return reasons;
}
async function readTerms(){
  const file=process.env.PUBLIC_CHECK_TERMS_FILE||'public-check-terms.local.json';
  try{return JSON.parse(await readFile(file,'utf8')).terms??[];}catch(error){if(error.code==='ENOENT'&&!process.env.PUBLIC_CHECK_TERMS_FILE)return [];throw error;}
}
async function main(){
  let privateValues=[];
  const secretNames=['OPENAI_API_KEY','QUORI_SESSION_SECRET','GROKBOT_WEBHOOK_KEY','GROKBOT_WEBHOOK_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','PORTAL_VERIFY_SECRET'];
  privateValues.push(...secretNames.map(k=>process.env[k]).filter(v=>v?.length>12));
  for(const configFile of ['.env.local','.env.production.local']){
    try{const env=parseEnv(await readFile(configFile,'utf8'));privateValues.push(...secretNames.map(k=>env[k]).filter(v=>v?.length>12));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const terms=await readTerms();
  async function visit(path){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const file=resolve(path,entry.name);
      if(entry.isSymbolicLink())throw new Error('Symlink in public artifacts: '+entry.name);
      if(entry.isDirectory()){await visit(file);continue;}
      if(/\.env|\.local\.|\.php$|\.sql$/.test(entry.name))throw new Error('Private file in public artifacts: '+entry.name);
      if(!['.js','.mjs','.html','.css','.json','.txt','.md'].includes(extname(file)))continue;
      const text=await readFile(file,'utf8');
      if(privateValues.some(value=>text.includes(value))||/(?:sk-(?:proj-)?|sb_secret_)[a-zA-Z0-9_-]{20,}/.test(text))throw new Error('Credential detected in public artifacts.');
      const reasons=findPrivateContent(text,terms);
      if(reasons.length)throw new Error(reasons[0]+' ('+entry.name+')');
    }
  }
  await visit(resolve('directions'));
  console.log('Public artifact check passed: no private configuration or configured credentials.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
