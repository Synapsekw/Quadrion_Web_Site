import test from 'node:test';
import assert from 'node:assert/strict';
import { deferAvatar } from '../directions/quori/deferred-avatar.mjs';

test('does no rendering work until requested, then preserves current state', async () => {
  let imports = 0, finish;
  const calls = [];
  const avatar = {setState:v=>calls.push(['state',v]),setMotion:v=>calls.push(['motion',v]),setVisible:v=>calls.push(['visible',v]),play:v=>calls.push(['play',v])};
  const proxy = deferAvatar(() => { imports++; return new Promise(r=>finish=()=>r(avatar)); });
  proxy.setState('thinking'); proxy.setMotion(false); proxy.setVisible(false); proxy.play('hello');
  assert.equal(imports, 0);
  const first = proxy.load(); const second = proxy.load();
  assert.equal(imports, 1);
  finish(); await Promise.all([first, second]);
  assert.deepEqual(calls, [['motion',false],['visible',false],['state','thinking']]);
  proxy.setMotion(true); proxy.play('hello');
  assert.deepEqual(calls.slice(-2), [['motion',true],['play','hello']]);
});

test('destroying during import disposes result and never revives the avatar', async () => {
  let finish, disposed = 0;
  const proxy = deferAvatar(() => new Promise(r=>finish=()=>r({destroy(){disposed++;}})));
  const pending = proxy.load(); proxy.destroy(); finish(); await pending;
  await proxy.load(); assert.equal(disposed, 1);
});

test('unavailable WebGL leaves fallback usable and does not cause unhandled rejection', async () => {
  let errors = 0;
  const proxy = deferAvatar(async () => { throw new Error('unavailable'); }, () => errors++);
  await proxy.load(); proxy.setState('happy'); proxy.destroy();
  assert.equal(errors, 1);
});
