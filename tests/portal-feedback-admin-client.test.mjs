import test from 'node:test';
import assert from 'node:assert/strict';
import {copyForAi,bulkFix,testerToggle,filterFromSearch,showAfterRender} from '../portal/src/feedback-admin.mjs';

test('Copy for AI copies the export text for the current filter',async()=>{
  const calls=[],copied=[];
  const api={get:async(action,params)=>{calls.push([action,params]);return {text:'# Quadrion open bugs (2)',count:2,expiresIn:86400};}};
  const search='?kind=bug&status=new%2Ctriaged&priority=high&build=0.26.0&tester=10000000-0000-4000-8000-000000000006&offset=100&junk=1';
  const message=await copyForAi({api,search,clipboard:{writeText:async text=>copied.push(text)}});
  assert.deepEqual(calls,[['feedbackExport',{kind:'bug',status:'new,triaged',priority:'high',build:'0.26.0',tester:'10000000-0000-4000-8000-000000000006'}]]);
  assert.deepEqual(copied,['# Quadrion open bugs (2)']);
  assert.equal(message,'Copied 2 bugs. Links work for 24 hours.');
  assert.deepEqual(filterFromSearch(search),calls[0][1]);
});
test('Copy for AI says so when the clipboard is refused and words one bug',async()=>{
  const api={get:async()=>({text:'x',count:1})};
  await assert.rejects(copyForAi({api,search:'',clipboard:{writeText:async()=>{throw new Error('denied');}}}),/Copy was blocked/);
  assert.equal(await copyForAi({api,search:'',clipboard:{writeText:async()=>{}}}),'Copied 1 bug. Links work for 24 hours.');
});
test('bulk fix sends the selected ids and then offers the tester message',async()=>{
  const posts=[];
  const api={post:async(action,body)=>{posts.push([action,body]);return {fixed:3,build:'0.26.1',bugs:2,features:1,testers:2};}};
  const result=await bulkFix({api,ids:['a','b','a','c'],build:' 0.26.1 ',origin:'https://quadrion.ai'});
  assert.deepEqual(posts,[['feedbackBulkFix',{ids:['a','b','c'],build:'0.26.1'}]]);
  assert.equal(result.message,'2 fixes in 0.26.1 are ready to re-check; 1 feature built in 0.26.1 is ready to try: https://quadrion.ai/portal/tests/');
  assert.equal(result.fixed,3);
  await assert.rejects(bulkFix({api,ids:[],build:'0.26.1',origin:'x'}),/Select at least one/);
  await assert.rejects(bulkFix({api,ids:['a'],build:'  ',origin:'x'}),/Enter the build/);
  assert.equal(posts.length,1);
});
test('a single fix offers the same tester message as a bulk one',async()=>{
  const {fixMessage}=await import('../portal/src/feedback-admin.mjs');
  assert.equal(fixMessage({kind:'bug'},' 0.26.1 ','https://quadrion.ai'),'1 fix in 0.26.1 is ready to re-check: https://quadrion.ai/portal/tests/');
  assert.equal(fixMessage({kind:'feature'},'0.26.1','https://quadrion.ai'),'1 feature built in 0.26.1 is ready to try: https://quadrion.ai/portal/tests/');
});
test('the tester checkbox shows for owners only',()=>{
  const user={user_id:'10000000-0000-4000-8000-000000000006',revision:4,tester:true};
  assert.equal(testerToggle('admin',user),null);
  assert.equal(testerToggle('member',user),null);
  const toggle=testerToggle('owner',user);
  assert.equal(toggle.checked,true);
  assert.deepEqual(toggle.payload(false),{userId:user.user_id,revision:4,tester:false});
  assert.equal(testerToggle('owner',{...user,tester:undefined}).checked,false);
  assert.equal(testerToggle('owner',{...user,role:'member'}).checked,true);
});
test('owner and admin rows say they always have tester access instead of a checkbox',async()=>{
  const {ALWAYS_TESTER}=await import('../portal/src/feedback-admin.mjs');
  assert.equal(ALWAYS_TESTER,'Owners and admins always have tester access');
  for(const role of ['owner','admin'])
    assert.deepEqual(testerToggle('owner',{user_id:'10000000-0000-4000-8000-000000000001',revision:1,tester:false,role}),{always:true},role);
  assert.equal(testerToggle('admin',{role:'admin'}),null);
});
test('a notice after render lands in the new content node, not the old one',async()=>{
  const oldMain={prepended:[],prepend(n){this.prepended.push(n);}},newMain={prepended:[],prepend(n){this.prepended.push(n);}};
  const ctx={content:oldMain,async render(){this.content=newMain;}};
  await showAfterRender(ctx,()=>'Marked 2 items fixed');
  assert.deepEqual(oldMain.prepended,[]);
  assert.deepEqual(newMain.prepended,['Marked 2 items fixed']);
});
