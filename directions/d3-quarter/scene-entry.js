// The mobile hero already has an SVG mark. Start its 3D enhancement when the
// visitor explores the page, keeping initial reading and demo controls responsive.
const html = document.documentElement;
let started = false, wanted = false, settle = 0;
// The 3D module graph, fetched in parallel instead of one import level at a time
// (entry -> d3-gl -> three + scene modules -> data loader -> GLTF/meshopt loaders).
const GRAPH = [
  './d3-gl.js', '/quori/vendor/three.module.js', './scene-travel.mjs', './scene-loading.mjs', './tour-workflows.mjs',
  '/vendor/three@0.160.0/examples/jsm/loaders/SVGLoader.js', '/vendor/three@0.160.0/examples/jsm/environments/RoomEnvironment.js',
  '../data/quadrion-data.js', '/vendor/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  '/vendor/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js', '/vendor/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js',
  '/vendor/three@0.160.0/examples/jsm/math/MeshSurfaceSampler.js',
];
function preloadGraph() {
  for (const path of GRAPH) {
    const link = document.createElement('link');
    link.rel = 'modulepreload'; link.href = new URL(path, import.meta.url).href;
    document.head.append(link);
  }
}
function fallback() {
  html.classList.remove('gl-pending'); html.classList.add('no-webgl');
  dispatchEvent(new Event('d3:fallback'));
}
function start() {
  if (started) return;
  started = true;
  removeEventListener('scroll', explore);
  preloadGraph();
  import('./d3-gl.js').then(() => {
    html.classList.remove('gl-pending');
    if (html.classList.contains('gl-ready')) html.classList.remove('no-webgl');
    else fallback();
  }).catch(fallback);
}
// Phones: begin once the visitor has scrolled and the page is idle, so building the
// scene never lands in the middle of a scroll gesture.
function startWhenIdle() {
  if (started) return;
  if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 50);
}
function explore() {
  if (!wanted && scrollY <= 40) return;
  wanted = true;
  clearTimeout(settle);
  settle = setTimeout(startWhenIdle, 220);
}
function init() {
  if (!html.classList.contains('gl-pending')) start();
  else { addEventListener('scroll', explore, { passive: true }); explore(); }
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init, { once: true });
else init();
