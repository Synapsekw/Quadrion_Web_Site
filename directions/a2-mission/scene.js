/* ============================================================
   Quadrion AI · Direction A2 · Mission Control
   One persistent WebGL scene. A single THREE.Points (posA/posB,
   colA/colB, seed, uMix) morphs between four real survey assets;
   native clouds and meshes cross-fade in via stageTransform().
   ============================================================ */
import * as THREE from 'three';
import { ASSETS, load, samplePoints, stageTransform } from '../data/quadrion-data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sat = (v) => clamp(v, 0, 1);
const sstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lin = (a, b, v) => sat((v - a) / (b - a));
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eout = (x) => 1 - Math.pow(1 - x, 4);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, dp = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const sgn = (v, dp = 0) => (v < 0 ? '−' : '+') + fmt(Math.abs(v), dp);
const pad = (v, w, dp = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(dp).padStart(w, '0');
const grp = (v, dp = 1) => {
  const [i, d] = Math.abs(v).toFixed(dp).split('.');
  return (v < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? '.' + d : '');
};

const NAMES = ['plant', 'tank', 'flare', 'stockpile'];
const LABEL = { plant: 'Tank terminal', tank: 'Storage tank interior', flare: 'Flare stack, 80 m', stockpile: 'Stockpile yard' };
const SHORT = { plant: 'TERMINAL', tank: 'TANK', flare: 'FLARE', stockpile: 'YARD' };
const RAD = { plant: 12, tank: 6, flare: 8, stockpile: 10 };
const VEX = 1.6; // stockpile vertical exaggeration (shown in the HUD)
const PSIZE = { ph: 0.05, plant: 0.038, tank: 0.036, flare: 0.03, stockpile: 0.026, quad: 0.034 };
const SEVC = (s) => (s >= 5 ? '#E5484D' : s === 4 ? '#F2994A' : s === 3 ? '#E8C547' : '#5B9BD5');
const SEVV = (s) => (s >= 5 ? 'var(--red)' : s === 4 ? 'var(--orange)' : s === 3 ? 'var(--yellow)' : 'var(--blue)');
const FLARE_SEV = (s) => (s >= 3 ? 'var(--red)' : s === 2 ? 'var(--orange)' : 'var(--yellow)');
const FLARE_GRADE = (r) => (r.classId === 'light' ? 'LIGHT' : r.classId === 'heavy' ? 'HEAVY' : 'MODERATE');
// Real tank centres in the plant's native frame (metres); roof crown at 51.5 m.
const PLANT_TANKS = [[1.1, -105.4], [146, -105.4], [290.7, -105.4], [435.5, -105.4], [1.2, 83.6], [146, 83.6], [290.8, 83.6], [435.5, 83.6]];
// Quad arrangement for chapter 05 (cell centre + scale per asset)
const QUAD = [
  { c: [-4.6, 0, 3.0], k: 0.3 },    // plant
  { c: [4.4, 0, -3.4], k: 0.56 },   // tank
  { c: [-4.0, 0, -3.6], k: 0.43 },  // flare
  { c: [4.6, 0, 3.2], k: 0.36 },    // stockpile
];
// Timeline (scroll progress)
const T = {
  t1a: 0.17, t1b: 0.27, slA: 0.27, slB: 0.31, dvA: 0.31, dvB: 0.35, inB: 0.44,
  t2a: 0.44, t2b: 0.51, scA: 0.51, scB: 0.56, igA: 0.56, igB: 0.64,
  t3a: 0.68, t3b: 0.75, rsA: 0.738, rsB: 0.768, wpA: 0.79, wpB: 0.86, t4a: 0.86, t4b: 0.92, apA: 0.92, apB: 0.97,
};
const STILLS = [0.0, 0.13, 0.40, 0.665, 0.83, 1.0];
const MODES = [
  [0.05, 'OVERVIEW'], [0.17, 'SURVEY'], [0.27, 'MORPH · LIFT'], [0.31, 'SECTION'], [0.35, 'DIVE'], [0.44, 'INTERIOR'],
  [0.51, 'MORPH · HELIX'], [0.56, 'SCAN RESOLVE'], [0.68, 'CORROSION MAP'], [0.75, 'DISSOLVE · FALL'], [0.79, 'RESOLVE'],
  [0.86, 'EPOCH COMPARE'], [0.92, 'GATHER'], [1.01, 'ONE VIEW'],
];

export async function init(ctx) {
  const { S, RM, onFail } = ctx;
  const view = $('#view'), canvas = $('#gl'), stage = $('#stage');
  const MOBILE = window.innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4;
  const N = MOBILE ? 60000 : 120000;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { onFail(); return null; }
  renderer.setClearColor(0x0B0F13, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.autoClear = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onFail(); }, { once: true });

  let running = false, visible = true, dirty = true, rmQueued = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.03, 300);
  scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x20262e, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(6, 10, 8);
  scene.add(sun);

  const BG = new THREE.Vector3(0.0033, 0.0048, 0.0065); // #0B0F13, linear
  const MINT = new THREE.Color('#5ED1B3');
  const PR = () => renderer.getPixelRatio();

  /* =========================================================
     Particle system
     ========================================================= */
  const posA = new Float32Array(N * 3), posB = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3), colB = new Float32Array(N * 3);
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { seed[i * 4] = Math.random(); seed[i * 4 + 1] = i % 4; }
  const aPosA = new THREE.BufferAttribute(posA, 3), aPosB = new THREE.BufferAttribute(posB, 3);
  const aColA = new THREE.BufferAttribute(colA, 3), aColB = new THREE.BufferAttribute(colB, 3);
  const aSeed = new THREE.BufferAttribute(seed, 4);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', aPosA);
  pgeo.setAttribute('posA', aPosA);
  pgeo.setAttribute('posB', aPosB);
  pgeo.setAttribute('colA', aColA);
  pgeo.setAttribute('colB', aColB);
  pgeo.setAttribute('seed', aSeed);
  pgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

  const PU = {
    uMix: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 }, uPx: { value: 600 }, uPR: { value: 1 },
    uSizeA: { value: 0.05 }, uSizeB: { value: 0.05 }, uAlpha: { value: 1 }, uOpq: { value: 0.8 },
    uScanY: { value: -99 }, uSliceY: { value: 99 }, uResolveR: { value: -1 }, uFocus: { value: -1 }, uFocusAmt: { value: 0 },
    uFogN: { value: 20 }, uFogF: { value: 60 }, uBg: { value: BG }, uLeft: { value: 0 }, uWipeX: { value: 99 }, uMaxPx: { value: 5 },
  };
  const pmat = new THREE.ShaderMaterial({
    uniforms: PU,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    vertexShader: /* glsl */`
      attribute vec3 posA; attribute vec3 posB; attribute vec3 colA; attribute vec3 colB; attribute vec4 seed;
      uniform float uMix, uMode, uTime, uPx, uPR, uSizeA, uSizeB, uAlpha, uScanY, uSliceY, uResolveR, uFocus, uFocusAmt, uFogN, uFogF, uLeft, uWipeX, uMaxPx;
      uniform vec3 uBg;
      varying vec3 vCol; varying float vA;
      const vec3 MINT = vec3(0.112, 0.638, 0.451);
      const vec3 COOL = vec3(0.62, 0.70, 0.78);
      float eio(float x){ return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5; }
      float eout(float x){ return 1.0 - pow(1.0 - x, 3.0); }
      vec3 curlish(vec3 p, float t){
        return vec3(
          sin(p.y * 1.7 + t) * cos(p.z * 1.1 - t * 0.6) + sin(p.z * 2.3 + t * 0.4) * 0.5,
          sin(p.z * 1.5 + t * 0.8) * cos(p.x * 1.3 + t * 0.5) + sin(p.x * 2.1 - t * 0.3) * 0.5,
          sin(p.x * 1.9 - t * 0.6) * cos(p.y * 1.2 + t * 0.9) + sin(p.y * 2.2 + t * 0.7) * 0.5);
      }
      void main(){
        float r = seed.x, q = seed.y, hA = seed.z, hB = seed.w;
        vec3 A = posA, B = posB, p;
        float e = 0.0, fly = 0.0, a = 1.0, glow = 0.0;
        if (uMode < 0.5) {
          // POINT MORPH: staggered lift-off, curl-like turbulence, settle
          float d = r * 0.42;
          float t = clamp((uMix - d) / 0.58, 0.0, 1.0);
          e = eio(t); fly = sin(3.14159 * t);
          p = mix(A, B, e);
          vec3 mid = mix(A, B, 0.5);
          // coherent ribbon: offset driven by coarse position + progress, tiny per-particle jitter
          p.y += fly * (1.2 + 0.9 * sin(mid.x * 0.35 + mid.z * 0.25));
          p += curlish(mid * 0.18 + vec3(t * 2.2), uTime * 0.25) * fly * 0.85;
          p += (vec3(r, fract(r * 7.3), fract(r * 13.1)) - 0.5) * fly * 0.25;
        } else if (uMode < 1.5) {
          // HELIX: particles spiral round the vertical axis, bottom-up by target height
          float d = hB * 0.42 + r * 0.12;
          float t = clamp((uMix - d) / 0.46, 0.0, 1.0);
          e = eio(t); fly = sin(3.14159 * t);
          float ra = length(A.xz), rb = length(B.xz);
          float ta = atan(A.z, A.x), tb = atan(B.z, B.x);
          float dth = mod(tb - ta + 3.14159, 6.28318) - 3.14159;
          float th = ta + dth * e + fly * (2.2 + r * 2.6);
          float rr = mix(ra, rb, e) + fly * (1.1 + r * 1.9);
          p = vec3(cos(th) * rr, mix(A.y, B.y, e) + fly * (r - 0.5) * 2.4, sin(th) * rr);
        } else if (uMode < 2.5) {
          // DISSOLVE AND FALL: top breaks away first, drifts out, rains onto the terrain
          float d = (1.0 - hA) * 0.55 + r * 0.05;
          float started = step(0.0001, uMix - d);
          float t = clamp((uMix - d) / 0.4, 0.0, 1.0);
          a *= started;
          float t1 = clamp(t / 0.38, 0.0, 1.0), t2 = clamp((t - 0.38) / 0.62, 0.0, 1.0);
          float Hc = max(A.y, 3.0) * 0.45 + 3.0 + r * 3.5;
          p.xz = mix(A.xz, B.xz, eout(t1));
          p.y = mix(A.y, Hc, eout(t1));
          p.y = mix(p.y, B.y, t2 * t2);
          p += curlish(p * 0.6 + r * 4.0, uTime) * sin(3.14159 * t1) * 0.4;
          e = t2; fly = (1.0 - t2) * started * 0.8;
          glow = (1.0 - t1) * started * 0.85;
        } else {
          // GATHER: lift, converge into the four-up arrangement
          float d = q * 0.08 + r * 0.3;
          float t = clamp((uMix - d) / 0.6, 0.0, 1.0);
          e = eio(t); fly = sin(3.14159 * t);
          p = mix(A, B, e);
          vec3 mid = mix(A, B, 0.5);
          p.y += fly * (0.8 + 0.6 * sin(mid.x * 0.4 + q));
          p += curlish(mid * 0.2 + vec3(t * 2.0 + q), uTime * 0.25) * fly * 0.6;
          p += (vec3(r, fract(r * 7.3), fract(r * 13.1)) - 0.5) * fly * 0.2;
        }
        vec3 col = mix(colA, colB, smoothstep(0.25, 0.75, e));
        col = mix(col, COOL * (0.3 + 0.35 * r), fly * 0.3);
        col = mix(col, MINT, fly * step(0.976, r) * 0.9);
        if (uScanY > -50.0) {
          a *= smoothstep(uScanY - 0.02, uScanY + 0.22, p.y);
          glow += exp(-abs(p.y - uScanY) * 9.0);
        }
        if (uSliceY < 50.0) {
          a *= 1.0 - smoothstep(uSliceY - 0.02, uSliceY + 0.02, p.y);
          glow += exp(-abs(p.y - uSliceY) * 16.0) * 0.9;
        }
        if (uResolveR > 0.0) a *= smoothstep(uResolveR - 0.1, uResolveR + 0.9, length(p.xz));
        if (uFocusAmt > 0.0) a *= mix(1.0, abs(q - uFocus) < 0.5 ? 1.0 : 0.14, uFocusAmt);
        if (uWipeX < 50.0) { float dw = abs(p.x - uWipeX); a *= exp(-dw * 2.6) * 0.6; glow += exp(-dw * 7.0) * 0.6; }
        a *= mix(1.0, 0.42, fly);
        col = mix(col, MINT, clamp(glow, 0.0, 1.0) * 0.85);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(0.05, -mv.z);
        float sz = mix(uSizeA, uSizeB, e) * (0.75 + 0.5 * r) * (1.0 + clamp(glow, 0.0, 1.0) * 0.5) * (1.0 - fly * 0.55);
        gl_PointSize = clamp(sz * uPx / dist, 0.8 * uPR, min(uMaxPx, mix(5.0, 2.4, fly)) * uPR);
        a *= smoothstep(1.2, 4.5, dist);
        if (uLeft > 0.0) a *= mix(1.0, smoothstep(-0.34, -0.02, gl_Position.x / gl_Position.w), uLeft);
        float fog = smoothstep(uFogN, uFogF, dist);
        vCol = mix(col, uBg, fog * 0.85);
        vA = a * uAlpha * (1.0 - fog * 0.55);
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpq;
      varying vec3 vCol; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
        if (d > 0.25) discard;
        float al = vA * (1.0 - smoothstep(0.05, 0.25, d));
        if (al < 0.004) discard;
        gl_FragColor = vec4(vCol, 1.0);
        #include <colorspace_fragment>
        gl_FragColor = vec4(gl_FragColor.rgb * al, al * uOpq);
      }`,
  });
  const points = new THREE.Points(pgeo, pmat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);

  /* native point clouds share one look */
  function nativeMat(size, opq = 0.92) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 }, uSize: { value: size }, uPx: PU.uPx, uPR: PU.uPR, uFogN: PU.uFogN, uFogF: PU.uFogF, uBg: PU.uBg,
        uSliceY: { value: 99 }, uOpq: { value: opq }, uGain: { value: 1 }, uRamp: { value: 0 }, uGamma: { value: 1 }, uMaxPx: { value: 4.5 }, uNear: { value: new THREE.Vector2(0, 0.001) }, uLidar: { value: 0 }, uHard: { value: 0 }, uAxis: { value: new THREE.Vector3() }, uRad: { value: 3 },
      },
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      vertexShader: /* glsl */`
        uniform float uOpacity, uSize, uPx, uPR, uFogN, uFogF, uSliceY, uGain, uRamp, uGamma, uMaxPx, uLidar;
        uniform vec2 uNear;
        uniform vec3 uAxis; uniform float uRad;
        uniform vec3 uBg;
        varying vec3 vCol; varying float vA;
        const vec3 MINT = vec3(0.112, 0.638, 0.451);
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          float dist = max(0.05, -mv.z);
          gl_PointSize = clamp(uSize * uPx / dist, 0.7 * uPR, uMaxPx * uPR);
          float sl = 1.0 - smoothstep(uSliceY - 0.02, uSliceY + 0.02, wp.y);
          float sec = uSliceY < 50.0 ? exp(-abs(wp.y - uSliceY) * 16.0) : 0.0;
          float fog = smoothstep(uFogN, uFogF, dist);
          vec3 c = pow(color, vec3(uGamma)) * uGain;
          if (uLidar > 0.0) {
            // stretch the (mostly low) LiDAR intensity, cool-to-warm-white ramp, faint 1 m height rings
            float it = pow(clamp((color.b - 0.25) / 0.75, 0.0, 1.0), 0.42);
            vec3 lc = mix(vec3(0.075, 0.095, 0.125), vec3(0.36, 0.42, 0.48), smoothstep(0.05, 0.6, it));
            lc = mix(lc, vec3(0.95, 0.93, 0.88), smoothstep(0.55, 1.0, it));
            // pseudo-normal shading: shell faces inward, floor up, roof down
            vec2 rv = wp.xz - uAxis.xz; float rr = length(rv);
            vec3 nrm = rr > uRad * 0.8 ? vec3(-rv.x / rr, 0.0, -rv.y / rr) : (wp.y < 2.0 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0));
            float lam = abs(dot(nrm, normalize(cameraPosition - wp.xyz)));
            lc *= (0.35 + 0.95 * lam) * mix(1.15, 0.6, smoothstep(3.0, 11.0, dist));
            float ring = 1.0 - smoothstep(0.012, 0.04, abs(fract(wp.y / uLidar + 0.5) - 0.5) * uLidar);
            c = mix(lc, vec3(0.112, 0.638, 0.451), ring * 0.5);
          }
          if (uRamp > 0.0) c *= mix(vec3(0.30, 0.40, 0.52), vec3(1.05, 1.02, 0.98), smoothstep(0.0, uRamp, wp.y));
          c = mix(c, MINT, sec * 0.9);
          vCol = mix(c, uBg, fog * 0.85);
          vA = uOpacity * sl * (1.0 - fog * 0.55) * smoothstep(uNear.x, uNear.y, dist);
        }`,
      fragmentShader: /* glsl */`
        uniform float uOpq, uHard;
        varying vec3 vCol; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
          if (d > 0.25 || vA < 0.004) discard;
          float al = vA * mix(1.0 - smoothstep(0.07, 0.25, d), 1.0 - smoothstep(0.2, 0.25, d), uHard);
          gl_FragColor = vec4(vCol, 1.0);
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * al, al * uOpq);
        }`,
    });
  }

  /* placeholder: a faint survey grid, used before / while data streams in */
  const PH = (() => {
    const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3), heights = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = Math.random();
      let x, z;
      if (r < 0.62) { const ring = 1 + Math.floor(Math.random() * 11), a = Math.random() * Math.PI * 2; x = Math.cos(a) * ring; z = Math.sin(a) * ring; }
      else if (r < 0.9) { const a = Math.floor(Math.random() * 36) / 36 * Math.PI * 2, d = Math.random() * 11; x = Math.cos(a) * d; z = Math.sin(a) * d; }
      else { x = (Math.random() * 2 - 1) * 11; z = (Math.random() * 2 - 1) * 11; }
      positions[i * 3] = x; positions[i * 3 + 1] = 0; positions[i * 3 + 2] = z;
      const g = 0.03 + Math.random() * 0.03;
      colors[i * 3] = g; colors[i * 3 + 1] = g * 1.15; colors[i * 3 + 2] = g * 1.35;
    }
    return { positions, colors, heights };
  })();

  /* =========================================================
     Data
     ========================================================= */
  const A = { ph: { s: PH } };
  const pending = {};
  const dlk = {};
  $$('#dlk .dlk-r').forEach((r) => { dlk[r.dataset.k] = r; });
  const setStatus = (k, s) => {
    const r = dlk[k]; if (!r) return;
    r.dataset.s = s;
    $('.st', r).textContent = s === 'ready' ? 'READY' : s === 'loading' ? 'STREAM' : s === 'error' ? 'ERROR' : 'QUEUED';
  };
  function ensure(name) {
    if (pending[name]) return pending[name];
    setStatus(name, 'loading');
    pending[name] = (async () => {
      const s = await samplePoints(name, N, RAD[name]);
      let M = await stageTransform(name, RAD[name], N);
      const a = await load(name);
      if (name === 'stockpile') {
        const ys = new Float32Array(s.positions);
        for (let i = 1; i < ys.length; i += 3) ys[i] *= VEX;
        s.positions = ys;
        M = new THREE.Matrix4().makeScale(1, VEX, 1).multiply(M);
      }
      A[name] = { s, M, a };
      BUILD[name](A[name]);
      setStatus(name, 'ready');
      if (NAMES.every((n) => A[n])) buildQuad();
      buildIssues();
      needsPair = true;
      requestRender();
    })().catch((e) => { console.warn('[A2] data', name, e); setStatus(name, 'error'); });
    return pending[name];
  }

  /* =========================================================
     Labels (projected DOM)
     ========================================================= */
  const labelsEl = $('#labels');
  let overBox = false;
  labelsEl.addEventListener('pointerover', (e) => { overBox = !!e.target.closest('.c-box'); });
  labelsEl.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.c-box')) overBox = false; });
  const LBL = [];
  const GOP = { plant: 0, tank: 0, flare: 0, pile: 0, quad: 0, wipe: 0 };
  function addLabel(cls, html, v, g, auto = false) {
    const el = document.createElement('div');
    el.className = 'pl hide off ' + cls;
    el.innerHTML = html;
    labelsEl.appendChild(el);
    const L = { el, v: v.clone(), g, off: true, on: false, auto, dir: 'r', vd: 'u' };
    LBL.push(L);
    return L;
  }
  function lazyPhoto(el) {
    const go = () => {
      $$('img[data-src]', el).forEach((img) => {
        img.addEventListener('load', () => img.classList.add('ld'), { once: true });
        img.src = img.dataset.src; img.removeAttribute('data-src');
      });
      const cv = $('canvas[data-mask]', el);
      if (cv && !cv.dataset.done) { cv.dataset.done = '1'; paintMask(cv, cv.dataset.mask); }
    };
    el.addEventListener('pointerenter', go, { once: true });
    el.addEventListener('focusin', go, { once: true });
  }
  // class-index mask (0 bg, 1 light, 2 moderate, 3 heavy, 4 uncertain) -> severity overlay
  function paintMask(cv, url) {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, w, h), px = d.data;
      const pal = [null, [232, 197, 71], [242, 153, 74], [229, 72, 77], [197, 205, 214]];
      for (let i = 0; i < px.length; i += 4) {
        const c = pal[px[i]] || null;
        if (c) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 150; } else px[i + 3] = 0;
      }
      cx.putImageData(d, 0, 0);
    };
    img.src = url;
  }

  /* quad tags + wipe label exist from the start */
  const QSTAT = ['757,579 PTS', '280,000 PTS', '78 PATCHES', '2 SURVEYS'];
  const quadTags = NAMES.map((n, q) => addLabel('tag qd', `<span><b>0${q + 1}</b> ${SHORT[n]}<em> · ${QSTAT[q]}</em></span>`, new THREE.Vector3(QUAD[q].c[0], 4, QUAD[q].c[2]), 'quad'));
  const wipeTag = addLabel('tag wl', '<span>SURVEY 2 · +10 D<i>│</i>SURVEY 1</span>', new THREE.Vector3(0, 2.3, 0), 'wipe');

  /* =========================================================
     Asset builders
     ========================================================= */
  const BUILD = {};
  const plantC = new THREE.Vector3(1, 0.4, 1);
  let plantPts = null, orthoMesh = null, droneGroup = null, pathLine = null, flightCurve = null, dropLine = null;
  let tankPts = null; const tankAxis = new THREE.Vector3();
  let flareGroup = null, patchList = [], flareMarks = null; const flareAxis = new THREE.Vector3(); let flareH = 16;
  const flarePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 99);
  let stockGroup = null, terrMats = [], pileInfo = [], lineMats = [];
  const wipePlaneA = new THREE.Plane(new THREE.Vector3(1, 0, 0), 99);   // e1 keeps x >= wipe
  const wipePlaneB = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -99); // e2 keeps x <= wipe
  let curtain = null;

  BUILD.plant = ({ s, M, a }) => {
    const sc = s.scale, minY = s.center.y - s.size.y / 2;
    const top = new THREE.Vector3();
    const tops = PLANT_TANKS.map(([x, z]) => new THREE.Vector3(x, 51.5, z).applyMatrix4(M));
    plantC.set(0, 0, 0); tops.forEach((v) => plantC.add(v)); plantC.multiplyScalar(1 / tops.length); plantC.y = (0 - minY) * sc + 0.2;
    if (!MOBILE) {
      plantPts = new THREE.Points(a.cloud.geometry, nativeMat(0.026, 0.9));
      plantPts.matrixAutoUpdate = false; plantPts.matrix.copy(M); plantPts.frustumCulled = false;
      plantPts.renderOrder = 9;
      scene.add(plantPts);
    }
    orthoMesh = new THREE.Mesh(a.ortho.geometry, new THREE.MeshBasicMaterial({ map: a.ortho.material.map, color: 0x7d8790, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    orthoMesh.material.map.anisotropy = 8;
    orthoMesh.matrixAutoUpdate = false; orthoMesh.matrix.copy(M);
    orthoMesh.renderOrder = 1;
    scene.add(orthoMesh);

    // flight path: a loop over the tank rows at ~120 m
    const alt = (120 - minY) * sc;
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const th = (i / 12) * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(th * 3 + 1.2);
      pts.push(new THREE.Vector3(plantC.x + Math.cos(th) * 3.7 * wob, alt + Math.sin(th * 2) * 0.06, plantC.z + Math.sin(th) * 2.3 * wob));
    }
    flightCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(flightCurve.getSpacedPoints(500)),
      new THREE.LineDashedMaterial({ color: MINT, dashSize: 0.09, gapSize: 0.07, transparent: true, opacity: 0, depthWrite: false }));
    pathLine.computeLineDistances();
    pathLine.renderOrder = 12;
    scene.add(pathLine);
    droneGroup = new THREE.Group();
    const s2 = [], arm = 2.2;
    s2.push(-arm, 0, -arm, arm, 0, arm, -arm, 0, arm, arm, 0, -arm);
    [[arm, arm], [-arm, arm], [arm, -arm], [-arm, -arm]].forEach(([cx, cz]) => {
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
        s2.push(cx + Math.cos(a0) * 1.1, 0.15, cz + Math.sin(a0) * 1.1, cx + Math.cos(a1) * 1.1, 0.15, cz + Math.sin(a1) * 1.1);
      }
    });
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(s2, 3));
    droneGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: MINT, transparent: true })));
    droneGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.0), new THREE.MeshBasicMaterial({ color: 0xEEF2F5, transparent: true })));
    droneGroup.scale.setScalar(0.05);
    droneGroup.renderOrder = 12;
    scene.add(droneGroup);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    dropLine = new THREE.Line(dg, new THREE.LineBasicMaterial({ color: 0x8E99A6, transparent: true, opacity: 0, depthWrite: false }));
    dropLine.frustumCulled = false;
    scene.add(dropLine);

    // callouts on the real tanks
    const cl = [
      { i: 5, dir: 'r', head: ['TANK A', 'Ø 93.5 m'], p: 'Full-height storage tank in true-colour photogrammetry. Roof crown 51.5 m above the site datum.', dl: [['DIAMETER', '93.5 m'], ['CROWN', '51.5 m']] },
      { i: 2, dir: 'l', head: ['TANK ROW', '8 × Ø 93.5 m'], p: 'Two rows of four on 145 m centres, captured in one flight and placed on the orthomosaic.', dl: [['ROWS', '2 × 4'], ['CENTRES', '145 m']] },
      { i: 7, dir: 'r', head: ['CLOUD', '757,579 pts'], p: 'Photogrammetry cloud with true RGB across about 2.1 km by 1 km, with 88 m of relief.', dl: [['EXTENT', '2.1 × 1.0 km'], ['COLOUR', 'TRUE RGB']] },
    ];
    cl.forEach((c) => {
      const v = tops[c.i].clone(); v.y += 0.02;
      const [x, z] = PLANT_TANKS[c.i];
      const L = addLabel('callout', `<i class="c-dot"></i><i class="c-lead"></i><div class="c-box" tabindex="0"><div class="c-head"><i></i><b>${c.head[0]}</b><span>${c.head[1]}</span></div><div class="c-more"><div><p>${c.p}</p><dl>${c.dl.map((d) => `<dt>${d[0]}</dt><dd>${d[1]}</dd>`).join('')}<dt>E / N</dt><dd>${grp(x)} / ${grp(-z)}</dd></dl></div></div></div>`, v, 'plant', true);
      L.el.style.setProperty('--sev', 'var(--mint)');
    });
    $('#d0Stat').textContent = ASSETS.plant.stat.toUpperCase();
    introReady();
  };

  BUILD.tank = ({ s, M, a }) => {
    tankAxis.set(0, 0, 0).applyMatrix4(M);
    tankPts = new THREE.Points(a.cloud.geometry, nativeMat(0.028, 0.95));
    tankPts.material.uniforms.uRamp.value = 0;
    tankPts.material.uniforms.uLidar.value = 1.0;
    tankPts.material.uniforms.uHard.value = 1.0;
    tankPts.material.uniforms.uMaxPx.value = 2.8;
    tankPts.material.uniforms.uAxis.value.copy(tankAxis);
    tankPts.material.uniforms.uRad.value = 2.35 * s.scale;
    tankPts.matrixAutoUpdate = false; tankPts.matrix.copy(M); tankPts.frustumCulled = false; tankPts.visible = false;

    tankPts.renderOrder = 9;
    scene.add(tankPts);
    a.findings.forEach((f) => {
      const v = f.position.clone().applyMatrix4(M);
      const L = addLabel('callout ph', `<i class="c-dot"></i><i class="c-lead"></i><div class="c-box" tabindex="0"><div class="c-head"><i></i><b>${esc(f.id)}</b><span>${esc(f.title)}</span><em>SEV ${f.severity}</em></div><div class="c-more"><div><figure class="c-ph"><img alt="${esc(f.title)}: inspection photo" data-src="${esc(f.photo)}"><figcaption>${esc(f.area).toUpperCase()} · ${esc(f.class).toUpperCase()}</figcaption></figure><p>${esc(f.description)}</p><dl><dt>SEVERITY</dt><dd>${f.severity} / 5</dd><dt>HEIGHT</dt><dd>${f.position.y.toFixed(2)} m</dd></dl></div></div></div>`, v, 'tank', true);
      L.el.style.setProperty('--sev', SEVV(f.severity));
      lazyPhoto(L.el);
    });
    $('#d1Stat').textContent = ASSETS.tank.stat.toUpperCase();
  };

  BUILD.flare = ({ s, M, a }) => {
    flareGroup = new THREE.Group();
    flareGroup.matrixAutoUpdate = false; flareGroup.matrix.copy(M);
    flareGroup.add(a.model);
    a.model.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => { m.clippingPlanes = [flarePlane]; m.needsUpdate = true; });
    });
    flareH = s.size.y * s.scale;
    const head = a.records.filter((r) => /head/i.test(r.zone));
    const ax = head.reduce((acc, r) => acc + r.center[0], 0) / Math.max(1, head.length);
    const az = head.reduce((acc, r) => acc + r.center[2], 0) / Math.max(1, head.length);
    flareAxis.set(ax, 0, az).applyMatrix4(M); flareAxis.y = 0;
    // patches, ordered bottom to top for ignition
    const order = a.patches.map((p, i) => i).sort((i, j) => a.patches[i].center.y - a.patches[j].center.y);
    patchList = a.patches.map((p) => ({ p, ord: 0 }));
    order.forEach((idx, rank) => { patchList[idx].ord = (rank / Math.max(1, order.length - 1)) * 0.9; });
    patchList.forEach(({ p }) => {
      p.mesh.material.clippingPlanes = [flarePlane];
      p.mesh.material.opacity = 0;
      p.mesh.renderOrder = 3;
      flareGroup.add(p.mesh);
    });
    flareGroup.visible = false;
    scene.add(flareGroup);
    // ignition markers (stage space, pushed off the shell)
    const mp = new Float32Array(patchList.length * 3), mo = new Float32Array(patchList.length), mc = new Float32Array(patchList.length * 3);
    const tmpc = new THREE.Color();
    patchList.forEach(({ p, ord }, i) => {
      const v = p.center.clone().applyMatrix4(M);
      const out = new THREE.Vector3(v.x - flareAxis.x, 0, v.z - flareAxis.z);
      if (out.lengthSq() > 1e-6) out.normalize().multiplyScalar(0.08); v.add(out);
      mp[i * 3] = v.x; mp[i * 3 + 1] = v.y; mp[i * 3 + 2] = v.z;
      mo[i] = ord;
      tmpc.set(p.record.severity >= 2 ? '#F2994A' : '#E8C547');
      mc[i * 3] = tmpc.r; mc[i * 3 + 1] = tmpc.g; mc[i * 3 + 2] = tmpc.b;
    });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aOrd', new THREE.BufferAttribute(mo, 1));
    mg.setAttribute('aCol', new THREE.BufferAttribute(mc, 3));
    flareMarks = new THREE.Points(mg, new THREE.ShaderMaterial({
      uniforms: { uIgn: { value: 0 }, uPR: PU.uPR, uOp: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */`
        attribute float aOrd; attribute vec3 aCol;
        uniform float uIgn, uPR, uOp;
        varying vec3 vC; varying float vA;
        void main(){
          float k = smoothstep(aOrd, aOrd + 0.02, uIgn);
          float fl = k * exp(-max(0.0, uIgn - aOrd - 0.02) * 26.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (8.0 + 34.0 * fl) * uPR * k;
          vC = mix(aCol, vec3(1.0, 0.85, 0.62), fl * 0.7);
          vA = k * (0.7 + fl * 0.8) * uOp;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float core = 1.0 - smoothstep(0.08, 0.2, d);
          float ring = smoothstep(0.33, 0.38, d) * (1.0 - smoothstep(0.42, 0.5, d));
          float al = (core + ring * 0.7) * vA;
          if (al < 0.01) discard;
          gl_FragColor = vec4(vC, 1.0);
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * al, al * 0.4);
        }`,
    }));
    flareMarks.frustumCulled = false; flareMarks.renderOrder = 14; flareMarks.visible = false;
    scene.add(flareMarks);
    // zone counts for the copy
    const z = { head: 0, stack: 0, base: 0 };
    a.records.forEach((r) => { if (/head/i.test(r.zone)) z.head++; else if (/base/i.test(r.zone)) z.base++; else z.stack++; });
    $('#d2Zones').textContent = `HEAD ${z.head} · STACK ${z.stack} · BASE ${z.base}`;
    // three callouts: the most extensive patch per zone
    const pick = ['head', 'access', 'base'].map((k) => a.patches.filter((p) => new RegExp(k, 'i').test(p.record.zone)).sort((x, y) => y.record.coverage - x.record.coverage)[0]).filter(Boolean);
    pick.forEach((p, i) => {
      const r = p.record;
      const v = p.center.clone().applyMatrix4(M);
      const L = addLabel('callout ph', `<i class="c-dot"></i><i class="c-lead"></i><div class="c-box" tabindex="0"><div class="c-head"><i></i><b>${esc(r.id)}</b><span>${esc(r.component)}</span><em>${FLARE_GRADE(r)}</em></div><div class="c-more"><div><figure class="c-ph w"><img alt="${esc(r.title)}: inspection photo" data-src="${esc(p.photo)}"><canvas data-mask="${esc(p.mask)}" aria-hidden="true"></canvas><figcaption>PHOTO + CORROSION MASK</figcaption></figure><p>${esc(r.title)}.</p><dl><dt>ZONE</dt><dd>${esc(r.zone).toUpperCase()}</dd><dt>HEIGHT</dt><dd>${r.center[1].toFixed(1)} m</dd><dt>COVERAGE</dt><dd>${r.coverage.toFixed(2)} %</dd></dl></div></div></div>`, v, 'flare', true);
      L.el.style.setProperty('--sev', FLARE_SEV(r.severity));
      lazyPhoto(L.el);
    });
  };

  // height maps of both epochs for the cut/fill tint
  const HMAX = 3.0, HFULL = 22;
  const hRT = [0, 1].map(() => new THREE.WebGLRenderTarget(512, 512, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true }));
  const hMat = new THREE.ShaderMaterial({
    vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying float vY; void main(){ float h = clamp(vY / ${HMAX.toFixed(1)}, 0.0, 0.9999); float hi = floor(h * 255.0) / 255.0; float lo = fract(h * 255.0); gl_FragColor = vec4(hi, lo, 0.0, 1.0); }`,
  });
  const hCam = new THREE.OrthographicCamera(-HFULL / 2, HFULL / 2, HFULL / 2, -HFULL / 2, 0.1, 100);
  hCam.position.set(0, 50, 0); hCam.up.set(0, 0, -1); hCam.lookAt(0, 0, 0); hCam.updateMatrixWorld();

  BUILD.stockpile = ({ s, M, a }) => {
    stockGroup = new THREE.Group();
    stockGroup.matrixAutoUpdate = false; stockGroup.matrix.copy(M);
    const sc = s.scale;
    const terr = [];
    [a.e1, a.e2].forEach((root, side) => {
      stockGroup.add(root);
      root.traverse((o) => {
        if (o.isMesh && /terrain/i.test(o.name + ' ' + (o.parent ? o.parent.name : ''))) {
          const map = o.material.map;
          const m = new THREE.ShaderMaterial({
            uniforms: {
              map: { value: map }, uH1: { value: hRT[0].texture }, uH2: { value: hRT[1].texture }, uSide: { value: side },
              uWipe: { value: 99 }, uResolveR: { value: 0 }, uDiff: { value: 0 }, uOpacity: { value: 1 },
              uDead: { value: 0.1 }, uHs: { value: HMAX / (sc * VEX) }, uFull: { value: HFULL },
            },
            transparent: true,
            vertexShader: /* glsl */`
              varying vec2 vUv; varying vec3 vW;
              void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
            fragmentShader: /* glsl */`
              uniform sampler2D map, uH1, uH2;
              uniform float uSide, uWipe, uResolveR, uDiff, uOpacity, uDead, uHs, uFull;
              varying vec2 vUv; varying vec3 vW;
              const vec3 MINT = vec3(0.112, 0.638, 0.451);
              const vec3 CUT = vec3(0.888, 0.319, 0.069);
              const vec3 FILL = vec3(0.104, 0.332, 0.665);
              float dec(vec4 t){ return t.r + t.g / 255.0; }
              void main(){
                float rr = length(vW.xz);
                if (rr > uResolveR) discard;
                if (uSide < 0.5) { if (vW.x < uWipe) discard; } else { if (vW.x >= uWipe) discard; }
                vec3 col = texture2D(map, vUv).rgb * 0.92;
                if (uSide > 0.5 && uDiff > 0.0) {
                  vec2 hu = vec2(vW.x / uFull + 0.5, -vW.z / uFull + 0.5);
                  vec4 a = texture2D(uH1, hu), b = texture2D(uH2, hu);
                  if (a.a > 0.5 && b.a > 0.5) {
                    float dh = (dec(b) - dec(a)) * uHs;
                    float k = smoothstep(uDead, uDead + 1.4, abs(dh));
                    col = mix(col, dh < 0.0 ? CUT : FILL, k * 0.66 * uDiff);
                  }
                }
                float edge = uResolveR < 30.0 ? exp(-abs(rr - uResolveR) * 7.0) : 0.0;
                float wl = abs(uWipe) < 12.0 ? exp(-abs(vW.x - uWipe) * 36.0) : 0.0;
                col = mix(col, MINT, clamp(edge * 0.9 + wl * 0.85, 0.0, 1.0));
                gl_FragColor = vec4(col, uOpacity);
                #include <colorspace_fragment>
              }`,
          });
          terr.push({ mesh: o, mat: m, side });
          terrMats.push(m);
          o.renderOrder = 2;
        } else if (o.isLine || o.isLineSegments) {
          o.material = new THREE.LineBasicMaterial({ color: 0xC5CDD6, transparent: true, opacity: 0, depthWrite: false, clippingPlanes: [side ? wipePlaneB : wipePlaneA] });
          o.renderOrder = 4;
          lineMats.push(o.material);
        }
      });
    });
    stockGroup.visible = false;
    scene.add(stockGroup);
    stockGroup.updateMatrixWorld(true);
    // bake the two height maps
    terr.forEach((t) => { t.mesh.material = hMat; });
    terr.forEach((t) => {
      const others = terr.filter((o) => o !== t);
      others.forEach((o) => { o.mesh.visible = false; });
      renderer.setRenderTarget(hRT[t.side]);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(t.mesh, hCam);
      others.forEach((o) => { o.mesh.visible = true; });
    });
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x0B0F13, 1);
    terr.forEach((t) => { t.mesh.material = t.mat; });

    // pile labels at the real pile tops, volumes from volumes.json
    const P = s.positions;
    pileInfo = a.volumes.piles.map((pl) => {
      const e1 = pl.epochs.e1, e2 = pl.epochs.e2;
      const ring = (e2 || e1).ring;
      let cx = 0, cz = 0; ring.forEach(([x, z]) => { cx += x; cz += z; }); cx /= ring.length; cz /= ring.length;
      const c = new THREE.Vector3(cx, 0, cz).applyMatrix4(M);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      ring.forEach(([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(M); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); });
      let top = 0;
      for (let i = 0; i < P.length; i += 3) { const x = P[i], z = P[i + 2]; if (x > x0 && x < x1 && z > z0 && z < z1 && P[i + 1] > top) top = P[i + 1]; }
      c.y = top;
      return { id: pl.id, c, v1: e1.volumes.tin, v2: e2.volumes.tin, w: 0 };
    });
    const top5 = [...pileInfo].sort((x, y) => y.v1.net - x.v1.net).slice(0, 5);
    top5.forEach((pi) => {
      pi.tag = addLabel('tag vol', `<span><em>${pi.id}</em><b>0</b> m³<small>S1</small></span>`, pi.c, 'pile');
      pi.tagB = $('b', pi.tag.el); pi.tagS = $('small', pi.tag.el);
    });
    $('#vtRows').innerHTML = top5.map((pi) => `<div class="vt-r" data-id="${pi.id}"><span>${pi.id}</span><span>0</span><span>0</span><span>0</span><span class="ep">S1</span></div>`).join('');
    top5.forEach((pi) => { pi.row = $(`.vt-r[data-id="${pi.id}"]`); pi.cells = $$('span', pi.row); });
    pileChange = a.volumes.pileChange;
    volTot.e1 = a.volumes.totals.e1.tin; volTot.e2 = a.volumes.totals.e2.tin;
    // wipe curtain
    curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uOp: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uOp; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.16 + smoothstep(0.985, 1.0, vUv.y) * 0.7; a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x); gl_FragColor = vec4(vec3(0.369, 0.82, 0.702) * a * uOp, 1.0); }`,
    }));
    curtain.rotation.y = Math.PI / 2;
    curtain.scale.set(20, 2.2, 1);
    curtain.visible = false; curtain.renderOrder = 15;
    scene.add(curtain);
  };
  let pileChange = { fill: 0, cut: 0, net: 0 };
  const volTot = { e1: 0, e2: 0 };

  /* quad: 4 assets, interleaved by particle index */
  function buildQuad() {
    if (A.quad) return;
    const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3), heights = new Float32Array(N);
    const ax = [new THREE.Vector3(), tankAxis, flareAxis, new THREE.Vector3()];
    for (let i = 0; i < N; i++) {
      const q = i % 4, s = A[NAMES[q]].s, Q = QUAD[q], o = ax[q];
      positions[i * 3] = (s.positions[i * 3] - (q === 0 ? plantC.x : o.x)) * Q.k + Q.c[0];
      positions[i * 3 + 1] = s.positions[i * 3 + 1] * Q.k + Q.c[1];
      positions[i * 3 + 2] = (s.positions[i * 3 + 2] - (q === 0 ? plantC.z : o.z)) * Q.k + Q.c[2];
      colors[i * 3] = s.colors[i * 3]; colors[i * 3 + 1] = s.colors[i * 3 + 1]; colors[i * 3 + 2] = s.colors[i * 3 + 2];
      heights[i] = s.heights[i];
    }
    A.quad = { s: { positions, colors, heights } };
    const tops = [0.9, 12 * QUAD[1].k + 0.5, 16 * QUAD[2].k + 0.5, 1.2];
    quadTags.forEach((L, q) => L.v.set(QUAD[q].c[0], tops[q], QUAD[q].c[2]));
  }

  /* pair management: which two buffers the single Points morphs between */
  let curPair = '', needsPair = true;
  function sampleOf(k) { return (A[k] && A[k].s) || PH; }
  function writePair(ka, kb) {
    const a = sampleOf(ka), b = sampleOf(kb);
    posA.set(a.positions); colA.set(a.colors);
    posB.set(b.positions); colB.set(b.colors);
    for (let i = 0; i < N; i++) { seed[i * 4 + 2] = a.heights[i] || 0; seed[i * 4 + 3] = b.heights[i] || 0; }
    aPosA.needsUpdate = aPosB.needsUpdate = aColA.needsUpdate = aColB.needsUpdate = aSeed.needsUpdate = true;
    PU.uSizeA.value = PSIZE[ka] || PSIZE.ph; PU.uSizeB.value = PSIZE[kb] || PSIZE.ph;
  }
  function pairFor(p) {
    if (intro.on) return ['ph', 'plant', 0];
    if (p < 0.39) return ['plant', 'tank', 0];
    if (p < 0.66) return ['tank', 'flare', 1];
    if (p < 0.82) return ['flare', 'stockpile', 2];
    return ['stockpile', 'quad', 3];
  }
  const MIXR = [[T.t1a, T.t1b], [T.t2a, T.t2b], [T.t3a, T.t3b], [T.t4a, T.t4b]];

  /* intro: grid -> plant once the real cloud arrives */
  const intro = { on: false, t0: 0, k: RM ? 1 : 0 };
  function introReady() {
    if (RM || S.p > 0.12) { intro.k = 1; return; }
    intro.on = true; intro.t0 = performance.now(); intro.k = 0;
    needsPair = true;
  }

  /* =========================================================
     Overlays: slice / scan rings
     ========================================================= */
  function makeRing(r) {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0, depthWrite: false }));
    const disk = new THREE.Mesh(new THREE.CircleGeometry(r, 96), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    disk.rotation.x = -Math.PI / 2;
    g.add(line, disk); g.visible = false; g.renderOrder = 13;
    g.userData = { line, disk };
    scene.add(g);
    return g;
  }
  const sliceRing = makeRing(3.9), scanRing = makeRing(1.9);
  const setRing = (g, op, fill) => { g.visible = op > 0.005; g.userData.line.material.opacity = op; g.userData.disk.material.opacity = op * fill; };

  /* =========================================================
     App chrome (chapter 05)
     ========================================================= */
  const app = $('#app'), aVp = $('#aVp'), aDs = $('#aDs');
  aDs.innerHTML = NAMES.map((n, q) => `<li data-q="${q}" tabindex="0"><i class="sw"></i><div><b>${LABEL[n]}</b><span>${esc(ASSETS[n].kind)}</span><em>${esc(ASSETS[n].stat)}</em></div></li>`).join('');
  let focusQ = -1, focusAmt = 0;
  $$('li', aDs).forEach((li) => {
    const q = Number(li.dataset.q);
    const on = () => { focusQ = q; $$('li', aDs).forEach((o) => o.classList.toggle('on', o === li)); quadTags.forEach((L, k) => L.el.classList.toggle('dim', k !== q)); };
    const off = () => { focusQ = -1; $$('li', aDs).forEach((o) => o.classList.remove('on')); quadTags.forEach((L) => L.el.classList.remove('dim')); };
    li.addEventListener('pointerenter', on); li.addEventListener('focus', on);
    li.addEventListener('pointerleave', off); li.addEventListener('blur', off);
  });
  // timeline tracks
  (function buildTimeline() {
    const rows = [
      ['TERMINAL', '<i style="left:2%;width:24%"></i>'],
      ['TANK', '<i style="left:28%;width:16%"></i>' + [30, 33, 35, 38, 40, 42].map((x, i) => `<i class="m" style="left:${x}%;--c:${['#E5484D', '#F2994A', '#E8C547', '#E8C547', '#E8C547', '#E8C547'][i]}"></i>`).join('')],
      ['FLARE', '<i style="left:46%;width:20%"></i>' + Array.from({ length: 26 }, (_, i) => `<i class="m" style="left:${(47 + i * 0.72).toFixed(2)}%;--c:#F2994A;opacity:.7"></i>`).join('')],
      ['YARD', '<i class="ep" style="left:68%;width:12%"></i><i class="ep" style="left:86%;width:12%"></i>'],
    ];
    $('#tlRows').innerHTML = rows.map(([k, h]) => `<div class="tl-r"><span>${k}</span><span class="tk">${h}</span></div>`).join('') + '<i class="tl-ph" id="tlPh"></i>';
  })();
  const tlPh = $('#tlPh'), tlT = $('#tlT');
  let issuesBuilt = '';
  function buildIssues() {
    const key = NAMES.map((n) => (A[n] ? 1 : 0)).join('');
    if (key === issuesBuilt) return;
    issuesBuilt = key;
    const items = [];
    if (A.tank) A.tank.a.findings.forEach((f) => items.push(`<li style="--sev:${SEVC(f.severity)}"><span class="th"><img alt="" data-src="${esc(f.photo)}"></span><div><b>${esc(f.id)} · ${esc(f.title)}</b><span><em>SEV ${f.severity}</em>TANK · ${esc(f.area).toUpperCase()}</span></div></li>`));
    if (A.flare) {
      const ps = [...A.flare.a.patches].sort((x, y) => y.record.coverage - x.record.coverage).slice(0, 3);
      ps.forEach((p) => items.push(`<li style="--sev:${p.record.severity >= 2 ? '#F2994A' : '#E8C547'}"><span class="th"><img alt="" data-src="${esc(p.photo)}"></span><div><b>${esc(p.record.id)} · ${esc(p.record.component)}</b><span><em>${FLARE_GRADE(p.record)}</em>FLARE · ${p.record.center[1].toFixed(0)} M</span></div></li>`));
      items.push(`<li style="--sev:#F2994A"><span class="th"></span><div><b>+ ${A.flare.a.patches.length - 3} more mapped patches</b><span><em>FLARE</em>HEAD · STACK · BASE</span></div></li>`);
    }
    if (A.stockpile) items.push(`<li style="--sev:#5B9BD5"><span class="th"></span><div><b>Stockpile net volume, 19 piles</b><span><em>${sgn(volTot.e2 - volTot.e1)} m³</em>YARD · S1→S2</span></div></li>`);
    $('#aIss').innerHTML = items.join('');
    $('#aIssN').textContent = (A.tank ? A.tank.a.findings.length : 0) + (A.flare ? ' + ' + A.flare.a.patches.length : '');
    if (thumbsOn) loadThumbs();
  }
  let thumbsOn = false;
  function loadThumbs() { $$('#aIss img[data-src]').forEach((img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); }); }

  /* =========================================================
     Camera keys (stage units)
     ========================================================= */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mk = () => ({ p: V(0, 0, 0), t: V(0, 0, 0), fov: 0, inside: false });
  const kA = mk(), kB = mk(), kC = mk(), kOut = mk();
  const setK = (k, p, t, fov = 0, inside = false) => { k.p.copy(p); k.t.copy(t); k.fov = fov; k.inside = inside; return k; };
  const tv1 = V(0, 0, 0), tv2 = V(0, 0, 0);
  function keyHero(k, t) { const ang = -0.95 + t * 0.022; return setK(k, tv1.set(plantC.x + Math.cos(ang) * 11.5, plantC.y + 5.6, plantC.z + Math.sin(ang) * 11.5), tv2.set(plantC.x - 0.6, plantC.y, plantC.z)); }
  function keyPlant(k, t) { const ang = -0.62 + t * 0.014; return setK(k, tv1.set(plantC.x + Math.cos(ang) * 8.2, plantC.y + 4.1, plantC.z + Math.sin(ang) * 8.2), tv2.set(plantC.x + 0.2, plantC.y - 0.1, plantC.z)); }
  const keyLift = (k) => setK(k, tv1.set(plantC.x * 0.5 + 9, 15, 29), tv2.set(0, 4.5, 0));
  const keyTank = (k) => setK(k, tv1.set(tankAxis.x + 13, 8.5, tankAxis.z + 15.5), tv2.set(tankAxis.x, 6.2, tankAxis.z));
  const keyOver = (k) => setK(k, tv1.set(tankAxis.x + 2.6, 19.5, tankAxis.z + 5.2), tv2.set(tankAxis.x, 6.0, tankAxis.z));
  const keyIn = (k, i) => {
    const P = [[-2.4, 7.6, 0.7, 2.6, 2.4, -0.8], [-2.5, 6.6, 0.9, 2.4, 3.6, -0.9], [-2.2, 4.6, 0.5, 1.4, 10.6, 0.0]][i];
    return setK(k, tv1.set(tankAxis.x + P[0], P[1], tankAxis.z + P[2]), tv2.set(tankAxis.x + P[3], P[4], tankAxis.z + P[5]), 1, true);
  };
  const keyExit = (k) => setK(k, tv1.set(tankAxis.x + 9, 21, tankAxis.z + 20), tv2.set(flareAxis.x, 7, flareAxis.z));
  const keyFlA = (k) => setK(k, tv1.set(flareAxis.x + 11.5, 6.5, flareAxis.z + 19), tv2.set(flareAxis.x, 7.6, flareAxis.z));
  const keyFlB = (k, u) => setK(k, tv1.set(flareAxis.x + 6.2, 2.2 + u * 11.5, flareAxis.z + 9.6), tv2.set(flareAxis.x, 1.6 + u * 12.2, flareAxis.z));
  const keyFlC = (k) => setK(k, tv1.set(flareAxis.x + 7.8, 13.6, flareAxis.z + 10.5), tv2.set(flareAxis.x, 12.2, flareAxis.z));
  const keyRain = (k) => setK(k, tv1.set(1, 30, 27), tv2.set(0, 2, 0));
  const keyStock = (k, u) => setK(k, tv1.set(-1.5 + u * 3, 12.8, 15.6), tv2.set(u * 0.8 - 0.4, 0.4, 1.2));
  const keyQuad = (k, t) => { const ang = Math.PI / 2 + Math.sin(t * 0.05) * 0.16; return setK(k, tv1.set(Math.cos(ang) * 16.5, 11, Math.sin(ang) * 16.5), tv2.set(0, 1.6, 0)); };
  function kmix(a, b, e, out) { out.p.lerpVectors(a.p, b.p, e); out.t.lerpVectors(a.t, b.t, e); out.fov = lerp(a.fov, b.fov, e); out.inside = e < 0.5 ? a.inside : b.inside; return out; }
  const bz = (a, m, b, e) => (1 - e) * (1 - e) * a + 2 * (1 - e) * e * m + e * e * b;
  function kbez(a, m, b, e, out) {
    out.p.set(bz(a.p.x, m.p.x, b.p.x, e), bz(a.p.y, m.p.y, b.p.y, e), bz(a.p.z, m.p.z, b.p.z, e));
    out.t.set(bz(a.t.x, m.t.x, b.t.x, e), bz(a.t.y, m.t.y, b.t.y, e), bz(a.t.z, m.t.z, b.t.z, e));
    out.fov = lerp(a.fov, b.fov, e); out.inside = false; return out;
  }
  function camKey(p, t) {
    if (p < 0.05) return keyHero(kOut, t);
    if (p < 0.12) { keyHero(kA, t); keyPlant(kB, t); return kmix(kA, kB, eio(lin(0.05, 0.12, p)), kOut); }
    if (p < T.t1a) return keyPlant(kOut, t);
    if (p < T.t1b) { keyPlant(kA, t); keyLift(kB); keyTank(kC); return kbez(kA, kB, kC, eio(lin(T.t1a, T.t1b, p)), kOut); }
    if (p < T.slB) { keyTank(kA); keyOver(kB); return kmix(kA, kB, eio(lin(T.slA, T.slB, p)), kOut); }
    if (p < T.dvB) { keyOver(kA); keyIn(kB, 0); const e = eio(lin(T.dvA, T.dvB, p)); kmix(kA, kB, e, kOut); kOut.inside = e > 0.55; return kOut; }
    if (p < T.inB) {
      const u = lin(T.dvB, T.inB, p);
      if (u < 0.5) { keyIn(kA, 0); keyIn(kB, 1); return kmix(kA, kB, eio(u * 2), kOut); }
      keyIn(kA, 1); keyIn(kB, 2); return kmix(kA, kB, eio(u * 2 - 1), kOut);
    }
    if (p < T.t2b) { keyIn(kA, 2); keyExit(kB); keyFlA(kC); const o = kbez(kA, kB, kC, eio(lin(T.t2a, T.t2b, p)), kOut); o.fov = 1 - eio(lin(T.t2a, T.t2a + 0.05, p)); o.inside = p < T.t2a + 0.015; return o; }
    if (p < T.scB) return keyFlA(kOut);
    if (p < T.igB) { keyFlA(kA); keyFlB(kB, eio(lin(T.igA, T.igB, p))); return kmix(kA, kB, eio(lin(T.igA, T.igA + 0.03, p)), kOut); }
    if (p < T.t3a) { keyFlB(kA, 1); keyFlC(kB); return kmix(kA, kB, eio(lin(T.igB, T.t3a, p)), kOut); }
    if (p < T.t3b) { keyFlC(kA); keyRain(kB); keyStock(kC, 0); return kbez(kA, kB, kC, eio(lin(T.t3a, T.t3b + 0.03, p)), kOut); }
    if (p < T.t4a) { keyFlC(kA); keyRain(kB); keyStock(kC, 0); const e0 = lin(T.t3a, T.t3b + 0.03, p); if (e0 < 1) return kbez(kA, kB, kC, eio(e0), kOut); return keyStock(kOut, eio(lin(T.wpA, T.wpB, p))); }
    if (p < T.t4b) { keyStock(kA, 1); keyQuad(kB, t); return kmix(kA, kB, eio(lin(T.t4a, T.t4b, p)), kOut); }
    return keyQuad(kOut, t);
  }

  /* =========================================================
     HUD
     ========================================================= */
  const hudEl = $('#hud');
  const H = { alt: $('#tAlt'), hdg: $('#tHdg'), gs: $('#tGs'), gmb: $('#tGmb'), pos: $('#tPos'), utc: $('#tUtc'), mode: $('#tMode'), as: $('#hAsset'), kind: $('#hKind'), stat: $('#hStat') };
  const scB = $('#scB'), scL = $('#scL'), cmp = $('#cmp');
  const xh = $('#xh'), xhH = $('#xhH'), xhV = $('#xhV'), xhC = $('#xhC'), xhT = $('#xhT');
  const ignN = $('#ignN'), ignS = $('#ignS');
  const vtA = $('#vtA'), vtB = $('#vtB'), vtF = $('#vtF'), vtC = $('#vtC'), vtN = $('#vtN'), vtE = $('#vtE'), chF = $('#chF'), chC = $('#chC'), chN = $('#chN');
  const NICE = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  const GL = '0123456789ABCDEF—·/';
  const scr = new Map();
  function scramble(el, text, ms = 420) {
    if (RM) { el.textContent = text; return; }
    const t0 = performance.now();
    scr.set(el, { text, t0, ms });
  }
  function runScramble(now) {
    scr.forEach((s, el) => {
      const k = (now - s.t0) / s.ms;
      if (k >= 1) { el.textContent = s.text; scr.delete(el); return; }
      const n = Math.floor(s.text.length * k);
      let o = s.text.slice(0, n);
      for (let i = n; i < s.text.length; i++) o += s.text[i] === ' ' ? ' ' : GL[(Math.random() * GL.length) | 0];
      el.textContent = o;
    });
  }
  let curAsset = -1, glitchT = 0;
  function setAsset(ai) {
    if (ai === curAsset) return;
    curAsset = ai;
    stage.dataset.as = String(ai);
    const n = NAMES[ai];
    if (n) {
      scramble(H.as, LABEL[n].toUpperCase());
      scramble(H.kind, ASSETS[n].kind.toUpperCase());
      scramble(H.stat, ASSETS[n].stat.toUpperCase());
    } else {
      scramble(H.as, 'ONE VIEW · 4 DATASETS');
      scramble(H.kind, 'FUSED SCENE · ONE TIMELINE');
      scramble(H.stat, '6 FINDINGS · 78 PATCHES · 2 SURVEYS');
    }
    Object.values(dlk).forEach((r, k) => r.classList.toggle('cur', k === ai));
    if (!RM) {
      hudEl.classList.remove('glitch'); void hudEl.offsetWidth; hudEl.classList.add('glitch');
      glitchT = performance.now() + 460;
    }
  }
  let lastMode = '';
  function writeMode(p) {
    let m = MODES[MODES.length - 1][1];
    for (const [lim, name] of MODES) { if (p < lim) { m = name; break; } }
    if (p < 0.05 && intro.k < 1) m = 'ACQUIRE';
    if (curAsset >= 0 && curAsset < 4 && !A[NAMES[curAsset]]) m = 'STREAMING ' + SHORT[NAMES[curAsset]];
    if (m !== lastMode) { lastMode = m; scramble(H.mode, m, 300); }
  }

  /* =========================================================
     Sizing
     ========================================================= */
  let W = 1, Hh = 1;
  const vpRect = { x: 0, y: 0, w: 1, h: 1 };
  function measureVp() {
    const vr = view.getBoundingClientRect(), r = aVp.getBoundingClientRect();
    vpRect.x = r.left - vr.left; vpRect.y = r.top - vr.top; vpRect.w = Math.max(1, r.width); vpRect.h = Math.max(1, r.height);
  }
  const ZONES = [];
  function measureZones() {
    ZONES.length = 0;
    const vr = view.getBoundingClientRect();
    const flat = document.documentElement.classList.contains('flat');
    if (flat && W >= 900) ZONES.push([0, 0, Math.min(W * 0.42, 600), Hh]);
    ['.hud-tr', '.hud-br', '.hud-tl'].concat(flat ? [] : ['#chapters']).forEach((sel) => {
      const el = $(sel); if (!el || getComputedStyle(el).display === 'none') return;
      const r = el.getBoundingClientRect(); if (r.width < 2) return;
      ZONES.push([r.left - vr.left - 10, r.top - vr.top - 10, r.right - vr.left + 10, r.bottom - vr.top + 10]);
    });
  }
  function resize() {
    W = Math.max(1, view.clientWidth); Hh = Math.max(1, view.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(W, Hh, false);
    PU.uPR.value = pr;
    measureVp();
    measureZones();
    requestRender();
  }
  resize();

  /* =========================================================
     Frame
     ========================================================= */
  const camP = V(0, 0, 0), camT = V(0, 0, 0), desP = V(0, 0, 0), desT = V(0, 0, 0), prevCam = V(0, 0, 0);
  const ax = V(0, 0, 0), ay = V(0, 0, 0), az = V(0, 0, 0), tmp = V(0, 0, 0), dir = V(0, 0, 0), D = V(0, 0, 0), F = V(0, 0, 0);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = V(0, 0, 0);
  let camInit = false, frameN = 0, tSim = 0, last = performance.now(), ps = 0, gsS = 0, fovS = 38;
  let smx = 0, smy = 0, spx = 0, spy = 0, xhInit = false;
  const rect = { x: 0, y: 0, w: 1, h: 1 };

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!RM) tSim += dt;
    const t = tSim;
    frameN++;
    runScramble(now);

    // progress
    const target = RM ? STILLS[S.still] || 0 : S.p;
    ps += (target - ps) * (RM ? 1 : 1 - Math.exp(-dt * 6));
    if (Math.abs(target - ps) < 1e-4) ps = target;
    const p = ps;
    // preload: the next asset one chapter early
    const chNow = p < 0.22 ? 0 : p < 0.475 ? 1 : p < 0.715 ? 2 : p < 0.89 ? 3 : 4;
    for (let k = 0; k <= Math.min(3, chNow + 1); k++) if (k === 0 || A[NAMES[k - 1]] || chNow >= k) ensure(NAMES[k]);
    setAsset(chNow);

    // intro
    if (intro.on) {
      intro.k = sat((now - intro.t0) / 2600);
      if (intro.k >= 1 || p > 0.1) { intro.on = false; intro.k = 1; needsPair = true; }
    }

    // particle pair
    const [pa, pb, mode] = pairFor(p);
    const ka = A[pa] ? pa : 'ph', kb = A[pb] ? pb : 'ph';
    const pk = ka + '>' + kb;
    if (pk !== curPair || needsPair) { curPair = pk; needsPair = false; writePair(ka, kb); }
    PU.uMode.value = mode;
    PU.uMix.value = intro.on ? intro.k : lin(MIXR[mode][0], MIXR[mode][1], p);
    PU.uTime.value = t;
    const flying = intro.on ? Math.sin(Math.PI * intro.k) : [[T.t1a, T.t1b], [T.t2a, T.t2b], [T.t3a, T.t3b + 0.02], [T.t4a, T.t4b]].reduce((m, r) => Math.max(m, sstep(r[0], r[0] + 0.015, p) * (1 - sstep(r[1] - 0.015, r[1], p))), 0);
    PU.uOpq.value = 0.88 - 0.28 * flying;
    PU.uMaxPx.value = lerp(5, 2.4, flying);
    PU.uLeft.value = (camera.aspect > 1.3 ? 1 : 0) * sstep(0.03, 0.09, p) * (1 - sstep(T.apA, T.apA + 0.02, p));
    PU.uAlpha.value = 1;

    /* ---- schedule ---- */
    const introDone = sstep(0.55, 1, intro.k);
    const wPlant = 1 - sstep(T.t1a - 0.004, T.t1a + 0.018, p);
    let aPart = 1;
    if (p < T.t1a + 0.03) aPart = lerp(plantPts ? 0.42 : 1, 1, sstep(T.t1a - 0.01, T.t1a + 0.02, p));
    if (intro.on) aPart = 1;
    if (p > 0.3 && p < 0.47) aPart = Math.max(1 - sstep(0.31, 0.345, p), sstep(0.435, 0.465, p));
    const wipeOn = p > T.wpA - 0.004 && p < T.wpB + 0.004;
    if (mode === 3) aPart = Math.max(sstep(0.864, 0.884, p), wipeOn ? 1 : 0);
    PU.uAlpha.value = aPart;

    if (plantPts) { plantPts.visible = wPlant > 0.002 && introDone > 0.002; plantPts.material.uniforms.uOpacity.value = wPlant * introDone; }
    if (orthoMesh) { const o = (0.38 + 0.37 * sstep(0.03, 0.12, p)) * introDone * wPlant; orthoMesh.visible = o > 0.002; orthoMesh.material.opacity = o; }
    let D_ok = false;
    if (droneGroup) {
      const v = wPlant * introDone;
      pathLine.visible = droneGroup.visible = dropLine.visible = v > 0.002;
      pathLine.material.opacity = 0.75 * v; dropLine.material.opacity = 0.35 * v;
      droneGroup.children.forEach((c) => { c.material.opacity = v; });
      if (v > 0.002) {
        const u = ((t * 0.0055) + 0.15) % 1;
        flightCurve.getPointAt(u, D); flightCurve.getTangentAt(u, F);
        D.y += Math.sin(t * 1.3) * 0.006;
        droneGroup.position.copy(D);
        droneGroup.rotation.y = Math.atan2(F.x, F.z);
        const da = dropLine.geometry.attributes.position.array;
        da[0] = D.x; da[1] = D.y - 0.05; da[2] = D.z; da[3] = D.x; da[4] = plantC.y - 0.2; da[5] = D.z;
        dropLine.geometry.attributes.position.needsUpdate = true;
        D_ok = true;
      }
    }
    // tank: slice + dive + interior
    let sliceY = 99;
    if (p >= T.slA && p < 0.345) sliceY = lerp(12.8, 7.0, eio(lin(T.slA, T.slB, p)));
    else if (p >= 0.345 && p < 0.38) sliceY = lerp(7.0, 13.2, eio(lin(0.345, 0.38, p)));
    PU.uSliceY.value = sliceY;
    if (tankPts) {
      const o = sstep(0.305, 0.345, p) * (1 - sstep(0.44, 0.47, p));
      tankPts.visible = o > 0.002; tankPts.material.uniforms.uOpacity.value = o;
      tankPts.material.uniforms.uSliceY.value = sliceY;
    }
    setRing(sliceRing, sliceY < 50 ? 0.85 * (1 - sstep(12.6, 13.2, sliceY)) : 0, 0.07);
    sliceRing.position.set(tankAxis.x, sliceY, tankAxis.z);

    // flare: scan resolve, ignition, dissolve
    let scanY = -99;
    if (p >= T.scA - 0.005 && mode === 1) scanY = lerp(-0.4, flareH + 0.4, eio(lin(T.scA, T.scB, p)));
    PU.uScanY.value = mode === 1 && p >= T.scA - 0.005 ? scanY : -99;
    let clipY = mode === 1 ? (p < T.scA - 0.005 ? -1 : scanY) : 99;
    if (mode === 2) clipY = (1 - PU.uMix.value / 0.55) * flareH + 0.05;
    flarePlane.constant = clipY;
    const ign = lin(T.igA, T.igB, p);
    if (flareGroup) {
      flareGroup.visible = p > T.scA - 0.01 && p < T.t3b + 0.01;
      patchList.forEach(({ p: pt, ord }) => { pt.mesh.material.opacity = sat((ign - ord) / 0.03); });
      const mo = sstep(T.igA, T.igA + 0.01, p) * (1 - sstep(T.t3a, T.t3a + 0.03, p));
      flareMarks.visible = mo > 0.002; flareMarks.material.uniforms.uOp.value = mo; flareMarks.material.uniforms.uIgn.value = ign;
    }
    setRing(scanRing, mode === 1 && p > T.scA - 0.005 && p < T.scB + 0.005 ? 0.9 : 0, 0.1);
    scanRing.position.set(flareAxis.x, scanY, flareAxis.z);

    // stockpile: resolve, epoch wipe, cut/fill
    const rsE = eio(lin(T.rsA, T.rsB, p));
    const wipeE = eio(lin(T.wpA, T.wpB, p));
    const wipeX = lerp(-10.6, 10.6, wipeE);
    PU.uResolveR.value = mode === 2 && p > T.rsA && !wipeOn ? rsE * 17 : -1;
    PU.uWipeX.value = wipeOn ? wipeX : 99;
    if (stockGroup) {
      stockGroup.visible = p > T.rsA - 0.005 && p < T.t4a + 0.03;
      const op = 1 - sstep(T.t4a + 0.006, T.t4a + 0.026, p);
      terrMats.forEach((m) => {
        m.uniforms.uResolveR.value = p < T.rsB ? rsE * 17 : 99;
        m.uniforms.uWipe.value = p > T.wpA - 0.005 ? wipeX : -99;
        m.uniforms.uDiff.value = sstep(T.wpA, T.wpA + 0.02, p);
        m.uniforms.uOpacity.value = op;
      });
      wipePlaneA.constant = -(p > T.wpA - 0.005 ? wipeX : -99);
      wipePlaneB.constant = p > T.wpA - 0.005 ? wipeX : -99;
      lineMats.forEach((m) => { m.opacity = 0.55 * sstep(T.rsB - 0.01, T.rsB + 0.01, p) * op; });
      curtain.visible = p > T.wpA - 0.003 && p < T.wpB + 0.004;
      curtain.position.set(wipeX, 1.1, 0.4);
      curtain.material.uniforms.uOp.value = 1 - sstep(T.wpB - 0.01, T.wpB, p);
      writeVolumes(rsE, wipeX, wipeE);
    }

    // quad + app chrome
    const appE = eio(lin(T.apA, T.apB, p));
    focusAmt += ((focusQ >= 0 ? 1 : 0) - focusAmt) * (1 - Math.exp(-dt * 8));
    PU.uFocus.value = focusQ >= 0 ? focusQ : PU.uFocus.value;
    PU.uFocusAmt.value = mode === 3 ? focusAmt * appE : 0;
    app.style.setProperty('--a', appE.toFixed(3));
    const appOn = appE > 0.01;
    if (appOn !== app.classList.contains('on')) { app.classList.toggle('on', appOn); stage.classList.toggle('app-on', appOn); if (appOn) { measureVp(); thumbsOn = true; loadThumbs(); } }
    rect.x = lerp(0, vpRect.x, appE); rect.y = lerp(0, vpRect.y, appE);
    rect.w = lerp(W, vpRect.w, appE); rect.h = lerp(Hh, vpRect.h, appE);

    /* ---- camera ---- */
    const key = camKey(p, t);
    desP.copy(key.p); desT.copy(key.t);
    const aspect = rect.w / rect.h;
    const base = aspect < 0.9 ? 50 : 38;
    const fov = lerp(base, aspect < 0.9 ? 80 : 72, key.fov);
    if (key.fov < 0.5) {
      const f = aspect < 0.9 ? 1.55 : aspect < 1.3 ? 1.22 : 1;
      if (f !== 1) desP.sub(desT).multiplyScalar(f).add(desT);
    }
    camera.matrixWorld.extractBasis(ax, ay, az);
    const par = key.inside ? 0.15 : 0.35;
    const dd = desP.distanceTo(desT);
    desP.addScaledVector(ax, smx * dd * 0.05 * par).addScaledVector(ay, -smy * dd * 0.03 * par);
    smx += (S.mx - smx) * (1 - Math.exp(-dt * 3)); smy += (S.my - smy) * (1 - Math.exp(-dt * 3));
    if (!camInit || RM) { camP.copy(desP); camT.copy(desT); fovS = fov; camInit = true; }
    const kk = 1 - Math.exp(-dt * 4.2);
    prevCam.copy(camP);
    camP.lerp(desP, kk); camT.lerp(desT, kk);
    fovS += (fov - fovS) * kk;
    camera.position.copy(camP); camera.lookAt(camT);
    camera.fov = fovS; camera.aspect = aspect;
    camera.near = key.inside ? 0.02 : 0.05;
    camera.updateProjectionMatrix();
    // shift the subject clear of the chapter panel / hero copy
    const wide = aspect > 1.3;
    const panelW = sstep(0.03, 0.09, p) * (1 - appE);
    const heroW = (1 - sstep(0.0, 0.05, p));
    const offX = wide ? -rect.w * (0.14 * heroW + 0.15 * panelW) : 0;
    const offY = wide ? -rect.h * 0.05 * heroW : rect.h * (0.17 * panelW + 0.06 * heroW);
    if (Math.abs(offX) > 0.5 || Math.abs(offY) > 0.5) camera.setViewOffset(rect.w, rect.h, offX, offY, rect.w, rect.h); else camera.clearViewOffset();
    camera.updateMatrixWorld();
    PU.uPx.value = rect.h * 0.5 * camera.projectionMatrix.elements[5] * PR();
    if (tankPts) tankPts.material.uniforms.uNear.value.set(key.fov > 0.5 ? 1.2 : 0, key.fov > 0.5 ? 3.6 : 0.001);
    const cd = camP.distanceTo(camT);
    PU.uFogN.value = key.fov > 0.5 ? 3.0 : cd * 0.95; PU.uFogF.value = key.fov > 0.5 ? 13 : cd * 2.6;
    sun.position.copy(camP).add(V(4, 9, 2));

    /* ---- render ---- */
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, Hh);
    renderer.clear();
    if (appE > 0.001) {
      const ry = Hh - rect.y - rect.h;
      renderer.setViewport(rect.x, ry, rect.w, rect.h);
      renderer.setScissor(rect.x, ry, rect.w, rect.h);
      renderer.setScissorTest(true);
    }
    renderer.render(scene, camera);
    renderer.setScissorTest(false);

    /* ---- labels ---- */
    GOP.plant = introDone * (sstep(0.06, 0.1, p) * (1 - sstep(T.t1a - 0.02, T.t1a, p)));
    GOP.tank = sstep(0.35, 0.37, p) * (1 - sstep(0.432, 0.444, p));
    GOP.flare = sstep(0.625, 0.64, p) * (1 - sstep(0.672, 0.684, p));
    GOP.pile = sstep(T.rsB - 0.015, T.rsB, p) * (1 - sstep(T.wpB, T.wpB + 0.012, p));
    GOP.quad = sstep(T.t4b - 0.01, T.t4b + 0.01, p);
    GOP.wipe = sstep(T.wpA, T.wpA + 0.008, p) * (1 - sstep(T.wpB - 0.01, T.wpB, p));
    wipeTag.v.set(wipeX, 2.4, 0.4);
    projectLabels();

    /* ---- telemetry ---- */
    if (frameN % 3 === 0 || RM) writeTelemetry(p, t, dt * 3, D_ok);

    /* ---- crosshair ---- */
    if (!RM) crosshair(dt, p);

    /* ---- app timeline playhead ---- */
    if (appOn && !RM) {
      const k = (t * 0.04) % 1;
      tlPh.style.transform = `translate3d(${(98 + k * (vpRect.w - 110)).toFixed(1)}px,0,0)`;
      const sec = Math.floor(k * 864000 / 10);
      if (frameN % 6 === 0) tlT.textContent = 'T+' + [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((v) => String(v).padStart(2, '0')).join(':');
    }

    // chapter 03 counter
    if (A.flare && p > T.igA - 0.02 && p < T.t3b) {
      let n = 0, mod = 0, light = 0;
      patchList.forEach(({ p: pt, ord }) => { if (ign >= ord + 0.004) { n++; if (pt.record.classId === 'light') light++; else mod++; } });
      if (n !== lastIgn) { lastIgn = n; ignN.textContent = String(n).padStart(2, '0'); ignS.textContent = `${mod} moderate · ${light} light`; }
    }
  }
  let lastIgn = -1;

  function projectLabels() {
    for (const L of LBL) {
      const o = GOP[L.g] > 0.5;
      if (o !== L.on) { L.on = o; L.el.classList.toggle('hide', !o); }
      if (!o) continue;
      tmp.copy(L.v).project(camera);
      let off = tmp.z > 1 || tmp.z < -1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05;
      if (!off && W < 900 && L.g !== 'quad' && (-tmp.y * 0.5 + 0.5) * rect.h > Hh * 0.54) off = true;
      if (!off && (L.g === 'pile' || L.g === 'wipe')) {
        const sx = rect.x + (tmp.x * 0.5 + 0.5) * rect.w, sy = rect.y + (-tmp.y * 0.5 + 0.5) * rect.h;
        const bx = L.g === 'pile' ? [sx - 8, sy - 60, sx + 236, sy + 6] : [sx - 150, sy - 24, sx + 150, sy + 14];
        for (const z of ZONES) if (bx[0] < z[2] && bx[2] > z[0] && bx[1] < z[3] && bx[3] > z[1]) { off = true; break; }
      }
      if (off !== L.off) { L.off = off; L.el.classList.toggle('off', off); }
      if (off) continue;
      let x = rect.x + (tmp.x * 0.5 + 0.5) * rect.w; const y = rect.y + (-tmp.y * 0.5 + 0.5) * rect.h;
      if (L.g === 'wipe') x = clamp(x, 120, W - 120);
      if (L.auto) {
        const d = x > W * 0.64 ? 'l' : 'r', vd = y < H_TOP() ? 'd' : 'u';
        if (d !== L.dir) { L.dir = d; L.el.dataset.dir = d; }
        if (vd !== L.vd) { L.vd = vd; L.el.dataset.v = vd; }
      }
      L.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    }
  }
  const H_TOP = () => Math.min(Hh * 0.36, 300);

  let lastVol = '';
  function writeVolumes(rsE, wipeX, wipeE) {
    const k = sstep(T.rsA, T.rsB + 0.005, ps);
    let F = 0, C = 0, Nn = 0;
    pileInfo.forEach((pi) => {
      pi.w = sstep(pi.c.x - 0.5, pi.c.x + 0.5, wipeX);
      const f = lerp(pi.v1.fill, pi.v2.fill, pi.w) * k, c = lerp(pi.v1.cut, pi.v2.cut, pi.w) * k, n = lerp(pi.v1.net, pi.v2.net, pi.w) * k;
      F += f; C += c; Nn += n;
      pi.cur = { f, c, n };
    });
    const key = Math.round(F) + '|' + Math.round(Nn) + '|' + wipeE.toFixed(3);
    if (key === lastVol) return;
    lastVol = key;
    pileInfo.forEach((pi) => {
      if (!pi.row) return;
      const b = pi.w > 0.5;
      pi.cells[1].textContent = fmt(pi.cur.f); pi.cells[2].textContent = fmt(pi.cur.c); pi.cells[3].textContent = fmt(pi.cur.n);
      pi.cells[4].textContent = b ? 'S2' : 'S1'; pi.cells[4].classList.toggle('b', b);
      pi.tagB.textContent = fmt(pi.cur.n); pi.tagS.textContent = b ? 'S2 ' + sgn(pi.v2.net - pi.v1.net) : 'S1';
      pi.tag.el.style.setProperty('--c', b ? (pi.v2.net < pi.v1.net ? 'var(--orange)' : 'var(--blue)') : 'var(--t2)');
    });
    vtF.textContent = fmt(F); vtC.textContent = fmt(C); vtN.textContent = fmt(Nn);
    vtE.textContent = wipeE > 0.5 ? 'S2' : 'S1'; vtE.classList.toggle('b', wipeE > 0.5);
    vtA.classList.toggle('on', wipeE <= 0.5); vtB.classList.toggle('on', wipeE > 0.5);
    chF.textContent = fmt(volTot.e1 * k); chC.textContent = fmt(volTot.e2 * k); chN.textContent = sgn((volTot.e2 - volTot.e1) * k);
  }

  const UTC0 = 9 * 3600 + 20 * 60;
  function writeTelemetry(p, t, dt3, droneOk) {
    let alt, hdg, gs, gmb, e, n;
    const glitching = performance.now() < glitchT;
    if (curAsset === 0 && droneOk && A.plant) {
      const s = A.plant.s, sc = s.scale, minY = s.center.y - s.size.y / 2;
      alt = D.y / sc + minY;
      hdg = (Math.atan2(F.x, -F.z) * 180 / Math.PI + 360) % 360;
      gs = 0.0055 * flightCurve.getLength() / sc + Math.sin(t * 1.7) * 0.15;
      gmb = -52 + Math.sin(t * 0.3) * 2;
      e = D.x / sc + s.center.x; n = -(D.z / sc + s.center.z);
    } else {
      const nm = NAMES[Math.min(3, curAsset)] || 'plant';
      const s = A[nm] ? A[nm].s : null;
      const sc = s ? s.scale : 1, scY = nm === 'stockpile' ? sc * VEX : sc;
      camera.getWorldDirection(dir);
      alt = camP.y / scY;
      hdg = (Math.atan2(dir.x, -dir.z) * 180 / Math.PI + 360) % 360;
      const v = prevCam.distanceTo(camP) / Math.max(1e-3, dt3 / 3) / sc;
      gsS += (Math.min(v, 99) - gsS) * 0.2; gs = gsS;
      gmb = Math.asin(clamp(dir.y, -1, 1)) * 180 / Math.PI;
      e = camP.x / sc; n = -camP.z / sc;
    }
    const J = (s) => (glitching ? s.replace(/\d/g, () => String((Math.random() * 10) | 0)) : s);
    H.alt.textContent = J(pad(alt, 5) + ' m');
    H.hdg.textContent = J(String(Math.round(hdg) % 360).padStart(3, '0') + '°');
    H.gs.textContent = J(pad(gs, 4) + ' m/s');
    H.gmb.textContent = J(pad(gmb, 4) + '°');
    H.pos.textContent = J(`LOCAL E ${grp(e)} N ${grp(n)}`);
    const sx = UTC0 + (RM ? 0 : (performance.now() - S.t0) / 1000);
    H.utc.textContent = `${String(Math.floor(sx / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sx / 60) % 60).padStart(2, '0')}:${(sx % 60).toFixed(1).padStart(4, '0')}`;
    writeMode(p);
    // scale bar + compass in metres of the current asset
    const nm = NAMES[Math.min(3, curAsset)] || 'plant';
    const sc = A[nm] ? A[nm].s.scale : 1;
    const dist = camP.distanceTo(camT);
    const mpp = (2 * dist * Math.tan((camera.fov / 2) * Math.PI / 180)) / rect.h / sc;
    let nice = NICE[0];
    for (const v of NICE) if (v / mpp <= 130) nice = v;
    scB.style.transform = `scaleX(${clamp(nice / mpp / 120, 0.08, 1.2).toFixed(3)})`;
    scL.textContent = nice + ' m';
    const azm = Math.atan2(camT.x - camP.x, -(camT.z - camP.z)) * 180 / Math.PI;
    cmp.style.transform = `rotate(${(-azm).toFixed(1)}deg)`;
  }

  function crosshair(dt, p) {
    const on = S.over && !overBox && !app.classList.contains('on');
    xh.classList.toggle('on', on);
    if (!on) return;
    if (!xhInit) { spx = S.px; spy = S.py; xhInit = true; }
    const kx = 1 - Math.exp(-dt * 16);
    spx += (S.px - spx) * kx; spy += (S.py - spy) * kx;
    xhH.style.transform = `translate3d(0,${spy.toFixed(1)}px,0)`;
    xhV.style.transform = `translate3d(${spx.toFixed(1)}px,0,0)`;
    xhC.style.transform = `translate3d(${spx.toFixed(1)}px,${spy.toFixed(1)}px,0)`;
    const tx = spx + 16 + 250 > W ? spx - 266 : spx + 16;
    xhT.style.transform = `translate3d(${tx.toFixed(1)}px,${(spy + 14).toFixed(1)}px,0)`;
    if (frameN % 3) return;
    ndc.set((spx / W) * 2 - 1, -(spy / Hh) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const nm = NAMES[Math.min(3, curAsset)] || 'plant';
    const s = A[nm] ? A[nm].s : null;
    if (!s) { xhT.textContent = 'E —  N —  STREAMING'; return; }
    const sc = s.scale;
    if (nm === 'plant' || nm === 'stockpile') {
      plane.set(V(0, 1, 0), nm === 'plant' ? -plantC.y + 0.2 : -0.3);
      if (ray.ray.intersectPlane(plane, hit) && Math.hypot(hit.x, hit.z) < 16) {
        const rng = camP.distanceTo(hit) / sc;
        xhT.textContent = `E ${grp(hit.x / sc + (nm === 'plant' ? s.center.x : 0))}  N ${grp(-(hit.z / sc + (nm === 'plant' ? s.center.z : 0)))}  RNG ${grp(rng, 0)} m`;
      } else xhT.textContent = 'E —  N —  NO GROUND';
    } else {
      const axp = nm === 'tank' ? tankAxis : flareAxis;
      camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
      plane.setFromNormalAndCoplanarPoint(dir, tmp.set(axp.x, 0, axp.z));
      if (ray.ray.intersectPlane(plane, hit)) {
        const y = hit.y / sc;
        xhT.textContent = `X ${pad((hit.x - axp.x) / sc, 4, 2)}  Z ${pad((hit.z - axp.z) / sc, 4, 2)}  H ${pad(y, 4, 2)} m`;
      }
    }
  }

  /* =========================================================
     Loop control
     ========================================================= */
  function requestRender() {
    dirty = true;
    if (RM && !rmQueued) { rmQueued = true; requestAnimationFrame(() => { rmQueued = false; safeFrame(); }); }
  }
  function safeFrame() {
    try { frame(performance.now()); }
    catch (e) { console.error(e); stop(); onFail(); }
  }
  function loop() {
    if (!running) return;
    safeFrame();
    requestAnimationFrame(loop);
  }
  function start() { if (running || RM) return; running = true; last = performance.now(); requestAnimationFrame(loop); }
  function stop() { running = false; }

  ensure('plant');
  safeFrame();
  document.documentElement.classList.add('gl-ok');

  new ResizeObserver(() => { resize(); if (RM) requestRender(); }).observe(view);
  if (!RM) {
    new IntersectionObserver((ents) => {
      visible = ents[0].isIntersecting;
      if (visible && !document.hidden) start(); else stop();
    }, { threshold: 0 }).observe(view);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (visible) start(); });
    start();
  }

  return {
    onChapter(i) { measureZones(); for (let k = 1; k <= Math.min(3, i); k++) ensure(NAMES[k]); },
    setStill(k) { S.still = k; for (let j = 0; j <= Math.min(3, k); j++) ensure(NAMES[j]); requestRender(); },
  };
}
