import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';

// What npm run build:portal leaves behind: pages that name hashed files that exist, and no stray bundles.
const root=new URL('../directions/',import.meta.url);
const pages=['portal/index.html','admin/index.html'];

test('each page links the font stylesheet and hashed bundles that exist',async()=>{
  const linked=new Set();
  for(const page of pages){
    const html=await readFile(new URL(page,root),'utf8');
    assert.match(html,/<link rel="stylesheet" href="\/assets\/fonts\/plex\.css">/,page);
    const refs=[...html.matchAll(/(?:href|src)="(\/assets\/portal\/[^"]+)"/g)].map(m=>m[1]);
    assert.ok(refs.some(r=>/\/h\/[a-z]+-[A-Z0-9]{8}\.js$/.test(r)),page+' loads a hashed script');
    assert.ok(refs.some(r=>/\/h\/[a-z]+-[A-Z0-9]{8}\.css$/.test(r)),page+' loads a hashed stylesheet');
    for(const ref of refs){await access(new URL('.'+ref,root));linked.add(ref.replace('/assets/portal/h/',''));}
  }
  // Every hashed file is either linked from a page or a chunk loaded later (the lazy upload library).
  for(const name of await readdir(new URL('assets/portal/h/',root)))
    assert.ok(linked.has(name)||name.startsWith('chunk-'),name+' is left over from an earlier build');
});

test('no page loads the old fixed-name bundles, and the CSS no longer @imports the fonts',async()=>{
  for(const page of pages)assert.doesNotMatch(await readFile(new URL(page,root),'utf8'),/\/assets\/portal\/(?:member|admin)\.(?:js|css)/);
  assert.doesNotMatch(await readFile(new URL('../portal/src/portal.css',import.meta.url),'utf8'),/@import/);
});
