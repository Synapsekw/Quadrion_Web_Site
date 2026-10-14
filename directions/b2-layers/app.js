/* =====================================================================
   Quadrion AI · Direction B2 · Layer Stack
   Four real assets, each an exploded stack that unfolds, fuses and hands over:
   tank terminal → storage tank interior → flare stack, 80 m → stockpile yard → one view.
   ===================================================================== */
import * as THREE from 'three';
import { load, samplePoints, stageTransform } from '../data/quadrion-data.js';
import { stockGrids } from './grids.js';
import { maskCanvas, SEV5 } from './bento.js';

window.__qInit = true;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const HTML = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const G = window.gsap, ST = window.ScrollTrigger;
const hasGSAP = !!(G && ST);
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (x, a, b) => clamp((x - a) / (b - a));
const ss = (t) => t * t * (3 - 2 * t);
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const qout = (t) => 1 - Math.pow(1 - t, 4);
const xout = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const xio = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2);
const bump = (x, a, b, c) => (x <= a || x >= c ? 0 : x < b ? (x - a) / (b - a) : 1 - (x - b) / (c - b));
// damped spring response (overshoots ~12% then settles) for scroll-scrubbed motion
const spr = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-6.2 * t) * Math.cos(9.8 * t) * (1 - t));
const narrow = () => innerWidth < 860 || innerWidth / innerHeight < 0.9;
const LITE = innerWidth < 860 || matchMedia('(pointer: coarse)').matches;
const NPTS = LITE ? 60000 : 120000;
const R = 10;
const yieldTask = () => new Promise((r) => setTimeout(r, 0));
const fmt = (v) => Math.round(v).toLocaleString('en-US');
const sgn = (v) => (v < 0 ? '−' : '+') + fmt(Math.abs(v));

class Spring {
  constructor(v = 0, k = 120, c = 18) { this.x = v; this.v = 0; this.t = v; this.k = k; this.c = c; }
  step(dt) { const a = this.k * (this.t - this.x) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
  snap() { this.x = this.t; this.v = 0; }
  get rest() { return Math.abs(this.t - this.x) < 1e-4 && Math.abs(this.v) < 1e-4; }
}

/* =====================================================================
   NAV, SMOOTH SCROLL, ANCHORS, REVEALS
   ===================================================================== */
const nav = $('#nav');
const onScrollNav = () => nav.classList.toggle('is-scrolled', scrollY > 24);
addEventListener('scroll', onScrollNav, { passive: true }); onScrollNav();

let lenis = null, storyST = null, fullMode = false, jumpTo = null;
if (hasGSAP) {
  G.registerPlugin(ST);
  ST.config({ ignoreMobileResize: true });
  if (window.Lenis && !reduced) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on('scroll', ST.update);
    G.ticker.add((t) => lenis.raf(t * 1000));
    G.ticker.lagSmoothing(0);
  }
}
$$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href'); if (id.length < 2) return;
  const el = $(id); if (!el) return;
  e.preventDefault();
  let y = el.getBoundingClientRect().top + scrollY;
  if (id === '#top') y = 0;
  const p = parseFloat(a.dataset.p);
  if (fullMode && storyST && !isNaN(p)) y = storyST.start + (storyST.end - storyST.start) * p;
  if (lenis) lenis.scrollTo(y, { duration: 2.0 }); else scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
}));

/* =====================================================================
   RENDERER
   ===================================================================== */
const stage = $('#stage'), canvas = $('#gl');
let renderer = null;
try {
  if (/[?&]nogl\b/.test(location.search)) throw new Error('nogl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, alpha: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no gl');
} catch (err) { renderer = null; }
const webgl = !!renderer;
fullMode = webgl && hasGSAP && !reduced;
HTML.classList.toggle('no-webgl', !webgl);
HTML.classList.toggle('static', !fullMode);

if (webgl) initStory();
setupReveals();
if (hasGSAP) { ST.sort && ST.sort(); ST.refresh(); }

function setupReveals() {
  if (!hasGSAP || reduced) return;
  $$('[data-reveal]').forEach((el) => {
    const targets = el.hasAttribute('data-stagger') ? Array.from(el.children) : [el];
    G.from(targets, { y: 30, opacity: 0, duration: 1.25, ease: 'expo.out', stagger: 0.075, scrollTrigger: { trigger: el, start: 'top 86%', once: true } });
  });
}

/* =====================================================================
   THE STORY
   ===================================================================== */
