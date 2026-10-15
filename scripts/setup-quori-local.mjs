import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
const reference=process.argv[2];if(!reference)throw new Error('Pass the existing private environment file path.');
const source=parseEnv(await readFile(reference,'utf8'));
const values={QUORI_ENABLED:'false',QUORI_LOCAL_ENABLED:'true',QUORI_LOCAL_CALLBACKS_ENABLED:'true',OPENAI_API_KEY:source.OPENAI_API_KEY||'',QUORI_SESSION_SECRET:randomBytes(48).toString('hex'),
  GROKBOT_WEBHOOK_URL:source.GROKBOT_WEBHOOK_URL||'',GROKBOT_WEBHOOK_KEY:source.GROKBOT_WEBHOOK_KEY||'',GROKBOT_AUTHORIZATION_HEADER:source.GROKBOT_AUTHORIZATION_HEADER||'',QUORI_MODEL:source.ORBI_MODEL||'gpt-6-luna'};
await writeFile('.env.local','# Private Quori configuration. Never publish or commit.\n'+Object.entries(values).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Private connections prepared. Separate Quori session secret generated. No requests sent.');
