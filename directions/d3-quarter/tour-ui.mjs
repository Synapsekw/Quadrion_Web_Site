import { WORKFLOWS, workflowState } from './tour-workflows.mjs';

const $ = (s, root = document) => root.querySelector(s);
const overrides = window.QWorkflowOverrides ||= {};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const controllers = new Map();
const dataCache = new Map();
const fmt = (n, decimals = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: decimals });
let selectedPile = 'P02', lastActive = '', tickAt = 0;

async function data(path) {
  if (!dataCache.has(path)) dataCache.set(path, fetch(path).then(r => {
    if (!r.ok) throw new Error('Evidence could not be loaded');
    return r.json();
  }).catch(error => { dataCache.delete(path); throw error; }));
  return dataCache.get(path);
}
function choose(scene, index) {
  overrides[scene] = index;
  dispatchEvent(new CustomEvent('d3:workflow', { detail: { scene, index } }));
  controllers.get(scene).key = '';
  updateScene(scene);
}
function evidenceShell(head, body, media = '', extra = '') {
  return `<div class="evidence-head">${head}</div>${media ? `<div class="evidence-media">${media}</div>` : ''}<div class="evidence-body">${body}</div>${extra}`;
}
function elevationLegend() {
  return '<div class="elevation-scale" aria-hidden="true"></div><div class="elevation-labels"><span>Lower elevation</span><span>Higher elevation</span></div>';
}

for (const [scene, config] of Object.entries(WORKFLOWS)) {
  const shot = $(`#shot-${scene}`);
  shot.classList.add('has-workflow');
  const controls = document.createElement('div');
  controls.className = 'workflow';
  controls.innerHTML = `<div class="workflow-steps" role="group" aria-label="${scene === 'plant' ? 'Terminal' : scene} views">${config.stages.map((s, i) => `<button type="button" data-step="${i}" aria-pressed="false"><span>${String(i + 1).padStart(2, '0')}</span>${s.label}</button>`).join('')}</div><p class="workflow-description"></p><button class="workflow-follow" type="button" hidden>Resume scroll tour</button>`;
  controls.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step) choose(scene, Number(step.dataset.step));
    else if (e.target.closest('.workflow-follow')) choose(scene, null);
  });
  const evidence = document.createElement('aside');
  evidence.className = 'workflow-evidence';
  evidence.hidden = true;
  evidence.setAttribute('aria-label', `${scene} evidence`);
  shot.append(controls, evidence);
  controllers.set(scene, { shot, controls, evidence, key: '', version: 0 });
}