function initStory() {
  const C = (h) => new THREE.Color(h);
  const MINT = C('#5ED1B3'), LINE = C('#4A5868'), WHITE = C('#EEF2F5');
  const DPR = () => Math.min(devicePixelRatio || 1, LITE ? 1.5 : 2);
  renderer.setPixelRatio(DPR());
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const FOV = 30, camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 900);
  const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  scene.add(new THREE.HemisphereLight(0xe6edf2, 0x1a2128, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.55); sun.position.set(-5, 9, 6); scene.add(sun);
  const world = new THREE.Group(), inner = new THREE.Group(); scene.add(world); world.add(inner);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mk = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  const glowTex = (() => { const c = mk(64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return ctex(c); })();
  const setOp = (mats, f) => { for (const m of mats) { m.opacity = (m.userData.base ?? 1) * f; } };
  const base = (m, b = m.opacity) => { m.userData.base = b; return m; };

  /* ---------------- phase timeline (scroll progress 0..1) ---------------- */
  const T = {
    gapA: 0.028, gapB: 0.075, seamA: 0.066, seamB: 0.098,
    m1A: 0.104, m1B: 0.19, plantOutA: 0.104, plantOutB: 0.116,
    tankInA: 0.182, tankInB: 0.2, cutA: 0.198, cutB: 0.232, expA: 0.212, expB: 0.268, pinsA: 0.25, pinsB: 0.266,
    collA: 0.334, collB: 0.35, tankOutA: 0.349, tankOutB: 0.36, m2A: 0.352, m2B: 0.43,
    radA: 0.442, radB: 0.478, ignA: 0.446, ignB: 0.508, cardsA: 0.48, cardsB: 0.497, cardsOutA: 0.538, cardsOutB: 0.552,
    flareOutA: 0.584, flareOutB: 0.596, m3A: 0.588, m3B: 0.656,
    s1InA: 0.64, s1InB: 0.662, s2InA: 0.664, s2InB: 0.7, fuseA: 0.758, fuseB: 0.786, diffA: 0.782, diffB: 0.802, cntA: 0.786, cntB: 0.81,
    lineA: 0.82, lineB: 0.862, axisA: 0.85, axisB: 0.87, appA: 0.876, appB: 0.92,
  };

  /* ---------------- asset loading (lazy, one phase ahead) ---------------- */
  const AS = { plant: {}, tank: {}, flare: {}, stockpile: {} };
  const BUILD = {};
  const WAITLBL = { plant: 'STREAMING · TANK TERMINAL · 11 MB', tank: 'STREAMING · STORAGE TANK · 5 MB', flare: 'STREAMING · FLARE STACK · 19 MB', stockpile: 'STREAMING · STOCKPILE YARD · 6 MB' };
  function ensure(name) {
    const a = AS[name]; if (a.p) return a.p;
    a.st = 'loading';
    a.p = (async () => {
      const d = await load(name);
      const s = await samplePoints(name, NPTS, R);
      await yieldTask();
      await BUILD[name](d, s);
      a.st = 'ready';
      onReady(name);
    })().catch((err) => { a.st = 'error'; a.err = err; });
    return a.p;
  }
  const ready = (n) => AS[n].st === 'ready';
  let readyHooks = [];
  function onReady(name) { readyHooks.forEach((f) => f(name)); }
  function gate(p) {
    ensure('plant');
    if (ready('plant') || p > 0.06) ensure('tank');
    if ((ready('tank') && (!LITE || p > 0.08)) || p > 0.3) ensure('flare');
    if ((ready('flare') && (!LITE || p > 0.33)) || p > 0.55) ensure('stockpile');
  }

  /* =================================================================
     01 · TANK TERMINAL STACK (plant)
     ================================================================= */
  const OQ = { tl: [-1030.75, -212.79], tr: [1044.35, -886.99], br: [1447.85, 354.92], bl: [-627.25, 1029.13] };
  const OQc = [(OQ.tl[0] + OQ.tr[0] + OQ.br[0] + OQ.bl[0]) / 4, (OQ.tl[1] + OQ.tr[1] + OQ.br[1] + OQ.bl[1]) / 4];
  const OU = [OQ.tr[0] - OQ.tl[0], OQ.tr[1] - OQ.tl[1]], OV = [OQ.bl[0] - OQ.tl[0], OQ.bl[1] - OQ.tl[1]];
  const OW = Math.hypot(...OU), OH = Math.hypot(...OV);
  const PS = 22 / OW, HX = 11, HZ = OH * PS / 2;
  const theta = Math.atan2(OU[1], OU[0]);
  const plantM = new THREE.Matrix4().makeScale(PS, PS, PS).multiply(new THREE.Matrix4().makeRotationY(theta)).multiply(new THREE.Matrix4().makeTranslation(-OQc[0], 0, -OQc[1]));
  const GAP = 2.8;
  const plantRoot = new THREE.Group(); inner.add(plantRoot);

  function frameGeo(hx, hz, tick) {
    const c = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]], P = [];
    for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; P.push(a[0], 0, a[1], b[0], 0, b[1]); }
    for (const [x, z] of c) P.push(x, 0, z, x + Math.sign(x) * tick, 0, z, x, 0, z, x, 0, z + Math.sign(z) * tick);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); return g;
  }
  const pFrameGeo = frameGeo(HX, HZ, 0.5);
  const pPlane = new THREE.PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2);
  const LDEF = [
    { id: '01', name: 'Orthomosaic', d: 'The real aerial mosaic of the terminal, georeferenced and stored on your own disk.', st: '4096 × 2451 · 53 CM/PX' },
    { id: '02', name: 'Elevation', d: 'Contours and a height ramp generated from the photogrammetry cloud. Every pixel carries a real height.', st: '2.5 M CONTOURS' },
    { id: '03', name: 'Point cloud', d: 'Dense photogrammetry points with true colour, in the same coordinate system as everything else.', st: '378,789 PTS' },
    { id: '04', name: '3D model', d: 'The engineering model of the terminal: storage tanks, racks, jetty and buildings.', st: 'ENGINEERING MODEL' },
    { id: '05', name: 'Asset tags', d: 'Every storage tank and the jetty carry a tag in 3D. Findings attach to tags, so each photo and grade lands on the right asset.', st: 'TANKS + JETTY · TAGGED' },
  ];
  const layers = LDEF.map((d, i) => {
    const g = new THREE.Group(); plantRoot.add(g);
    const nat = new THREE.Group(); nat.matrixAutoUpdate = false; nat.matrix.copy(plantM); g.add(nat);
    const frameMat = new THREE.LineBasicMaterial({ color: LINE.clone(), transparent: true, opacity: 0.9 });
    const frame = new THREE.LineSegments(pFrameGeo, frameMat); frame.renderOrder = 60 + i; g.add(frame);
    const fillMat = new THREE.MeshBasicMaterial({ color: C('#121920'), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(pPlane, fillMat); fill.renderOrder = i * 10; g.add(fill);
    const hit = new THREE.Mesh(pPlane, new THREE.MeshBasicMaterial()); hit.visible = false; hit.userData.layer = i; g.add(hit);
    return { d, g, nat, frame, frameMat, fill, fillMat, hit, mats: [], lift: new Spring(0, 140, 17), dim: new Spring(1, 120, 18), hot: new Spring(0, 140, 20), appear: new Spring(0, 60, 14) };
  });
  // fused-plane seam + sweep
  const seamMat = new THREE.LineBasicMaterial({ color: MINT.clone(), transparent: true, opacity: 0 });
  const seam = new THREE.LineSegments(pFrameGeo, seamMat); seam.position.y = 0.02; seam.renderOrder = 90; plantRoot.add(seam);
  const sweepMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { uP: { value: 0 }, uA: { value: 0 }, uC: { value: MINT.clone() } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform float uP;uniform float uA;uniform vec3 uC;varying vec2 vUv;void main(){float d=(vUv.x*0.62+(1.0-vUv.y)*0.38)-uP;float band=exp(-d*d*1600.0)+0.28*exp(-d*d*80.0);gl_FragColor=vec4(uC*band*uA,clamp(band*uA,0.0,1.0)*0.7);\n#include <colorspace_fragment>\n}',
  });
  const sweep = new THREE.Mesh(pPlane, sweepMat); sweep.position.y = 0.05; sweep.renderOrder = 91; plantRoot.add(sweep);
  const plantPins = [];

  function keyOrtho(img) {
    const w = Math.min(img.width, LITE ? 2048 : 3072), h = Math.round(img.height * w / img.width);
    const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    const br = p[(2 * w + 2) * 4], bg = p[(2 * w + 2) * 4 + 1], bb = p[(2 * w + 2) * 4 + 2];
    for (let i = 0; i < p.length; i += 4) {
      const dd = Math.abs(p[i] - br) + Math.abs(p[i + 1] - bg) + Math.abs(p[i + 2] - bb);
      if (dd < 40) p[i + 3] = dd < 16 ? 0 : Math.round(255 * (dd - 16) / 24);
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  const MSQ = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]], [[3, 0]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
  function contour(x, f, gw, gh, s, L) {
    for (let j = 0; j < gh - 1; j++) {
      const r0 = j * gw, r1 = r0 + gw;
      for (let i = 0; i < gw - 1; i++) {
        const a = f[r0 + i], b = f[r0 + i + 1], c = f[r1 + i + 1], d = f[r1 + i];
        if (a !== a || b !== b || c !== c || d !== d) continue;
        const k = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (k === 0 || k === 15) continue;
        for (const seg of MSQ[k]) for (let q = 0; q < 2; q++) {
          const e = seg[q]; let X, Y;
          if (e === 0) { X = i + (L - a) / (b - a); Y = j; } else if (e === 1) { X = i + 1; Y = j + (L - b) / (c - b); } else if (e === 2) { X = i + (L - d) / (c - d); Y = j + 1; } else { X = i; Y = j + (L - a) / (d - a); }
          if (q === 0) x.moveTo(X * s, Y * s); else x.lineTo(X * s, Y * s);
        }
      }
    }
  }
  // Elevation layer: rasterise the real cloud heights into the orthomosaic's UV space, then hillshade + contour.
  function buildElevation(cloud) {
    const pos = cloud.geometry.attributes.position.array;
    const GW = LITE ? 384 : 512, GH = Math.round(GW * OH / OW), det = OU[0] * OV[1] - OU[1] * OV[0];
    const f = new Float32Array(GW * GH).fill(NaN);
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] - OQ.tl[0], dz = pos[i + 2] - OQ.tl[1];
      const u = (dx * OV[1] - dz * OV[0]) / det, v = (OU[0] * dz - OU[1] * dx) / det;
      const gi = Math.floor(u * GW), gj = Math.floor(v * GH);
      if (gi < 0 || gj < 0 || gi >= GW || gj >= GH) continue;
      const k = gj * GW + gi, y = pos[i + 1];
      if (!(f[k] >= y)) f[k] = y;
    }
    for (let pass = 0; pass < 4; pass++) {
      const g2 = f.slice();
      for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
        const k = j * GW + i; if (f[k] === f[k]) continue;
        let s = 0, n = 0; for (const o of [-1, 1, -GW, GW, -GW - 1, -GW + 1, GW - 1, GW + 1]) { const v = f[k + o]; if (v === v) { s += v; n++; } }
        if (n >= 3) g2[k] = s / n;
      }
      f.set(g2);
    }
    const sm = f.slice();
    for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i; if (f[k] !== f[k]) continue; let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = f[k + dj * GW + di]; if (v === v) { s += v; n++; } }
      sm[k] = s / n;
    }
    let lo = Infinity, hi = -Infinity; for (const v of sm) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const c0 = mk(GW, GH), x0 = c0.getContext('2d'), im = x0.createImageData(GW, GH), d = im.data;
    const RAMP = [[-4, [30, 44, 56]], [3, [52, 74, 88]], [14, [86, 112, 122]], [32, [150, 162, 170]], [55, [214, 220, 222]], [75, [246, 248, 248]]];
    const rampC = (h) => { for (let r = 1; r < RAMP.length; r++) if (h <= RAMP[r][0]) { const [a, ca] = RAMP[r - 1], [b, cb] = RAMP[r], t = clamp((h - a) / (b - a)); return [lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]; } return RAMP[RAMP.length - 1][1]; };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i, h = sm[k], o = k * 4;
      if (h !== h) { d[o + 3] = 0; continue; }
      const hx = sm[k + 1] === sm[k + 1] ? sm[k + 1] - h : 0, hz = sm[k + GW] === sm[k + GW] ? sm[k + GW] - h : 0;
      const shd = clamp(0.95 - (hx * 0.9 + hz * 0.6) * 0.16, 0.45, 1.35);
      const c = rampC(h);
      d[o] = c[0] * shd; d[o + 1] = c[1] * shd; d[o + 2] = c[2] * shd; d[o + 3] = 200 + 55 * clamp((h + 2) / 12);
    }
    x0.putImageData(im, 0, 0);
    const S = LITE ? 4 : 4, c = mk(GW * S, GH * S), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(c0, 0, 0, GW * S, GH * S);
    x.lineJoin = 'round';
    for (let L = Math.ceil(lo / 2.5) * 2.5; L < hi; L += 2.5) {
      const idx = Math.round(L / 2.5) % 4 === 0;
      x.beginPath(); contour(x, sm, GW, GH, S, L);
      x.strokeStyle = idx ? 'rgba(238,242,245,.62)' : 'rgba(197,205,214,.24)'; x.lineWidth = idx ? 1.5 : 0.9; x.stroke();
    }
    return { canvas: c, lo, hi };
  }

  // Bake many meshes into one indexed geometry with per-vertex material colour (one draw call).
  function bake(root, filter, colorOf, pre) {
    root.updateMatrixWorld(true);
    const list = []; let nv = 0, ni = 0;
    root.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position && filter(o)) { list.push(o); nv += o.geometry.attributes.position.count; ni += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; } });
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3), I = new Uint32Array(ni);
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), M = new THREE.Matrix4(), col = new THREE.Color();
    let vo = 0, io = 0, missing = false;
    for (const o of list) {
      const g = o.geometry, sp = g.attributes.position, sn = g.attributes.normal;
      M.copy(o.matrixWorld); if (pre) M.premultiply(pre);
      nm.getNormalMatrix(M); colorOf(o, col);
      for (let i = 0; i < sp.count; i++) {
        v.fromBufferAttribute(sp, i).applyMatrix4(M); P[(vo + i) * 3] = v.x; P[(vo + i) * 3 + 1] = v.y; P[(vo + i) * 3 + 2] = v.z;
        if (sn) { n.fromBufferAttribute(sn, i).applyMatrix3(nm).normalize(); N[(vo + i) * 3] = n.x; N[(vo + i) * 3 + 1] = n.y; N[(vo + i) * 3 + 2] = n.z; } else missing = true;
        Cc[(vo + i) * 3] = col.r; Cc[(vo + i) * 3 + 1] = col.g; Cc[(vo + i) * 3 + 2] = col.b;
      }
      if (g.index) for (let k = 0; k < g.index.count; k++) I[io + k] = g.index.getX(k) + vo; else for (let k = 0; k < sp.count; k++) I[io + k] = k + vo;
      io += g.index ? g.index.count : sp.count; vo += sp.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    out.setIndex(new THREE.BufferAttribute(I, 1));
    if (missing) out.computeVertexNormals();
    out.computeBoundingSphere();
    out.userData.parts = list.length;
    return out;
  }

  // Severity pin head sprites
  const ringGeo = new THREE.RingGeometry(0.17, 0.21, 48).rotateX(-Math.PI / 2);

  BUILD.plant = async (d, s) => {
    // 01 orthomosaic (real), background keyed out
    const keyed = keyOrtho(d.ortho.material.map.image);
    const og = d.ortho.geometry.clone(); const op = og.attributes.position; for (let i = 0; i < op.count; i++) op.setY(i, 0);
    const orthoMat = base(new THREE.MeshBasicMaterial({ map: ctex(keyed), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 1 }));
    const ortho = new THREE.Mesh(og, orthoMat); ortho.renderOrder = 1; layers[0].nat.add(ortho); layers[0].mats.push(orthoMat);
    await yieldTask();
    // 02 elevation from real cloud heights
    const el = buildElevation(d.cloud);
    const elevMat = base(new THREE.MeshBasicMaterial({ map: ctex(el.canvas), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.95 }));
    const elev = new THREE.Mesh(og, elevMat); elev.renderOrder = 11; layers[1].nat.add(elev); layers[1].mats.push(elevMat);
    LDEF[1].st = `${Math.round(el.hi - el.lo)} M RELIEF · 2.5 M CONTOURS`;
    await yieldTask();
    // 03 point cloud (real RGB)
    let cg = d.cloud.geometry;
    if (LITE) {
      const sp = cg.attributes.position.array, sc = cg.attributes.color.array, n = Math.floor(sp.length / 6);
      const P = new Float32Array(n * 3), Cc = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = sp[i * 6 + k]; Cc[i * 3 + k] = sc[i * 6 + k]; }
      cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(P, 3)); cg.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    }
    const cloudMat = base(new THREE.PointsMaterial({ size: 1.6 * DPR(), sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.95 }));
    const cloud = new THREE.Points(cg, cloudMat); cloud.renderOrder = 21; cloud.frustumCulled = false; layers[2].nat.add(cloud); layers[2].mats.push(cloudMat);
    plantCloudMat = cloudMat;
    await yieldTask();
    // 04 engineering model (sea + land planes hidden), baked to one draw call
    const box = new THREE.Box3(), sz = new THREE.Vector3();
    const keep = (o) => {
      box.setFromObject(o); box.getSize(sz);
      if (sz.length() > 1500) return false;
      if (sz.y < 0.5 && Math.max(sz.x, sz.z) > 800) return false;
      if (/Context_Indicative|Site_Terrain|Mainland|Land_Platform/i.test(o.parent?.name || '')) return false;
      return true;
    };
    const grey = new THREE.Color(0.55, 0.58, 0.62);
    const mg = bake(d.model, keep, (o, c) => { c.copy(o.material?.color || grey).lerp(grey, 0.35).multiplyScalar(0.92); });
    const modelMat = base(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 1 }));
    const model = new THREE.Mesh(mg, modelMat); model.renderOrder = 31; layers[3].nat.add(model); layers[3].mats.push(modelMat);
    LDEF[3].st = `${mg.userData.parts.toLocaleString('en-US')} PARTS · SEA + LAND HIDDEN`;
    // 05 asset tags: neutral tags on the real storage tanks and the jetty (no grades: the terminal has no findings here)
    const cand = [];
    d.model.traverse((o) => { if (/^\d\d-T-\d{4}[A-Z]?(_Outer_Tank)?$/i.test(o.name || '')) { const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) cand.push(b); } });
    const tanksB = [];
    cand.forEach((b) => { const sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()); if (Math.min(sz.x, sz.z) < 25 || Math.min(sz.x, sz.z) > 140) return; if (tanksB.some((q) => Math.hypot(q.c.x - c.x, q.c.z - c.z) < 30)) return; tanksB.push({ c, top: b.max.y }); });
    tanksB.sort((a, b) => (Math.round(a.c.z / 60) - Math.round(b.c.z / 60)) || a.c.x - b.c.x);
    const tags = tanksB.map((q, i) => ({ name: 'T-' + String(i + 1).padStart(2, '0'), x: q.c.x, z: q.c.z, top: q.top }));
    ['jetty1-loading-platform', 'jetty2-loading-platform'].forEach((n, i) => { const o = d.model.getObjectByName(n); if (!o) return; const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return; const c = b.getCenter(new THREE.Vector3()); tags.push({ name: 'JETTY ' + (i + 1), x: c.x, z: c.z, top: b.max.y, jetty: true }); });
    const tagCol = C('#8E99A6');
    tags.forEach((t, i) => {
      const tp = new THREE.Vector3(t.x, t.top, t.z).applyMatrix4(plantM);
      const g = new THREE.Group(); g.position.set(tp.x, 0, tp.z); layers[4].g.add(g);
      const top = tp.y + 0.7;
      const stemMat = base(new THREE.LineBasicMaterial({ color: tagCol, transparent: true, opacity: 0.7 }));
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, top, 0], 3));
      g.add(new THREE.Line(sg, stemMat));
      const c = mk(256, 64), x = c.getContext('2d');
      x.font = '500 30px "IBM Plex Mono", monospace'; const tw = x.measureText(t.name).width;
      x.fillStyle = 'rgba(11,15,19,.88)'; x.strokeStyle = 'rgba(94,209,179,.55)'; x.lineWidth = 2;
      x.beginPath(); x.roundRect ? x.roundRect(2, 10, tw + 52, 44, 8) : x.rect(2, 10, tw + 52, 44); x.fill(); x.stroke();
      x.fillStyle = '#5ED1B3'; x.fillRect(16, 26, 12, 12);
      x.fillStyle = '#E3E8EC'; x.textBaseline = 'middle'; x.fillText(t.name, 38, 33);
      const headMat = base(new THREE.SpriteMaterial({ map: ctex(c), sizeAttenuation: false, transparent: true, depthWrite: false, depthTest: false }), 1);
      const head = new THREE.Sprite(headMat); head.center.set(22 / 256, 0.5); head.position.y = top; head.renderOrder = 95; g.add(head);
      const ringMat = new THREE.MeshBasicMaterial({ color: MINT.clone(), transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 0.02; g.add(ring);
      layers[4].mats.push(stemMat, headMat);
      plantPins.push({ head, ring, ringMat, i, asp: 4 });
    });
    const nT = tags.filter((t) => !t.jetty).length, nJ = tags.length - nT;
    LDEF[4].st = `${nT} TANKS + ${nJ > 1 ? nJ + ' JETTY BERTHS' : 'JETTY'} · TAGGED`;
    resizeHeads();
    // morph A: the fused plant, as the real cloud sample
    morph1.set('A', plantToStage(s), s.colors, s.heights);
    layers.forEach((L, i) => setLabelStat(i));
  };
  let plantCloudMat = null;
  function plantToStage(s) {
    const n = s.positions.length / 3, out = new Float32Array(n * 3), v = new THREE.Vector3(), by = s.center.y - s.size.y / 2;
    for (let i = 0; i < n; i++) {
      v.set(s.positions[i * 3] / s.scale + s.center.x, s.positions[i * 3 + 1] / s.scale + by, s.positions[i * 3 + 2] / s.scale + s.center.z).applyMatrix4(plantM);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    return out;
  }

  /* =================================================================
     MORPHING POINTS (one buffer pair per handover)
     ================================================================= */
  const MV = `
uniform float uT; uniform float uSize; uniform float uPx; uniform float uAlpha; uniform float uMode; uniform float uScan; uniform vec3 uMint;
attribute vec3 aB; attribute vec3 aCA; attribute vec3 aCB; attribute vec4 aR; attribute float aHA; attribute float aHB;
varying vec3 vC; varying float vA;
#define PI 3.14159265
float eio(float t){ return t < .5 ? 4.*t*t*t : 1. - pow(-2.*t + 2., 3.) * .5; }
float eo(float t){ float u = 1. - t; return 1. - u*u*u; }
vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t){ float u = 1. - t; return u*u*u*a + 3.*u*u*t*b + 3.*u*t*t*c + t*t*t*d; }
vec3 turb(vec3 p){ return vec3(sin(p.y*1.7 + p.z*.6) + sin(p.z*2.3 + 1.3), sin(p.z*1.9 + p.x*.7) + sin(p.x*1.3 + 2.1), sin(p.x*2.1 + p.y*.5) + sin(p.y*1.1 + 4.2)) * .5; }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }
void main(){
  vec3 A = position, B = aB, P; vec3 col; float sz = 1.; float al = 1.;
  if (uMode < .5) {
    // SHATTER: radial wave from the centre, particles burst up through curl-ish turbulence and re-form
    float d = clamp(length(A.xz) / 12., 0., 1.) * .42 + aR.x * .12;
    float t = clamp((uT - d) / .46, 0., 1.), e = eio(t);
    vec3 dir = normalize(vec3(aR.y - .5, 0., aR.z - .5) + vec3(1e-4, 0., 0.));
    vec3 c1 = A + vec3(0., 2.5 + 6.5 * aR.w, 0.) + dir * (1.5 + 4. * aR.x);
    vec3 rb = vec3(B.x, 0., B.z); float lb = length(rb);
    vec3 c2 = B + (lb > 1e-3 ? rb / lb : dir) * (2.5 + 3. * aR.y) + vec3(0., 1., 0.);
    float s = sin(PI * e);
    P = bez(A, c1, c2, B, e) + turb(A * .35 + vec3(uT * 3.)) * s * 1.4;
    col = mix(aCA, aCB, smoothstep(.35, .85, e));
    col = mix(col, uMint, s * step(aR.w, .2) * .85);
    sz = 1. + .8 * s;
  } else if (uMode < 1.5) {
    // COLUMN RISE: drain to a ring on the ground, then rise bottom-up into the stack
    float t1 = clamp((uT - (1. - aHA) * .15 - aR.x * .05) / .2, 0., 1.);
    float t2 = clamp((uT - .4 - aHB * .42 - aR.x * .04) / .14, 0., 1.);
    float ang = aR.y * 6.2832, rad = .35 + aR.z * 2.4;
    vec3 Gp = vec3(cos(ang) * rad, .03, sin(ang) * rad);
    if (t2 <= 0.) {
      float e = eio(t1);
      P = bez(A, A + vec3(0., .8, 0.), vec3(Gp.x * 1.6, Gp.y + 1.2, Gp.z * 1.6), Gp, e);
      P.xz = rot(P.xz, e * 1.4);
      col = mix(aCA, aCA * .5, e);
      sz = 1. - .3 * e;
    } else {
      float e = eo(t2);
      P = mix(Gp, B, e);
      P.xz = rot(P.xz, (1. - e) * 2.8);
      col = mix(uMint, aCB, smoothstep(.6, 1., t2));
      col = mix(aCA * .5, col, smoothstep(0., .2, t2));
      sz = 1. + .7 * sin(PI * t2);
    }
    al = smoothstep(uScan - .015, uScan + .02, aHB);
  } else {
    // DISSOLVE AND FALL: the stack sheds from the top, points fall, land and spread into the yard
    float d = (1. - aHA) * .42 + aR.x * .08;
    float t = clamp((uT - d) / .5, 0., 1.);
    float f = clamp(t / .55, 0., 1.);
    vec3 dir = normalize(vec3(aR.y - .5, 0., aR.z - .5) + vec3(1e-4, 0., 0.));
    vec3 drift = dir * (.4 + aR.z * 2.6) * f;
    vec3 L = vec3(A.x, 0., A.z) + drift;
    float s = clamp((t - .55) / .45, 0., 1.), es = eo(s);
    if (t < .55) P = vec3(A.x, A.y * (1. - f * f), A.z) + drift;
    else P = mix(L, B, es) + vec3(0., sin(PI * s) * (.4 + .9 * aR.w), 0.);
    col = mix(aCA, aCB, s);
    col = mix(col, uMint, step(aR.w, .12) * sin(PI * f) * .6);
    sz = 1. + .45 * sin(PI * f);
  }
  vC = col; vA = uAlpha * al;
  vec4 mv = modelViewMatrix * vec4(P, 1.);
  gl_PointSize = max(1., uSize * sz * uPx / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
  const MF = `varying vec3 vC; varying float vA;
void main(){ vec2 c = gl_PointCoord - .5; float d = length(c); if (d > .5 || vA < .003) discard; gl_FragColor = vec4(vC, vA * smoothstep(.5, .3, d));
#include <colorspace_fragment>
}`;
  class Morph {
    constructor(n, mode) {
      const g = new THREE.BufferGeometry();
      this.n = n;
      const att = (k, sz) => { const a = new THREE.BufferAttribute(new Float32Array(n * sz), sz); g.setAttribute(k, a); return a; };
      this.at = { A: att('position', 3), B: att('aB', 3), CA: att('aCA', 3), CB: att('aCB', 3), HA: att('aHA', 1), HB: att('aHB', 1) };
      const r = new Float32Array(n * 4); for (let i = 0; i < r.length; i++) r[i] = Math.random(); g.setAttribute('aR', new THREE.BufferAttribute(r, 4));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), 80);
      this.u = { uT: { value: 0 }, uSize: { value: 0.075 }, uPx: { value: 600 }, uAlpha: { value: 1 }, uMode: { value: mode }, uScan: { value: -1 }, uMint: { value: MINT.clone() } };
      this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: MV, fragmentShader: MF, transparent: true, depthWrite: false });
      this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.visible = false; this.pts.renderOrder = 120; inner.add(this.pts);
    }
    set(which, pos, col, h) {
      const p = which === 'A' ? this.at.A : this.at.B, c = which === 'A' ? this.at.CA : this.at.CB, hh = which === 'A' ? this.at.HA : this.at.HB;
      p.array.set(pos.subarray ? pos.subarray(0, this.n * 3) : pos); c.array.set(col.subarray(0, this.n * 3)); hh.array.set(h.subarray(0, this.n));
      p.needsUpdate = c.needsUpdate = hh.needsUpdate = true;
    }
  }
  // procedural placeholders so every handover can run before its data lands
  function ph(kind, n) {
    const P = new Float32Array(n * 3), Cc = new Float32Array(n * 3), H = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let x, y, z, g;
      if (kind === 'plant') { x = (Math.random() - 0.5) * 2 * HX * 0.85; z = (Math.random() - 0.5) * 2 * HZ * 0.6; y = Math.random() * 0.2; g = 0.32 + Math.random() * 0.2; }
      else if (kind === 'tank') { const a = Math.random() * 6.2832, top = Math.random() < 0.18; y = top ? 19.2 + Math.random() * 0.6 : Math.random() * 19.2; const r = top ? Math.sqrt(Math.random()) * 5 : 5; x = Math.cos(a) * r; z = Math.sin(a) * r; g = 0.35 + Math.random() * 0.3; }
      else if (kind === 'flare') { const a = Math.random() * 6.2832, base = Math.random() < 0.12; y = base ? Math.random() * 0.4 : Math.random() * 20; const r = base ? 1.5 * Math.sqrt(Math.random()) : 0.56; x = Math.cos(a) * r; z = Math.sin(a) * r; g = 0.45 + Math.random() * 0.2; }
      else { x = (Math.random() - 0.5) * 18; z = (Math.random() - 0.5) * 20; y = 0.2 * Math.sin(x * 0.7) * Math.cos(z * 0.5) + 0.2; g = 0.4 + Math.random() * 0.15; }
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; Cc[i * 3] = g * 0.92; Cc[i * 3 + 1] = g * 0.9; Cc[i * 3 + 2] = g * 0.86; H[i] = clamp(y / 20);
    }
    return { P, Cc, H };
  }
  const morph1 = new Morph(NPTS, 0), morph2 = new Morph(NPTS, 1), morph3 = new Morph(NPTS, 2);
  morph2.u.uSize.value = 0.062; morph3.u.uSize.value = 0.05;
  { const a = ph('plant', NPTS), b = ph('tank', NPTS), c = ph('flare', NPTS), e = ph('pile', NPTS);
    morph1.set('A', a.P, a.Cc, a.H); morph1.set('B', b.P, b.Cc, b.H);
    morph2.set('A', b.P, b.Cc, b.H); morph2.set('B', c.P, c.Cc, c.H);
    morph3.set('A', c.P, c.Cc, c.H); morph3.set('B', e.P, e.Cc, e.H); }

  /* =================================================================
     02 · STORAGE TANK INTERIOR
     ================================================================= */
  const tankRoot = new THREE.Group(); tankRoot.visible = false; inner.add(tankRoot);
  const TB = [-1, 3, 5.5, 8, 99], TGAP = 2.7;
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
  const tank = { bands: [], mats: [], ringMat: null, findings: [], scale: 1, r: 5, ready: false };
  const BAND_NAMES = ['COURSE 1 · 0–3 M', 'COURSE 2 · 3–5.5 M', 'COURSE 3 · 5.5–8 M', 'ROOF · 8–9.5 M'];
  BUILD.tank = async (d, s) => {
    const tm = await stageTransform('tank', R, NPTS);
    tank.scale = new THREE.Vector3().setFromMatrixScale(tm).x;
    const cb = d.cloud.geometry.boundingBox; const rN = Math.max(cb.max.x - cb.min.x, cb.max.z - cb.min.z) / 2 + 0.02;
    tank.r = rN * tank.scale; tank.rN = rN;
    const shellMat = base(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [cutPlane], transparent: true, opacity: 1 }));
    const cloudMat = base(new THREE.PointsMaterial({ size: LITE ? 0.085 : 0.07, vertexColors: true, clippingPlanes: [cutPlane], transparent: true, depthWrite: false, opacity: 1 }));
    const ringMat = base(new THREE.LineBasicMaterial({ color: LINE.clone(), transparent: true, opacity: 0.9 }));
    tank.mats.push(shellMat, cloudMat, ringMat); tank.ringMat = ringMat; tank.shellMat = shellMat; tank.cloudMat = cloudMat;
    const bandOf = (y) => (y < TB[1] ? 0 : y < TB[2] ? 1 : y < TB[3] ? 2 : 3);
    const bx = new THREE.Box3(), cc = new THREE.Vector3();
    const shellCol = (o, c) => { c.copy(o.material?.color || WHITE).multiplyScalar(0.9); };
    // cloud split into bands (decimated on mobile)
    const cp = d.cloud.geometry.attributes.position.array, ccol = d.cloud.geometry.attributes.color.array, step = LITE ? 2 : 1;
    const bucket = [[], [], [], []];
    for (let i = 0; i < cp.length / 3; i += step) bucket[bandOf(cp[i * 3 + 1])].push(i);
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group(); tankRoot.add(g);
      const nat = new THREE.Group(); nat.matrixAutoUpdate = false; nat.matrix.copy(tm); g.add(nat);
      const sg = bake(d.model, (o) => o.parent?.name !== 'Lining' && bandOf(bx.setFromObject(o).getCenter(cc).y) === k, shellCol);
      const shell = new THREE.Mesh(sg, shellMat); shell.renderOrder = 40; nat.add(shell);
      const ids = bucket[k], P = new Float32Array(ids.length * 3), Cc = new Float32Array(ids.length * 3);
      ids.forEach((id, j) => { for (let q = 0; q < 3; q++) { P[j * 3 + q] = cp[id * 3 + q]; Cc[j * 3 + q] = ccol[id * 3 + q] * 1.05; } });
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(P, 3)); pg.setAttribute('color', new THREE.BufferAttribute(Cc, 3)); pg.computeBoundingSphere();
      const pts = new THREE.Points(pg, cloudMat); pts.renderOrder = 41; nat.add(pts);
      // course rings at the cut lines (the sliced-cylinder signature)
      const y0 = Math.max(0, TB[k]), y1 = Math.min(9.4, TB[k + 1]), RP = [];
      for (const y of [y0, y1]) for (let a = 0; a < 96; a++) { const t0 = a / 96 * Math.PI * 2, t1 = (a + 1) / 96 * Math.PI * 2; RP.push(Math.cos(t0) * rN, y, Math.sin(t0) * rN, Math.cos(t1) * rN, y, Math.sin(t1) * rN); }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(RP, 3));
      const ring = new THREE.LineSegments(rg, ringMat); ring.renderOrder = 42; nat.add(ring);
      tank.bands.push({ g, nat, y0, y1, mid: (y0 + y1) / 2 });
    }
    tank.findings = d.findings.map((f) => ({ f, band: bandOf(f.position.y), local: f.position.clone() }));
    morph1.set('B', s.positions, s.colors, s.heights);
    morph2.set('A', s.positions, s.colors, s.heights);
    tank.ready = true;
    buildTankDom();
  };

  /* =================================================================
     03 · FLARE STACK, 80 M
     ================================================================= */
  const flareRoot = new THREE.Group(); flareRoot.visible = false; inner.add(flareRoot);
  const scanPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
  const flare = { mats: [], patches: [], H: 20, scale: 0.25, ready: false, headY: 19.2 };
  const CARD_IDS = LITE ? ['F04', 'F44', 'F69'] : ['F04', 'F44', 'F61', 'F69'];
  BUILD.flare = async (d, s) => {
    const fm = await stageTransform('flare', R, NPTS);
    flare.scale = new THREE.Vector3().setFromMatrixScale(fm).x;
    const nat = new THREE.Group(); nat.matrixAutoUpdate = false; nat.matrix.copy(fm); flareRoot.add(nat);
    d.model.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material, m = base(new THREE.MeshBasicMaterial({ map: old.map || null, color: old.map ? 0xffffff : 0x9aa3ab, clippingPlanes: [scanPlane], transparent: true, opacity: 1, side: THREE.DoubleSide }));
      if (m.map) m.map.anisotropy = maxAniso;
      o.material = m; o.renderOrder = 50; flare.mats.push(m); old.dispose?.();
    });
    nat.add(d.model);
    const pnat = new THREE.Group(); pnat.matrixAutoUpdate = false; pnat.matrix.copy(fm); flareRoot.add(pnat);
    const order = d.patches.map((p, i) => i).sort((a, b) => d.patches[a].center.y - d.patches[b].center.y);
    const SEVF = { 1: '#E8C547', 2: '#F2994A', 3: '#E5484D' };
    d.patches.forEach((p, i) => {
      const g = new THREE.Group(); pnat.add(g);
      p.mesh.material.clippingPlanes = [scanPlane]; p.mesh.material.opacity = 0; p.mesh.renderOrder = 55; g.add(p.mesh);
      const sm = new THREE.SpriteMaterial({ map: glowTex, color: C(SEVF[p.record.severity] || SEVF[2]), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const sp = new THREE.Sprite(sm); sp.position.copy(p.center); const gs = 0.9 + Math.sqrt(p.record.coverage || 0.1) * 0.55; sp.scale.set(gs, gs, 1); sp.renderOrder = 56; g.add(sp);
      const dir = new THREE.Vector3(p.center.x, 0, p.center.z); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
      flare.patches.push({ p, g, sm, dir, rank: order.indexOf(i) / Math.max(1, d.patches.length - 1) });
    });
    flareRoot.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(nat); flare.H = bb.max.y; flare.r = Math.max(bb.max.x, -bb.min.x);
    flare.headY = new THREE.Vector3(0, 76.6, 0).applyMatrix4(fm).y;
    flare.byId = Object.fromEntries(flare.patches.map((q) => [q.p.record.id, q]));
    morph2.set('B', s.positions, s.colors, s.heights);
    morph3.set('A', s.positions, s.colors, s.heights);
    flare.ready = true;
    buildFlareDom();
  };

  /* =================================================================
     04 · STOCKPILE YARD (two surveys)
     ================================================================= */
  const pileRoot = new THREE.Group(); pileRoot.visible = false; inner.add(pileRoot);
  const SGAP = 5.2;
  const diffU = { value: 0 };
  const pile = { s: [], callouts: [], ready: false };
  const CALL_IDS = LITE ? ['P02', 'P05', 'P15'] : ['P02', 'P05', 'P18', 'P15'];
  BUILD.stockpile = async (d, s) => {
    const sm = await stageTransform('stockpile', R, NPTS);
    const g = await stockGrids();
    pile.sm = sm; pile.g = g;
    for (const [k, root] of [[0, d.e1], [1, d.e2]]) {
      const grp = new THREE.Group(); pileRoot.add(grp);
      const nat = new THREE.Group(); nat.matrixAutoUpdate = false; nat.matrix.copy(sm); grp.add(nat);
      const mats = [];
      root.traverse((o) => {
        if (o.isMesh) {
          const m = base(new THREE.MeshBasicMaterial({ map: o.material.map || null, transparent: true, opacity: 1 }));
          if (m.map) m.map.anisotropy = maxAniso;
          if (k === 1) {
            const pos = o.geometry.attributes.position, df = new Float32Array(pos.count), v = new THREE.Vector3();
            o.updateMatrixWorld(true);
            for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const h1 = g.at(g.h1, v.x, v.z); df[i] = h1 === h1 ? v.y - h1 : 0; }
            o.geometry.setAttribute('aDiff', new THREE.BufferAttribute(df, 1));
            m.onBeforeCompile = (sh) => {
              sh.uniforms.uDiff = diffU;
              sh.vertexShader = 'attribute float aDiff;\nvarying float vDiff;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDiff = aDiff;');
              sh.fragmentShader = 'uniform float uDiff;\nvarying float vDiff;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{ float a = smoothstep(0.1, 2.2, abs(vDiff)); vec3 dc = vDiff < 0.0 ? vec3(0.78, 0.065, 0.074) : vec3(0.104, 0.33, 0.665);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.42, dc, a * 0.9), uDiff); }`);
            };
            m.customProgramCacheKey = () => 'diff';
          }
          o.material.dispose?.(); o.material = m; o.renderOrder = 30 + k; mats.push(m);
        } else if (o.isLine || o.isLineSegments) {
          const m = base(new THREE.LineBasicMaterial({ color: C('#E8C547'), transparent: true, opacity: 0.55 }));
          o.material.dispose?.(); o.material = m; o.renderOrder = 33; mats.push(m);
        }
      });
      nat.add(root);
      grp.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(nat), w = bb.max.x - bb.min.x, dd = bb.max.z - bb.min.z, th = 0.34;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, th, dd), base(new THREE.MeshBasicMaterial({ color: C('#0E1318'), transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 })));
      body.position.set((bb.min.x + bb.max.x) / 2, bb.min.y - th / 2 + 0.02, (bb.min.z + bb.max.z) / 2); grp.add(body);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), base(new THREE.LineBasicMaterial({ color: LINE.clone(), transparent: true, opacity: 1 })));
      edges.position.copy(body.position); grp.add(edges);
      mats.push(body.material, edges.material);
      pile.s.push({ grp, nat, mats, edgeMat: edges.material, bb });
    }
    pile.top = pile.s[0].bb.max.y;
    const v = new THREE.Vector3();
    pile.callouts = CALL_IDS.map((id) => { const q = g.piles.find((x) => x.id === id); if (!q) return null; v.set(q.x, q.top, q.z).applyMatrix4(sm); return { q, pos: v.clone() }; }).filter(Boolean);
    const sp = s.positions.slice(); morph3.set('B', sp, s.colors, s.heights);
    pile.ready = true;
    buildPileDom();
  };

  /* =================================================================
     05 · FINALE: four slabs on one timeline
     ================================================================= */
  const SLOT_D = [[-16.5, 0, 0], [-5.5, 0, 0], [5.5, 0, 0], [16.5, 0, 0]];
  const SLOT_M = [[-5.6, 0, -6.6], [5.6, 0, -6.6], [-5.6, 0, 6.6], [5.6, 0, 6.6]];
  const SLOT_S = [0.4, 0.42, 0.42, 0.46];
  // app viewport: scale per asset and [targetY, dirX, dirY, dirZ, needW, needH]
  const APP_S = [0.95, 0.92, 0.9, 1.0];
  const APPK = [[0.6, 0.75, 0.95, 1.1, 25, 12], [9.8, 1, 0.42, 1.15, 18, 23.5], [9.0, 1, 0.3, 1.1, 13, 20], [0.5, 0.8, 0.95, 1.1, 24, 13]];
  const plinths = [0, 1, 2, 3].map((i) => {
    const g = new THREE.Group(); inner.add(g); g.visible = false;
    const geo = new THREE.BoxGeometry(10.4, 0.42, 10.4); geo.translate(0, -0.23, 0);
    const bm = base(new THREE.MeshBasicMaterial({ color: C('#0F151B'), transparent: true, opacity: 0.96, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    const em = base(new THREE.LineBasicMaterial({ color: LINE.clone(), transparent: true, opacity: 1 }));
    g.add(new THREE.Mesh(geo, bm), new THREE.LineSegments(new THREE.EdgesGeometry(geo), em));
    return { g, bm, em, mats: [bm, em], lift: new Spring(0, 150, 16), hot: new Spring(0, 150, 18) };
  });
  const axisMat = new THREE.LineBasicMaterial({ color: C('#8E99A6'), transparent: true, opacity: 0 });
  const axis = new THREE.LineSegments(new THREE.BufferGeometry(), axisMat); inner.add(axis);
  function buildAxis() {
    const P = [], z = 6.6;
    if (!mobile) { P.push(-23, 0, z, 23, 0, z); for (let x = -22; x <= 22; x += 1.1) P.push(x, 0, z, x, 0, z + 0.18); SLOT_D.forEach(([x]) => P.push(x, 0, z - 0.35, x, 0, z + 0.5)); P.push(23, 0, z, 22.4, 0, z - 0.3, 23, 0, z, 22.4, 0, z + 0.3); }
    else { for (const zz of [-1.0, 12.2]) { P.push(-11.5, 0, zz, 11.5, 0, zz); [-5.6, 5.6].forEach((x) => P.push(x, 0, zz - 0.35, x, 0, zz + 0.5)); } }
    axis.geometry.dispose(); axis.geometry = new THREE.BufferGeometry(); axis.geometry.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  }

  /* =================================================================
     DOM OVERLAYS
     ================================================================= */
  const labelsWrap = $('#labels'), leaders = $('#leaders'), tip = $('#tip'), fcard = $('#fcard');
  const heroCopy = $('#heroCopy'), cue = $('#cue'), rail = $('#rail'), railItems = $$('a', rail), hud = $('#hud'), hudXY = $('#hudXY'), hudT = $('#hudT'), waitEl = $('#wait'), waitT = $('#waitT');
  const caps = $$('.cap', stage);
  const SVGNS = 'http://www.w3.org/2000/svg';
  class Ov {
    constructor(el) { this.el = el; this.o = 0; this.x = NaN; this.y = NaN; this.w = 0; this.h = 0; el.classList.add('o'); }
    measure() { this.w = this.el.offsetWidth; this.h = this.el.offsetHeight; }
    set(x, y, op) {
      if (!(op > 0.004)) { if (this.o !== 0) { this.el.style.opacity = '0'; this.el.style.visibility = 'hidden'; this.o = 0; } return false; }
      if (this.o === 0) this.el.style.visibility = 'visible';
      if (Math.abs(op - this.o) > 0.002) { this.el.style.opacity = op.toFixed(3); this.o = op; }
      if (!(Math.abs(x - this.x) <= 0.15 && Math.abs(y - this.y) <= 0.15)) { this.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`; this.x = x; this.y = y; }
      return true;
    }
  }
  class Ld {
    constructor() { this.p = document.createElementNS(SVGNS, 'path'); this.c = document.createElementNS(SVGNS, 'circle'); this.p.setAttribute('fill', 'none'); this.p.setAttribute('stroke-width', '1'); this.c.setAttribute('r', '2.2'); leaders.append(this.p, this.c); this.o = -1; this.col = ''; this.d = ''; }
    set(d, cx, cy, col, op) {
      if (!(op > 0.004)) { if (this.o !== 0) { this.p.style.opacity = '0'; this.c.style.opacity = '0'; this.o = 0; } return; }
      if (d !== this.d) { this.p.setAttribute('d', d); this.c.setAttribute('cx', cx.toFixed(1)); this.c.setAttribute('cy', cy.toFixed(1)); this.d = d; }
      if (col !== this.col) { this.p.setAttribute('stroke', col); this.c.setAttribute('fill', col); this.col = col; }
      if (Math.abs(op - this.o) > 0.002) { this.p.style.opacity = op.toFixed(3); this.c.style.opacity = op.toFixed(3); this.o = op; }
    }
  }
  const allOv = [];
  const mkOv = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; labelsWrap.appendChild(e); const o = new Ov(e); allOv.push(o); return o; };

  // hero layer labels
  let hoverLabel = -1, hoverRay = -1, hover = -1, shownTip = -2;
  layers.forEach((L, i) => {
    const o = mkOv('button', 'lbl two load', `<b>${L.d.id}</b><span class="nm">· ${L.d.name.toUpperCase()}</span><em>STREAMING</em>`);
    o.el.type = 'button'; o.el.setAttribute('aria-label', `Layer ${L.d.id}, ${L.d.name}: ${L.d.d}`);
    o.el.addEventListener('pointerenter', () => { hoverLabel = i; }); o.el.addEventListener('pointerleave', () => { if (hoverLabel === i) hoverLabel = -1; });
    o.el.addEventListener('focus', () => { hoverLabel = i; }); o.el.addEventListener('blur', () => { if (hoverLabel === i) hoverLabel = -1; });
    L.lbl = o; L.ld = new Ld();
  });
  function setLabelStat(i) { const L = layers[i]; L.lbl.el.classList.remove('load'); $('em', L.lbl.el).textContent = LDEF[i].st; L.lbl.measure(); }
  const tipK = $('.k', tip), tipH = $('h4', tip), tipP = $('p', tip), tipM = $('.m', tip);

  // tank overlays
  const tankLbl = [
    { o: mkOv('div', 'lbl', '<b>01</b><span class="nm">· OUTER SHELL</span><em>3 COURSES + ROOF</em>'), ld: new Ld() },
    { o: mkOv('div', 'lbl', '<b>02</b><span class="nm">· LIDAR INTERIOR</span><em>280,000 PTS · 2 CM</em>'), ld: new Ld() },
    { o: mkOv('div', 'lbl', '<b>03</b><span class="nm">· FINDINGS</span><em>6 GRADED · HOVER A PIN</em>'), ld: new Ld() },
  ];
  const bandLbl = BAND_NAMES.map((t) => ({ o: mkOv('div', 'lbl sm', `<b>${t.split(' · ')[0]}</b><span class="nm">${t.split(' · ')[1]}</span>`), ld: new Ld() }));
  const pins = [];
  let pinHover = -1, pinFocus = -1;
  function buildTankDom() {
    tank.findings.forEach((F, i) => {
      const f = F.f, o = mkOv('button', 'pin', `<i></i><span>${f.id}</span>`);
      o.el.type = 'button'; o.el.style.setProperty('--c', SEV5[f.severity]); o.el.style.setProperty('--d', (i * 0.3).toFixed(1) + 's');
      o.el.setAttribute('aria-label', `${f.id}, severity ${f.severity} of 5: ${f.title}, ${f.area}`);
      const on = () => { pinHover = i; }, off = () => { if (pinHover === i) pinHover = -1; };
      o.el.addEventListener('pointerenter', on); o.el.addEventListener('pointerleave', off); o.el.addEventListener('focus', on); o.el.addEventListener('blur', off);
      o.el.addEventListener('click', () => { pinHover = pinHover === i ? -1 : i; });
      pins.push({ o, F });
    });
    fillIssues();
  }
  let cardShown = -1;
  function showCard(i) {
    if (i === cardShown) return; cardShown = i;
    if (i < 0) { fcard.classList.remove('on'); return; }
    const f = tank.findings[i].f, c = SEV5[f.severity];
    const img = $('img', fcard); img.src = f.photo; img.alt = `${f.title}, ${f.area}`;
    const b = $('.ph b', fcard); b.textContent = `SEV ${f.severity} / 5`; b.style.setProperty('--c', c); b.style.color = c;
    $('.k', fcard).textContent = `${f.id} · ${f.class.toUpperCase()} · ${f.area.toUpperCase()}`;
    $('h4', fcard).textContent = f.title; $('p', fcard).textContent = f.description;
    $$('.sev5 i', fcard).forEach((e, k) => { e.classList.toggle('on', k < f.severity); e.style.setProperty('--c', c); });
    fcard.classList.add('on');
  }

  // flare overlays
  const flareLbl = [
    { o: mkOv('div', 'lbl', '<b>01</b><span class="nm">· TEXTURED MESH</span><em>80 M · PHOTOGRAMMETRY</em>'), ld: new Ld() },
    { o: mkOv('div', 'lbl', '<b>02</b><span class="nm">· CORROSION PATCHES</span><em>78 · BY SEVERITY</em>'), ld: new Ld() },
  ];
  const evLbl = mkOv('div', 'lbl', '<b>03</b><span class="nm">· PHOTO EVIDENCE</span><em>HOVER FOR THE MASK</em>');
  const headLbl = { o: mkOv('div', 'lbl', '<b>FLARE HEAD</b><span class="nm">· 41 PATCHES</span><em>NECK + BOLTED CONNECTION</em>'), ld: new Ld() };
  const cards = [];
  const CLS = { light: ['LIGHT', '#E8C547'], moderate: ['MODERATE', '#F2994A'], heavy: ['HEAVY', '#E5484D'] };
  function buildFlareDom() {
    CARD_IDS.forEach((id) => {
      const q = flare.byId[id]; if (!q) return;
      const r = q.p.record, cl = CLS[r.classId] || ['GRADED', '#8E99A6'];
      const o = mkOv('div', 'pc', `<div class="ph"><img alt="Inspection photo, ${r.component.toLowerCase()}" width="1024" height="683" decoding="async"><em>MASK</em></div><div class="cp"><b><i></i>${r.id} · ${cl[0]}</b>${r.component}</div>`);
      o.el.style.setProperty('--c', cl[1]);
      cards.push({ o, q, ld: new Ld(), img: $('img', o.el), loaded: false });
    });
  }
  function loadCards() {
    cards.forEach((c) => {
      if (c.loaded) return; c.loaded = true;
      c.img.src = c.q.p.photo;
      maskCanvas(c.q.p.mask, 0.72).then((cv) => { if (cv) $('.ph', c.o.el).insertBefore(cv, $('em', c.o.el)); });
    });
  }

  // stockpile overlays
  const dateLbl = [
    { o: mkOv('div', 'dl', '<i></i>SURVEY 1<small>DAY 0</small>'), ld: new Ld() },
    { o: mkOv('div', 'dl', '<i></i>SURVEY 2<small>+10 DAYS</small>'), ld: new Ld() },
  ];
  const callEls = [];
  function buildPileDom() {
    pile.callouts.forEach((c) => {
      const e1 = c.q.e1.volumes.tin.net, e2 = c.q.e2.volumes.tin.net, cut = e2 < e1;
      const o = mkOv('div', 'co ' + (cut ? 'cut' : 'fill'), `<small>${c.q.id}</small><b>${fmt(e1)}</b> m³<i></i>`);
      callEls.push({ o, ld: new Ld(), b: $('b', o.el), i: $('i', o.el), e1, e2, last: '' });
    });
    allOv.forEach((o) => o.measure());
  }
  const volTot = $('#volTot'), volCut = $('#volCut'), volFill = $('#volFill');

  // finale slab labels
  const SLAB_T = [['TANK TERMINAL', 'ORTHO · CLOUD · MODEL'], ['STORAGE TANK INTERIOR', 'LIDAR · 6 FINDINGS'], ['FLARE STACK, 80 M', '78 CORROSION PATCHES'], ['STOCKPILE YARD', 'SURVEY 1 → 2 · CUT / FILL']];
  const slabLbl = SLAB_T.map(([a, b], i) => mkOv('div', 'sl', `0${i + 1} · ${a}<small>${b}</small>`));

  // app chrome
  const app = $('#app'), awFrame = $('#awFrame'), apTop = $('#apTop'), apSide = $('#apSide'), apIss = $('#apIss'), apTime = $('#apTime'), avChip = $('#avChip'), tlPlay = $('#tlPlay'), agQ = $('#agQ');
  let dsHover = -1, issHover = -1, appSel = 1;
  const selW = [0, 1, 2, 3].map((i) => new Spring(i === 1 ? 1 : 0, 90, 16));
  $$('.ds', app).forEach((b) => b.addEventListener('click', () => { appSel = +b.dataset.ds; }));
  $$('.ds', app).forEach((b) => { const i = +b.dataset.ds; b.addEventListener('pointerenter', () => { dsHover = i; }); b.addEventListener('pointerleave', () => { if (dsHover === i) dsHover = -1; }); b.addEventListener('focus', () => { dsHover = i; }); b.addEventListener('blur', () => { if (dsHover === i) dsHover = -1; }); });
  function fillIssues() {
    const list = $('#issList'); list.innerHTML = '';
    tank.findings.forEach((F, i) => {
      const f = F.f, b = document.createElement('button'); b.type = 'button'; b.className = 'isr';
      b.innerHTML = `<img alt="" loading="lazy" width="1280" height="960"><span class="tx"><b></b><small>${f.id} · STORAGE TANK · ${f.area.toUpperCase()}</small></span><span class="sv" style="--c:${SEV5[f.severity]}">SEV ${f.severity}</span>`;
      $('img', b).src = f.photo; $('b', b).textContent = f.title;
      b.addEventListener('pointerenter', () => { issHover = i; }); b.addEventListener('pointerleave', () => { if (issHover === i) issHover = -1; });
      b.addEventListener('focus', () => { issHover = i; }); b.addEventListener('blur', () => { if (issHover === i) issHover = -1; });
      list.appendChild(b);
    });
  }

  /* =================================================================
     SIZING
     ================================================================= */
  let W = 1, H = 1, mobile = narrow();
  const AW = { win: [0, 0, 1, 1], hole: [0, 0, 1, 1] };
  function layoutApp() {
    const M = mobile;
    // centred in the viewport below the nav, never cut off
    const ww = M ? W - 20 : Math.min(W - 48, 1400), wh = M ? H - 82 : Math.min(H - 64 - 32, 860);
    const l = Math.round((W - ww) / 2), t = Math.round(64 + (H - 64 - wh) / 2), r = l + ww, b = t + wh;
    const top = M ? 36 : 40, side = M ? 0 : Math.min(236, W * 0.17), iss = M ? 0 : Math.min(300, W * 0.21), time = M ? 74 : 132, strip = M ? 128 : 0;
    AW.win = [l, t, r, b];
    AW.hole = [l + side, t + top, r - iss, b - time - strip];
    const set = (el, x, y, w, h) => { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = Math.max(0, w) + 'px'; el.style.height = Math.max(0, h) + 'px'; };
    set(apTop, l + 1, t + 1, r - l - 2, top - 1);
    apSide.style.display = M ? 'none' : '';
    if (!M) set(apSide, l + 1, t + top, side, b - t - top - time - 1);
    if (!M) { apIss.classList.remove('m'); set(apIss, r - iss - 1, t + top, iss, b - t - top - time - 1); }
    else { apIss.classList.add('m'); set(apIss, l + 1, b - time - strip, r - l - 2, strip); }
    $$('.isum,.agbox', apIss).forEach((e) => { e.style.display = M ? 'none' : ''; });
    set(apTime, l + 1, b - time, r - l - 2, time - 1);
    $$('.tl-g', apTime).forEach((e) => { e.style.gridTemplateColumns = M ? '96px 1fr' : ''; });
    $('.tl-ruler', apTime).style.marginLeft = M ? '96px' : '';
    tlPlay.style.left = M ? 'calc(96px + (100% - 96px) * var(--x,.3))' : '';
    if (M) $$('.tl-g > *', apTime).forEach((e, i) => { e.style.display = i >= 4 ? 'none' : ''; }); else $$('.tl-g > *', apTime).forEach((e) => { e.style.display = ''; });
    avChip.style.left = (AW.hole[0] + 12) + 'px'; avChip.style.top = (AW.hole[1] + 12) + 'px';
  }
  function resizeHeads() {
    const s = (mobile ? 10 : 12.5) / H * 2 * tanH;
    plantPins.forEach((p) => p.head.scale.set(s * 1.4 * p.asp, s * 1.4, 1));
  }
  function resize() {
    W = stage.clientWidth; H = stage.clientHeight; mobile = narrow();
    renderer.setPixelRatio(DPR()); renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const px = H * DPR() / (2 * tanH);
    morph1.u.uPx.value = morph2.u.uPx.value = morph3.u.uPx.value = px;
    if (plantCloudMat) plantCloudMat.size = (mobile ? 1.4 : 1.6) * DPR();
    resizeHeads();
    allOv.forEach((o) => o.measure());
    layoutApp(); buildAxis();
  }
  resize();
  addEventListener('resize', resize);
  document.fonts?.ready.then(() => allOv.forEach((o) => o.measure()));

  /* =================================================================
     INPUT
     ================================================================= */
  const par = { x: new Spring(0, 60, 11), y: new Spring(0, 60, 11) };
  addEventListener('pointermove', (e) => { par.x.t = (e.clientX / innerWidth) * 2 - 1; par.y.t = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  let pX = -1, pY = -1, pointerIn = false;
  stage.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return; const r = stage.getBoundingClientRect(); pX = e.clientX - r.left; pY = e.clientY - r.top; pointerIn = !e.target.closest('.hero-copy a, .lbl, .pin, .app'); });
  stage.addEventListener('pointerleave', () => { pointerIn = false; hoverRay = -1; });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hitPlanes = layers.map((L) => L.hit);

  /* =================================================================
     SCROLL DRIVER
     ================================================================= */
  let targetP = 0, P = 0;
  const SNAP = /[?&]snap\b/.test(location.search);
  if (fullMode) {
    storyST = ST.create({ trigger: stage, start: 'top top', end: () => '+=' + Math.round(innerHeight * (LITE ? 10 : 12)), pin: true, pinSpacing: true, anticipatePin: 1, invalidateOnRefresh: true, onUpdate: (s) => { targetP = s.progress; } });
  }
  jumpTo = (p) => { if (!storyST) return; const y = storyST.start + (storyST.end - storyST.start) * p; if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else scrollTo(0, y); targetP = p; P = p; };
  window.__b2 = { goto: (p) => jumpTo(p), state: () => ({ p: P, assets: Object.fromEntries(Object.entries(AS).map(([k, v]) => [k, v.st || 'idle'])) }), ensureAll: () => Promise.all(['plant', 'tank', 'flare', 'stockpile'].map(ensure)) };

  /* =================================================================
     CAMERA
     ================================================================= */
  // [p, tx,ty,tz, dx,dy,dz, needW,needH, shiftX,shiftY]
  const KD = [
    [0.000, 0.4, 5.4, 0.4, 0.8, 0.6, 1.15, 52, 21, 0.31, -0.06],
    [0.028, 0.4, 5.4, 0.4, 0.8, 0.6, 1.15, 52, 21, 0.31, -0.06],
    [0.085, 0, 0.3, 0, 0.5, 1.15, 1.0, 33, 15.5, 0.22, 0.06],
    [0.112, 0, 0.6, 0, 0.55, 1.05, 1.05, 33, 15.5, 0.21, 0.05],
    [0.165, 0, 8.5, 0, 1, 0.6, 1.2, 32, 27, 0.2, 0.02],
    [0.205, 0, 10, 0, 1, 0.42, 1.15, 32, 25, 0.2, 0],
    [0.268, 0, 14.4, 0, 1, 0.26, 1.12, 44, 38, 0.17, -0.03],
    [0.334, 0, 14.4, 0, 1, 0.24, 1.12, 44, 38, 0.17, -0.03],
    [0.36, 0, 10, 0, 1, 0.32, 1.1, 32, 25, 0.12, 0],
    [0.43, 0, 10.4, 0, 1, 0.16, 1.1, 32, 26.5, 0.08, -0.03],
    [0.45, 0, 10.4, 0, 1, 0.16, 1.1, 32, 26.5, 0.02, -0.03],
    [0.53, 0, 10.4, 0, 1, 0.14, 1.05, 32, 26.5, -0.02, -0.03],
    [0.566, 0, 18.9, 0, 1, 0.34, 1.05, 9, 5.6, 0.02, 0],
    [0.586, 0, 18.9, 0, 1, 0.34, 1.05, 9, 5.6, 0.02, 0],
    [0.62, 0, 6, 0, 0.9, 0.72, 1.1, 30, 24, 0.1, 0],
    [0.664, 0, 0.6, 0, 0.85, 0.9, 1.1, 34, 19, 0.2, 0.05],
    [0.70, 0, 3.2, 0, 0.9, 0.52, 1.1, 38, 17.5, 0.2, 0],
    [0.726, 0, 2.7, 0, 0.5, 0.1, 1, 15, 7.5, 0, 0],
    [0.752, -2, 2.6, -4, 0.45, 0.05, 1, 7, 3.6, 0, 0],
    [0.788, 0, 0.6, 0, 0.8, 1.0, 1.1, 34, 19, 0.2, 0.05],
    [0.814, 0, 0.6, 0, 0.8, 1.0, 1.1, 34, 19, 0.2, 0.05],
    [0.862, 0, 3, 0, 0.22, 0.52, 1, 49, 17, 0, -0.04],
    [1.0, 0, 3, 0, 0.22, 0.52, 1, 49, 17, 0, -0.04],
  ];
  const KM = [
    [0.000, 0, 5.4, 0, 0.8, 0.7, 1.15, 25, 12, 0, -0.44],
    [0.028, 0, 5.4, 0, 0.8, 0.7, 1.15, 25, 12, 0, -0.44],
    [0.085, 0, 0.3, 0, 0.5, 1.2, 1.0, 23, 10, 0, 0.3],
    [0.112, 0, 0.6, 0, 0.55, 1.1, 1.05, 23, 10, 0, 0.28],
    [0.165, 0, 8.5, 0, 1, 0.6, 1.2, 14, 30, 0, 0.18],
    [0.205, 0, 10, 0, 1, 0.42, 1.15, 13, 30, 0, 0.18],
    [0.268, 0, 14.4, 0, 1, 0.26, 1.12, 16, 54, 0, 0.1],
    [0.334, 0, 14.4, 0, 1, 0.24, 1.12, 16, 54, 0, 0.1],
    [0.36, 0, 10, 0, 1, 0.32, 1.1, 13, 30, 0, 0.18],
    [0.43, 0, 10.2, 0, 1, 0.16, 1.1, 8, 30, 0, 0.16],
    [0.45, 0, 10.2, 0, 1, 0.16, 1.1, 8, 30, -0.42, 0.16],
    [0.53, 0, 10.2, 0, 1, 0.14, 1.05, 8, 30, -0.42, 0.16],
    [0.566, 0, 18.9, 0, 1, 0.34, 1.05, 5, 8, 0, 0.2],
    [0.586, 0, 18.9, 0, 1, 0.34, 1.05, 5, 8, 0, 0.2],
    [0.62, 0, 6, 0, 0.9, 0.72, 1.1, 16, 28, 0, 0.18],
    [0.664, 0, 0.6, 0, 0.85, 1.0, 1.1, 21, 12, 0, 0.3],
    [0.70, 0, 3.2, 0, 0.9, 0.6, 1.1, 22, 14, 0, 0.26],
    [0.726, 0, 2.7, 0, 0.5, 0.1, 1, 9, 9, 0, 0.1],
    [0.752, -2, 2.6, -4, 0.45, 0.05, 1, 4.2, 6, 0, 0.1],
    [0.788, 0, 0.6, 0, 0.8, 1.05, 1.1, 21, 12, 0, 0.3],
    [0.814, 0, 0.6, 0, 0.8, 1.05, 1.1, 21, 12, 0, 0.3],
    [0.862, 0, 1.5, 0, 0.25, 1.3, 1, 25, 26, 0, 0.12],
    [1.0, 0, 1.5, 0, 0.25, 1.3, 1, 25, 26, 0, 0.12],
  ];
  const KN = 10, camOut = new Array(KN), appKey = new Array(KN);
  function camAt(p, keys) {
    let i = 0; while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], t = eio(clamp((p - a[0]) / (b[0] - a[0] || 1)));
    for (let j = 1; j < a.length; j++) camOut[j - 1] = lerp(a[j], b[j], t);
    return camOut;
  }
  const tgt = new THREE.Vector3(), dir = new THREE.Vector3();
  function placeCamera(k) {
    tgt.set(k[0], k[1], k[2]); dir.set(k[3], k[4], k[5]).normalize();
    const dist = Math.max(k[6] / (2 * tanH * camera.aspect), k[7] / (2 * tanH));
    camera.position.copy(tgt).addScaledVector(dir, dist); camera.lookAt(tgt);
    camera.near = Math.max(0.2, dist * 0.02); camera.far = dist * 8 + 200;
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = -k[8]; camera.projectionMatrix.elements[9] = -k[9];
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();
  }

  /* =================================================================
     STATE (pure function of scroll progress + springs)
     ================================================================= */
  const v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  function proj(v) { v3.copy(v).project(camera); return [(v3.x + 1) * 0.5 * W, (1 - v3.y) * 0.5 * H, v3.z]; }
  function projL(obj, x, y, z) { v4.set(x, y, z); obj.localToWorld(v4); return proj(v4); }
  let time = 0, finalT = 0;

  function update(p, dt) {
    const M = mobile;
    // ---- camera
    const k = camAt(p, M ? KM : KD);
    const appT = ramp(p, T.appA, T.appA + 0.04);
    if (appT > 0) {
      const [hl, ht, hr, hb] = AW.hole, hw = hr - hl, hh = hb - ht;
      for (let j = 0; j < KN; j++) appKey[j] = 0;
      let ws = 0;
      selW.forEach((sw, i) => { const w = Math.max(0, sw.x); ws += w; const a = APPK[i]; appKey[1] += w * a[0]; appKey[3] += w * a[1]; appKey[4] += w * a[2]; appKey[5] += w * a[3]; appKey[6] += w * a[4]; appKey[7] += w * a[5]; });
      ws = Math.max(1e-3, ws); for (const j of [1, 3, 4, 5, 6, 7]) appKey[j] /= ws;
      appKey[6] *= W / hw; appKey[7] *= H / hh;
      appKey[8] = ((hl + hr) / 2 - W / 2) / (W / 2); appKey[9] = -((ht + hb) / 2 - H / 2) / (H / 2);
      const e = xio(appT); for (let j = 0; j < KN; j++) camOut[j] = lerp(k[j], appKey[j], e);
    }
    placeCamera(camOut);

    // ---- parallax tilt
    par.x.step(dt); par.y.step(dt);
    const tiltAmt = reduced ? 0 : lerp(1, 0.35, ramp(p, 0.02, 0.09)) * (1 - ramp(p, T.lineA, T.lineB));
    world.position.copy(tgt); inner.position.copy(tgt).negate();
    world.rotation.set(par.y.x * 0.07 * tiltAmt, par.x.x * 0.12 * tiltAmt, -par.x.x * 0.035 * tiltAmt);

    const line = eio(ramp(p, T.lineA, T.lineB));
    const SLOT = M ? SLOT_M : SLOT_D;
    const finIn = (i) => spr(ramp(p, T.lineA + 0.006 + i * 0.008, T.lineA + 0.034 + i * 0.008));
    const finOp = (i) => ramp(p, T.lineA + 0.004 + i * 0.008, T.lineA + 0.02 + i * 0.008);
    // focus from the app sidebar / issue list
    // the app viewport shows one asset at a time; the sidebar picks it (default: storage tank, matching the issue panel)
    const selNow = dsHover >= 0 ? dsHover : issHover >= 0 ? 1 : appSel;
    selW.forEach((sw, i) => { sw.t = i === selNow ? 1 : 0; if (dt) sw.step(dt); else sw.snap(); });
    plinths.forEach((pl) => { pl.lift.t = 0; pl.hot.t = 0; if (dt) { pl.lift.step(dt); pl.hot.step(dt); } else { pl.lift.snap(); pl.hot.snap(); } });
    const appE = xio(appT);
    const place = (root, i, storyScale = 1) => {
      const s = SLOT[i], sc = SLOT_S[i];
      let x, y, z, k;
      if (i === 3) { x = lerp(0, s[0], line); y = lerp(0, s[1], line); z = lerp(0, s[2], line); k = lerp(storyScale, sc, line); }
      else { const f = finIn(i); x = s[0]; y = s[1] - 3 * (1 - f); z = s[2]; k = sc * lerp(0.9, 1, f); }
      if (appE > 0) {
        const w = clamp(selW[i].x, 0, 1.2), m = appE * w;
        x = lerp(x, 0, m); y = lerp(y, 0, m); z = lerp(z, 0, m);
        k = lerp(k, APP_S[i], m) * (1 - appE * clamp(1 - w * 1.4));
      }
      root.position.set(x, y, z); root.scale.setScalar(Math.max(1e-3, k));
      return k > 0.004;
    };

    // ======== 01 · terminal stack
    const gapF = 1 - xio(ramp(p, T.gapA, T.gapB));
    const storyPlant = 1 - ramp(p, T.plantOutA, T.plantOutB);
    const finPlant = p > T.lineA ? finOp(0) : 0;
    const plantOp = Math.max(storyPlant, finPlant);
    plantRoot.visible = plantOp > 0.003;
    if (plantRoot.visible) {
      if (finPlant > 0) plantRoot.visible = place(plantRoot, 0); else { plantRoot.position.set(0, 0, 0); plantRoot.scale.setScalar(1); }
      const fused = 1 - gapF;
      layers.forEach((L, i) => {
        const hot = hover === i;
        L.lift.t = hot ? 0.38 : 0; L.dim.t = hover >= 0 && !hot ? 0.3 : 1; L.hot.t = hot ? 1 : 0;
        L.appear.t = ready('plant') ? 1 : 0;
        if (dt) { L.lift.step(dt); L.dim.step(dt); L.hot.step(dt); L.appear.step(dt); } else { L.lift.snap(); L.dim.snap(); L.hot.snap(); L.appear.snap(); }
        const br = reduced ? 0 : Math.sin(time * 0.8 + i * 0.9) * 0.06;
        L.g.position.y = (i * GAP + br + L.lift.x) * gapF + i * 0.004;
        // blend: in the fused view the elevation and cloud thin out over the ortho + model
        const blend = i === 1 ? lerp(1, 0.3, fused) : i === 2 ? lerp(1, 0.28, fused) : 1;
        const finK = i === 2 ? 0 : 1;
        const op = clamp(L.dim.x) * L.appear.x * blend * (finPlant > 0 ? finPlant * finK : storyPlant);
        setOp(L.mats, op);
        L.frameMat.opacity = (0.9 * clamp(L.dim.x) * (1 - fused * (i ? 1 : 0.2))) * (finPlant > 0 ? 0 : storyPlant);
        L.frameMat.color.copy(LINE).lerp(MINT, clamp(L.hot.x));
        L.frame.visible = L.frameMat.opacity > 0.003;
        L.fillMat.opacity = 0.3 * (1 - fused) * clamp(L.dim.x) * (1 - L.appear.x * (i === 0 ? 0.5 : 0.35)) * storyPlant;
        L.fill.visible = L.fillMat.opacity > 0.003;
      });
      plantPins.forEach((pn) => { const f = reduced ? 0.35 : ((time * 0.42 + pn.i * 0.17) % 1); const s = 1 + f * 2.4; pn.ring.scale.set(s, 1, s); pn.ringMat.opacity = (1 - f) * 0.4 * clamp(layers[4].dim.x) * plantOp * layers[4].appear.x; });
      const seamA = bump(p, T.seamA, (T.seamA + T.seamB) / 2, T.seamB);
      seamMat.opacity = seamA; seam.visible = seamA > 0.003;
      sweepMat.uniforms.uA.value = seamA * 1.25; sweepMat.uniforms.uP.value = lerp(-0.15, 1.15, ramp(p, T.seamA, T.seamB)); sweep.visible = seamA > 0.003;
      if (finPlant > 0) { seam.visible = false; sweep.visible = false; }
    }

    // ======== morph 1 · shatter
    const m1on = p > T.m1A - 0.004 && p < T.tankInB + 0.004;
    morph1.pts.visible = m1on;
    if (m1on) { morph1.u.uT.value = ramp(p, T.m1A, T.m1B); morph1.u.uAlpha.value = ramp(p, T.m1A - 0.004, T.m1A + 0.004) * (1 - ramp(p, T.m1B - 0.002, T.tankInB)); }

    // ======== 02 · storage tank
    const storyTank = ramp(p, T.tankInA, T.tankInB) * (1 - ramp(p, T.tankOutA, T.tankOutB));
    const finTank = p > T.lineA ? finOp(1) : 0;
    const tankOp = Math.max(storyTank, finTank);
    tankRoot.visible = tank.ready && tankOp > 0.003;
    if (tankRoot.visible) {
      if (finTank > 0) tankRoot.visible = place(tankRoot, 1); else { tankRoot.position.set(0, 0, 0); tankRoot.scale.setScalar(1); }
      const exp = finTank > 0 ? 0 : spr(ramp(p, T.expA, T.expB)) * (1 - eio(ramp(p, T.collA, T.collB)));
      tank.bands.forEach((b, i) => { b.g.position.y = i * TGAP * exp; });
      setOp(tank.mats, tankOp);
      const tankApp = appE * clamp(selW[1].x);
      if (finTank > 0) tank.cloudMat.opacity = tankOp * tankApp;
      const flash = bump(p, T.expA, T.expA + 0.018, T.expB);
      tank.ringMat.color.copy(LINE).lerp(MINT, clamp(flash * 1.4 + 0.25 * exp));
      tank.ringMat.opacity = (0.45 + 0.55 * clamp(exp * 2)) * tankOp;
      tank.cut = finTank > 0 ? tankApp * 0.85 : ss(ramp(p, T.cutA, T.cutB)) * (1 - ramp(p, T.collA, T.collB));
    }

    // ======== morph 2 · column rise
    const m2T = ramp(p, T.m2A, T.m2B);
    const m2on = p > T.tankOutA - 0.002 && p < T.m2B + 0.004;
    morph2.pts.visible = m2on;
    if (m2on) { morph2.u.uT.value = m2T; morph2.u.uAlpha.value = ramp(p, T.tankOutA - 0.002, T.tankOutB - 0.004); morph2.u.uScan.value = flare.ready ? (m2T - 0.58) / 0.4 : -1; }

    // ======== 03 · flare stack
    const storyFlare = (flare.ready && p > T.m2A + 0.02 ? 1 : 0) * (1 - ramp(p, T.flareOutA, T.flareOutB));
    const finFlare = p > T.lineA ? finOp(2) : 0;
    const flareOp = Math.max(storyFlare, finFlare);
    flareRoot.visible = flare.ready && flareOp > 0.003;
    if (flareRoot.visible) {
      if (finFlare > 0) flareRoot.visible = place(flareRoot, 2); else { flareRoot.position.set(0, 0, 0); flareRoot.scale.setScalar(1); }
      setOp(flare.mats, flareOp);
      const rad = finFlare > 0 ? 0 : spr(ramp(p, T.radA, T.radB)) * (1 - eio(ramp(p, 0.528, 0.56)));
      const headK = ramp(p, 0.54, 0.565);
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(time * 3);
      flare.patches.forEach((q) => {
        const a = T.ignA + q.rank * (T.ignB - T.ignA - 0.012);
        const ig = finFlare > 0 ? 1 : ramp(p, a, a + 0.012);
        q.g.position.copy(q.dir).multiplyScalar(rad * 3.4);
        q.p.mesh.material.opacity = ig * flareOp;
        q.sm.opacity = ig * flareOp * (finFlare > 0 ? 0.3 : (0.42 + 0.58 * bump(p, a, a + 0.006, a + 0.04)) * pulse * (1 - 0.75 * headK));
      });
    }
    // scan resolve: reveal the textured mesh under the rising column
    flare.scan = (p > T.m2A && p < T.m2B + 0.01 && finFlare === 0) ? ((m2T - 0.58) / 0.4) * flare.H + 0.1 : 1e5;

    // ======== morph 3 · dissolve and fall
    const m3on = p > T.flareOutA - 0.002 && p < T.s1InB + 0.004;
    morph3.pts.visible = m3on;
    if (m3on) { morph3.u.uT.value = ramp(p, T.m3A, T.m3B); morph3.u.uAlpha.value = ramp(p, T.flareOutA - 0.002, T.flareOutB - 0.004) * (1 - ramp(p, T.s1InA + 0.008, T.s1InB)); }

    // ======== 04 · stockpile yard
    const pileOn = pile.ready && p > T.s1InA;
    pileRoot.visible = pileOn;
    if (pileOn) {
      pileRoot.visible = place(pileRoot, 3, 1);
      const s1 = ramp(p, T.s1InA, T.s1InB), fuse = xio(ramp(p, T.fuseA, T.fuseB));
      const s2In = spr(ramp(p, T.s2InA, T.s2InB)), s2Op = ramp(p, T.s2InA, T.s2InA + 0.014);
      const [A1, A2] = pile.s;
      setOp(A1.mats, s1 * (1 - ramp(p, T.fuseB - 0.004, T.fuseB + 0.004)));
      A1.grp.visible = A1.mats[0].opacity > 0.003;
      A2.grp.position.y = lerp(16, SGAP, s2In) * (1 - fuse) + 0.012;
      setOp(A2.mats, s2Op);
      A2.grp.visible = s2Op > 0.003;
      const seamF = bump(p, T.fuseB - 0.012, T.fuseB, T.fuseB + 0.02);
      A2.edgeMat.color.copy(LINE).lerp(MINT, seamF);
      diffU.value = ramp(p, T.diffA, T.diffB);
    }

    // ======== finale plinths + axis
    const plOp = ramp(p, T.lineA + 0.01, T.lineB);
    plinths.forEach((pl, i) => {
      pl.g.visible = plOp > 0.003;
      if (!pl.g.visible) return;
      const s = SLOT[i]; pl.g.position.set(s[0], s[1] - 0.6 * (1 - plOp) - 1.5 * appE, s[2]);
      setOp(pl.mats, plOp * (1 - appE)); pl.g.visible = plOp * (1 - appE) > 0.003; pl.em.color.copy(LINE).lerp(MINT, pl.hot.x);
    });
    axisMat.opacity = 0.7 * ramp(p, T.axisA, T.axisB) * (1 - appE); axis.visible = axisMat.opacity > 0.003;
    finalT = appT;
  }

  function updateClip() {
    // tank cutaway: keep the half away from the camera
    if (tankRoot.visible && tank.cut > 0.001) {
      tankRoot.getWorldPosition(v4); const ax = v4.clone();
      const toCam = camera.position.clone().sub(ax); toCam.y = 0; toCam.normalize();
      const off = lerp(tank.r * 1.35, tank.r * 0.06, tank.cut) * tankRoot.scale.x;
      cutPlane.setFromNormalAndCoplanarPoint(toCam.clone().negate(), ax.addScaledVector(toCam, off));
    } else cutPlane.set(new THREE.Vector3(0, -1, 0), 1e5);
    if (flare.scan < 1e4) { flareRoot.getWorldPosition(v4); scanPlane.set(new THREE.Vector3(0, -1, 0), flare.scan + v4.y); } else scanPlane.set(new THREE.Vector3(0, -1, 0), 1e5);
  }

  /* ---------------- overlays ---------------- */
  const RAIL_ON = new Array(5).fill(-1);
  let lastHud = '', lastWait = '';
  const rightmost = (obj, pts) => { let best = null; for (const q of pts) { const s = projL(obj, q[0], q[1], q[2]); if (!best || s[0] > best[0]) best = s; } return best; };
  const leftmost = (obj, pts) => { let best = null; for (const q of pts) { const s = projL(obj, q[0], q[1], q[2]); if (!best || s[0] < best[0]) best = s; } return best; };
  const ringPts = (r, y, n = 16) => { const a = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([Math.cos(t) * r, y, Math.sin(t) * r]); } return a; };
  const labelAt = (o, ld, anc, side, op, col = '#4A5868', len = 22) => {
    const dx = side * len;
    ld.set(`M${anc[0].toFixed(1)} ${anc[1].toFixed(1)}h${dx}`, anc[0], anc[1], col, op);
    o.set(side > 0 ? anc[0] + dx + 4 : anc[0] + dx - 4 - o.w, anc[1] - o.h / 2, op);
  };

  function overlays(p) {
    const M = mobile;
    // hero copy + cue
    const heroOp = 1 - ramp(p, 0.02, 0.07);
    heroCopy.style.opacity = heroOp.toFixed(3); heroCopy.style.visibility = heroOp < 0.01 ? 'hidden' : 'visible';
    heroCopy.style.translate = `0 ${(-40 * ramp(p, 0.0, 0.07)).toFixed(1)}px`;
    cue.style.opacity = (1 - ramp(p, 0.0, 0.03)).toFixed(3);

    // plant layer labels
    const labOp = (1 - ramp(p, 0.03, 0.07)) * (plantRoot.visible ? 1 : 0);
    stage.style.cursor = hover >= 0 && hoverRay >= 0 ? 'crosshair' : '';
    layers.forEach((L, i) => {
      if (labOp < 0.004) { L.lbl.set(0, 0, 0); L.ld.set('', 0, 0, '', 0); return; }
      // anchor on the layer's front-right corner, label to the right
      const anc = projL(L.g, HX, 0, HZ);
      const op = labOp * (hover >= 0 && hover !== i ? 0.4 : 1);
      const len = Math.max(14, Math.min(28, W - 10 - L.lbl.w - anc[0] - 4));
      labelAt(L.lbl, L.ld, anc, 1, op, hover === i ? '#5ED1B3' : '#4A5868', len);
      L.lbl.el.classList.toggle('hot', hover === i); L.lbl.el.style.pointerEvents = labOp > 0.5 ? 'auto' : 'none';
    });
    if (hover !== shownTip) {
      shownTip = hover;
      if (hover >= 0) { const d = LDEF[hover]; tipK.textContent = `LAYER ${d.id} · TANK TERMINAL`; tipH.textContent = d.name; tipP.textContent = d.d; tipM.textContent = d.st; tip.classList.add('on'); } else tip.classList.remove('on');
    }
    if (hover >= 0) {
      let tx, ty;
      if (hoverLabel >= 0) { const o = layers[hoverLabel].lbl; tx = o.x - 30; ty = o.y + 30; } else { tx = pX + 18; ty = pY + 18; }
      tip.style.transform = `translate3d(${clamp(tx, 12, W - 284).toFixed(1)}px,${clamp(ty, 72, H - 200).toFixed(1)}px,0)`;
    }

    // tank labels + pins
    const tLab = tankRoot.visible ? ramp(p, 0.236, 0.256) * (1 - ramp(p, T.collA - 0.006, T.collA + 0.004)) : 0;
    if (tank.ready && tLab > 0.004) {
      const B = tank.bands, rN = tank.rN;
      labelAt(tankLbl[0].o, tankLbl[0].ld, rightmost(B[3].nat, ringPts(rN, 8.0)), 1, tLab);
      labelAt(tankLbl[1].o, tankLbl[1].ld, rightmost(B[2].nat, ringPts(rN * 0.97, 6.75)), 1, tLab, '#4A5868', 40);
      const f9 = tank.findings.find((F) => F.f.id === 'F09') || tank.findings[0];
      const fa = projL(B[f9.band].nat, f9.local.x, f9.local.y, f9.local.z);
      const r2 = rightmost(B[1].nat, ringPts(rN, 4.9));
      tankLbl[2].ld.set(`M${fa[0].toFixed(1)} ${fa[1].toFixed(1)}L${(r2[0] + 26).toFixed(1)} ${(r2[1] + 40).toFixed(1)}h14`, fa[0], fa[1], '#4A5868', tLab);
      tankLbl[2].o.set(r2[0] + 44, r2[1] + 40 - tankLbl[2].o.h / 2, tLab);
      bandLbl.forEach((b, i) => { const anc = leftmost(B[i].nat, ringPts(rN, B[i].mid, 12)); labelAt(b.o, b.ld, anc, -1, tLab * (M ? 0 : 0.95), '#3A4654', 16); });
    } else { tankLbl.forEach((t) => { t.o.set(0, 0, 0); t.ld.set('', 0, 0, '', 0); }); bandLbl.forEach((b) => { b.o.set(0, 0, 0); b.ld.set('', 0, 0, '', 0); }); }
    const pinOp = tankRoot.visible ? Math.max(ramp(p, T.pinsA, T.pinsB) * (1 - ramp(p, T.collA - 0.006, T.collA + 0.002)), ramp(p, T.appA + 0.03, T.appB)) : 0;
    const mini = p > T.lineA;
    const pinSel = mini ? clamp(selW[1].x * 2 - 1) : 1;
    let hov = pinHover;
    if (mini && issHover >= 0) hov = issHover;
    pins.forEach((pn, i) => {
      const b = tank.bands[pn.F.band], s = projL(b.nat, pn.F.local.x, pn.F.local.y, pn.F.local.z);
      const on = pn.o.set(s[0], s[1], pinOp * pinSel * (s[2] < 1 ? 1 : 0));
      if (on) { pn.o.el.classList.toggle('mini', mini); pn.o.el.classList.toggle('hot', hov === i); pn.o.el.style.pointerEvents = pinOp > 0.5 ? 'auto' : 'none'; }
    });
    const showC = pinOp > 0.5 && !mini && pinHover >= 0 ? pinHover : -1;
    showCard(showC);
    if (showC >= 0) {
      const pn = pins[showC]; const cw = M ? 236 : 290;
      let cx = pn.o.x + 26, cy = pn.o.y - 60;
      if (cx + cw > W - 12) cx = pn.o.x - 26 - cw;
      fcard.style.transform = `translate3d(${clamp(cx, 12, W - cw - 12).toFixed(1)}px,${clamp(cy, 74, H - 380).toFixed(1)}px,0)`;
    }

    // flare labels + cards
    const fLab = flareRoot.visible && p < T.lineA ? ramp(p, 0.455, 0.47) * (1 - ramp(p, T.cardsOutA - 0.01, T.cardsOutA)) : 0;
    if (flare.ready && fLab > 0.004) {
      const fnat = flareRoot.children[0];
      const s1 = leftmost(fnat, ringPts(2.3, 66, 12)); labelAt(flareLbl[0].o, flareLbl[0].ld, s1, -1, fLab, '#4A5868', 30);
      const q = flare.byId.F46 || flare.patches[0], qg = q.g; const s2 = projL(qg.parent, q.p.center.x + qg.position.x, q.p.center.y, q.p.center.z + qg.position.z);
      labelAt(flareLbl[1].o, flareLbl[1].ld, s2, -1, fLab, '#F2994A', 40);
    } else flareLbl.forEach((t) => { t.o.set(0, 0, 0); t.ld.set('', 0, 0, '', 0); });
    const cOp = flareRoot.visible && p < T.lineA ? ramp(p, T.cardsA, T.cardsB) * (1 - ramp(p, T.cardsOutA, T.cardsOutB)) : 0;
    if (cards.length && cOp > 0.004) {
      const cw = M ? 128 : 192; const ch = cw / 1.5 + (M ? 34 : 44);
      const colX = M ? W - cw - 10 : Math.min(W * 0.66, W - cw - 260);
      const items = cards.map((c) => { const qg = c.q.g; const s = projL(qg.parent, c.q.p.center.x + qg.position.x, c.q.p.center.y, c.q.p.center.z + qg.position.z); return { c, s }; }).sort((a, b) => a.s[1] - b.s[1]);
      const top = M ? 80 : 96, bottom = H - (M ? 250 : 40);
      let y = top; const gap = 10, need = items.length * ch + (items.length - 1) * gap;
      const avail = bottom - top, startY = top + Math.max(0, (avail - need) / 2);
      y = startY;
      items.forEach(({ c, s }, i) => {
        const want = clamp(s[1] - ch / 2, y, bottom - (items.length - i) * (ch + gap) + gap);
        const cy = Math.max(y, want);
        c.o.el.style.setProperty('--cw', cw + 'px');
        const st = ramp(cOp, i * 0.12, 0.6 + i * 0.12);
        c.o.set(colX + 30 * (1 - xout(st)), cy, xout(st) * cOp);
        c.ld.set(`M${s[0].toFixed(1)} ${s[1].toFixed(1)}L${(colX - 22).toFixed(1)} ${(cy + ch / 2).toFixed(1)}H${colX.toFixed(1)}`, s[0], s[1], '#F2994A', 0.85 * xout(st) * cOp);
        y = cy + ch + gap;
      });
      evLbl.set(colX, startY - 30, cOp * (M ? 0 : 1));
    } else { cards.forEach((c) => { c.o.set(0, 0, 0); c.ld.set('', 0, 0, '', 0); }); evLbl.set(0, 0, 0); }
    const hOp = flareRoot.visible && p < T.lineA ? ramp(p, 0.56, 0.57) * (1 - ramp(p, 0.58, 0.588)) : 0;
    if (flare.ready && hOp > 0.004) { const s = leftmost(flareRoot.children[0], ringPts(1.6, 76.4, 12)); labelAt(headLbl.o, headLbl.ld, s, -1, hOp, '#F2994A', 34); } else { headLbl.o.set(0, 0, 0); headLbl.ld.set('', 0, 0, '', 0); }

    // stockpile labels + callouts
    const dOp = pileRoot.visible && p < T.lineA ? ramp(p, T.s2InA + 0.012, T.s2InB) * (1 - ramp(p, T.fuseA - 0.004, T.fuseA + 0.008)) : 0;
    if (pile.ready && dOp > 0.004) {
      pile.s.forEach((S, i) => {
        const bb = S.bb, cs = [[bb.min.x, bb.min.y, bb.max.z], [bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z], [bb.max.x, bb.min.y, bb.min.z]];
        if (i === 1) labelAt(dateLbl[i].o, dateLbl[i].ld, leftmost(S.grp, cs), -1, dOp, '#5ED1B3', 26);
        else { let f = null; for (const q of cs) { const s2 = projL(S.grp, q[0], q[1], q[2]); if (!f || s2[1] > f[1]) f = s2; } labelAt(dateLbl[i].o, dateLbl[i].ld, f, 1, dOp, '#4A5868', 26); }
        dateLbl[i].o.el.classList.toggle('on', i === 1);
      });
    } else dateLbl.forEach((t) => { t.o.set(0, 0, 0); t.ld.set('', 0, 0, '', 0); });
    const cT = ramp(p, T.cntA, T.cntB);
    const coOp = pileRoot.visible && p < T.lineA + 0.004 ? ramp(p, T.cntA - 0.004, T.cntA + 0.008) * (1 - ramp(p, 0.813, 0.82)) : 0;
    callEls.forEach((c, i) => {
      if (coOp < 0.004) { c.o.set(0, 0, 0); c.ld.set('', 0, 0, '', 0); return; }
      const a = proj(pile.s[1].grp.localToWorld(v4.copy(pile.callouts[i].pos)));
      const up = (M ? 34 : 54) + (i % 2) * (M ? 18 : 26), side = a[0] > W * (M ? 0.5 : 0.62) ? -1 : 1;
      const ex = a[0] + side * (M ? 10 : 26), ey = a[1] - up;
      c.ld.set(`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`, a[0], a[1], c.e2 < c.e1 ? '#E5484D' : '#5B9BD5', coOp);
      c.o.set(side < 0 ? ex - c.o.w : ex, ey - c.o.h / 2, coOp);
      const val = fmt(lerp(c.e1, c.e2, ss(cT))), dl = cT > 0.98 ? `${sgn(c.e2 - c.e1)}` : '';
      if (val + dl !== c.last) { c.b.textContent = val; c.i.textContent = dl; c.last = val + dl; c.o.measure(); }
    });
    if (pile.ready) {
      const tot = pile.g.volumes.totals, pc = pile.g.volumes.pileChange, e = ss(cT);
      const s = `${fmt(lerp(tot.e1.tin, tot.e2.tin, e))}|${fmt(pc.cut * e)}|${fmt(pc.fill * e)}`;
      if (s !== lastVol) { lastVol = s; const [a, b, c] = s.split('|'); volTot.textContent = a + ' m³'; volCut.textContent = '−' + b + ' m³'; volFill.textContent = '+' + c + ' m³'; }
    }

    // finale slab labels
    const sOp = ramp(p, T.axisA, T.axisB) * (1 - ramp(p, T.appA, T.appA + 0.02));
    const SLOT = M ? SLOT_M : SLOT_D;
    slabLbl.forEach((o, i) => {
      if (sOp < 0.004) { o.set(0, 0, 0); return; }
      const s = SLOT[i]; v4.set(s[0], 0, s[2] + 5.6); inner.localToWorld(v4); const a = proj(v4);
      o.set(a[0] - o.w / 2, a[1] + 12, sOp);
    });

    // app chrome
    const appT = finalT;
    if (appT > 0.002) {
      if (!app.classList.contains('live')) app.classList.add('live');
      app.style.opacity = '1';
      const e = xout(ramp(p, T.appA, T.appA + 0.035));
      const [l, t, r, b] = AW.win;
      awFrame.style.left = lerp(-2, l, e).toFixed(1) + 'px'; awFrame.style.top = lerp(-2, t, e).toFixed(1) + 'px';
      awFrame.style.width = lerp(W + 4, r - l, e).toFixed(1) + 'px'; awFrame.style.height = lerp(H + 4, b - t, e).toFixed(1) + 'px';
      awFrame.style.opacity = ramp(p, T.appA, T.appA + 0.01).toFixed(3);
      const pan = (el, k, dx, dy) => { const q = ramp(p, T.appA + 0.012 + k * 0.006, T.appA + 0.038 + k * 0.006), s = spr(q); el.style.opacity = clamp(q * 2).toFixed(3); el.style.transform = `translate3d(${(dx * (1 - s)).toFixed(1)}px,${(dy * (1 - s)).toFixed(1)}px,0)`; };
      pan(apTop, 0, 0, -28); pan(apSide, 1, -48, 0); pan(apIss, 2, M ? 0 : 48, M ? 40 : 0); pan(apTime, 3, 0, 40);
      const cq = ramp(p, T.appA + 0.04, T.appA + 0.055); avChip.style.opacity = cq.toFixed(3);
      tlPlay.style.setProperty('--x', (0.06 + ((time * 0.045) % 0.9)).toFixed(4));
      const selNow = dsHover >= 0 ? dsHover : issHover >= 0 ? 1 : appSel;
      $$('.ds', app).forEach((d, i) => { d.classList.toggle('on', selNow === i); d.setAttribute('aria-pressed', String(appSel === i)); });
      if (selNow !== lastSel) { lastSel = selNow; avName.textContent = APP_NAMES[selNow]; }
      typeAgent();
    } else if (app.classList.contains('live')) { app.classList.remove('live'); app.style.opacity = '0'; }

    // captions
    const capWin = [[0.058, 0.074, 0.106, 0.118], [0.218, 0.236, 0.326, 0.338], [0.448, 0.466, 0.572, 0.584], [0.672, 0.69, 0.81, 0.82], [0.826, 0.84, 0.864, 0.874]];
    caps.forEach((el, i) => {
      const [a, b, c, d] = capWin[i], o = ramp(p, a, b) * (1 - ramp(p, c, d)) * (i === 3 ? 1 - ramp(p, 0.704, 0.714) * (1 - ramp(p, 0.772, 0.786)) : 1), y = (1 - xout(ramp(p, a, b))) * 22 - ramp(p, c, d) * 16;
      if (o < 0.004) { if (el.style.visibility !== 'hidden') { el.style.opacity = '0'; el.style.visibility = 'hidden'; } return; }
      el.style.opacity = o.toFixed(3); el.style.visibility = 'visible';
      el.style.transform = el.classList.contains('top') && !M ? `translate3d(-50%,${y.toFixed(1)}px,0)` : `translate3d(0,${y.toFixed(1)}px,0)`;
    });

    // rail
    const segs = [[0, 0.11], [0.11, 0.345], [0.345, 0.59], [0.59, 0.82], [0.82, 1.0]];
    const ri = segs.findIndex(([a, b]) => p < b);
    railItems.forEach((a, i) => {
      const st = i < ri ? 2 : i === ri ? 1 : 0;
      if (RAIL_ON[i] !== st) { RAIL_ON[i] = st; a.classList.toggle('on', st === 1); a.classList.toggle('done', st === 2); }
      if (st === 1) a.querySelector('i').style.setProperty('--f', ramp(p, segs[i][0], segs[i][1]).toFixed(3));
    });
    const late = 1 - ramp(p, T.appA - 0.01, T.appA + 0.01);
    rail.style.opacity = (ramp(p, 0.03, 0.07) * late).toFixed(3);
    rail.style.pointerEvents = p > 0.05 && late > 0.5 ? 'auto' : 'none';
    hud.style.opacity = ((0.45 + 0.55 * ramp(p, 0.02, 0.07)) * late).toFixed(3);
    const ht = p < 0.11 ? 'TANK TERMINAL · 5 LAYERS' : p < 0.345 ? 'STORAGE TANK · 280,000 PTS' : p < 0.59 ? 'FLARE STACK · 78 PATCHES' : p < 0.7 ? 'STOCKPILE YARD · SURVEY 1' : p < 0.76 ? 'SURVEY 1 + SURVEY 2 · +10 DAYS' : p < 0.82 ? 'CUT / FILL · SURFACE TO SURFACE' : 'ONE TIMELINE · 4 ASSETS';
    if (ht !== lastHud) { lastHud = ht; hudT.textContent = ht; }
    // streaming indicator when the current asset hasn't landed yet
    const need = p < 0.104 ? 'plant' : p < 0.35 ? 'tank' : p < 0.586 ? 'flare' : 'stockpile';
    const w = !ready(need) && p > 0.005 ? WAITLBL[need] : (!ready('plant') ? WAITLBL.plant : '');
    if (w !== lastWait) { lastWait = w; waitEl.classList.toggle('on', !!w); if (w) waitT.textContent = w; }
  }
  let lastVol = '', lastSel = -1;
  const avName = $('#avName');
  const APP_NAMES = ['TANK TERMINAL · ORTHO + MODEL', 'STORAGE TANK · LIDAR + 6 FINDINGS', 'FLARE STACK · 78 PATCHES', 'STOCKPILE YARD · CUT / FILL'];
  const AGQ = ['Which findings are severity 5?', 'Compare stockpile P02 between surveys.', 'Show flare patches above 70 m.'];
  let agLast = '';
  function typeAgent() {
    const cyc = 5.5, k = Math.floor(time / cyc) % AGQ.length, lt = time % cyc, s = AGQ[k], n = Math.floor(clamp(lt / 2.2) * s.length);
    const out = s.slice(0, n) + (lt < 4.8 ? '|' : '');
    if (out !== agLast) { agLast = out; agQ.innerHTML = ''; agQ.append(document.createTextNode(s.slice(0, n))); if (lt < 4.8) { const c = document.createElement('span'); c.className = 'caret'; agQ.append(c); } }
  }

  /* =================================================================
     FRAME
     ================================================================= */
  let last = performance.now(), running = false, visible = true, firstFrame = true;
  function frame(now) {
    if (!visible) { running = false; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!reduced) time += dt;
    P += (targetP - P) * (1 - Math.exp(-dt * 10)); if (SNAP || Math.abs(targetP - P) < 1e-5) P = targetP;
    const p = P;
    gate(p);
    if (p > 0.3) loadCards();
    // hover via raycast (hero only)
    const gapNow = 1 - xio(ramp(p, T.gapA, T.gapB));
    if (pointerIn && p < 0.026 && gapNow > 0.98 && finePointer) {
      ndc.set(pX / W * 2 - 1, -(pY / H) * 2 + 1); ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(hitPlanes, false);
      hoverRay = hits.length ? hits[0].object.userData.layer : -1;
      if (hits.length) { const lp = layers[hoverRay].nat.worldToLocal(hits[0].point.clone()); hudXY.textContent = `X ${lp.x.toFixed(1)} · Z ${lp.z.toFixed(1)} m`; }
    } else if (p >= 0.026) hoverRay = -1;
    hover = p < 0.03 ? (hoverLabel >= 0 ? hoverLabel : hoverRay) : -1;
    update(p, dt);
    scene.updateMatrixWorld();
    updateClip();
    renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; HTML.classList.add('gl-on'); }
    overlays(p);
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible) { running = true; last = performance.now(); requestAnimationFrame(frame); } }

  if (fullMode) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { rootMargin: '120px' }).observe(stage);
    start();
  } else {
    /* ---------- reduced motion / no scroll engine: static layered stills per asset ---------- */
    const STILL_P = { plant: 0.0, tank: 0.30, flare: 0.505, stockpile: 0.81 };
    const IDX = { plant: 0, tank: 1, flare: 2, stockpile: 3 };
    const render = (name) => {
      const img = $(`img.still[data-still="${IDX[name]}"]`); if (!img) return;
      const w = 1080, h = 720;
      W = w; H = h; mobile = false;
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; renderer.setClearColor(0x0E1318, 1);
      const px = h / (2 * tanH); morph1.u.uPx.value = morph2.u.uPx.value = morph3.u.uPx.value = px; resizeHeads();
      const p = STILL_P[name];
      update(p, 0);
      camOut[8] = 0; camOut[9] = 0; placeCamera(camOut);
      morph1.pts.visible = morph2.pts.visible = morph3.pts.visible = false;
      plinths.forEach((pl) => { pl.g.visible = false; }); axis.visible = false;
      ['plant', 'tank', 'flare', 'stockpile'].forEach((n) => { const r = { plant: plantRoot, tank: tankRoot, flare: flareRoot, stockpile: pileRoot }[n]; if (n !== name) r.visible = false; });
      scene.updateMatrixWorld(); updateClip();
      renderer.render(scene, camera);
      try { img.src = renderer.domElement.toDataURL('image/jpeg', 0.88); img.hidden = false; img.alt = img.alt || 'Layered still'; if (name === 'stockpile') { const cv = $('[data-still-diff]'); if (cv) cv.remove(); } } catch (e) { /* keep the photo fallback */ }
    };
    readyHooks.push((name) => { setTimeout(() => render(name), 30); if (name === 'flare') loadCards(); });
    ensure('plant').then(() => ensure('tank')).then(() => ensure('flare')).then(() => ensure('stockpile'));
  }
}
