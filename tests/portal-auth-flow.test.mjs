import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import {loginDestination} from '../portal/src/routing.mjs';

// Execute the production controller with local Auth and DOM boundaries, without
// network calls or browser globals. Keep the routing implementation real.
const source=(await readFile(new URL('../portal/src/auth.mjs',import.meta.url),'utf8'))
  .replace(/^import .+;\r?\n/gm,'').replace(/^export /gm,'');
const loadAuth=compileFunction(source+'\nreturn createPortalAuth;',[
  'createClient','el','field','button','link','notice','busy','loginDestination',
  'location','history','sessionStorage','fetch',
]);
function node(tag,attrs={},...children){
  return {tag,attrs,children:children.flat(Infinity),replaceChildren(...items){this.children=items;}};
}
function findForm(element){
  if(element?.tag==='form')return element;
  for(const child of element?.children||[]){const form=findForm(child);if(form)return form;}
}
async function fixture(role,path,{signedIn=false}={}){
  const fields=new Map(),stored=new Map(),redirects=[],root=node('root');
  const location=new URL(path,'https://quadrion.ai');
  location.replace=path=>{redirects.push(path);location.href=new URL(path,location).href;};
  const history={replaceState(_state,_title,path){location.href=new URL(path,location).href;}};
  const storage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  const field=(_label,id)=>{const input={value:''};fields.set(id,input);return {input,node:node('field')};};
  const client={auth:{
    onAuthStateChange(){},
    getSession:async()=>({data:{session:signedIn?{access_token:'fixture-token'}:null},error:null}),
    signInWithPassword:async()=>{signedIn=true;return {data:{session:{access_token:'fixture-token'}},error:null};},
    updateUser:async()=>({data:{user:{id:'fixture-user'}},error:null}),
  }};
  const createPortalAuth=loadAuth(()=>client,node,field,()=>node('button'),()=>node('a'),()=>node('notice'),()=>()=>{},
    loginDestination,location,history,storage,async()=>({ok:true,json:async()=>({url:'https://fixture.invalid',publishableKey:'fixture-key'})}));
  let auth;
  auth=await createPortalAuth({root,onChange:async()=>{
    if(!await auth.getToken()){auth.showLogin();return;}
    if(auth.needsPassword()){auth.showPassword();return;}
    auth.enterWorkspace({role});
  }});
  return {auth,fields,location,redirects,submit:async()=>{
    const form=findForm(root);assert.ok(form,'The auth screen should contain a form');
    await form.attrs.onsubmit({preventDefault(){}});
  }};
}

for(const [role,destination] of [['owner','/admin/'],['admin','/admin/'],['member','/portal/']]){
  test('password sign-in routes '+role+' to '+destination,async()=>{
    // No ?login flag: successful sign-in itself must select the role's home.
    const f=await fixture(role,'/portal/');
    f.auth.showLogin();
    f.fields.get('email').value='user@example.com';
    f.fields.get('password').value='fixture password 123!';
    await f.submit();
    assert.equal(f.location.pathname,destination);
    assert.deepEqual(f.redirects,destination==='/admin/'?['/admin/']:[]);
    assert.equal(f.fields.get('password').value,'');
    assert.equal(f.auth.enterWorkspace({role}),false,'Later renders must not repeat the redirect');
  });
}

for(const type of ['invite','recovery']){
  for(const [role,destination] of [['owner','/admin/'],['admin','/admin/'],['member','/portal/']]){
    test(type+' password completion routes '+role+' to '+destination,async()=>{
      const f=await fixture(role,'/portal/account/#type='+type,{signedIn:true});
      assert.equal(f.auth.needsPassword(),true);
      f.auth.showPassword();
      f.fields.get('new-password').value='fixture new password 123!';
      f.fields.get('confirm-password').value='fixture new password 123!';
      await f.submit();
      assert.equal(f.auth.needsPassword(),false);
      assert.equal(f.location.pathname,destination);
      assert.deepEqual(f.redirects,destination==='/admin/'?['/admin/']:[]);
      assert.equal(f.location.hash,'');
      assert.equal(f.fields.get('new-password').value,'');
      assert.equal(f.fields.get('confirm-password').value,'');
    });
  }
}

test('signed-in administrators can deliberately open the client library without a redirect',async()=>{
  for(const role of ['owner','admin']){
    const f=await fixture(role,'/portal/projects/?search=survey',{signedIn:true});
    assert.equal(f.auth.enterWorkspace({role}),false);
    assert.equal(f.auth.enterWorkspace({role}),false);
    assert.equal(f.location.pathname,'/portal/projects/');
    assert.equal(f.location.search,'?search=survey');
    assert.deepEqual(f.redirects,[]);
  }
});

test('the public config is fetched once per tab session and reused on the next load',async()=>{
  const stored=new Map(),storage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  let fetches=0;const fetch=async()=>{fetches++;return {ok:true,json:async()=>({url:'https://fixture.invalid',publishableKey:'fixture-key'})};};
  const seen=[];const createClient=(url,key)=>{seen.push([url,key]);return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null}})}};};
  const load=()=>loadAuth(createClient,node,()=>({input:{},node:node('field')}),()=>node('button'),()=>node('a'),()=>node('notice'),()=>()=>{},
    loginDestination,new URL('https://quadrion.ai/admin/'),{replaceState(){}},storage,fetch)({root:node('root'),onChange:async()=>{}});
  await load();await load();
  assert.equal(fetches,1);
  assert.deepEqual(seen,[['https://fixture.invalid','fixture-key'],['https://fixture.invalid','fixture-key']]);
  stored.set('quadrion-config','not json');
  await load();
  assert.equal(fetches,2,'a damaged entry falls back to the request');
});