async function updateScene(scene) {
  const c = controllers.get(scene);
  if (!c) return;
  const state = workflowState(scene, window.QS?.[scene] || 0, overrides[scene]);
  const key = `${state.index}:${state.manual}:${scene === 'stock' ? selectedPile : ''}`;
  if (key === c.key) return;
  c.key = key;
  const version = ++c.version;
  c.controls.querySelectorAll('[data-step]').forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.index)));
  $('.workflow-description', c.controls).textContent = state.description;
  $('.workflow-follow', c.controls).hidden = !state.manual;
  const oldVideo = $('video', c.evidence);
  oldVideo?.pause();
  c.evidence.hidden = true;
  c.evidence.className = 'workflow-evidence';
  c.evidence.replaceChildren();
  try {
    if (scene === 'plant' && state.id === 'elevation') {
      c.evidence.classList.add('evidence-wide');
      c.evidence.innerHTML = evidenceShell('POINT CLOUD / ELEVATION', `<h3>Height reveals the site.</h3><p>The same surveyed points, coloured by their measured elevation.</p>${elevationLegend()}`);
    }
    if (scene === 'tank' && state.id === 'issues') {
      c.evidence.innerHTML = evidenceShell('F01 / SEVERITY 5', '<h3>Crack in bottom plate</h3><p>Located in the scan, linked to the inspection photograph.</p><p class="mono">Bottom plate · 0.04 m</p>', '<img src="../data/tank/photos/F01_109_0256.jpg" width="1280" height="960" alt="Inspection photograph of a crack in the tank bottom plate">');
    }
    if (scene === 'tank' && state.id === 'interior') {
      c.evidence.classList.add('flight-evidence');
      c.evidence.innerHTML = evidenceShell('RECORDED INTERIOR FLIGHT', '<h3>Follow the drone inside.</h3><p>Recorded footage and its camera path, together in the tank model.</p>', '<video id="tank-flight-video" controls playsinline muted loop preload="metadata" poster="../data/tank/interior.jpg" aria-label="Recorded tank interior flight"><source src="../data/tank/interior.mp4" type="video/mp4"></video>');
    }
    if (scene === 'flare' && state.index >= 2) {
      const d = await data('../data/flare/data.json');
      if (version !== c.version) return;
      const r = d.records.find(r => r.id === ['F70', 'F44', 'F04'][state.index - 2]);
      if (!r) throw new Error('Finding unavailable');
      c.evidence.innerHTML = evidenceShell(`${r.id} / ${r.center[1].toFixed(1)} m`, '<h3></h3><p class="finding-description"></p><button class="evidence-toggle" type="button" aria-pressed="true">Corrosion mask on</button>', '<img class="finding-photo" width="1600" height="1067"><img class="evidence-mask" alt="Mapped corrosion mask" width="1600" height="1067">');
      $('h3', c.evidence).textContent = r.component;
      $('.finding-description', c.evidence).textContent = r.description;
      const photo = $('.finding-photo', c.evidence);
      photo.src = `../data/flare/patches/${r.photo}`;
      photo.alt = r.title;
      const mask = $('.evidence-mask', c.evidence);
      mask.src = `../data/flare/patches/${r.mask}`;
      $('.evidence-toggle', c.evidence).addEventListener('click', e => {
        mask.hidden = !mask.hidden;
        e.currentTarget.setAttribute('aria-pressed', String(!mask.hidden));
        e.currentTarget.textContent = `Corrosion mask ${mask.hidden ? 'off' : 'on'}`;
      });
    }
    if (scene === 'facade' && state.id === 'heatmap') {
      c.evidence.classList.add('evidence-wide');
      c.evidence.innerHTML = evidenceShell('FACADE / ISSUE HEATMAP', '<h3>Find the areas that need attention.</h3><p>656 graded issues mapped onto their actual surfaces. Colours identify defect classes; stronger shading highlights higher severity.</p><div class="pile-metrics"><div><b>474</b><span>Minor issues</span></div><div><b>182</b><span>Moderate issues</span></div></div>');
    }
    if (scene === 'facade' && ['rgb', 'thermal'].includes(state.id)) {
      const thermal = state.id === 'thermal';
      c.evidence.innerHTML = evidenceShell(thermal ? 'D397 / THERMAL ANOMALY' : 'D159 / STAINING', thermal ? '<h3>Look beyond the visible surface.</h3><p>Warm spot behind the west wall cladding.</p><p class="mono">West elevation · 36.3 m</p>' : '<h3>Trace the finding to its photograph.</h3><p>Run-off on the roof canopy fascia.</p><p class="mono">North elevation · 64.7 m</p>', thermal ? '<img src="../data/facade/photos/p2736.jpg" width="640" height="512" alt="Thermal photograph showing a warm area behind the tower cladding">' : '<img src="../data/facade/photos/p3038.jpg" width="1600" height="1200" alt="Roof canopy fascia with run-off staining"><img class="evidence-mask" src="../data/facade/photos/p3038-overlay.png" alt="Recorded defect classification overlay" width="1600" height="1200">');
    }
    if (scene === 'stock' && state.id === 'dsm') {
      c.evidence.classList.add('evidence-wide');
      c.evidence.innerHTML = evidenceShell('DSM / SURFACE ELEVATION', `<h3>Read the shape of the stockyard.</h3><p>Survey surface elevations reveal pile heights and terrain. Choose a numbered pile to inspect its boundary and volume.</p>${elevationLegend()}`);
    }
    if (scene === 'stock' && state.index >= 2) {
      const d = await data('../data/stockpile/volumes.json');
      if (version !== c.version) return;
      const p = d.piles.find(p => p.id === selectedPile) || d.piles[0];
      const a = p.epochs.e1, b = p.epochs.e2;
      const va = a.volumes.tin.net, vb = b.volumes.tin.net, delta = vb - va;
      const max = Math.max(va, vb, 1) * 1.22;
      const ya = 126 - (va / max) * 105, yb = 126 - (vb / max) * 105;
      c.evidence.classList.add('evidence-wide');
      c.evidence.innerHTML = evidenceShell('PILE BOUNDARY / SURVEY VOLUMES', `<label class="sr-only" for="pile-selector">Choose a stockpile</label><select class="pile-select" id="pile-selector">${d.piles.map(p => `<option value="${p.id}"${p.id === selectedPile ? ' selected' : ''}>${p.id} · ${p.name}</option>`).join('')}</select><div class="pile-metrics"><div><b>${fmt(b.areaM2, 1)} m²</b><span>Outlined area</span></div><div><b>${fmt(b.heightM, 2)} m</b><span>Pile height</span></div></div><svg class="pile-chart" viewBox="0 0 300 154" role="img" aria-label="${p.id} survey volume: ${fmt(va, 1)} cubic metres on 31 December 2020, ${fmt(vb, 1)} cubic metres on 10 January 2021"><path d="M44 126H260" stroke="#2A3340"/><path d="M60 ${ya}L240 ${yb}L240 126H60Z" fill="#5ed1b314"/><path d="M60 ${ya}L240 ${yb}" fill="none" stroke="#5ED1B3" stroke-width="2"/><circle cx="60" cy="${ya}" r="4" fill="#5ED1B3"/><circle cx="240" cy="${yb}" r="4" fill="#5ED1B3"/><text x="60" y="${ya - 12}" text-anchor="middle">${fmt(va)} m³</text><text x="240" y="${yb - 12}" text-anchor="middle">${fmt(vb)} m³</text><text x="60" y="146" text-anchor="middle">31 Dec 2020</text><text x="240" y="146" text-anchor="middle">10 Jan 2021</text><text x="30" y="130" text-anchor="end">0</text></svg><p class="pile-delta">${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))} m³ · ${delta < 0 ? 'decrease' : 'increase'}</p><p>Survey volume · triangulated toe base</p>`);
      $('#pile-selector', c.evidence).addEventListener('change', e => selectPile(e.target.value));
    }
    c.evidence.hidden = !c.evidence.hasChildNodes();
    const video = $('#tank-flight-video', c.evidence);
    if (video && !reduced && !document.hidden) {
      video.muted = true;
      video.play().catch(() => { /* Native controls remain available when autoplay is blocked. */ });
    }
  } catch {
    if (version !== c.version) return;
    c.evidence.classList.add('evidence-wide');
    c.evidence.innerHTML = evidenceShell('EVIDENCE', '<p>This evidence could not load. Select the view again to retry.</p>');
    c.evidence.hidden = false;
    // Keep this failed state until the visitor explicitly selects a view again.
  }
}

