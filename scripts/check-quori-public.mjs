import {readdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {parseEnv} from 'node:util';
let privateValues=[];
for(const configFile of ['.env.local','.env.production.local']){
  try{const env=parseEnv(await readFile(configFile,'utf8'));privateValues.push(...['OPENAI_API_KEY','QUORI_SESSION_SECRET','GROKBOT_WEBHOOK_KEY','GROKBOT_WEBHOOK_URL'].map(k=>env[k]).filter(v=>v?.length>12));}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function visit(path){
  for(const entry of await readdir(path,{withFileTypes:true})){
    const file=resolve(path,entry.name);
    if(entry.isSymbolicLink())throw new Error('Symlink in public artifacts: '+entry.name);
    if(entry.isDirectory()){await visit(file);continue;}
    if(/\.env|\.local\.|\.php$|\.sql$/.test(entry.name))throw new Error('Private file in public artifacts: '+entry.name);
    if(!['.js','.mjs','.html','.css','.json','.txt','.md'].includes(extname(file)))continue;
    const text=await readFile(file,'utf8');
    if(privateValues.some(value=>text.includes(value))||/sk-(?:proj-)?[a-zA-Z0-9_-]{32,}/.test(text))throw new Error('Credential detected in public artifacts.');
  }
}
await visit(resolve('directions'));
console.log('Public artifact check passed: no private configuration or configured credentials.');
