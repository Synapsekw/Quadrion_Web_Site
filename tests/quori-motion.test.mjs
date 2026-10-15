import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotion, STATES, GESTURES } from '../directions/quori/motion.mjs';

test('reduced motion stays still even for speaking and spin', () => {
  const m = createMotion(); m.setState('speaking'); m.play('spin');
  const a = m.tick(.01, false);
  assert.deepEqual(m.tick(10, false), a);
  assert.equal(m.status().gesture, null);
});
test('completed gestures return to the chosen expression', () => {
  const m = createMotion(); m.setState('listening'); m.play('hello');
  for (let i=0;i<600;i++) m.tick(1/60);
  assert.equal(m.status().state, 'listening');
  assert.equal(m.status().gesture, null);
});
test('paused animation freezes its clock and current gesture', () => {
  const m = createMotion(); m.play('spin'); m.tick(.1);
  const before=m.status();
  const pose=m.tick(0); assert.deepEqual(m.tick(0), pose);
  assert.deepEqual(m.status(),before);
});
test('changing a gesture preserves continuity and cancels the old one', () => {
  const m=createMotion(); m.play('hop');
  for(let i=0;i<25;i++) m.tick(1/60);
  const a=m.tick(0); m.play('wink'); const b=m.tick(1/60);
  assert.ok(Math.abs(a.y-b.y)<.12);
  assert.equal(m.status().gesture,'wink');
});
test('all motions remain finite under bad clock inputs', () => {
  for (const state of STATES) for(const gesture of GESTURES) {
    const m=createMotion(); m.setState(state); m.play(gesture);
    for(const dt of [NaN, Infinity, -1, 0, .016, 3]) {
      const p=m.tick(dt); assert.ok(Object.values(p).every(Number.isFinite), `${state}/${gesture}`);
    }
  }
});
test('unknown inputs fall back without breaking the chosen pose', () => {
  const m=createMotion(); m.setState('missing'); m.play('missing');
  assert.equal(m.status().state,'idle'); assert.equal(m.status().gesture,null);
});