function selectPile(id) {
  if (!/^P\d{2}$/.test(id)) return;
  selectedPile = id;
  dispatchEvent(new CustomEvent('d3:pile', { detail: { id } }));
  choose('stock', 2);
}
const hotspots = document.createElement('div');
hotspots.className = 'pile-hotspots';
hotspots.setAttribute('role', 'group');
hotspots.setAttribute('aria-label', 'Select a measured stockpile');
controllers.get('stock').shot.append(hotspots);
const pileButtons = new Map();
let projectionAt = 0;
addEventListener('d3:pile-screen', ({ detail }) => {
  if (!detail.points.length) {
    hotspots.hidden = true;
    for (const b of pileButtons.values()) b.hidden = true;
    return;
  }
  const now = performance.now();
  if (now - projectionAt < 33) return;
  projectionAt = now;
  const s = workflowState('stock', window.QS?.stock || 0, overrides.stock);
  const visible = lastActive === 'stock' && s.index > 0;
  hotspots.hidden = !visible;
  if (!visible) return;
  const c = controllers.get('stock');
  const stageBox = c.shot.getBoundingClientRect();
  const occupied = [...c.controls.querySelectorAll('button:not([hidden])'), $('.shot-copy', c.shot), ...(c.evidence.hidden ? [] : [c.evidence])].map(el => el.getBoundingClientRect());
  const shown = new Set();
  for (const p of detail.points) {
    const x = p.x + stageBox.left, y = p.y + stageBox.top;
    if (y < 119 || occupied.some(r => x + 22 > r.left && x - 22 < r.right && y + 22 > r.top && y - 22 < r.bottom)) continue;
    shown.add(p.id);
    let b = pileButtons.get(p.id);
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'pile-hotspot';
      b.textContent = p.id; b.setAttribute('aria-label', `Inspect pile ${p.id}`);
      b.addEventListener('click', () => selectPile(p.id));
      pileButtons.set(p.id, b); hotspots.append(b);
    }
    b.hidden = false; b.style.left = `${p.x}px`; b.style.top = `${p.y}px`;
    b.setAttribute('aria-pressed', String(selectedPile === p.id));
  }
  for (const [id, b] of pileButtons) b.hidden = !shown.has(id);
});

