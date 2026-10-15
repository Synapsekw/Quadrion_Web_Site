import {build} from 'esbuild';
import {access} from 'node:fs/promises';
const entryPoints=['portal/src/member.mjs'];
for(const name of ['admin','hash-worker']){try{await access(`portal/src/${name}.mjs`);entryPoints.push(`portal/src/${name}.mjs`);}catch{}}
await build({entryPoints,outdir:'directions/assets/portal',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,sourcemap:false,legalComments:'eof',external:['/assets/fonts/plex.css']});
console.log('Portal bundles built.');
