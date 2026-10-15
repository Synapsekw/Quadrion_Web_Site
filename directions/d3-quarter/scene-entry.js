// The mobile hero already has an SVG mark. Start its 3D enhancement when the
// visitor explores the page, keeping initial reading and demo controls responsive.
const html = document.documentElement;
let started = false;
function fallback() {
  html.classList.remove('gl-pending'); html.classList.add('no-webgl');
  dispatchEvent(new Event('d3:fallback'));
}
function start() {
  if (started) return;
  started = true;
  removeEventListener('scroll', explore);
  import('./d3-gl.js').then(() => {
    html.classList.remove('gl-pending');
    if (html.classList.contains('gl-ready')) html.classList.remove('no-webgl');
    else fallback();
  }).catch(fallback);
}
function explore() { if (scrollY > 40) start(); }
function init() {
  if (!html.classList.contains('gl-pending')) start();
  else { addEventListener('scroll', explore, { passive: true }); explore(); }
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init, { once: true });
else init();
