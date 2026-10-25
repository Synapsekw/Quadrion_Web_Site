import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createClient} from '../portal/src/supabase-auth.mjs';

const root=new URL('../directions/',import.meta.url);

test('the auth-only client talks to the same Auth URL with the same key headers as supabase-js',()=>{
  const client=createClient('https://fixture.invalid','sb_publishable_fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  assert.equal(client.auth.url,'https://fixture.invalid/auth/v1');
  assert.equal(client.auth.headers.apikey,'sb_publishable_fixture');
  assert.equal(client.auth.headers.Authorization,'Bearer sb_publishable_fixture');
});

test('the upload library is a separate chunk that no page loads up front',async()=>{
  const dir=new URL('assets/portal/h/',root),names=await readdir(dir);
  const withTus=[];
  for(const name of names)if((await readFile(new URL(name,dir),'utf8')).includes('Tus-Resumable'))withTus.push(name);
  assert.equal(withTus.length,1,'tus-js-client sits in exactly one file');
  assert.match(withTus[0],/^chunk-/);
  for(const page of ['portal/index.html','admin/index.html'])
    assert.ok(!(await readFile(new URL(page,root),'utf8')).includes(withTus[0]),page+' does not preload the upload chunk');
});

test('the bundles leave out the database, storage and realtime clients',async()=>{
  const dir=new URL('assets/portal/h/',root);
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.js')))
    assert.doesNotMatch(await readFile(new URL(name,dir),'utf8'),/RealtimeClient|PostgrestClient|StorageClient/,name);
});
