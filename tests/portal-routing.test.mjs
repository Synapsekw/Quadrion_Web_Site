import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import {loginDestination,canTest} from '../portal/src/routing.mjs';
test('one sign-in routes owners and admins to management and members to their library',()=>{
  assert.equal(loginDestination('owner'),'/admin/');
  assert.equal(loginDestination('admin'),'/admin/');
  assert.equal(loginDestination('member'),'/portal/');
  for(const role of [null,undefined,'superuser'])assert.equal(loginDestination(role),null);
});
test('loginDestination keeps an allowed deep link for every role',()=>{
  const deep='/portal/report/?build=0.26.0&screen=scene:map';
  for(const role of ['owner','admin','member']){
    assert.equal(loginDestination(role,deep),deep);
    assert.equal(loginDestination(role,'/portal/report?build=0.26.0'),'/portal/report?build=0.26.0');
    assert.equal(loginDestination(role,'/portal/tests/'),'/portal/tests/');
  }
  for(const path of ['//evil.example/','/admin/users/','https://evil.example/portal/report/','/portal/reports-elsewhere/','/portal/downloads/','/portal/?login','','/\\evil.example/portal/report/',undefined]){
    assert.equal(loginDestination('owner',path),'/admin/');
    assert.equal(loginDestination('admin',path),'/admin/');
    assert.equal(loginDestination('member',path),'/portal/');
  }
  for(const role of [null,undefined,'superuser'])assert.equal(loginDestination(role,deep),null);
});
test('owners and admins always count as testers; members need the tick',()=>{
  for(const role of ['owner','admin'])for(const tester of [true,false,undefined])assert.equal(canTest({role,tester}),true,role);
  assert.equal(canTest({role:'member',tester:true}),true);
  for(const m of [{role:'member',tester:false},{role:'member'},{role:'member',tester:'true'},{role:'superuser'},null,undefined])assert.equal(canTest(m),false);
});

// Runs member.mjs against a fake DOM; returns the sidebar links, what the tests page was handed and any redirect.
async function portalPage(member,pathname){
  const source=(await readFile(new URL('../portal/src/member.mjs',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'');
  const {createCache,sessionSeed}=await import('../portal/src/cache.mjs');
  const node=(tag,attrs={},...kids)=>({tag,attrs,kids:kids.flat(Infinity).filter(k=>k!=null),isConnected:true,append(...k){this.kids.push(...k);},replaceChildren(...k){this.kids=k;},prepend(){},querySelector:()=>null,
    getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},classList:{toggle(){},add(){},remove(){}},replaceWith(){}});
  const text=n=>n==null?'':typeof n!=='object'?String(n):(n.kids||[]).map(text).join(' ');
  const links=[],redirects=[],pages=[];
  const root=node('div');
  const document={querySelector:()=>root,addEventListener(){},getElementById:()=>null,visibilityState:'visible'};
  const window={addEventListener(){},dispatchEvent(){}};
  const location={pathname,search:'',hash:'',origin:'https://x.test',replace:url=>redirects.push(url)};
  const auth={getToken:async()=>'token',userId:async()=>member.userId,needsPassword:()=>false,enterWorkspace:()=>false,signOut:async()=>{},showLogin(){},showPassword(){}};
  const api=()=>({get:async action=>action==='me'?{member}:action==='counts'?{waiting:2}:{items:[]},post:async()=>({})});
  const link=(label,href,cls)=>{const a=node('a',{href,class:cls},label);links.push(a);return a;};
  const el=(tag,attrs,...kids)=>{const n=node(tag,attrs,...kids);if(tag==='a')links.push(n);return n;};
  const params=['document','window','location','history','setInterval','createPortalAuth','createPortalApi','el','button','link','field','heading','empty','notice','bytes','date','runButton','skeleton','renderTests','renderReport','createCache','sessionSeed','progressBar','canTest'];
  const run=compileFunction('return (async()=>{'+source+'\n})();',params);
  await run(document,window,location,{pushState(){},replaceState(){}},()=>({}),async()=>auth,api,el,label=>node('button',{},label),link,()=>({}),(...t)=>node('h1',{},...t),
    title=>node('section',{},title),message=>node('p',{},message),()=>'',()=>'',async()=>{},()=>node('div',{},'Loading'),async ctx=>pages.push(ctx),async ctx=>pages.push(ctx),
    createCache,sessionSeed,()=>({track:()=>()=>{}}),canTest);
  await new Promise(resolve=>setTimeout(resolve,10));
  return {links,redirects,pages,text};
}
test('an owner or admin opening /portal/tests/ stays there, sees Tests in the sidebar and a way back to Admin',async()=>{
  for(const role of ['owner','admin']){
    const {links,redirects,pages,text}=await portalPage({userId:'u1',role,tier:null,tester:false,displayName:'Team'},'/portal/tests/');
    assert.deepEqual(redirects,[],role);
    assert.equal(pages.length,1);assert.equal(pages[0].member.role,role);
    const tests=links.find(a=>a.attrs.href==='/portal/tests/');
    assert.ok(tests,role);assert.match(text(tests),/Tests/);
    assert.ok(links.some(a=>a.attrs.href==='/admin/'),role+' has a link back to Admin');
  }
});
test('a member sees Tests only with the Tester tick, and never a link to Admin',async()=>{
  const ticked=await portalPage({userId:'u2',role:'member',tier:1,tester:true,displayName:'Member'},'/portal/account/');
  assert.ok(ticked.links.some(a=>a.attrs.href==='/portal/tests/'));
  const plain=await portalPage({userId:'u3',role:'member',tier:2,tester:false,displayName:'Client'},'/portal/account/');
  assert.equal(plain.links.some(a=>a.attrs.href==='/portal/tests/'),false);
  for(const page of [ticked,plain])assert.equal(page.links.some(a=>a.attrs.href==='/admin/'),false);
});
