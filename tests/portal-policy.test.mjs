import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMember, canAdminister, canReadProject, canReadSoftware, isTester } from '../netlify/lib/portal/policy.mjs';
const now = Date.parse('2026-10-15T12:00:00Z');
const member = { userId:'u1',role:'member',tier:3,status:'active',expiresAt:null };
const project = { id:'p1',category:'oil_gas',minimumTier:3,audience:'assigned',status:'published',currentVersionId:'v1' };
const assignment = { userId:'u1',projectId:'p1',expiresAt:null };
test('private assignments intersect tiers, publication and account status', () => {
  assert.equal(canReadProject({member,project,assignment,now}),true);
  for (const change of [{assignment:null},{assignment:{...assignment,userId:'other'}},{assignment:{...assignment,projectId:'other'}},
    {assignment:{...assignment,expiresAt:new Date(now).toISOString()}},{member:{...member,tier:2}},
    {member:{...member,status:'suspended'}},{project:{...project,status:'draft'}},{project:{...project,currentVersionId:null}}]) {
    assert.equal(canReadProject({member,project,assignment,now,...change}),false);
  }
});
test('tier matrix includes software at T1, basic at T2, restricted at T3', () => {
  for(const tier of [1,2,3]) {
    const m={...member,tier};
    assert.equal(canReadSoftware({member:m,status:'published',verified:true,now}),true);
    for(const [category,minimumTier] of [['basic',2],['oil_gas',3],['restricted',3]]) {
      assert.equal(canReadProject({member:m,project:{...project,category,minimumTier,audience:'tier'},now}),tier>=minimumTier);
    }
  }
  assert.equal(canReadProject({member,project:{...project,category:'oil_gas',minimumTier:2,audience:'tier'},now}),false);
});
test('invalid, missing and expired memberships fail closed at exact boundaries', () => {
  for(const m of [null,{}, {...member,status:'invited'},{...member,role:'root'}, {...member,tier:'3'},
    {...member,expiresAt:'invalid'}, {...member,expiresAt:new Date(now).toISOString()}]) assert.equal(activeMember(m,now),false);
  assert.equal(activeMember(member,NaN),false);
  assert.equal(activeMember({...member,expiresAt:new Date(now+1).toISOString()},now),true);
});
test('T3 never grants administration; active administrators can use password sessions', () => {
  assert.equal(canAdminister({member,aal:'aal2',now}),false);
  for(const role of ['admin','owner']) {
    const m={...member,role,tier:null};
    assert.equal(canAdminister({member:m,aal:'aal1',now}),true);
    assert.equal(canReadProject({member:m,project,aal:'aal1',now}),true);
    assert.equal(canAdminister({member:m,aal:undefined,now}),false);
    assert.equal(canAdminister({member:{...m,status:'suspended'},aal:'aal1',now}),false);
    assert.equal(canAdminister({member:m,aal:'aal2',now}),true);
    assert.equal(canReadProject({member:m,project,aal:'aal2',now}),true);
  }
});
test('tester flag counts only on an active membership', () => {
  assert.equal(isTester({...member,tier:1,tester:true},now),true);
  assert.equal(isTester({...member,role:'owner',tier:null,tester:true},now),true);
  for(const m of [{...member,tester:false},member,{...member,tester:'true'},{...member,tester:true,status:'suspended'},
    {...member,tester:true,expiresAt:new Date(now).toISOString()},null]) assert.equal(isTester(m,now),false);
});
test('owners and admins always have tester access while their membership is active', () => {
  for(const role of ['owner','admin']){
    assert.equal(isTester({...member,role,tier:null},now),true,role);
    assert.equal(isTester({...member,role,tier:null,tester:false},now),true,role);
    for(const status of ['suspended','revoked','invited'])assert.equal(isTester({...member,role,tier:null,status},now),false,role+' '+status);
    assert.equal(isTester({...member,role,tier:null,expiresAt:new Date(now).toISOString()},now),false,role+' expired');
  }
  assert.equal(isTester({...member,role:'superuser',tier:null},now),false);
});
