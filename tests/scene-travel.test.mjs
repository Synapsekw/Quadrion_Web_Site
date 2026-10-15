import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneTravel } from '../directions/d3-quarter/scene-travel.mjs';

test('travel joins each original shot at its exact camera position', () => {
  assert.equal(sceneTravel(0).outgoing, 0);
  assert.equal(sceneTravel(0).blend, 0);
  assert.equal(sceneTravel(1).incoming, 0);
  assert.equal(sceneTravel(1).blend, 1);
});

test('both cameras pull away during the handoff, with bounded, reversible progress', () => {
  const forward = Array.from({ length: 101 }, (_, i) => sceneTravel(i / 100));
  const reverse = Array.from({ length: 101 }, (_, i) => sceneTravel((100 - i) / 100)).reverse();
  assert.deepEqual(forward, reverse);
  assert.ok(forward[50].outgoing > 0.5 && forward[50].incoming > 0.5);
  for (let i = 0; i < forward.length; i++) {
    assert.ok(Object.values(forward[i]).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
    if (i) {
      assert.ok(forward[i].blend >= forward[i - 1].blend);
      assert.ok(forward[i].outgoing >= forward[i - 1].outgoing);
      assert.ok(forward[i].incoming <= forward[i - 1].incoming);
      assert.ok(Math.abs(forward[i].outgoing - forward[i - 1].outgoing) < 0.03);
    }
  }
  assert.deepEqual(sceneTravel(-1), sceneTravel(0));
  assert.deepEqual(sceneTravel(2), sceneTravel(1));
});
