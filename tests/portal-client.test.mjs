import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortalApi} from '../portal/src/api.mjs';
import {clearSessionData} from '../portal/src/auth.mjs';
test('sign-out removes session and upload capabilities without clearing unrelated site preferences',()=>{
  const storage={'quadrion-auth':'token','quadrion-password-setup':'true','quadrion-upload:tus:1':'upload-url',theme:'dark',removeItem(key){delete this[key];}};
  clearSessionData(storage);assert.equal(storage['quadrion-auth'],undefined);assert.equal(storage['quadrion-upload:tus:1'],undefined);assert.equal(storage.theme,'dark');
});
test('bearer credentials stay in headers and denials clear cached UI state',async()=>{
  let reset=0,status=200,seen;
  const api=createPortalApi({getToken:async()=>'private-token',onDenied:()=>reset++,fetcher:async(url,options)=>{seen=new Request('https://quadrion.ai'+url,options);return new Response(JSON.stringify(status===200?{items:[]}:{error:'forbidden',message:'Access denied'}),{status});}});
  await api.get('projects');assert.equal(seen.headers.get('authorization'),'Bearer private-token');assert.equal(seen.url.includes('private-token'),false);
  status=403;await assert.rejects(api.get('projects'),/Access denied/);assert.equal(reset,1);
  status=401;await assert.rejects(api.get('me'));assert.equal(reset,2);
});
test('network failures clear old private content, and unknown actions cannot issue requests',async()=>{
  let reset=0,calls=0;
  const api=createPortalApi({getToken:async()=>'private-token',onDenied:()=>reset++,fetcher:async()=>{calls++;throw new Error('network');}});
  await assert.rejects(api.get('projects'),/connection/i);assert.equal(reset,1);
  await assert.rejects(api.get('https://evil.test'),/Unknown/);assert.equal(calls,1);
});

test('failed upload requests pass their error to the private-view fallback before rejecting',async()=>{
  for(const status of [403,503]){
    let failure;
    const api=createPortalApi({admin:true,getToken:async()=>'fixture-token',onDenied:(status,error)=>{failure={status,error};},fetcher:async()=>new Response(JSON.stringify({error:'unavailable',message:'Upload service unavailable'}),{status})});
    await assert.rejects(api.post('upload',{}),error=>{
      assert.equal(failure.status,status);
      assert.equal(failure.error,error);
      assert.equal(failure.error.message,'Upload service unavailable');
      return true;
    });
  }
});

test('network and malformed responses provide an error to the fallback view',async()=>{
  for(const fetcher of [async()=>{throw new Error('network');},async()=>new Response('not json')]){
    let failure;
    const api=createPortalApi({admin:true,getToken:async()=>'fixture-token',onDenied:(status,error)=>{failure={status,error};},fetcher});
    await assert.rejects(api.post('upload',{}),error=>{
      assert.equal(failure.status,0);assert.equal(failure.error,error);return true;
    });
  }
});

test('feedback scope reaches its own endpoint and refuses admin-only actions',async()=>{
  const urls=[];const fetcher=async url=>{urls.push(url);return new Response('{}');};
  const feedback=createPortalApi({scope:'feedback',getToken:async()=>'fixture-token',fetcher});
  await feedback.get('mine');await feedback.post('answer',{lineId:'a:b:0123456789'});
  await assert.rejects(feedback.get('feedbackInbox'),/Unknown/);await assert.rejects(feedback.get('projects'),/Unknown/);
  await createPortalApi({admin:true,getToken:async()=>'fixture-token',fetcher}).get('feedbackInbox');
  await createPortalApi({scope:'admin',getToken:async()=>'fixture-token',fetcher}).post('memberTester',{});
  await createPortalApi({getToken:async()=>'fixture-token',fetcher}).get('me');
  assert.deepEqual(urls,['/api/portal-feedback?action=mine','/api/portal-feedback?action=answer','/api/portal-admin?action=feedbackInbox','/api/portal-admin?action=memberTester','/api/portal?action=me']);
  assert.throws(()=>createPortalApi({scope:'root',getToken:async()=>''}),/Unknown portal scope/);
});
