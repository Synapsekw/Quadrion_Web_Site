import {build} from 'esbuild';
import {readFile,writeFile,rm} from 'node:fs/promises';
// Portal and admin bundles get content-hashed names under /assets/portal/h/ (served immutable, see netlify.toml),
// and the two pages are rewritten to point at them. The checksum worker keeps its fixed name: new Worker() needs a
// known URL and it only loads during uploads.
const out='directions/assets/portal',hashed=out+'/h';
const pages={member:'directions/portal/index.html',admin:'directions/admin/index.html'};
const common={bundle:true,format:'esm',platform:'browser',target:'es2022',supported:{'template-literal':false},minify:true,sourcemap:false,legalComments:'eof'};
// Earlier builds: the hashed folder and the old fixed-name bundles.
await rm(hashed,{recursive:true,force:true});
for(const name of ['member.js','admin.js','member.css','admin.css'])await rm(`${out}/${name}`,{force:true});
await build({...common,entryPoints:['portal/src/hash-worker.mjs'],outdir:out});
const result=await build({...common,entryPoints:Object.fromEntries(Object.keys(pages).map(name=>[name,`portal/src/${name}.mjs`])),outdir:hashed,splitting:true,entryNames:'[name]-[hash]',chunkNames:'chunk-[hash]',metafile:true});
const url=path=>'/'+path.replace(/\\/g,'/').replace(/^directions\//,'');
for(const [name,file] of Object.entries(pages)){
  const [js,meta]=Object.entries(result.metafile.outputs).find(([,o])=>o.entryPoint===`portal/src/${name}.mjs`);
  if(!meta.cssBundle)throw new Error(`No stylesheet was built for ${name}.`);
  // Chunks the entry imports up front load in parallel with it; dynamic ones (the upload library) stay lazy.
  const preload=meta.imports.filter(i=>i.kind==='import-statement').map(i=>`<link rel="modulepreload" href="${url(i.path)}">`).join('');
  const tags=`<link rel="stylesheet" href="/assets/fonts/plex.css"><link rel="stylesheet" href="${url(meta.cssBundle)}">${preload}<script type="module" src="${url(js)}"></script>`;
  const html=await readFile(file,'utf8');
  const head=html.replace(/<link rel="(?:stylesheet|modulepreload)"[^>]*>|<script type="module"[^>]*><\/script>/g,'');
  if(!head.includes('<link rel="icon" href="/assets/favicon.svg">'))throw new Error(`${file} lost its favicon link; cannot place the bundle tags.`);
  await writeFile(file,head.replace('<link rel="icon" href="/assets/favicon.svg">',m=>m+tags));
}
console.log('Portal bundles built.');
