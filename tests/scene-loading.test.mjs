import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLoader, sceneDemand, canCaptureStill } from '../directions/d3-quarter/scene-loading.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

test('road still capture waits for uploaded base tiles even after another asset becomes ready', async () => {
  const baseTiles = { requested: true, loaded: 0, tiles: [{ state: 0 }, { state: 0 }] };
  const captures = [], ready = new Set();
  const captureVisibleStills = () => {
    for (const name of ['road', 'flare']) {
      if (!captures.includes(name) && canCaptureStill(name, ready.has(name), baseTiles)) captures.push(name);
    }
  };
  const loader = createSceneLoader({ road: async () => {}, flare: async () => {} }, {
    onState(name, state) { if (state === 'ready') { ready.add(name); captureVisibleStills(); } }
  });
  await loader.request('road');
  assert.deepEqual(captures, []);
  await loader.request('flare');
  assert.deepEqual(captures, ['flare']);
  baseTiles.tiles[0].state = 1; baseTiles.loaded = 1;
  captureVisibleStills();
  assert.deepEqual(captures, ['flare']);
  baseTiles.tiles[1].state = 1; baseTiles.loaded = 2;
  captureVisibleStills();
  assert.deepEqual(captures, ['flare', 'road']);
});

test('failed base tiles settle a road still only after every remaining tile finishes', () => {
  const baseTiles = { requested: true, loaded: 0, tiles: [{ state: -1 }, { state: 0 }] };
  assert.equal(canCaptureStill('road', true, undefined), false);
  assert.equal(canCaptureStill('road', true, baseTiles), false);
  baseTiles.tiles[1].state = 1; baseTiles.loaded = 1;
  assert.equal(canCaptureStill('road', true, baseTiles), true);
  assert.equal(canCaptureStill('road', false, baseTiles), false);
});

test('static hero and hidden hosts do not request any dataset', async () => {
  const started = [];
  const loader = createSceneLoader({ road: async () => started.push('road') });
  loader.setDemand(...Object.values(sceneDemand({}, 'stage')));
  await turn();
  assert.deepEqual(started, []);
  assert.deepEqual(sceneDemand({ zoom: 1, stock: 1 }, 'none'), { active: [], preload: [] });
  assert.deepEqual(sceneDemand({ zoom: 1 }, 'cta'), { active: [], preload: [] });
});

test('a direct jump requests the current chapter before its next chapter, not earlier assets', () => {
  assert.deepEqual(sceneDemand({ zoom: 1, sweep: 1, iris: 1, tank: 0.4 }, 'stage'), {
    active: ['tank'], preload: ['flare']
  });
  assert.deepEqual(sceneDemand({}, 'app', 'stock'), { active: ['stockpile'], preload: [] });
  assert.deepEqual(sceneDemand({ hero: 0.7 }, 'stage'), { active: [], preload: ['road'] });
});

test('transition demand includes both worlds in either scroll direction', () => {
  const middle = { zoom: 1, sweep: 1, iris: 0.7, plant: 1, tank: 0.2 };
  assert.deepEqual(sceneDemand(middle, 'stage'), { active: ['tank', 'plant'], preload: [] });
  assert.deepEqual(sceneDemand({ ...middle, iris: 0.3 }, 'stage'), { active: ['plant', 'tank'], preload: [] });
});

test('a jump drops obsolete queued preloads and prioritizes the current asset', async () => {
  const started = [], finish = new Map();
  const tasks = Object.fromEntries(['road', 'plant', 'tank', 'flare'].map(name => [name, () => {
    started.push(name);
    return new Promise(resolve => finish.set(name, resolve));
  }]));
  const loader = createSceneLoader(tasks);
  loader.setDemand(['road'], ['plant']);
  await turn();
  assert.deepEqual(started, ['road']);
  loader.setDemand(['tank'], ['flare']);
  finish.get('road')();
  await turn();
  assert.deepEqual(started, ['road', 'tank']);
  assert.equal(loader.state('plant'), 'idle');
  finish.get('tank')();
  await turn();
  assert.deepEqual(started, ['road', 'tank', 'flare']);
  finish.get('flare')();
  await turn();
});

test('repeated requests share work and completed assets stay cached for reverse scrolling', async () => {
  let loads = 0, finish;
  const value = { scene: 'road' };
  const loader = createSceneLoader({ road: () => { loads++; return new Promise(resolve => { finish = resolve; }); } });
  const first = loader.request('road');
  assert.equal(loader.request('road', 100), first);
  await turn();
  finish(value);
  assert.equal(await first, value);
  assert.equal(await loader.request('road'), value);
  assert.equal(loads, 1);
  assert.equal(loader.state('road'), 'ready');
});

test('a failed asset does not retry every frame and other queued assets still load', async () => {
  let attempts = 0;
  const loader = createSceneLoader({
    tank: async () => { attempts++; throw new Error('offline'); },
    flare: async () => 'flare'
  });
  await assert.rejects(loader.request('tank'), /offline/);
  await assert.rejects(loader.request('tank'), /offline/);
  assert.equal(await loader.request('flare'), 'flare');
  assert.equal(attempts, 1);
  assert.equal(loader.state('tank'), 'error');
});

test('the loader never exceeds the configured concurrency', async () => {
  let running = 0, peak = 0;
  const finish = [];
  const task = () => { peak = Math.max(peak, ++running); return new Promise(resolve => finish.push(() => { running--; resolve(); })); };
  const loader = createSceneLoader({ a: task, b: task, c: task }, { concurrency: 2 });
  const work = ['a', 'b', 'c'].map(name => loader.request(name));
  await turn();
  assert.equal(finish.length, 2);
  finish.shift()();
  await turn();
  finish.splice(0).forEach(resolve => resolve());
  await Promise.all(work);
  assert.equal(peak, 2);
});
