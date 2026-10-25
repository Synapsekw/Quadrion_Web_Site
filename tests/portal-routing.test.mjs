import test from 'node:test';
import assert from 'node:assert/strict';
import {loginDestination} from '../portal/src/routing.mjs';
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
