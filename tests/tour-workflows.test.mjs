import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOWS, workflowState, flightTime } from '../directions/d3-quarter/tour-workflows.mjs';

test('every workflow starts and ends on its documented modes', () => {
  for (const [name, workflow] of Object.entries(WORKFLOWS)) {
    assert.equal(workflowState(name, 0).id, workflow.stages[0].id);
    assert.equal(workflowState(name, 1).id, workflow.stages.at(-1).id);
    assert.equal(workflowState(name, 1).local, 1);
    for (let i = 1; i < workflow.stages.length; i++) {
      const boundary = i / workflow.stages.length;
      assert.equal(workflowState(name, boundary - 1e-8).index, i - 1);
      assert.equal(workflowState(name, boundary).index, i);
    }
  }
});

test('scrubbing backward exactly reconstructs workflow state', () => {
  for (const name of Object.keys(WORKFLOWS)) {
    const forward = Array.from({ length: 101 }, (_, i) => workflowState(name, i / 100));
    const reverse = Array.from({ length: 101 }, (_, i) => workflowState(name, (100 - i) / 100)).reverse();
    assert.deepEqual(forward, reverse);
    assert.ok(forward.every(state => state.local >= 0 && state.local <= 1 && !state.manual));
  }
});

test('manual stage selection is independent of scroll and null resumes scroll', () => {
  assert.deepEqual(workflowState('flare', 0, 3), workflowState('flare', 1, 3));
  assert.equal(workflowState('flare', 0, 3).id, 'mid');
  assert.equal(workflowState('flare', 0, 3).manual, true);
  assert.equal(workflowState('flare', 0, null).id, 'points');
  assert.equal(workflowState('flare', 1, null).id, 'top');
});

test('invalid override values never invent stages and progress is bounded', () => {
  assert.deepEqual(workflowState('plant', -1), workflowState('plant', 0));
  assert.deepEqual(workflowState('plant', 2), workflowState('plant', 1));
  assert.deepEqual(workflowState('plant', NaN), workflowState('plant', 0));
  for (const invalid of [-1, 3, 1.5, '1', NaN, Infinity]) {
    assert.equal(workflowState('plant', 0, invalid).id, 'rgb');
    assert.equal(workflowState('plant', 0, invalid).manual, false);
  }
  assert.throws(() => workflowState('missing', 0), RangeError);
});

test('video time holds a paused or sought flight pose instead of returning to scroll time', () => {
  assert.equal(flightTime(0.65, 11, 3.2), 3.2);
  assert.equal(flightTime(0.9, 11, 3.2), 3.2);
  assert.equal(flightTime(0.65, 11, 0), 0);
  assert.equal(flightTime(0.5, 11), 5.5);
  assert.equal(flightTime(0.5, 11, 14), 11);
  assert.equal(flightTime(0.5, 11, NaN), 5.5);
});
