import test from 'node:test';
import assert from 'node:assert/strict';
import {loginDestination} from '../portal/src/routing.mjs';
test('one sign-in routes owners and admins to management and members to their library',()=>{
  assert.equal(loginDestination('owner'),'/admin/');
  assert.equal(loginDestination('admin'),'/admin/');
  assert.equal(loginDestination('member'),'/portal/');
  for(const role of [null,undefined,'superuser'])assert.equal(loginDestination(role),null);
});