function tick(now) {
  requestAnimationFrame(tick);
  if (document.hidden || now - tickAt < 100) return;
  tickAt = now;
  const current = $('.tix.is-live a.is-on')?.getAttribute('href')?.replace('#shot-', '') || '';
  if (lastActive && lastActive !== current) {
    const c = controllers.get(lastActive);
    c?.evidence.querySelector('video')?.pause();
    if (c) { c.version++; c.key = ''; }
    hotspots.hidden = true;
  }
  lastActive = current;
  if (controllers.has(current)) updateScene(current);
}
requestAnimationFrame(tick);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.querySelectorAll('.workflow-evidence video,.layer-visual video').forEach(v => v.pause());
});

const layers = {
  cloud: { src: 'previews/terminal-cloud.webp', alt: 'Captured colour points showing the eight storage tanks, pipework and jetty', badge: 'RGB · Point cloud', title: 'See the whole site.', caption: 'Tank terminal · captured survey points' },
  model: { src: 'previews/flare.webp', alt: 'Textured 3D reconstruction of an 80 metre flare stack', badge: 'GLB · 3D model', title: 'Understand the asset in 3D.', caption: 'Flare stack · textured reconstruction' },
  map: { src: '../data/plant/ortho.jpg', alt: 'Overhead orthomosaic of the terminal showing tanks, surrounding roads and jetty', badge: 'Ortho · Map', title: 'Keep the wider context.', caption: 'Tank terminal · georeferenced orthomosaic' },
  video: { badge: 'Video · Recorded flight', title: 'Go inside the asset.', caption: 'Tank interior · recorded drone footage' },
  issue: { src: '../data/flare/patches/F04.webp', alt: 'Inspection photograph of corrosion at a flare neck bolted connection', badge: 'F04 · Inspection evidence', title: 'Get to the evidence.', caption: 'Flare neck · corrosion at 76.7 m' },
};
const layerVideo = $('#layer-video');
$('.layer-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-layer]');
  if (!b) return;
  const layer = b.dataset.layer, d = layers[layer];
  $('.layer-tabs').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === b)));
  layerVideo.pause();
  layerVideo.hidden = layer !== 'video';
  $('#layer-image').hidden = layer === 'video';
  if (d.src) { $('#layer-image').src = d.src; $('#layer-image').alt = d.alt; }
  if (layer === 'video') {
    if (!layerVideo.getAttribute('src')) layerVideo.src = '../data/tank/interior.mp4';
    layerVideo.muted = true;
    layerVideo.play().catch(() => {});
  }
  $('#layer-badge').textContent = d.badge;
  $('#layer-title').textContent = d.title;
  $('#layer-caption').textContent = d.caption;
});
new IntersectionObserver(entries => { if (!entries[0].isIntersecting) layerVideo.pause(); }).observe($('.layer-browser'));
