// Dataset names are shared by the loader, app selector, and tour chapters.
export const datasetName = name => name === 'stock' || name === 'stock1' || name === 'stock2' ? 'stockpile' : name;

// Road geometry becomes ready before its separately fetched orthophoto tiles.
// A still is permanent, so every capture entry point must wait for their GPU
// upload (or failure), not merely for the scene-loader promise to resolve.
export function canCaptureStill(name, sceneReady, baseTiles) {
  if (!sceneReady) return false;
  if (name !== 'road') return true;
  return !!baseTiles?.requested && baseTiles.tiles.every(tile => tile.state === 1 || tile.state === -1);
}

// The same thresholds as the director. Derive demand from current state, not
// visited chapters, so direct links and reverse scrolling do not load a backlog.
export function sceneDemand(s, mode, selected = 'flare') {
  const none = { active: [], preload: [] };
  if (mode === 'app') return { active: [datasetName(selected)], preload: [] };
  if (mode !== 'stage') return none;
  if (!(s.zoom >= 0.999)) {
    return s.hero > 0.55 || s.sep > 0.05 || s.zoom > 0
      ? { active: [], preload: ['road'] } : none;
  }
  const names = ['road', 'plant', 'tank', 'flare', 'facade', 'stockpile'];
  const transitions = ['sweep', 'iris', 'rise', 'split', 'wipe1'];
  const progress = ['road', 'plant', 'tank', 'flare', 'facade'];
  for (let i = 0; i < transitions.length; i++) {
    const p = s[transitions[i]] || 0;
    if (p <= 0.0005) return {
      active: [names[i]],
      preload: s[progress[i]] >= 0.22 ? [names[i + 1]] : []
    };
    if (p < 0.9995) return {
      active: p < 0.5 ? [names[i], names[i + 1]] : [names[i + 1], names[i]],
      preload: []
    };
  }
  return { active: ['stockpile'], preload: [] };
}

// A task owns its entire fetch/build/warm cycle. Only one heavy scene is built
// at a time by default. Queued speculative work can be replaced after a jump;
// running work is retained and cached for the return journey.
export function createSceneLoader(tasks, { concurrency = 1, onState = () => {} } = {}) {
  const jobs = new Map();
  let running = 0, scheduled = false;
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  function change(job, state) { job.state = state; onState(job.name, state); }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  }
  function pump() {
    while (running < limit) {
      const job = [...jobs.values()].filter(j => j.state === 'queued').sort((a, b) => b.priority - a.priority)[0];
      if (!job) return;
      running++;
      change(job, 'loading');
      Promise.resolve().then(() => tasks[job.name]()).then(value => {
        change(job, 'ready'); job.resolve(value);
      }, error => {
        job.error = error; change(job, 'error'); job.reject(error);
      }).finally(() => { running--; schedule(); });
    }
  }
  function request(name, priority = 0) {
    name = datasetName(name);
    if (!Object.hasOwn(tasks, name)) return Promise.reject(new Error('Unknown scene: ' + name));
    let job = jobs.get(name);
    if (job) { job.priority = Math.max(priority, job.priority); return job.promise; }
    job = { name, priority, state: 'queued' };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    jobs.set(name, job);
    change(job, 'queued'); schedule();
    return job.promise;
  }
  function setDemand(active = [], preload = []) {
    const wanted = new Map();
    const want = (name, priority) => { name = datasetName(name); wanted.set(name, Math.max(priority, wanted.get(name) ?? -Infinity)); };
    preload.forEach((name, i) => want(name, 10 - i));
    active.forEach((name, i) => want(name, 100 - i));
    for (const [name, job] of jobs) {
      if (job.state !== 'queued') continue;
      if (wanted.has(name)) job.priority = wanted.get(name);
      else { jobs.delete(name); change(job, 'idle'); job.resolve(undefined); }
    }
    for (const [name, priority] of wanted) request(name, priority).catch(() => {});
  }
  return { request, setDemand, state: name => jobs.get(datasetName(name))?.state || 'idle' };
}
