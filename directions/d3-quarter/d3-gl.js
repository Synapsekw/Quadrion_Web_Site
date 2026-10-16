// Direction D3 · The Quarter: WebGL director.
// One renderer, moved between three hosts (cinema stage, app window, CTA).
// Reads scroll state from window.QS (written by the GSAP timeline in d3-story.js) every frame.
// Six real assets, each in its own scene; only the scene(s) on screen are rendered.
import * as THREE from 'three';
import { sceneTravel, aimCamera, moveTravelCamera } from './scene-travel.mjs';
import { createSceneLoader, sceneDemand, datasetName, canCaptureStill } from './scene-loading.mjs';
import { WORKFLOWS, workflowState, flightTime } from './tour-workflows.mjs';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const html = document.documentElement;
const S = window.QS;
const layoutFn = window.QLayout;
const reduced = html.classList.contains('reduced') || !html.classList.contains('motion');
const MOBILE = innerWidth < 761 || matchMedia('(pointer: coarse)').matches;
const Q = MOBILE
  ? { dprMark: 1.5, dprHeavy: 1.25, plantStride: 5, tankStride: 3, flareN: 40000, bgN: 6000, win: 300, rt: 0.85, z4: false, sil: 700 }
  : { dprMark: 2, dprHeavy: 1.5, plantStride: 1, tankStride: 1, flareN: 90000, bgN: 18000, win: 480, rt: 1, z4: true, sil: 1500 };
const DATA = new URL('../data/', import.meta.url).href;

const PATHS = [
  'M4.06 25.28A23 23 0 0 1 25.28 4.06A1.6 1.6 0 0 1 27 5.66L27 15.01A1.6 1.6 0 0 1 25.61 16.59A10.5 10.5 0 0 0 16.59 25.61A1.6 1.6 0 0 1 15.01 27L5.66 27A1.6 1.6 0 0 1 4.06 25.28Z',
  'M32.72 4.06A23 23 0 0 1 53.94 25.28A1.6 1.6 0 0 1 52.34 27L42.99 27A1.6 1.6 0 0 1 41.41 25.61A10.5 10.5 0 0 0 32.39 16.59A1.6 1.6 0 0 1 31 15.01L31 5.66A1.6 1.6 0 0 1 32.72 4.06Z',
  'M25.28 53.94A23 23 0 0 1 4.06 32.72A1.6 1.6 0 0 1 5.66 31L15.01 31A1.6 1.6 0 0 1 16.59 32.39A10.5 10.5 0 0 0 25.61 41.41A1.6 1.6 0 0 1 27 42.99L27 52.34A1.6 1.6 0 0 1 25.28 53.94Z',
  'M36.6 35H54.4A1.6 1.6 0 0 1 56 36.6V54.4A1.6 1.6 0 0 1 54.4 56H36.6A1.6 1.6 0 0 1 35 54.4V36.6A1.6 1.6 0 0 1 36.6 35Z'
];
const UNIT = 1 / 26;
const MARK_W = 51.94 * UNIT;
const CAM_Z = 10, FOV = 30;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const DIRS = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
const SCATTER = [
  { p: [-2.7, 1.9, 3.0], r: [1.2, -2.3, 0.8] },
  { p: [3.0, 2.2, -2.6], r: [-0.9, 1.9, -1.2] },
  { p: [-2.3, -2.5, -3.2], r: [1.7, 1.1, 1.4] },
  { p: [2.5, -1.9, 4.2], r: [-1.4, -2.5, 0.9] }
];
const BG = 0x0B0F13;
const MINT = new THREE.Color(0x5ED1B3);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const cubicOut = (t) => 1 - Math.pow(1 - t, 3);
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
const V = () => new THREE.Vector3();
const elevationGLSL = /* glsl */`
  vec3 elevationColor(float h) {
    h = clamp(h, 0.0, 1.0);
    vec3 low = vec3(0.035, 0.17, 0.48), mid = vec3(0.08, 0.77, 0.62);
    vec3 high = vec3(0.98, 0.66, 0.08), peak = vec3(0.94, 0.16, 0.11);
    return h < 0.5 ? mix(low, mid, h * 2.0) : h < 0.8 ? mix(mid, high, (h - 0.5) / 0.3) : mix(high, peak, (h - 0.8) / 0.2);
  }
`;

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Point shader (shared) ----------
const POINT_MATS = [];
function pointsMat(o = {}) {
  const m = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: true, toneMapped: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uSize: { value: o.size || 1 }, uScale: { value: 500 }, uMin: { value: o.minPx ?? 1 }, uMax: { value: o.maxPx || 6 },
      uPx: { value: o.px || 0 }, uOpacity: { value: o.opacity ?? 1 }, uBright: { value: o.bright ?? 1 },
      uFog: { value: new THREE.Vector2(o.fogNear ?? 1e8, o.fogFar ?? 2e8) },
      uElevation: { value: new THREE.Vector2(0, 1) }, uElevOn: { value: 0 },
      uDim: { value: new THREE.Vector3(1e8, 2e8, 1) }, // near, far, min brightness (depth fade by darkening, not alpha)
      uScan: { value: -1e9 }, uScanOn: { value: o.scan ? 1 : 0 }, uClip: { value: o.clip || new THREE.Vector4(0, 0, 0, 1) }, uClipOn: { value: o.clip ? 1 : 0 }, uSec: { value: o.sec || 0 }, uMint: { value: MINT.clone() }, uSoft: { value: o.soft ? 1 : 0 }
    },
    vertexShader: /* glsl */`
      uniform float uSize, uScale, uMin, uMax, uPx, uScan, uScanOn, uBright;
      uniform vec2 uFog, uElevation; uniform float uElevOn; uniform vec3 uDim; uniform vec4 uClip;
      varying vec3 vC; varying float vA; varying float vEdge; varying float vClip;
      ${elevationGLSL}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float s = uPx > 0.0 ? uPx : uSize * uScale / max(d, 0.001);
        gl_PointSize = clamp(s, uMin, uMax);
        vec3 pointColor = mix(color, elevationColor((wp.y - uElevation.x) / max(0.001, uElevation.y - uElevation.x)), uElevOn);
        vC = pointColor * uBright * mix(1.0, uDim.z, smoothstep(uDim.x, uDim.y, d));
        vA = 1.0 - smoothstep(uFog.x, uFog.y, d);
        vEdge = 0.0;
        vClip = dot(uClip.xyz, wp.xyz) + uClip.w;
        if (uScanOn > 0.5) {
          float k = wp.y - uScan;
          vA *= step(0.0, k);
          vEdge = 1.0 - smoothstep(0.0, 0.45, k);
        }
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity, uSoft, uClipOn, uSec; uniform vec3 uMint;
      varying vec3 vC; varying float vA; varying float vEdge; varying float vClip;
      void main() {
        if (uClipOn > 0.5 && vClip < 0.0) discard;
        float sec = uSec > 0.0 ? (1.0 - smoothstep(0.0, uSec, vClip)) * 0.55 : 0.0;
        vec2 c = gl_PointCoord - 0.5;
        float r = dot(c, c);
        if (r > 0.25) discard;
        float a = uSoft > 0.5 ? pow(1.0 - sqrt(r) * 2.0, 1.6) : 1.0;
        vec3 col = mix(vC, uMint * 1.5, max(vEdge, sec));
        gl_FragColor = vec4(col, uOpacity * vA * a);
        #include <colorspace_fragment>
      }`
  });
  POINT_MATS.push(m);
  return m;
}
function setPointScale(hPx, fovDeg) {
  const k = hPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)));
  for (const m of POINT_MATS) m.uniforms.uScale.value = k;
}

const paneVS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const paneFS = /* glsl */`
  uniform sampler2D tMap, tScreen; uniform float uReveal, uScreen, uDiv, uDivOn, uHasMap; uniform vec2 uRes; uniform vec3 uMint;
  varying vec2 vUv;
  void main() {
    vec3 a = texture2D(tMap, vUv).rgb * uHasMap;
    vec3 b = texture2D(tScreen, gl_FragCoord.xy / uRes).rgb;
    vec3 col = mix(a, b, uScreen);
    float e = (1.0 - smoothstep(0.0, 0.006, abs(vUv.x - uDiv))) * uDivOn * (1.0 - uScreen);
    col = mix(col, uMint, e);
    vec2 q = abs(vUv - 0.5) * 2.0;
    col *= mix(1.0, 0.82, smoothstep(0.75, 1.0, max(q.x, q.y)) * (1.0 - uScreen));
    gl_FragColor = vec4(col, uReveal);
    #include <colorspace_fragment>
  }`;

// ---------- Camera handoff and survey comparison compositor ----------
const compFS = /* glsl */`
  uniform sampler2D tA, tB;
  uniform int uMode;
  uniform float uP;
  uniform vec2 uRes;
  uniform vec3 uMint;
  varying vec2 vUv;
  void main() {
    vec3 a = texture2D(tA, vUv).rgb;
    vec3 b = texture2D(tB, vUv).rgb;
    vec3 col;
    if (uMode == 3) {
      // Only the two dates of the same stockpile use a comparison divider.
      col = vUv.x < uP ? a : b;
      float edge = 1.0 - smoothstep(0.0, 1.2, abs(vUv.x - uP) * uRes.x);
      col = mix(col, uMint, edge * step(0.001, uP) * step(uP, 0.999));
    } else {
      // Camera motion does the transition; this short overlap joins worlds.
      col = mix(a, b, uP);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

function decimate(geo, stride) {
  if (stride <= 1) return geo;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name], n = Math.floor(a.count / stride), sz = a.itemSize;
    const arr = new a.array.constructor(n * sz);
    for (let i = 0; i < n; i++) for (let k = 0; k < sz; k++) arr[i * sz + k] = a.array[i * stride * sz + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, sz, a.normalized));
  }
  out.computeBoundingSphere();
  return out;
}

// ---------- Road: local helpers on top of the data layer ----------
const PCI_HEX = (pci) => (pci >= 86 ? 0x1f9d55 : pci >= 71 ? 0x8bc34a : pci >= 56 ? 0xf2c94c : pci >= 41 ? 0xf2994a : pci >= 26 ? 0xeb5757 : pci >= 11 ? 0xb0232a : 0x6d6d6d);
function pciMeshWithChainage(cells) {
  // Same triangulation as the data layer, plus a per-vertex chainage so the PCI colour can sweep with km.
  const pos = [], col = [], km = [], c = new THREE.Color();
  for (const cell of cells) {
    c.setHex(PCI_HEX(cell.pci[1]));
    for (const ring of cell.rings) {
      const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
      if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop();
      for (const tri of THREE.ShapeUtils.triangulateShape(pts, [])) for (const k of tri) { pos.push(pts[k].x, 0.2, pts[k].y); col.push(c.r, c.g, c.b); km.push(cell.km); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('pcol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('km', new THREE.Float32BufferAttribute(km, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uSweep: { value: 9 }, uOpacity: { value: 0.85 }, uLocal: { value: -9 }, uLocalW: { value: 0.012 }, uEdge: { value: 0.22 }, uMint: { value: MINT.clone() } },
    vertexShader: 'attribute vec3 pcol; attribute float km; varying vec3 vC; varying float vK; void main(){ vC = pcol; vK = km; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uSweep, uOpacity, uLocal, uLocalW, uEdge; uniform vec3 uMint; varying vec3 vC; varying float vK;
      void main() {
        float behind = uSweep - vK;
        if (behind < 0.0) discard;
        float edge = 1.0 - smoothstep(0.0, uEdge, behind);
        float loc = 1.0 - smoothstep(0.0, uLocalW, abs(vK - uLocal));
        vec3 col = mix(vC, uMint * 1.2, max(edge * 0.9, loc * 0.75));
        float a = uOpacity + (1.0 - uOpacity) * max(edge * 0.9, loc * 0.8);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 10; mesh.frustumCulled = false;
  return mesh;
}
function defectCloud(defects) {
  const n = defects.length, p = new Float32Array(n * 3), sev = new Float32Array(n), km = new Float32Array(n);
  defects.forEach((d, i) => { p[i * 3] = d.x; p[i * 3 + 1] = 0.5; p[i * 3 + 2] = d.z; sev[i] = d.sev; km[i] = d.km; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('sev', new THREE.BufferAttribute(sev, 1));
  g.setAttribute('km', new THREE.BufferAttribute(km, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { uPop: { value: 1 }, uK: { value: 1500 }, uPx: { value: 1 }, uMax: { value: 3.2 },
      uC1: { value: new THREE.Color(0x9AA6B2) }, uC2: { value: new THREE.Color(0xF2994A) }, uC3: { value: new THREE.Color(0xE5484D) } },
    vertexShader: /* glsl */`
      attribute float sev; attribute float km;
      uniform float uPop, uK, uPx, uMax; uniform vec3 uC1, uC2, uC3;
      varying vec3 vC; varying float vA; varying float vS;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float gs = sev < 1.5 ? 0.0 : sev < 2.5 ? 0.36 : 0.64;
        float st = gs + 0.2 * (km / 7.55);
        float k = clamp((uPop - st) / 0.14, 0.0, 1.0);
        float pop = k <= 0.0 ? 0.0 : (k < 1.0 ? sin(k * 1.5708) + 0.55 * sin(k * 3.14159) : 1.0);
        float base = sev < 1.5 ? 1.6 : sev < 2.5 ? 3.2 : 5.0;
        float zoom = clamp(uK / max(-mv.z, 1.0), 1.0, uMax);
        gl_PointSize = base * uPx * zoom * pop;
        vC = sev < 1.5 ? uC1 : sev < 2.5 ? uC2 : uC3;
        vA = step(0.001, k) * (sev < 1.5 ? 0.75 : 1.0);
        vS = sev;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA; varying float vS;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = length(c);
        if (r > 0.5) discard;
        float rim = smoothstep(0.32, 0.42, r);
        vec3 col = mix(vC, vC * 0.25, rim * step(1.5, vS));
        gl_FragColor = vec4(col, vA * (1.0 - smoothstep(0.44, 0.5, r)));
        #include <colorspace_fragment>
      }`
  });
  const pts = new THREE.Points(g, mat);
  pts.renderOrder = 20; pts.frustumCulled = false;
  return pts;
}
// Ortho tiles: decoded off the main thread (fetch + createImageBitmap), uploaded at most one per frame.
const tileGeo = new THREE.PlaneGeometry(1, 1);
const tileQueue = [], uploadQueue = [];
let tileActive = 0;
function tileSet(road, z, filter) {
  const lvl = road.ortho.levels.find((l) => l.z === z), size = road.ortho.square.size, [tlx, tlz] = road.ortho.square.tl;
  const t = size / lvl.cols, group = new THREE.Group(), tiles = [];
  for (const key of road.ortho.tiles[String(z)] || []) {
    const [x, y] = key.split('_').map(Number);
    const cx = tlx + (x + 0.5) * t, cz = tlz + (y + 0.5) * t;
    if (filter && !filter(cx, cz, t)) continue;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false, color: 0xcfd5d9 });
    const m = new THREE.Mesh(tileGeo, mat);
    m.scale.set(t, t, 1); m.rotation.x = -Math.PI / 2; m.position.set(cx, 0, cz); m.renderOrder = -20 + z; m.visible = false; m.frustumCulled = true;
    group.add(m); tiles.push({ m, url: DATA + 'road/ortho/' + z + '/' + key + '.webp', state: 0, t0: 0 });
  }
  group.userData = { tiles, z, loaded: 0, opacity: 1, requested: false };
  return group;
}
function requestTiles(set) {
  if (set.userData.requested) return; set.userData.requested = true;
  for (const tl of set.userData.tiles) tileQueue.push([set, tl]);
  pumpTiles();
}
function pumpTiles() {
  while (tileActive < 4 && tileQueue.length) {
    const [set, tl] = tileQueue.shift();
    tileActive++;
    fetch(tl.url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
      .then((b) => createImageBitmap(b, { imageOrientation: 'flipY' }))
      .then((bmp) => {
        const tex = new THREE.Texture(bmp);
        tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
        uploadQueue.push([set, tl, tex]);
      })
      .catch(() => { tl.state = -1; })
      .finally(() => { tileActive--; pumpTiles(); });
  }
}
function pumpUploads(renderer, max = 1) {
  for (let i = 0; i < max && uploadQueue.length; i++) {
    const [set, tl, tex] = uploadQueue.shift();
    renderer.initTexture(tex);
    tl.m.material.map = tex; tl.m.material.needsUpdate = true; tl.m.visible = true; tl.state = 1; tl.t0 = performance.now() / 1000;
    set.userData.loaded++;
  }
}
function tileOpacity(set, now, k) {
  set.visible = k > 0.002;
  if (!set.visible) return;
  for (const tl of set.userData.tiles) if (tl.state === 1) tl.m.material.opacity = k * (reduced ? 1 : smooth(0, 0.6, now - tl.t0));
}

// =====================================================================
function boot() {
  if (html.classList.contains('no-webgl')) return;
  const hostStage = document.getElementById('glStage');
  const hostApp = document.getElementById('glApp');
  const hostCta = document.getElementById('glCta');
  if (!hostStage || typeof layoutFn !== 'function') return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) { html.classList.add('no-webgl'); return; }
  const DEV_DPR = window.devicePixelRatio || 1;
  let DPR = Math.min(DEV_DPR, Q.dprMark), heavyCap = Q.dprHeavy;
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); html.classList.add('no-webgl'); stop(); });

  // ================= MARK SCENE =================
  const markScene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  markScene.environment = envTex;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 120);
  camera.position.set(0, 0, CAM_Z);
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-4, 5, 6);
  const rim = new THREE.DirectionalLight(0xdbe7f0, 2.6); rim.position.set(5, 3, -5);
  const rim2 = new THREE.DirectionalLight(0xffffff, 0.7); rim2.position.set(-5, -3, -4);
  markScene.add(key, rim, rim2);

  const satin = new THREE.MeshPhysicalMaterial({ color: 0xE9EDF0, roughness: 0.42, metalness: 0.04, clearcoat: 1, clearcoatRoughness: 0.2, envMapIntensity: 0.95 });
  const mint = new THREE.MeshPhysicalMaterial({ color: 0x5ED1B3, roughness: 0.38, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.16, envMapIntensity: 0.55, emissive: 0x5ED1B3, emissiveIntensity: 0.12 });
  mint.toneMapped = false;

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">' + PATHS.map((d) => '<path d="' + d + '"/>').join('') + '</svg>';
  const svgData = new SVGLoader().parse(svg);
  const extrude = { depth: 3.4, bevelEnabled: true, bevelThickness: 0.75, bevelSize: 0.55, bevelOffset: -0.55, bevelSegments: 6, curveSegments: 48 };
  const group = new THREE.Group();
  markScene.add(group);

  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTex.needsUpdate = true;
  const pieces = svgData.paths.slice(0, 4).map((path, i) => {
    const shapes = SVGLoader.createShapes(path).map((sh) => {
      const pts = [];
      sh.getPoints(32).forEach((v) => { if (!pts.length || pts[pts.length - 1].distanceTo(v) > 1e-3) pts.push(v); });
      while (pts.length > 3 && pts[pts.length - 1].distanceTo(pts[0]) < 1e-3) pts.pop();
      return new THREE.Shape(pts);
    });
    const g = new THREE.ExtrudeGeometry(shapes, extrude);
    g.rotateX(Math.PI); g.scale(UNIT, UNIT, UNIT);
    g.computeBoundingBox();
    const c = new THREE.Vector3(); g.boundingBox.getCenter(c);
    g.translate(-c.x, -c.y, -c.z); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, i === 3 ? mint : satin);
    const bb = g.boundingBox, zf = bb.max.z, p = g.attributes.position;
    const grp = g.groups[0], tri = [];
    for (let k = grp.start; k < grp.start + grp.count; k += 3) {
      if (p.getZ(k) > zf - 1e-4 && p.getZ(k + 1) > zf - 1e-4 && p.getZ(k + 2) > zf - 1e-4) {
        for (let j = 0; j < 3; j++) tri.push(p.getX(k + j), p.getY(k + j), zf + 0.004);
      }
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const side = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
    const uvs = [];
    for (let k = 0; k < tri.length; k += 3) uvs.push((tri[k] - bb.min.x) / side + (side - (bb.max.x - bb.min.x)) / side / 2, (tri[k + 1] - bb.min.y) / side + (side - (bb.max.y - bb.min.y)) / side / 2);
    pg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const paneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: {
        tMap: { value: null }, tScreen: { value: blackTex }, uReveal: { value: 0 }, uScreen: { value: 0 }, uDiv: { value: 0.5 }, uDivOn: { value: i === 3 ? 1 : 0 },
        uHasMap: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uMint: { value: MINT.clone() }
      },
      vertexShader: paneVS, fragmentShader: paneFS
    });
    const pane = new THREE.Mesh(pg, paneMat);
    pane.renderOrder = 2;
    mesh.add(pane);
    const rest = new THREE.Vector3(c.x - 30 * UNIT, c.y + 30 * UNIT, 0);
    mesh.position.copy(rest);
    group.add(mesh);
    return { mesh, pane, rest, dir: DIRS[i], sc: SCATTER[i] };
  });

  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(94,209,179,0.55)'], [0.35, 'rgba(94,209,179,0.16)'], [1, 'rgba(94,209,179,0)']]), transparent: true, depthWrite: false, toneMapped: false
  }));
  halo.position.z = -0.25; halo.renderOrder = -1;
  pieces[3].mesh.add(halo);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(160,182,198,0.20)'], [0.45, 'rgba(120,140,160,0.07)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false, toneMapped: false
  }));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false, toneMapped: false
  }));
  pool.renderOrder = shadow.renderOrder = -2;
  markScene.add(pool, shadow);

  const bgMat = pointsMat({ px: MOBILE ? 1.3 : 1.6, minPx: 1, maxPx: 3, opacity: 0, bright: 0.5, soft: false });
  bgMat.depthWrite = false;
  const bgPts = new THREE.Points(new THREE.BufferGeometry(), bgMat);
  bgPts.renderOrder = -5; bgPts.visible = false; bgPts.frustumCulled = false;
  const bgRig = new THREE.Group(); bgRig.add(bgPts); markScene.add(bgRig);

  // ================= DATA SCENES =================
  const mk = () => new THREE.Scene();
  const road = { scene: mk(), ready: false, c: V(), L: 3500, cl: null, km: null, sets: {} };
  const plant = { scene: mk(), ready: false, center: V(), size: V() };
  const tank = { scene: mk(), ready: false, findings: [] };
  const flare = { scene: mk(), ready: false, patches: [], order: [], axis: V(), M: new THREE.Matrix4() };
  const facade = { scene: mk(), ready: false, c: V(), size: V(), centers: [], meta: null };
  const stock = { scene: mk(), ready: false, e1: null, e2: null, piles: {}, selected: 'P02', surfaces: [], outlines: [] };
  const SCN = { road, plant, tank, flare, facade, stock };
  const scanPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

  const camA = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  const camB = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  const camApp = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  const winCams = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(36, 1, 0.1, 10000));
  const workflow = (name, p = S[name]) => workflowState(name, p, window.QWorkflowOverrides?.[name]);
  const manualCamera = new Map();
  function beginCameraMove(name) {
    if (reduced || mode !== 'stage') return;
    manualCamera.set(name, { pos: camA.position.clone(), q: camA.quaternion.clone(), fov: camA.fov, start: performance.now() });
  }
  function easeManualCamera(name, cam) {
    const move = manualCamera.get(name);
    if (!move || cam !== camA) return;
    const k = smooth(0, 1000, performance.now() - move.start);
    cam.position.lerpVectors(move.pos, cam.position, k);
    cam.quaternion.slerpQuaternions(move.q, cam.quaternion, k);
    cam.fov = lerp(move.fov, cam.fov, k);
    if (k >= 1) manualCamera.delete(name);
  }
  window.addEventListener('d3:workflow', event => {
    if (!WORKFLOWS[event.detail?.scene]) return;
    beginCameraMove(event.detail.scene);
    if (reduced && mode !== 'none') renderOnce();
  });
  window.addEventListener('d3:pile', event => {
    const id = event.detail?.id;
    if (!stock.piles[id]) return;
    beginCameraMove('stock'); stock.selected = id;
    if (reduced && mode !== 'none') renderOnce();
  });

  // ---------- road geometry helpers ----------
  function roadAt(kmv, out = { x: 0, z: 0, dx: 1, dz: 0 }) {
    const ch = road.km, cl = road.cl;
    let lo = 0, hi = ch.length - 1;
    kmv = Math.max(ch[0], Math.min(ch[hi], kmv));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ch[m] <= kmv) lo = m; else hi = m; }
    const t = (kmv - ch[lo]) / Math.max(1e-6, ch[hi] - ch[lo]);
    out.x = lerp(cl[lo][0], cl[hi][0], t); out.z = lerp(cl[lo][1], cl[hi][1], t);
    const a = Math.max(0, lo - 3), b = Math.min(ch.length - 1, hi + 3);
    const dx = cl[b][0] - cl[a][0], dz = cl[b][1] - cl[a][1], l = Math.hypot(dx, dz) || 1;
    out.dx = dx / l; out.dz = dz / l;
    return out;
  }
  const RA = { x: 0, z: 0, dx: 1, dz: 0 }, RB = { x: 0, z: 0, dx: 1, dz: 0 };
  const _p0 = V(), _p1 = V(), _t0 = V(), _t1 = V();
  const _f = V(), _r = V(), UPV = new THREE.Vector3(0, 1, 0);
  function roadOverview(q, t, aspect, outP, outT) {
    const c = road.c, L = road.L;
    const az = -2.15 + 0.32 * q + t;
    const el = lerp(1.14, 1.0, q);
    const dist = L * (aspect < 1 ? 3.0 : 1.62) * lerp(1, 0.86, q);
    outP.set(c.x + Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, c.z + Math.sin(az) * Math.cos(el) * dist);
    outT.set(c.x, 0, c.z);
    // desktop: pan so the ring sits right of the copy
    if (aspect >= 1) {
      _f.subVectors(outT, outP).normalize(); _r.crossVectors(_f, UPV).normalize().multiplyScalar(-L * 0.19);
      outP.add(_r); outT.add(_r);
    }
  }
  function setRoadAppCam(cam, t) { // the whole ring, top-down, slowly turning
    const c = road.c, L = road.L, a = t * 0.05;
    cam.fov = 34; cam.position.set(c.x + Math.sin(a) * L * 0.5, L * 1.45, c.z + Math.cos(a) * L * 0.5);
    cam.near = 10; cam.far = L * 6; cam.lookAt(c.x, 0, c.z);
    roadAlt = cam.position.y; roadKm = -1;
  }
  function setRoadWinCam(cam, t) { // the X window: an oblique drift over the hero stretch, so the quarter-ring is full of road
    roadAt(3.72 + 0.06 * Math.sin(t * 0.12), RA);
    const lx = RA.dz, lz = -RA.dx;
    cam.fov = 34; cam.position.set(RA.x - lx * 260 - RA.dx * 160, 420, RA.z - lz * 260 - RA.dz * 160);
    cam.near = 5; cam.far = 8000; cam.lookAt(RA.x + RA.dx * 60, 0, RA.z + RA.dz * 60);
    roadAlt = cam.position.y; roadKm = -1;
  }
  const FLY = { k0: 3.34, k1: 3.6 };
  function roadFlight(q, aspect, outP, outT) {
    const e = sine(q), kmv = lerp(FLY.k0, FLY.k1, e);
    roadAt(kmv, RA);
    const lx = RA.dz, lz = -RA.dx; // left of travel
    const side = lerp(-26, -95, e) * (aspect < 1 ? 1.25 : 1);
    const alt = lerp(58, 150, e) * (aspect < 1 ? 1.35 : 1);
    outP.set(RA.x + lx * side - RA.dx * lerp(30, 70, e), alt, RA.z + lz * side - RA.dz * lerp(30, 70, e));
    roadAt(kmv + lerp(0.12, 0.27, e), RB);
    outT.set(RB.x, 0, RB.z);
    return kmv;
  }
  let roadKm = 0, roadAlt = 9999;
  function setRoadCam(cam, p, t = 0, aspect = 1) {
    cam.fov = 40;
    if (p <= 0.4) {
      roadOverview(p / 0.4, t, aspect, cam.position, _t0);
      aimCamera(cam, _t0); roadKm = -1;
    } else if (p < 0.62) {
      // Dive: orbit about a target that slides onto the hero stretch first, then close the distance.
      const q = (p - 0.4) / 0.22, e = sine(q);
      roadOverview(1, t, aspect, _p0, _t0); roadFlight(0, aspect, _p1, _t1);
      _p0.sub(_t0); _p1.sub(_t1);
      const d0 = _p0.length(), d1 = _p1.length();
      _p0.normalize(); _p1.normalize();
      const d = Math.exp(lerp(Math.log(d0), Math.log(d1), smooth(0.1, 1, e)));
      _t0.lerp(_t1, smooth(0, 0.6, e));
      _p0.lerp(_p1, smooth(0.15, 1, e)).normalize();
      cam.position.copy(_t0).addScaledVector(_p0, d);
      aimCamera(cam, _t0); cam.fov = lerp(40, 46, e); roadKm = -1;
    } else {
      roadKm = roadFlight((p - 0.62) / 0.38, aspect, cam.position, _t0);
      aimCamera(cam, _t0); cam.fov = 46;
    }
    roadAlt = cam.position.y;
    cam.near = Math.max(1, roadAlt * 0.05); cam.far = roadAlt * 40 + 8000;
  }
  function roadState(sweep, pop, local, alt, pxScale) {
    if (!road.ready) return;
    const pm = road.pci.material.uniforms, dm = road.def.material.uniforms;
    pm.uSweep.value = sweep; pm.uLocal.value = local;
    const low = 1 - smooth(260, 900, alt);
    pm.uOpacity.value = lerp(0.82, 0.2, low); pm.uEdge.value = lerp(0.22, 0.03, low); pm.uLocalW.value = lerp(0.03, 0.006, low);
    dm.uPop.value = pop; dm.uPx.value = pxScale; dm.uK.value = 2600; dm.uMax.value = 3.4;
    const now = performance.now() / 1000;
    const s = road.sets;
    if (s.z2) tileOpacity(s.z2, now, 1);
    if (s.z4) tileOpacity(s.z4, now, 1 - smooth(1100, 2200, alt));
    if (s.z6) tileOpacity(s.z6, now, 1 - smooth(240, 480, alt));
  }

  // --- camera paths (p = 0..1 across each shot) ---
  function setPlantCam(cam, p, t = 0, aspect = 1, tour = true) {
    const active = tour && mode === 'stage';
    if (active) p = workflow('plant', p).progress;
    const c = plant.center, L = Math.max(plant.size.x, plant.size.z, 200);
    const e = sine(p);
    const az = lerp(-1.95, -1.3, e) + t;
    const el = lerp(1.18, 0.5, e);
    const dist = lerp(0.62, 0.36, e) * L * (aspect < 1 ? 1.5 : 1);
    cam.fov = 40;
    cam.position.set(c.x + Math.cos(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.sin(az) * Math.cos(el) * dist);
    cam.near = dist * 0.02; cam.far = dist * 8;
    aimCamera(cam, c.x + lerp(0, 0.06, e) * L, c.y, c.z);
    if (active) easeManualCamera('plant', cam);
  }
  const tankClip = new THREE.Vector4(1, 0, 0, 0.35);
  function setTankCam(cam, p, up = 0, aspect = 1, tour = true) {
    // Low and close, looking up into the far half of the shell, so the curvature and weld rings read.
    const state = tour && mode === 'stage' ? workflow('tank', p) : null;
    const e = sine(state ? Math.min(state.progress / 0.75, 1) : p);
    cam.fov = aspect < 1 ? 60 : 44;
    const az = Math.PI + lerp(-0.55, 0.3, e);
    const r = lerp(14.2, 12.6, e) * (aspect < 1 ? 1.5 : 1);
    cam.position.set(Math.cos(az) * r, lerp(7.4, 5.6, e) + up * 16, Math.sin(az) * r);
    cam.near = 0.1; cam.far = 120;
    aimCamera(cam, 0.4, lerp(4.5, 4.6, e) + up * 22, 0);
    if (state?.id === 'interior') {
      const enter = smooth(0, 0.48, state.local);
      const samples = tank.flight?.samples;
      if (samples?.length) {
        const video = document.getElementById('tank-flight-video');
        const time = flightTime(state.local, samples.at(-1).t, video?.currentTime);
        let i = Math.min(samples.length - 2, Math.max(0, Math.floor(time * (tank.flight.sampleRateHz || 10))));
        while (i < samples.length - 2 && samples[i + 1].t < time) i++;
        const a = samples[i], b = samples[i + 1], mix = clamp01((time - a.t) / (b.t - a.t));
        _p0.fromArray(a.pos).lerp(_p1.fromArray(b.pos), mix);
        const q = new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), mix);
        cam.position.lerp(_p0, enter); cam.quaternion.slerp(q, enter);
        // Store a real forward target for the subsequent cross-scene camera handoff.
        _t0.set(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(4).add(cam.position);
        const orientation = cam.quaternion.clone();
        aimCamera(cam, _t0);
        // lookAt records the travel target but replaces roll with camera.up.
        // Retain the calibrated camera quaternion, including its recorded roll.
        cam.quaternion.copy(orientation);
        cam.fov = lerp(cam.fov, 75, enter);
      } else {
        // Deterministic interior movement remains available if the optional track fails.
        const az = lerp(-2.7, -0.35, state.local);
        _p0.set(Math.cos(az) * 3.2, lerp(3.8, 6.5, state.local), Math.sin(az) * 3.2);
        cam.position.lerp(_p0, enter);
        aimCamera(cam, Math.cos(az + 0.7) * 6, 7, Math.sin(az + 0.7) * 6);
      }
    }
    if (state) easeManualCamera('tank', cam);
  }
  // Approach look: thin, see-through points while the camera approaches and settles, so the shell edge and the
  // interior structure read first; the cloud firms up to its settled look just before the findings appear.
  function tankLook(k) {
    if (!tank.mat) return;
    const u = tank.mat.uniforms, e = k * k * (3 - 2 * k);
    u.uSize.value = tank.size0 * lerp(0.55, 0.82, e);
    if (tank.max0 === undefined) tank.max0 = u.uMax.value;
    u.uMax.value = lerp(2.0, tank.max0 * 0.85, e);
    u.uOpacity.value = lerp(0.68, 0.9, e);
    u.uBright.value = lerp(1.9, 1.15, e);
    tank.mat.depthWrite = e > 0.98;
  }
  function sectionTank(cam) {
    const x = cam.position.x, z = cam.position.z, l = Math.hypot(x, z) || 1;
    tankClip.set(-x / l, 0, -z / l, 0.3);
    if (tank.mat) tank.mat.uniforms.uDim.value.set(l - 2.4, l + 2.6, 0.3);
    if (tank.modelClip) tank.modelClip.setComponents(tankClip.x, 0, tankClip.z, tankClip.w);
  }
  function setFlareCam(cam, p, t = 0, aspect = 1, tour = true) {
    if (tour && mode === 'stage' && flare.focus) {
      const state = workflow('flare', p), a = flare.axis, size = aspect < 1 ? 1.55 : 1;
      const overview = { pos: new THREE.Vector3(a.x + 12 * size, 11.5, a.z + 20 * size), target: new THREE.Vector3(a.x, 9.5, a.z) };
      const poses = [overview, overview, ...['F70', 'F44', 'F04'].map(id => flare.focus[id] || overview)];
      const to = poses[state.index], from = poses[Math.max(0, state.index - 1)];
      const k = smooth(0, 0.6, state.local);
      cam.position.lerpVectors(from.pos, to.pos, k);
      _t0.lerpVectors(from.target, to.target, k);
      if (aspect < 1 && state.index >= 2) cam.position.sub(_t0).multiplyScalar(1.35).add(_t0);
      cam.fov = 40; cam.near = 0.025; cam.far = 200;
      aimCamera(cam, _t0); easeManualCamera('flare', cam); return;
    }
    const e = sine(p);
    const a = flare.axis;
    const r = (aspect < 1 ? 19 : 10.5) - e * 1.2;
    const az = lerp(0.35, 1.25, e) + t;
    cam.fov = 44;
    cam.position.set(a.x + Math.cos(az) * r, lerp(1.2, 15.2, e), a.z + Math.sin(az) * r);
    cam.near = 0.1; cam.far = 200;
    aimCamera(cam, a.x, lerp(6.5, 17.2, e) + (aspect < 1 ? 1.4 : 0), a.z);
  }
  function setFacadeCam(cam, p, t = 0, aspect = 1, tour = true) {
    // Rise up the west elevation, ending on a three-quarter view of the full 74 m.
    const state = tour && mode === 'stage' ? workflow('facade', p) : null;
    const e = sine(state ? Math.min(0.85, state.progress) : p), c = facade.c, H = facade.size.y;
    const az = Math.PI + lerp(-0.7, 0.32, e) + t;
    const r = lerp(118, 150, e) * (aspect < 1 ? 1.8 : 1);
    cam.fov = 40;
    cam.position.set(c.x + Math.cos(az) * r, lerp(6, H * 0.6, e), c.z + Math.sin(az) * r);
    cam.near = 0.5; cam.far = 1500;
    _t0.set(c.x, lerp(H * 0.5, H * 0.46, e), c.z);
    if (aspect >= 1) { // pan so the tower stands right of the copy
      _f.subVectors(_t0, cam.position).normalize(); _r.crossVectors(_f, UPV).normalize().multiplyScalar(-r * 0.12);
      cam.position.add(_r); _t0.add(_r);
    }
    aimCamera(cam, _t0);
    if (state && state.index >= 2 && facade.evidenceTargets) {
      const target = facade.evidenceTargets[state.id];
      if (target) {
        const k = smooth(0, 0.65, state.local);
        const evidencePosition = point => {
          const direction = point.clone().sub(new THREE.Vector3(c.x, point.y, c.z)).normalize();
          if (direction.lengthSq() < 0.1) direction.set(-1, 0, 0);
          const at = point.clone().addScaledVector(direction, aspect < 1 ? 70 : 48); at.y += 7; return at;
        };
        if (state.index === 3 && facade.evidenceTargets.rgb) {
          cam.position.copy(evidencePosition(facade.evidenceTargets.rgb)); _t0.copy(facade.evidenceTargets.rgb);
        }
        const at = evidencePosition(target);
        cam.position.lerp(at, k); _t0.lerp(target, k); aimCamera(cam, _t0);
      }
    }
    if (state) easeManualCamera('facade', cam);
  }
  function setStockCam(cam, p, t = 0, aspect = 1, tour = true) {
    const state = tour && mode === 'stage' ? workflow('stock', p) : null;
    const e = sine(state?.progress ?? p);
    const c = stock.center || V();
    const az = lerp(0.95, 1.45, e) + t;
    const el = lerp(0.95, 0.72, e);
    const dist = lerp(345, 285, e) * (aspect < 1 ? 1.5 : 1);
    cam.fov = 38;
    cam.position.set(c.x + Math.cos(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.sin(az) * Math.cos(el) * dist);
    cam.near = 2; cam.far = 3000;
    aimCamera(cam, c.x, c.y, c.z);
    if (state && state.index >= 2 && stock.piles[stock.selected]) {
      const pile = stock.piles[stock.selected], k = state.index > 2 ? 1 : smooth(0, 0.65, state.local);
      const distance = Math.max(45, pile.radius * 3.2) * (aspect < 1 ? 1.55 : 1);
      _p0.set(pile.center.x + Math.cos(az) * distance * 0.65, pile.center.y + distance * 0.82, pile.center.z + Math.sin(az) * distance * 0.65);
      cam.position.lerp(_p0, k); _t0.copy(c).lerp(pile.center, k); aimCamera(cam, _t0);
      cam.near = 0.5;
    }
    if (state) easeManualCamera('stock', cam);
  }
  function flareState(scan, ignite, t) {
    scanPlane.constant = lerp(-0.6, 20.8, scan);
    if (flare.pts) flare.pts.material.uniforms.uScan.value = scanPlane.constant;
    if (flare.pts) flare.pts.visible = scan < 0.999;
    if (flare.scanRing) {
      flare.scanRing.visible = scan > 0.001 && scan < 0.999;
      flare.scanRing.position.y = scanPlane.constant;
    }
    const n = flare.order.length;
    const k = ignite * (n + 6);
    flare.order.forEach((pt, idx) => {
      const f = clamp01((k - idx) / 6);
      pt.mesh.visible = f > 0;
      const flash = f > 0 ? Math.max(0, 1 - f) : 0;
      pt.mesh.material.color.setScalar(1 + flash * 3 + (ignite >= 1 ? 0.25 + 0.25 * Math.sin(t * 2 + idx) : 0));
      if (flare.glowCol) {
        const g = (f > 0 ? 0.35 + 0.65 * flash : 0);
        flare.glowCol.setXYZ(idx, 1.0 * g, 0.48 * g, 0.18 * g);
      }
    });
    if (flare.glowCol) flare.glowCol.needsUpdate = true;
  }
  const fx = { reveal: 9, hi: -1, hiCls: -1 };
  function facadeState(reveal, base = 0.24) {
    if (!facade.mat) return;
    const u = facade.mat.uniforms;
    fx.reveal = reveal;
    u.uReveal.value = reveal; u.uHi.value = fx.hi; u.uHiCls.value = fx.hiCls; u.uBase.value = base;
  }
  function modelOpacity(model, amount) {
    if (!model) return;
    model.visible = amount > 0.001;
    for (const material of model.userData.workflowMaterials || []) {
      const transparent = amount < 0.999;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = amount; material.depthWrite = !transparent;
    }
  }
  function prepareModel(model, scene, extra = {}) {
    const materials = new Set();
    model.traverse(object => {
      if (!object.isMesh) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = source.map(material => {
        const copy = material.clone(); Object.assign(copy, extra);
        copy.side = THREE.DoubleSide; copy.envMapIntensity = 0.5; materials.add(copy); return copy;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
    });
    model.userData.workflowMaterials = [...materials];
    scene.environment = envTex;
    scene.add(model, new THREE.HemisphereLight(0xe6f1ff, 0x323b42, 2.1));
    const key = new THREE.DirectionalLight(0xfff6e8, 2.5); key.position.set(-30, 70, 45); scene.add(key);
  }
  function applyWorkflow(name, opts = {}) {
    const active = mode === 'stage' && !opts.still;
    if (name === 'plant' && plant.pts) {
      const state = active ? workflow('plant') : workflowState('plant', 0);
      const model = state.index === 2 ? smooth(0, 0.45, state.local) : 0;
      plant.pts.visible = model < 0.999; plant.pts.material.uniforms.uOpacity.value = 1 - model;
      plant.pts.material.uniforms.uElevOn.value = state.index === 0 ? 0 : state.index === 1 ? smooth(0, 0.45, state.local) : 1;
      plant.ortho.visible = state.index !== 1;
      modelOpacity(plant.model, model);
    } else if (name === 'tank' && tank.pts) {
      const state = active ? workflow('tank') : workflowState('tank', 0.68);
      const model = state.index === 0 ? 0 : state.index === 1 ? smooth(0, 0.45, state.local) : 1;
      tank.pts.visible = model < 0.999; tank.pts.material.uniforms.uOpacity.value *= 1 - model;
      modelOpacity(tank.model, model);
      tank.markers.visible = state.index >= 2 && state.id !== 'interior';
      tank.flightLine.visible = state.id === 'interior' && state.local < 0.25;
      // The cutaway reveals the interior in overview; once inside retain all real surfaces.
      tank.modelClip.constant = state.id === 'interior' && state.local > 0.2 ? 1e6 : tankClip.w;
    } else if (name === 'flare' && flare.model) {
      const state = active ? workflow('flare') : null;
      const model = !state || state.index >= 2 ? 1 : state.index === 0 ? 0 : smooth(0, 0.45, state.local);
      scanPlane.constant = 1e6;
      flare.pts.material.uniforms.uScanOn.value = 0;
      flare.pts.material.uniforms.uOpacity.value = 1 - model;
      flare.pts.visible = model < 0.999; flare.model.visible = model > 0.001;
      flare.scanRing.visible = false;
      const focused = state ? ['F70', 'F44', 'F04'][state.index - 2] : null;
      flare.order.forEach((patch, i) => {
        patch.mesh.visible = !state || state.index >= 2;
        const selected = !state || patch.record.id === focused;
        patch.mesh.material.opacity = selected ? 1 : 0.18;
        patch.mesh.material.color.setScalar(selected ? 1.25 : 0.75);
        if (flare.glowCol) flare.glowCol.setXYZ(i, selected && focused ? 0.9 : 0, selected && focused ? 0.28 : 0, 0);
      });
      if (flare.glowCol) flare.glowCol.needsUpdate = true;
    } else if (name === 'facade' && facade.mat) {
      const state = active ? workflow('facade') : null;
      facade.mat.uniforms.uEvidenceIssue.value = -1;
      if (!state) {
        facadeState(9, 0.3);
        facade.mat.uniforms.uHi.value = -1; facade.mat.uniforms.uHiCls.value = -1;
        return;
      }
      const reveal = state.index === 0 ? 0 : state.index === 1 ? smooth(0, 0.75, state.local) * 9 : 9;
      facadeState(reveal, state.index === 1 ? 0.68 : 0.18);
      if (state.index >= 2) {
        facade.mat.uniforms.uEvidenceIssue.value = state.id === 'rgb' ? 159 : 397;
        facade.mat.uniforms.uHiCls.value = state.id === 'thermal' ? 6 : -1;
      }
    } else if (name === 'stock' && stock.dsm) {
      const state = active ? workflow('stock') : null;
      const dsm = state?.id === 'dsm';
      for (const surface of stock.surfaces) surface.mesh.material = dsm ? stock.dsm : surface.material;
      for (const outline of stock.outlines) {
        const selected = outline.id === stock.selected;
        outline.line.visible = !state || state.index >= 2;
        outline.line.material.color.setHex(selected ? 0x5ed1b3 : 0xb9c7d1);
        outline.line.material.opacity = selected ? 1 : 0.22;
        outline.line.renderOrder = selected ? 8 : 3;
      }
    }
  }
  let pilesProjected = false;
  function clearPileProjection() {
    if (!pilesProjected) return;
    pilesProjected = false;
    window.dispatchEvent(new CustomEvent('d3:pile-screen', { detail: { points: [], width: W, height: H } }));
  }
  function projectPiles(cam) {
    if (mode !== 'stage') return;
    const points = Object.entries(stock.piles).flatMap(([id, pile]) => {
      pv.copy(pile.center); pv.y += 1.5; pv.project(cam);
      return pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 0.96 && Math.abs(pv.y) < 0.92
        ? [{ id, x: (pv.x + 1) * 0.5 * W, y: (1 - pv.y) * 0.5 * H }] : [];
    });
    pilesProjected = points.length > 0;
    window.dispatchEvent(new CustomEvent('d3:pile-screen', { detail: { points, width: W, height: H } }));
  }

  // ================= RENDER TARGETS & COMPOSITE =================
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true };
  const rtA = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const winRT = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(Q.win, Q.win, rtOpts));
  pieces.forEach((pc, i) => { pc.pane.material.uniforms.tMap.value = winRT[i].texture; });
  // Baked from these same camera views. Tiny previews keep all four quarters
  // alive without downloading four complete inspection projects for thumbnails.
  const winPosters = [], posterNames = ['road', 'plant', 'flare', 'stockpile'];
  let postersRequested = false;
  function requestPosters() {
    if (postersRequested) return;
    postersRequested = true;
    const textures = new THREE.TextureLoader();
    posterNames.forEach((name, i) => textures.load(new URL('./previews/' + name + '.webp', import.meta.url).href,
      texture => { texture.colorSpace = THREE.SRGBColorSpace; winPosters[i] = texture; }, undefined, () => {}));
  }
  const compMat = new THREE.ShaderMaterial({
    toneMapped: false, depthTest: false, depthWrite: false,
    uniforms: { tA: { value: null }, tB: { value: null }, uMode: { value: 1 }, uP: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uMint: { value: MINT.clone() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: compFS
  });
  const compScene = new THREE.Scene();
  const compQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat);
  compQuad.frustumCulled = false; compScene.add(compQuad);
  const compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ================= HOSTING =================
  let host = null, W = 1, H = 1;
  const loadingNote = document.createElement('div');
  loadingNote.className = 'scene-loading';
  loadingNote.setAttribute('role', 'status');
  loadingNote.setAttribute('aria-live', 'polite');
  loadingNote.style.cssText = 'position:absolute;left:24px;right:24px;bottom:10%;z-index:5;text-align:center;color:#E9EDF0;font:500 13px/1.5 sans-serif;pointer-events:none;text-shadow:0 1px 6px #0B0F13';
  loadingNote.hidden = true;
  const dbs = new THREE.Vector2();
  const ro = new ResizeObserver(() => resize());
  function resize() {
    if (!host) return;
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    renderer.getDrawingBufferSize(dbs);
    const rw = Math.round(dbs.x * Q.rt), rh = Math.round(dbs.y * Q.rt);
    rtA.setSize(rw, rh); rtB.setSize(rw, rh);
    compMat.uniforms.uRes.value.set(W, H);
    pieces.forEach((pc) => pc.pane.material.uniforms.uRes.value.copy(dbs));
    camera.aspect = W / H; camera.updateProjectionMatrix();
    measureCallouts();
    if (reduced && mode !== 'none') renderOnce();
  }
  function setDpr(v) {
    v = Math.min(DEV_DPR, v);
    if (Math.abs(v - DPR) < 0.01) return;
    DPR = v; renderer.setPixelRatio(DPR); resize();
  }
  function attach(h) {
    if (host === h) return;
    host = h; h.append(canvas, loadingNote);
    ro.disconnect(); ro.observe(h);
    resize();
  }

  // ================= CALLOUTS (DOM anchored to 3D) =================
  const callouts = [...document.querySelectorAll('.callout[data-anchor]')].map((el) => {
    const [scene, id] = el.dataset.anchor.split(':');
    return { el, scene, id, dot: el.querySelector('.adot'), card: el.querySelector('.ccard'), path: el.querySelector('.aline path'), svg: el.querySelector('.aline'), follow: el.hasAttribute('data-follow'), pos: null, box: null, last: '' };
  });
  function measureCallouts() {
    for (const c of callouts) {
      if (!c.card) continue;
      c.box = { l: c.card.offsetLeft, t: c.card.offsetTop, w: c.card.offsetWidth, h: c.card.offsetHeight };
      if (c.svg) c.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    }
  }
  const pv = new THREE.Vector3();
  function placeCallouts(sceneName, cam, extra) {
    for (const c of callouts) {
      if (c.scene !== sceneName || !c.pos) continue;
      pv.copy(c.pos).project(cam);
      const vis = pv.z < 1 && pv.z > -1 && Math.abs(pv.x) < 1.15 && Math.abs(pv.y) < 1.15;
      const x = (pv.x + 1) / 2 * W, y = (1 - pv.y) / 2 * H;
      c.dot.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      c.dot.style.opacity = vis ? '' : '0';
      if (!c.box || !c.box.w) measureCallouts();
      let cx, cy;
      if (c.follow) {
        const ox = x + (x > W * 0.7 ? -(c.box.w + 34) : 34), oy = y - c.box.h - 26;
        c.card.style.transform = 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)';
        cx = x > W * 0.7 ? ox + c.box.w : ox; cy = oy + c.box.h;
        if (extra && extra.div !== undefined) {
          const ep = x / W < extra.div ? 'b' : 'a';
          if (ep !== c.last) { c.last = ep; c.el.setAttribute('data-epoch', ep); }
        }
      } else {
        const right = c.box.l > x;
        const below = c.box.t > y + 30, above = c.box.t + c.box.h < y - 30;
        if (W < 761 && (below || above)) { cx = c.box.l + c.box.w / 2; cy = below ? c.box.t : c.box.t + c.box.h; }
        else { cx = right ? c.box.l : c.box.l + c.box.w; cy = c.box.t + 22; }
      }
      if (c.path) {
        const vert = W < 761 && Math.abs(cx - (c.box.l + c.box.w / 2)) < 1;
        const mx = vert ? cx : cx + (cx > x ? -28 : 28), my = vert ? cy + (cy > y ? -18 : 18) : cy;
        c.path.setAttribute('d', vis ? 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'L' + mx.toFixed(1) + ' ' + my.toFixed(1) + 'L' + cx.toFixed(1) + ' ' + cy.toFixed(1) : 'M0 0');
      }
    }
  }

  // ================= MODES =================
  let mode = 'none';
  const vis = { stage: false, app: false, cta: false };
  let asmT0 = performance.now() / 1000 + 0.2;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.target === hostStage) vis.stage = en.isIntersecting;
      else if (en.target === hostApp) vis.app = en.isIntersecting;
      else vis.cta = en.isIntersecting;
    });
    const m = vis.stage ? 'stage' : vis.app ? 'app' : vis.cta ? 'cta' : 'none';
    if (m === mode) return;
    const prev = mode; mode = m;
    updateDemand();
    if (m === 'stage') { attach(hostStage); if (prev === 'cta') asmT0 = -100; }
    if (m === 'app') attach(hostApp);
    if (m === 'cta') { attach(hostCta); asmT0 = performance.now() / 1000 + 0.1; }
    if (m === 'none') stop(); else start();
  }, { threshold: 0, rootMargin: '120px 0px' });
  io.observe(hostStage);
  if (hostApp) io.observe(hostApp);
  if (hostCta) io.observe(hostCta);

  const ptr = { x: 0, y: 0, cx: -1, cy: -1 };
  const tilt = { x: 0, y: 0, vx: 0, vy: 0 };
  addEventListener('pointermove', (e) => { ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = (e.clientY / innerHeight) * 2 - 1; ptr.cx = e.clientX; ptr.cy = e.clientY; }, { passive: true });

  // ================= MARK UPDATE =================
  function updateMark(t, dt) {
    const k = 34, c = 8.5;
    const tx = reduced ? 0 : ptr.y * 0.24, ty = reduced ? 0 : ptr.x * 0.4;
    tilt.vx += ((tx - tilt.x) * k - tilt.vx * c) * dt; tilt.x += tilt.vx * dt;
    tilt.vy += ((ty - tilt.y) * k - tilt.vy * c) * dt; tilt.y += tilt.vy * dt;

    let ax, ay, size, heroK = 0, sep = 0, spin = 0, zoom = 0, spx = 240, spy = 160;
    if (mode === 'cta') { ax = W / 2; ay = H / 2; size = Math.min(W, H) * 0.54; }
    else {
      const L = layoutFn(W, H);
      heroK = S.hero; sep = S.sep; spin = S.spin; zoom = S.zoom;
      ax = lerp(L.hx, L.sx, heroK); ay = lerp(lerp(L.hy, L.sy, heroK), L.fy, sep); size = lerp(lerp(L.hs, L.ss, heroK), L.fs, sep);
      spx = L.spx; spy = L.spy;
    }
    const wpp = (2 * CAM_Z * TAN) / H;
    const gs = (size * wpp) / MARK_W;
    const gx = (ax - W / 2) * wpp, gy = -(ay - H / 2) * wpp;
    group.scale.setScalar(gs); group.position.set(gx, gy, 0);
    const zr = 1 - smooth(0, 0.35, zoom);
    const calm = (1 - sep) * zr;
    const idleY = reduced ? -0.32 : Math.sin(t * 0.3) * 0.42;
    const idleX = reduced ? 0 : Math.sin(t * 0.23 + 1.3) * 0.05;
    const tiltK = 0.25 + 0.75 * calm;
    group.rotation.x = ((-0.12 + idleX) * calm + tilt.x * tiltK * (1 - sep * 0.6)) * zr;
    group.rotation.y = (idleY * calm + tilt.y * tiltK * (1 - sep * 0.6)) * zr + spin * Math.PI * 2;

    const side = 21 * UNIT * gs;
    const dCover = side / (2 * TAN * Math.max(1, W / H));
    const dFill = Math.max(0.16, dCover * 0.42);
    let asmMin = 1;
    for (let i = 0; i < 4; i++) {
      const p = pieces[i];
      const e = reduced ? 1 : expoOut(clamp01((t - asmT0 - i * 0.13) / 1.9));
      asmMin = Math.min(asmMin, e);
      const tgx = (p.dir[0] * spx * wpp) / gs, tgy = (p.dir[1] * spy * wpp) / gs;
      let x = lerp(p.rest.x, tgx, sep), y = lerp(p.rest.y, tgy, sep), z = 0;
      y += Math.sin(t * 0.9 + i * 1.7) * 0.02 * sep;
      let rx = 0, ry = Math.sin(sep * Math.PI) * 0.85 * p.dir[0], rz = 0, s = 1;
      rx += Math.sin(t * 0.5 + i) * 0.05 * sep; ry += Math.sin(t * 0.37 + i * 2) * 0.07 * sep;
      if (i === 3) {
        if (zoom > 0) {
          const d = CAM_Z * Math.pow(dFill / CAM_Z, zoom);
          const cm = smooth(0, 0.65, zoom);
          x = lerp(x, -gx / gs, cm); y = lerp(y, -gy / gs, cm);
          z = (CAM_Z - d) / gs;
          rz = cubicOut(clamp01(zoom / 0.7)) * Math.PI / 2;
          ry *= 1 - cm; rx *= 1 - cm;
        }
        mint.emissiveIntensity = 0.12 + (reduced ? 0 : Math.sin(t * 1.4) * 0.04) + zoom * zoom * 0.55;
        halo.material.opacity = (0.42 + sep * 0.1) * (1 - smooth(0, 0.4, zoom)) * e * (1 - S.win * 0.6);
      } else { z -= zoom * 1.4; s = 1 - zoom * 0.25; }
      const ie = 1 - e;
      x += p.sc.p[0] * ie; y += p.sc.p[1] * ie; z += p.sc.p[2] * ie;
      rx += p.sc.r[0] * ie; ry += p.sc.r[1] * ie; rz += p.sc.r[2] * ie;
      s *= lerp(0.35, 1, e);
      p.mesh.position.set(x, y, z); p.mesh.rotation.set(rx, ry, rz); p.mesh.scale.setScalar(s);
      const u = p.pane.material.uniforms;
      const rdy = WIN_ASSETS[i].ready;
      const winK = mode === 'cta' ? 0 : (i === 3 ? S.win : S.winq);
      if (winK > 0.001) requestPosters();
      const hasPreview = rdy || !!winPosters[i];
      u.tMap.value = rdy ? winRT[i].texture : (winPosters[i] || winRT[i].texture);
      u.uHasMap.value = hasPreview ? 1 : 0;
      u.uReveal.value = Math.max(winK * (hasPreview ? 1 : 0), i === 3 ? smooth(0, 0.25, zoom) * (road.ready ? 1 : 0) : 0);
      if (i === 3) u.uScreen.value = smooth(0.02, 0.3, zoom);
      p.pane.visible = u.uReveal.value > 0.002;
    }
    const floorK = (1 - heroK) * (1 - sep) * (1 - zoom) * asmMin;
    const fy = gy - gs * 1.25;
    pool.position.set(gx, fy, -0.2 * gs); pool.rotation.set(-Math.PI / 2 + 0.36, 0, 0);
    pool.scale.set(gs * 4.6, gs * 3.2, 1); pool.material.opacity = floorK;
    shadow.position.set(gx, fy + 0.002, -0.1 * gs); shadow.rotation.set(-Math.PI / 2 + 0.36, 0, 0);
    shadow.scale.set(gs * 2.3, gs * 1.1, 1); shadow.material.opacity = floorK * 0.9;
    pool.visible = shadow.visible = floorK > 0.002;

    if (bgPts.visible) {
      const k2 = mode === 'cta' ? 0 : 1;
      bgMat.uniforms.uOpacity.value = Math.min(1, (t - bgT0) / 2.5) * k2 * (0.72 - 0.4 * sep) * (1 - smooth(0, 0.6, zoom));
      bgRig.position.set(-tilt.y * 1.6, -heroK * 3.2 + sep * 1.5 + tilt.x * 1.2, -42 + heroK * 6);
      bgPts.rotation.y = (reduced ? 0.6 : t * 0.018) + heroK * 0.35;
    }
  }

  // ================= WINDOWS (X road · Y terminal · Z flare · T stockpile) =================
  const WIN_ASSETS = [road, plant, flare, stock];
  let winFrame = 0;
  function renderWindows(t) {
    const sz = Q.win;
    renderer.setClearColor(BG, 1);
    winFrame++;
    const live = [0, 1, 2, 3].filter((i) => WIN_ASSETS[i].ready && pieces[i].pane.visible);
    live.forEach((i, n) => {
      // more than two live windows: each refreshes every other frame
      if (live.length > 2 && (n % 2) !== (winFrame % 2)) return;
      const c = winCams[i];
      setPointScale(sz, 36);
      if (i === 0) {
        setRoadWinCam(c, t); c.aspect = 1; c.updateProjectionMatrix();
        roadState(9, 1, -9, roadAlt, 1.15);
        renderer.setRenderTarget(winRT[0]); renderer.render(road.scene, c);
      } else if (i === 1) {
        applyWorkflow('plant', { still: true });
        setPlantCam(c, 0.55, t * 0.03, 1, false); c.fov = 36; c.aspect = 1; c.updateProjectionMatrix();
        renderer.setRenderTarget(winRT[1]); renderer.render(plant.scene, c);
      } else if (i === 2) {
        const a = t * 0.12 + 0.6, ax = flare.axis;
        c.fov = 36; c.aspect = 1; c.near = 0.1; c.far = 200;
        c.position.set(ax.x + Math.cos(a) * 9, 12.5, ax.z + Math.sin(a) * 9); c.lookAt(ax.x, 16.2, ax.z); c.updateProjectionMatrix();
        flareState(1, 1, t); applyWorkflow('flare', { still: true });
        renderer.setRenderTarget(winRT[2]); renderer.render(flare.scene, c);
      } else {
        applyWorkflow('stock', { still: true });
        setStockCam(c, 0.3, t * 0.04, 1, false); c.aspect = 1; c.updateProjectionMatrix();
        const div = 0.5 + 0.32 * Math.sin(t * 0.55);
        stock.e1.visible = true; stock.e2.visible = false;
        renderer.setRenderTarget(winRT[3]); renderer.render(stock.scene, c);
        stock.e1.visible = false; stock.e2.visible = true;
        renderer.setScissorTest(true);
        const px = Math.round(div * sz);
        renderer.setScissor(px, 0, sz - px, sz);
        renderer.render(stock.scene, c);
        renderer.setScissorTest(false);
        pieces[3].pane.material.uniforms.uDiv.value = div;
      }
    });
    renderer.setRenderTarget(null);
  }

  // ================= RENDER HELPERS =================
  const mobileFrame = () => W < 761 && mode === 'stage';
  let lastVisibleAsset = null;
  function drawScene(name, cam, target, opts = {}) {
    const h = target ? target.height : dbs.y;
    cam.aspect = W / H;
    // Mobile: push the asset into the lower band so the copy above never sits on it.
    if (mobileFrame() && !opts.noOffset) cam.setViewOffset(W, H, 0, -H * 0.07, W, H); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    setPointScale(h, cam.fov);
    renderer.setRenderTarget(target || null);
    renderer.setClearColor(BG, 1);
    const px = h / H;
    if (name === 'stock1' || name === 'stock2') {
      applyWorkflow('stock', opts);
      stock.e1.visible = name === 'stock1'; stock.e2.visible = name === 'stock2';
      renderer.render(stock.scene, cam);
    } else if (name === 'road') {
      road.def.material.uniforms.uPx.value = px;
      renderer.render(road.scene, cam);
    } else {
      if (name === 'tank') { sectionTank(cam); tankLook(mode === 'stage' && !opts.still ? smooth(0.45, 0.95, S.tank) : 1); }
      applyWorkflow(name, opts);
      renderer.render(SCN[name].scene, cam);
    }
    if (!target && !opts.still) lastVisibleAsset = name;
  }
  function flyBetween(nameA, cameraA, nameB, cameraB, progress) {
    const travel = sceneTravel(progress);
    const strength = reduced ? 0 : MOBILE ? 0.72 : 1;
    moveTravelCamera(cameraA, travel.outgoing, 1, strength);
    moveTravelCamera(cameraB, travel.incoming, -1, strength);
    composite(nameA, cameraA, nameB, cameraB, 0, travel.blend);
  }
  function composite(nameA, camA_, nameB, camB_, modeId, p, opts = {}) {
    drawScene(nameA, camA_, rtA, opts);
    drawScene(nameB, camB_, rtB, opts);
    compMat.uniforms.tA.value = rtA.texture; compMat.uniforms.tB.value = rtB.texture;
    compMat.uniforms.uMode.value = modeId; compMat.uniforms.uP.value = p;
    renderer.setRenderTarget(null);
    renderer.render(compScene, compCam);
    lastVisibleAsset = p < 0.5 ? nameA : nameB;
  }
  const ready = (n) => (datasetName(n) === 'stockpile' ? stock.ready : SCN[n] ? SCN[n].ready : false);

  // ================= HUD =================
  const hudCam = document.getElementById('hudCam');
  const kmEl = document.querySelector('[data-kmread]');
  const divEl = document.querySelector('.divider');
  let hudN = 0;
  function hud(cam, scale = 1) {
    if (!hudCam || (hudN++ % 5)) return;
    const p = cam.position;
    const f = (v) => (v < 0 ? '−' : '+') + Math.abs(v * scale).toFixed(1);
    hudCam.textContent = 'CAM  X ' + f(p.x) + '   Y ' + f(-p.z) + '   Z ' + f(p.y) + ' m';
  }
  function hudRoad() {
    if (!hudCam || (hudN++ % 4)) return;
    const k = roadKm >= 0 ? roadKm : 7.55 * S.pci;
    hudCam.textContent = 'CH ' + k.toFixed(2).padStart(5, ' ') + ' km   ALT ' + Math.round(roadAlt).toString().padStart(4, ' ') + ' m';
  }
  function setDivider(d, on) {
    if (!divEl) return;
    divEl.style.transform = 'translate3d(' + (d * W).toFixed(1) + 'px,0,0)';
    divEl.style.visibility = on ? 'visible' : 'hidden';
  }
  let kmShown = '';
  function kmRead(v) {
    if (!kmEl) return;
    const s = v.toFixed(2);
    if (s !== kmShown) { kmShown = s; kmEl.textContent = s; }
  }

  // ================= FACADE HOVER (screen-space nearest patch) =================
  const tip = document.querySelector('.fx-tip');
  const finePtr = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let fxCam = null;
  const _pp = V();
  function facadeHover(cam) {
    fxCam = cam;
    if (!finePtr || !facade.ready || ptr.cx < 0) { setHi(-1); return; }
    const rect = canvas.getBoundingClientRect();
    const mx = ptr.cx - rect.left, my = ptr.cy - rect.top;
    if (mx < 0 || my < 0 || mx > W || my > H) { setHi(-1); return; }
    let best = -1, bd = 26 * 26;
    const cs = facade.centers;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i].ord > fx.reveal - 0.5) continue;
      _pp.copy(cs[i].v).project(cam);
      if (_pp.z > 1) continue;
      const x = (_pp.x + 1) / 2 * W, y = (1 - _pp.y) / 2 * H, d = (x - mx) * (x - mx) + (y - my) * (y - my);
      if (d < bd) { bd = d; best = i; }
    }
    setHi(best, mx, my);
  }
  function setHi(i, x, y) {
    if (fx.hi !== i) {
      fx.hi = i;
      if (tip) {
        if (i < 0) tip.classList.remove('on');
        else {
          const p = facade.meta.patches[i], cl = facade.classLabel[p.cls] || p.cls;
          tip.innerHTML = '<b>' + p.issue + '</b><span class="sev ' + (p.sev > 1 ? 's2' : 's1') + '">' + (p.sev > 1 ? 'Moderate' : 'Minor') + '</span><em>' + cl + '</em><span class="mono">' + p.component + ' · ' + p.center[1].toFixed(1) + ' m</span>';
          tip.classList.add('on');
        }
      }
    }
    if (tip && i >= 0) tip.style.transform = 'translate3d(' + Math.round(x + 18) + 'px,' + Math.round(y - 12) + 'px,0)';
  }
  window.addEventListener('d3:fx-class', (e) => { fx.hiCls = e.detail; });

  // ================= STAGE FRAME =================
  let bgT0 = 0;
  function stageFrame(t, dt) {
    const aspect = W / H;
    if (S.zoom < 0.999 || S.wipe1 < 0.9995) clearPileProjection();
    if (S.zoom < 0.999) {
      setDpr(Q.dprMark);
      setDivider(0, false);
      updateMark(t, dt);
      if ((S.win > 0.001 || S.winq > 0.001) && S.zoom < 0.3) renderWindows(t);
      if (S.zoom > 0.001 && road.ready) {
        setRoadCam(camA, 0, 0, aspect); roadState(0, 0, -9, roadAlt, rtA.height / H);
        drawScene('road', camA, rtA);
        pieces[3].pane.material.uniforms.tScreen.value = rtA.texture;
      }
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.render(markScene, camera);
      return;
    }
    setDpr(heavyCap);
    if (fx.hi >= 0 && !(S.split >= 0.9995 && S.wipe1 <= 0.0005)) setHi(-1);
    const rd = S.road, sw = S.sweep, pl = S.plant, ir = S.iris, tk = S.tank, ri = S.rise, fl = S.flare, sp = S.split, fa = S.facade, w1 = S.wipe1, w2 = S.wipe2, st = S.stock;
    const fS = () => flareState(S.scan, S.ignite, t);
    const rS = (target) => roadState(7.55 * S.pci + (roadKm >= 0 ? 9 : 0), S.pop, roadKm >= 0 ? roadKm + 0.2 : -9, roadAlt, (target ? target.height : dbs.y) / H);
    const fxS = () => facadeState(S.cls * 9.0);
    kmRead(roadKm >= 0 ? roadKm : 7.55 * S.pci);
    if (sw <= 0.0005) {
      setDivider(0, false);
      if (!road.ready) return loadingFrame(['road'], t);
      setRoadCam(camA, rd, 0, aspect); rS(null); drawScene('road', camA, null); placeCallouts('road', camA); hudRoad();
    } else if (sw < 0.9995) {
      setDivider(0, false);
      if (!road.ready || !plant.ready) return loadingFrame(['road', 'plant'], t);
      setRoadCam(camA, rd, 0, aspect); rS(rtA); setPlantCam(camB, pl, 0, aspect);
      flyBetween('road', camA, 'plant', camB, sw); hud(camB);
    } else if (ir <= 0.0005) {
      setDivider(0, false);
      if (!plant.ready) return loadingFrame(['plant'], t);
      setPlantCam(camA, pl, 0, aspect); drawScene('plant', camA, null); hud(camA);
    } else if (ir < 0.9995) {
      setDivider(0, false);
      if (!plant.ready || !tank.ready) return loadingFrame(['plant', 'tank'], t);
      setPlantCam(camA, pl, 0, aspect); setTankCam(camB, tk, 0, aspect);
      flyBetween('plant', camA, 'tank', camB, ir); hud(camB);
    } else if (ri <= 0.0005) {
      setDivider(0, false);
      if (!tank.ready) return loadingFrame(['tank'], t);
      setTankCam(camA, tk, 0, aspect); drawScene('tank', camA, null); placeCallouts('tank', camA); hud(camA);
    } else if (ri < 0.9995) {
      setDivider(0, false);
      if (!tank.ready || !flare.ready) return loadingFrame(['tank', 'flare'], t);
      setTankCam(camA, tk, 0, aspect); setFlareCam(camB, fl, 0, aspect); fS();
      flyBetween('tank', camA, 'flare', camB, ri); hud(camB);
    } else if (sp <= 0.0005) {
      setDivider(0, false);
      if (!flare.ready) return loadingFrame(['flare'], t);
      setFlareCam(camA, fl, 0, aspect); fS(); drawScene('flare', camA, null); placeCallouts('flare', camA); hud(camA, 4);
    } else if (sp < 0.9995) {
      setDivider(0, false);
      if (!flare.ready || !facade.ready) return loadingFrame(['flare', 'facade'], t);
      setFlareCam(camA, fl, 0, aspect); fS(); setFacadeCam(camB, fa, 0, aspect); fxS();
      flyBetween('flare', camA, 'facade', camB, sp); hud(camB);
    } else if (w1 <= 0.0005) {
      setDivider(0, false);
      if (!facade.ready) return loadingFrame(['facade'], t);
      setFacadeCam(camA, fa, 0, aspect); fxS(); drawScene('facade', camA, null); placeCallouts('facade', camA); hud(camA);
      facadeHover(camA);
    } else if (w1 < 0.9995) {
      if (!facade.ready || !stock.ready) return loadingFrame(['facade', 'stock2'], t);
      setDivider(0, false);
      setFacadeCam(camA, fa, 0, aspect); fxS(); setStockCam(camB, st, 0, aspect);
      flyBetween('facade', camA, 'stock2', camB, w1); hud(camB);
    } else {
      if (!stock.ready) return loadingFrame(['stock2'], t);
      setStockCam(camA, st, 0, aspect);
      const state = workflow('stock');
      const comparison = state.id === 'compare' ? (state.manual ? 0.5 : smooth(0.08, 0.92, state.local)) : 0;
      if (comparison <= 0.0005) { drawScene(state.id === 'compare' ? 'stock1' : 'stock2', camA, null); setDivider(0, false); }
      else if (comparison >= 0.9995) { drawScene('stock2', camA, null); setDivider(1, false); }
      else { camB.copy(camA); composite('stock2', camA, 'stock1', camB, 3, comparison); setDivider(comparison, true); }
      placeCallouts('stock', camA, { div: comparison }); projectPiles(camA); hud(camA);
    }
  }
  function clearBg() { renderer.setRenderTarget(null); renderer.setClearColor(BG, 1); renderer.clear(); }
  function loadingFrame(candidates, t) {
    // Keep a ready world visible during a slow handoff. If this was a direct
    // jump, keep the last rendered asset behind the explicit loading message.
    const name = candidates.find(ready) || (ready(lastVisibleAsset) ? lastVisibleAsset : null);
    if (!name) return clearBg();
    const aspect = W / H, o = { noOffset: mode === 'app' };
    if (name === 'road') { setRoadCam(camA, S.road, 0, aspect); roadState(9, 1, -9, roadAlt, dbs.y / H); }
    else if (name === 'plant') setPlantCam(camA, S.plant, 0, aspect);
    else if (name === 'tank') setTankCam(camA, S.tank, 0, aspect);
    else if (name === 'flare') { setFlareCam(camA, S.flare, 0, aspect); flareState(1, 1, t); }
    else if (name === 'facade') { setFacadeCam(camA, S.facade, 0, aspect); facadeState(9, 0.3); }
    else setStockCam(camA, S.stock, 0, aspect);
    drawScene(name, camA, null, o);
  }

  // ================= APP FRAME =================
  let appDs = document.querySelector('[data-ds].on')?.dataset.ds || 'flare';
  window.addEventListener('d3:dataset', (e) => {
    if (!Object.hasOwn(SCN, e.detail)) return;
    appDs = e.detail; updateDemand();
    if (reduced && mode === 'app') renderOnce();
  });
  function appFrame(t) {
    setDpr(heavyCap);
    const aspect = W / H, k = reduced ? 0 : t * 0.05;
    tilt.x += (ptr.y * 0.15 - tilt.x) * 0.05; tilt.y += (ptr.x * 0.2 - tilt.y) * 0.05;
    const need = appDs === 'stock' ? 'stock2' : appDs;
    if (!ready(need)) return loadingFrame([need], t);
    const o = { noOffset: true };
    if (appDs === 'road') { setRoadAppCam(camApp, t * (reduced ? 0 : 1) + tilt.y * 8); camApp.fov = aspect < 1 ? 52 : 38; roadState(9, 1, -9, roadAlt, dbs.y / H); drawScene('road', camApp, null, o); }
    else if (appDs === 'plant') { setPlantCam(camApp, 0.7, k + tilt.y * 0.4, aspect); drawScene('plant', camApp, null, o); }
    else if (appDs === 'tank') { setTankCam(camApp, 0.5 + 0.5 * Math.sin(k * 2), 0, Math.max(aspect, 1)); drawScene('tank', camApp, null, o); }
    else if (appDs === 'flare') {
      const ax = flare.axis, a = k * 2 + 0.8 + tilt.y;
      camApp.fov = 40; camApp.near = 0.1; camApp.far = 300;
      camApp.position.set(ax.x + Math.cos(a) * 11, 14.5 + tilt.x * 3, ax.z + Math.sin(a) * 11); camApp.lookAt(ax.x, 15.8, ax.z);
      flareState(1, 1, t); drawScene('flare', camApp, null, o);
    } else if (appDs === 'facade') { setFacadeCam(camApp, 0.85, k + tilt.y * 0.3, aspect); facadeState(9, 0.3); drawScene('facade', camApp, null, o); }
    else { setStockCam(camApp, 0.55, k + tilt.y * 0.4, aspect); drawScene('stock2', camApp, null, o); }
  }

  // ================= LOOP =================
  let last = performance.now() / 1000, raf = 0;
  const fpsLog = { n: 0, t0: 0, slow: 0 };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (MOBILE && now / 1000 - last < 1 / 30 - 0.001) return;
    const t = now / 1000, dt = Math.min(0.05, Math.max(0.001, t - last)); last = t;
    // adaptive quality: if frames stay slow in heavy scenes, step the pixel ratio down (never below 1)
    if (DPR > 1.01 && mode !== 'cta' && (S.zoom >= 0.999 || mode === 'app')) {
      fpsLog.slow = dt > (MOBILE ? 0.044 : 0.024) ? fpsLog.slow + 1 : Math.max(0, fpsLog.slow - 2);
      if (fpsLog.slow > 90) { heavyCap = Math.max(1, heavyCap - 0.25); fpsLog.slow = 0; }
    }
    render(t, dt);
  }
  let lastMs = 0;
  function render(t, dt) {
    const t0 = performance.now();
    const demand = updateDemand();
    const visibleNeeds = mode === 'stage' && S.zoom > 0.02 && S.zoom < 0.999 ? ['road'] : demand.active;
    showLoading(visibleNeeds.filter(name => !ready(name)));
    pumpUploads(renderer, reduced ? 64 : 1);
    if (texQueue.length) { const tx = texQueue.shift(); try { renderer.initTexture(tx); } catch (e) { /* ignore */ } }
    if (mode === 'stage') stageFrame(t, dt);
    else if (mode === 'app') appFrame(t);
    else if (mode === 'cta') { setDpr(Q.dprMark); updateMark(t, dt); renderer.setRenderTarget(null); renderer.setClearColor(0, 0); renderer.render(markScene, camera); }
    lastMs = lastMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  function renderOnce() { render(performance.now() / 1000, 0.016); }
  function start() { if (document.hidden) return; if (reduced) { renderOnce(); return; } if (!raf) { last = performance.now() / 1000; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (mode !== 'none') start(); });

  window.__qglReady = true;
  html.classList.add('gl-ready');

  // ================= DATA =================
  const status = (n, s) => { document.querySelectorAll('[data-status="' + n + '"]').forEach((el) => el.setAttribute('data-state', s)); window.dispatchEvent(new CustomEvent('d3:asset', { detail: { name: n, state: s } })); };
  const toBasic = (root, extra = {}) => root.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    o.material = new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : (m.color || 0xcccccc), side: THREE.DoubleSide, toneMapped: false, ...extra });
  });
  // Pre-compile every program variant a scene will need: on screen (sRGB out) and into the transition targets (linear out).
  const warm = (scene, cam) => {
    try {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(null); renderer.compile(scene, cam);
      renderer.setRenderTarget(rtA); renderer.compile(scene, cam);
      renderer.setRenderTarget(winRT[0]); renderer.compile(scene, cam);
      renderer.setRenderTarget(prev);
    } catch (e) { /* ignore */ }
    // queue the scene's textures for upload, one per frame, so first sight of an asset never stalls
    scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach((m) => ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach((k) => { if (m[k] && m[k].isTexture) texQueue.push(m[k]); })); });
  };
  const texQueue = [];

  let D = null, dataModule = null;
  function ensureData() {
    if (!dataModule) dataModule = import('../data/quadrion-data.js').then(module => {
      D = module;
      if (D.ASSETS) window.dispatchEvent(new CustomEvent('d3:assets', { detail: D.ASSETS }));
      return module;
    });
    return dataModule;
  }
  const steps = new Map([
      ['road', async () => {
        const a = await D.loadRoad();
        road.cl = a.road.centreline; road.km = a.road.chainageKm;
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        road.cl.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
        road.c.set((x0 + x1) / 2, 0, (z0 + z1) / 2); road.L = Math.max(x1 - x0, z1 - z0);
        road.sets.z2 = tileSet(a.road, 2);
        // 26 cm tiles only along the flown stretch; 6.5 cm tiles exist only around the hero km.
        const near = [];
        for (let k = FLY.k0 - 0.4; k <= FLY.k1 + 0.7; k += 0.05) { const r = roadAt(k); near.push([r.x, r.z]); }
        if (Q.z4) road.sets.z4 = tileSet(a.road, 4, (cx, cz, t) => near.some(([x, z]) => Math.abs(x - cx) < t * 0.5 + 160 && Math.abs(z - cz) < t * 0.5 + 160));
        road.sets.z6 = tileSet(a.road, 6);
        Object.values(road.sets).forEach((s) => road.scene.add(s));
        road.pci = pciMeshWithChainage(a.cells);
        road.def = defectCloud(a.defects);
        road.scene.add(road.pci, road.def);
        requestTiles(road.sets.z2);
        // close-up anchors from the real defect positions
        a.defects.forEach((d) => callouts.forEach((c) => { if (c.scene === 'road' && c.id === d.id) c.pos = new THREE.Vector3(d.x, 0.5, d.z); }));
        road.ready = true;
        setRoadCam(camA, 0.5, 0, 1.6); warm(road.scene, camA);
      }],
      ['plant', async () => {
        const a = await D.loadPlant();
        const geo = decimate(a.cloud.geometry, Q.plantStride);
        const pts = new THREE.Points(geo, pointsMat({ size: 2.4, minPx: 1, maxPx: MOBILE ? 3 : 4.5 }));
        pts.frustumCulled = false;
        plant.scene.add(pts); plant.pts = pts; plant.model = a.model;
        prepareModel(a.model, plant.scene);
        modelOpacity(plant.model, 0);
        const box = new THREE.Box3(), sz = V();
        a.model.updateMatrixWorld(true);
        a.model.traverse((o) => {
          if (!o.isMesh) return;
          const b = new THREE.Box3().setFromObject(o); b.getSize(sz);
          if (sz.length() > 1500 || (sz.y < 0.5 && Math.max(sz.x, sz.z) > 800)) return;
          box.union(b);
        });
        box.getCenter(plant.center); box.getSize(plant.size);
        const ys = []; const p = a.cloud.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 97) ys.push(p.getY(i));
        ys.sort((x, y) => x - y);
        const ground = ys[Math.floor(ys.length * 0.08)];
        pts.material.uniforms.uElevation.value.set(ground, ys[Math.floor(ys.length * 0.99)]);
        plant.center.y = ground + 4;
        const ortho = a.ortho.clone();
        ortho.material = new THREE.MeshBasicMaterial({ map: a.ortho.material.map, color: 0x9a9a9a, toneMapped: false, side: THREE.DoubleSide, depthWrite: true });
        ortho.position.y = ground - a.ortho.geometry.attributes.position.getY(0) - 0.6;
        plant.scene.add(ortho); plant.ortho = ortho;
        const s = await D.samplePoints('plant', Q.bgN, 10);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(s.colors, 3));
        bgPts.geometry = g; bgPts.scale.setScalar(2.4); bgPts.rotation.x = 0; bgPts.position.y = -4;
        bgRig.rotation.x = 0.62;
        bgPts.visible = true; bgT0 = performance.now() / 1000;
        plant.ready = true;
        setPlantCam(camA, 0.5, 0, 1.6, false); warm(plant.scene, camA);
      }],
      ['stockpile', async () => {
        const a = await D.loadStockpile();
        toBasic(a.e1); toBasic(a.e2);
        [a.e1, a.e2].forEach((r) => r.traverse((o) => { if (o.isLine || o.isLineSegments) { o.material = new THREE.LineBasicMaterial({ color: 0xffc400, toneMapped: false, transparent: true, opacity: 0.9 }); } }));
        stock.scene.add(a.e1, a.e2);
        stock.e1 = a.e1; stock.e2 = a.e2;
        a.e1.updateMatrixWorld(true); a.e2.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(a.e2);
        stock.dsm = new THREE.ShaderMaterial({
          side: THREE.DoubleSide, toneMapped: false,
          uniforms: { uRange: { value: new THREE.Vector2(box.min.y, box.max.y) } },
          vertexShader: 'varying float vHeight; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vHeight = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }',
          fragmentShader: /* glsl */`
            uniform vec2 uRange; varying float vHeight;
            ${elevationGLSL}
            void main(){
              vec3 col = elevationColor((vHeight - uRange.x) / max(0.001, uRange.y - uRange.x));
              float contour = 1.0 - smoothstep(0.025, 0.09, abs(fract(vHeight) - 0.5));
              gl_FragColor = vec4(col * (1.0 - contour * 0.24), 1.0);
              #include <colorspace_fragment>
            }`,
        });
        [a.e1, a.e2].forEach(root => root.traverse(mesh => {
          if (mesh.isMesh) stock.surfaces.push({ mesh, material: mesh.material });
        }));
        stock.center = V();
        let sx = 0, sz2 = 0, n = 0;
        a.volumes.piles.forEach((p) => p.epochs.e2.ring.forEach(([x, z]) => { sx += x; sz2 += z; n++; }));
        stock.center.set(sx / n, (box.min.y + box.max.y) * 0.4, sz2 / n);
        let terrain = null; a.e2.traverse((o) => { if (o.isMesh && /terrain/i.test(o.name)) terrain = o; });
        const rc = new THREE.Raycaster();
        a.volumes.piles.forEach((p) => {
          const r = p.epochs.e2.ring; let cx = 0, cz = 0; r.forEach(([x, z]) => { cx += x; cz += z; }); cx /= r.length; cz /= r.length;
          let y = box.max.y;
          if (terrain) { rc.set(new THREE.Vector3(cx, box.max.y + 50, cz), new THREE.Vector3(0, -1, 0)); const hit = rc.intersectObject(terrain, false)[0]; if (hit) y = hit.point.y; }
          const center = new THREE.Vector3(cx, y, cz);
          stock.piles[p.id] = { center, radius: Math.max(...r.map(([x, z]) => Math.hypot(x - cx, z - cz))), record: p };
          callouts.forEach((c) => { if (c.scene === 'stock' && c.id === p.id) c.pos = center.clone(); });
        });
        // The optimized GLB merges every outline into P01. Split its *existing*
        // measured segments by nearest recorded ring; never fabricate a pile surface.
        function edgeDistance(x, z, ring) {
          let distance = Infinity;
          for (let i = 1; i < ring.length; i++) {
            const [ax, az] = ring[i - 1], [bx, bz] = ring[i];
            const dx = bx - ax, dz = bz - az, t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1));
            distance = Math.min(distance, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
          }
          return distance;
        }
        for (const [epoch, root] of [['e1', a.e1], ['e2', a.e2]]) {
          const groups = Object.fromEntries(a.volumes.piles.map(pile => [pile.id, []]));
          const originals = []; root.traverse(line => { if (line.isLineSegments) originals.push(line); });
          for (const line of originals) {
            const geometry = line.geometry, positions = geometry.attributes.position, index = geometry.index;
            const count = index ? index.count : positions.count;
            for (let i = 0; i + 1 < count; i += 2) {
              _p0.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(line.matrixWorld);
              _p1.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).applyMatrix4(line.matrixWorld);
              const x = (_p0.x + _p1.x) / 2, z = (_p0.z + _p1.z) / 2;
              let nearest = null, distance = Infinity;
              for (const pile of a.volumes.piles) {
                const d = edgeDistance(x, z, pile.epochs[epoch].ring);
                if (d < distance) { distance = d; nearest = pile.id; }
              }
              if (nearest) groups[nearest].push(..._p0.toArray(), ..._p1.toArray());
            }
            line.visible = false;
          }
          for (const [id, positions] of Object.entries(groups)) {
            const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x5ed1b3, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
            root.add(line); stock.outlines.push({ id, line });
          }
        }
        stock.ready = true;
        setStockCam(camA, 0.5, 0, 1.6, false); warm(stock.scene, camA);
      }],
      ['flare', async () => {
        const a = await D.loadFlare();
        const s = await D.samplePoints('flare', Q.flareN, 10);
        const M = await D.stageTransform('flare', 10, Q.flareN);
        flare.M.copy(M);
        const rig = new THREE.Group(); rig.matrixAutoUpdate = false; rig.matrix.copy(M);
        toBasic(a.model, { clippingPlanes: [scanPlane] });
        rig.add(a.model); flare.model = a.model;
        a.patches.forEach((p) => { p.mesh.material.clippingPlanes = null; rig.add(p.mesh); });
        flare.scene.add(rig);
        rig.updateMatrixWorld(true);
        flare.axis.set(0, 0, 0).applyMatrix4(M); flare.axis.y = 0;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
        const cols = new Float32Array(s.colors.length);
        for (let i = 0; i < cols.length; i += 3) { const l = (s.colors[i] + s.colors[i + 1] + s.colors[i + 2]) / 3; cols[i] = l * 0.75 + 0.03; cols[i + 1] = l * 0.85 + 0.06; cols[i + 2] = l * 0.85 + 0.07; }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        flare.pts = new THREE.Points(g, pointsMat({ size: 0.075, minPx: 1, maxPx: 3.5, scan: true, bright: 1.25 }));
        flare.pts.frustumCulled = false;
        flare.scene.add(flare.pts);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.03, 6, 96), new THREE.MeshBasicMaterial({ color: MINT, toneMapped: false, transparent: true, opacity: 0.9 }));
        ring.rotation.x = Math.PI / 2; ring.position.x = flare.axis.x; ring.position.z = flare.axis.z;
        flare.scene.add(ring); flare.scanRing = ring;
        flare.order = a.patches.slice().sort((p, q) => p.center.y - q.center.y);
        flare.order.forEach((p) => { p.world = p.center.clone().applyMatrix4(M); });
        flare.focus = {};
        for (const id of ['F70', 'F44', 'F04']) {
          const patch = flare.order.find(p => p.record.id === id);
          if (!patch) continue;
          const target = patch.world.clone();
          const source = new THREE.Vector3(...patch.record.camera.pos).applyMatrix4(M);
          const direction = source.sub(target).normalize();
          flare.focus[id] = { target, pos: target.clone().addScaledVector(direction, id === 'F70' ? 2.8 : 2.0) };
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(flare.order.flatMap((p) => p.world.toArray()), 3));
        flare.glowCol = new THREE.Float32BufferAttribute(new Float32Array(flare.order.length * 3), 3);
        gg.setAttribute('color', flare.glowCol);
        const glow = new THREE.Points(gg, pointsMat({ size: 1.1, minPx: 2, maxPx: 70, additive: true, soft: true }));
        glow.material.depthWrite = false; glow.renderOrder = 5;
        flare.scene.add(glow);
        a.patches.forEach((p) => callouts.forEach((c) => { if (c.scene === 'flare' && c.id === p.record.id) c.pos = p.center.clone().applyMatrix4(M); }));
        flare.ready = true;
        setFlareCam(camA, 0.8, 0, 1.6, false); flareState(1, 1, 0); warm(flare.scene, camA);
      }],
      ['tank', async () => {
        const a = await D.loadTank();
        // The clip and its pose track are optional evidence, loaded only with this chapter.
        tank.flight = await fetch(DATA + 'tank/flight.json').then(response => response.ok ? response.json() : null).catch(() => null);
        tank.model = a.model; tank.modelClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0.35);
        prepareModel(a.model, tank.scene, { clippingPlanes: [tank.modelClip] });
        const insideLight = new THREE.PointLight(0xe4f0ff, 8, 16, 1); insideLight.position.set(0, 5, 0); tank.scene.add(insideLight);
        modelOpacity(tank.model, 0);
        const tg = decimate(a.cloud.geometry, Q.tankStride);
        // Intensity contrast: stretch between the 3rd and 98th percentile, then a gentle S-curve.
        const it = tg.attributes.intensity, n = it.count, hist = new Uint32Array(256);
        // De-speckle: average intensity in 6 cm voxels so plate seams and patches read instead of sensor noise.
        const tp = tg.attributes.position.array, vk = new Float64Array(n), acc = new Map(), VX = 0.08;
        for (let i = 0; i < n; i++) {
          const k = (Math.floor(tp[i * 3] / VX) + 512) + (Math.floor(tp[i * 3 + 1] / VX) + 512) * 1024 + (Math.floor(tp[i * 3 + 2] / VX) + 512) * 1048576;
          vk[i] = k; const a = acc.get(k); if (a) { a[0] += it.array[i]; a[1]++; } else acc.set(k, [it.array[i], 1]);
        }
        const sm = new Uint8Array(n);
        for (let i = 0; i < n; i++) { const a = acc.get(vk[i]); sm[i] = Math.round(0.85 * a[0] / a[1] + 0.15 * it.array[i]); }
        it.array.set(sm);
        for (let i = 0; i < n; i++) hist[it.array[i]]++;
        const pct = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; } return 255; };
        const lo = pct(0.03), hi = Math.max(lo + 1, pct(0.985));
        const tc = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          let v = clamp01((it.array[i] - lo) / (hi - lo)); v = v * v * (3 - 2 * v); v = Math.pow(v, 1.1);
          tc[i * 3] = 0.05 + 0.92 * v; tc[i * 3 + 1] = 0.07 + 0.92 * v; tc[i * 3 + 2] = 0.09 + 0.91 * v;
        }
        tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
        const pts = new THREE.Points(tg, tank.mat = pointsMat({ size: (tank.size0 = 0.024 * Math.sqrt(Q.tankStride)), minPx: 1, maxPx: MOBILE ? 2.6 : 3.4, bright: 1.15, clip: tankClip, sec: 0.14 }));
        pts.frustumCulled = false;
        tank.scene.add(pts); tank.pts = pts;
        tank.findings = a.findings;
        const positions = [], colors = [], color = new THREE.Color();
        a.findings.forEach(finding => {
          positions.push(...finding.position.toArray());
          color.setHex([0x9aa6b2, 0x5ed1b3, 0xf2c94c, 0xf2994a, 0xe5484d, 0xb0232a][finding.severity] || 0x9aa6b2);
          colors.push(...color.toArray());
        });
        const markers = new THREE.BufferGeometry();
        markers.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        markers.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        tank.markers = new THREE.Points(markers, pointsMat({ px: MOBILE ? 13 : 17, minPx: 10, maxPx: 19, bright: 1.2 }));
        tank.markers.material.depthTest = false; tank.markers.material.depthWrite = false; tank.markers.renderOrder = 9;
        tank.scene.add(tank.markers);
        tank.flightLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints((tank.flight?.samples || []).map(sample => new THREE.Vector3(...sample.pos))), new THREE.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0.8, toneMapped: false, depthTest: false }));
        tank.flightLine.renderOrder = 8; tank.flightLine.visible = false; tank.scene.add(tank.flightLine);
        a.findings.forEach((f) => callouts.forEach((c) => { if (c.scene === 'tank' && c.id === f.id) c.pos = f.position.clone(); }));
        tank.ready = true;
        setTankCam(camA, 0.5, 0, 1.6, false); sectionTank(camA); warm(tank.scene, camA);
      }],
      ['facade', async () => {
        const a = await D.loadFacade();
        facade.meta = a.meta;
        facade.classLabel = Object.fromEntries(a.meta.classes.map((k) => [k.id, k.label]));
        const model = a.model;
        model.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.envMapIntensity = 0.55; if (m.color) m.color.multiplyScalar(0.92); }); } });
        facade.scene.add(model);
        facade.scene.environment = envTex;
        const hemi = new THREE.HemisphereLight(0xdfe8ef, 0x141a20, 1.25);
        const sun = new THREE.DirectionalLight(0xfff6ea, 1.9); sun.position.set(-60, 90, 40);
        facade.scene.add(hemi, sun);
        const box = new THREE.Box3().setFromObject(model); box.getCenter(facade.c); box.getSize(facade.size); facade.c.y = 0;
        // ground disc so the tower stands on something
        const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 64), new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(48,58,70,0.9)'], [0.5, 'rgba(24,30,38,0.6)'], [1, 'rgba(11,15,19,0)']]), transparent: true, depthWrite: false, toneMapped: false }));
        ground.rotation.x = -Math.PI / 2; ground.position.set(facade.c.x, box.min.y - 0.05, facade.c.z); ground.renderOrder = -1;
        facade.scene.add(ground);
        // Patches: restrained. Low opacity, revealed class by class, highlight on hover.
        const ORDER = ['staining', 'soiling', 'cladding', 'object', 'sealant', 'corrosion', 'thermal', 'water', 'glazing'];
        const g = a.patches.geometry, pi = g.attributes.patchIndex, n = pi.count, ord = new Float32Array(n), severity = new Float32Array(n), issue = new Float32Array(n);
        const ordOf = a.meta.patches.map((p) => Math.max(0, ORDER.indexOf(p.cls)));
        for (let i = 0; i < n; i++) {
          const patch = a.meta.patches[pi.array[i]];
          ord[i] = ordOf[pi.array[i]]; severity[i] = patch.sev; issue[i] = Number(patch.issue.slice(1));
        }
        g.setAttribute('ord', new THREE.BufferAttribute(ord, 1));
        g.setAttribute('severity', new THREE.BufferAttribute(severity, 1));
        g.setAttribute('issue', new THREE.BufferAttribute(issue, 1));
        g.setAttribute('pcol', g.attributes.color);
        facade.mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
          uniforms: { uReveal: { value: 9 }, uHi: { value: -1 }, uHiCls: { value: -1 }, uBase: { value: 0.24 }, uEvidenceIssue: { value: -1 } },
          vertexShader: 'attribute vec3 pcol; attribute float ord; attribute float patchIndex; attribute float severity; attribute float issue; varying vec3 vC; varying float vO; varying float vP; varying float vSeverity; varying float vIssue; void main(){ vC = pcol; vO = ord; vP = patchIndex; vSeverity = severity; vIssue = issue; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: /* glsl */`
            uniform float uReveal, uHi, uHiCls, uBase, uEvidenceIssue; varying vec3 vC; varying float vO; varying float vP; varying float vSeverity; varying float vIssue;
            void main() {
              float r = clamp(uReveal - vO, 0.0, 1.0);
              if (r <= 0.0) discard;
              float cur = (1.0 - clamp(uReveal - vO - 1.0, 0.0, 1.0)) * step(uReveal, 8.99);
              float a = r * min(0.95, uBase + 0.18 * (vSeverity - 1.0) + 0.22 * cur);
              vec3 col = vC;
              if (uHiCls > -0.5) a = abs(vO - uHiCls) < 0.5 ? 0.82 : a * 0.3;
              if (abs(vP - uHi) < 0.5 || abs(vIssue - uEvidenceIssue) < 0.5) { a = 0.95; col = mix(col, vec3(1.0), 0.25); }
              gl_FragColor = vec4(col, a);
              #include <colorspace_fragment>
            }`
        });
        const patches = new THREE.Mesh(g, facade.mat); patches.renderOrder = 3;
        facade.scene.add(patches);
        facade.centers = a.meta.patches.map((p) => ({ v: new THREE.Vector3(...p.center), ord: Math.max(0, ORDER.indexOf(p.cls)) }));
        facade.evidenceTargets = {}; facade.evidenceIndices = {};
        for (const [key, issue] of [['rgb', 'D159'], ['thermal', 'D397']]) {
          const index = a.meta.patches.findIndex(patch => patch.issue === issue);
          if (index < 0) continue;
          facade.evidenceIndices[key] = index;
          facade.evidenceTargets[key] = new THREE.Vector3(...a.meta.patches[index].center);
        }
        callouts.forEach((c) => { if (c.scene !== 'facade') return; const p = a.meta.patches.find((q) => q.issue === c.id); if (p) c.pos = new THREE.Vector3(...p.center); });
        facade.ready = true;
        setFacadeCam(camA, 0.8, 0, 1.6, false); warm(facade.scene, camA);
      }]
  ]);
  const loader = createSceneLoader(Object.fromEntries([...steps].map(([name, build]) => [name, async () => {
    await ensureData();
    try { await build(); }
    catch (error) { console.warn('[D3] ' + name + ' failed', error); throw error; }
    measureCallouts();
  }])), { onState(name, state) {
    status(name, state === 'queued' ? 'loading' : state);
    if (state === 'ready' || state === 'error') {
      if (reduced) {
        const done = name === 'road' && road.ready ? waitTiles(road.sets.z2, Infinity) : Promise.resolve();
        done.then(() => { renderStills(); if (mode !== 'none') renderOnce(); });
      }
      if (state === 'ready') queueSilhouettes();
    }
  } });
  const LABELS = { road: 'ring road', plant: 'tank terminal', tank: 'tank interior', flare: 'flare stack', facade: 'tower facade', stockpile: 'stockpile yard' };
  let demandKey = '';
  function updateDemand() {
    const demand = sceneDemand(S, mode, appDs);
    const active = demand.active.slice(), preload = demand.preload.slice();
    if (reduced) {
      const ordered = [...nearStills].map(cv => ({ cv, rect: cv.getBoundingClientRect() }))
        .sort((a, b) => Math.abs(a.rect.top) - Math.abs(b.rect.top));
      for (const { cv, rect } of ordered) {
        if (stillDone.has(cv)) continue;
        (rect.top < innerHeight && rect.bottom > 0 ? active : preload).push(datasetName(cv.dataset.still));
      }
    }
    const key = active.join(',') + '|' + preload.join(',');
    if (key !== demandKey) { demandKey = key; loader.setDemand(active, preload); }
    // Only request close-up tiles while the road chapter is approaching or on
    // screen; small quarter windows and the app overview need the base tiles.
    if (road.ready && mode === 'stage' && !reduced && S.zoom > 0.1 && S.sweep < 0.9995) {
      if (road.sets.z6) requestTiles(road.sets.z6);
      if (road.sets.z4) requestTiles(road.sets.z4);
    }
    return demand;
  }
  function loadingText(names) {
    return names.some(name => loader.state(name) === 'error')
      ? 'This scene could not load. Refresh the page to try again.'
      : 'Loading ' + names.map(name => LABELS[datasetName(name)]).join(' and ') + '… You can keep scrolling.';
  }
  function showLoading(names) {
    const text = names.length ? loadingText(names) : '';
    if (loadingNote.textContent !== text) loadingNote.textContent = text;
    loadingNote.hidden = !text;
  }
  function waitTiles(set, timeout = 8000) {
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = () => { pumpUploads(renderer, 64); const u = set.userData; if (u.loaded + u.tiles.filter((t) => t.state < 0).length >= u.tiles.length || performance.now() - t0 > timeout) res(); else setTimeout(tick, 60); };
      tick();
    });
  }

  // ================= STATEMENT: six assets as tiny drifting silhouettes (2D canvas, cheap) =================
  let silhouetteVisible = false, silhouetteStarted = false, silhouetteQueued = false;
  let refreshSilhouettes = () => {};
  function queueSilhouettes() {
    if (!silhouetteVisible || document.hidden || silhouetteQueued || !D) return;
    silhouetteQueued = true;
    const build = () => {
      silhouetteQueued = false;
      if (!silhouetteVisible || document.hidden) return;
      if (silhouetteStarted) refreshSilhouettes();
      else { silhouetteStarted = true; buildSilhouettes(); }
    };
    if (window.requestIdleCallback) requestIdleCallback(build, { timeout: 1200 }); else setTimeout(build, 100);
  }
  const silCanvas = document.getElementById('silCanvas');
  if (silCanvas) {
    const statementObserver = new IntersectionObserver(entries => {
      silhouetteVisible = entries[0].isIntersecting;
      if (silhouetteVisible) queueSilhouettes();
    });
    statementObserver.observe(silCanvas);
  }
  async function buildSilhouettes() {
    const cv = document.getElementById('silCanvas');
    if (!cv || !D) return;
    const names = ['road', 'plant', 'tank', 'flare', 'facade', 'stockpile'];
    const sets = names.map(() => null);
    let sampling = false, sampleAgain = false;
    refreshSilhouettes = async () => {
      if (sampling) { sampleAgain = true; return; }
      sampling = true;
      for (const [index, n] of names.entries()) {
        if (!silhouetteVisible || document.hidden) break;
        // samplePoints() can fetch its source. A jump to the statement must never
        // use these decorative silhouettes as a back door into all six datasets.
        if (sets[index] || !ready(n)) continue;
        try {
          const s = await D.samplePoints(n, Q.sil, 1);
          const col = new Uint8Array(Q.sil * 3);
          for (let i = 0; i < Q.sil; i++) {
            const r = Math.pow(Math.min(1, s.colors[i * 3]), 1 / 2.2), g = Math.pow(Math.min(1, s.colors[i * 3 + 1]), 1 / 2.2), b = Math.pow(Math.min(1, s.colors[i * 3 + 2]), 1 / 2.2), l = 0.3 * r + 0.59 * g + 0.11 * b;
            // muted: half-way to grey so no asset shouts
            col[i * 3] = Math.round(255 * (0.3 * r + 0.7 * l)); col[i * 3 + 1] = Math.round(255 * (0.3 * g + 0.7 * l)); col[i * 3 + 2] = Math.round(255 * Math.min(1, 0.3 * b + 0.7 * l + 0.03));
          }
          sets[index] = { n, p: s.positions, c: col };
        } catch (e) { /* A decorative silhouette must not block the story. */ }
        await new Promise((r) => setTimeout(r, 16));
      }
      sampling = false;
      if (on && !document.hidden && !rafS) rafS = requestAnimationFrame(draw);
      if (sampleAgain) { sampleAgain = false; queueSilhouettes(); }
    };
    const ctx = cv.getContext('2d');
    let on = false, rafS = 0;
    const ioS = new IntersectionObserver((es) => { on = es[0].isIntersecting; if (on && !document.hidden && !rafS) rafS = requestAnimationFrame(draw); });
    ioS.observe(cv);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && on) { queueSilhouettes(); if (!rafS) rafS = requestAnimationFrame(draw); } });
    const tilt = [0.95, 0.75, 0.32, 0.28, 0.3, 0.75];
    const SIL_LABELS = ['ROAD', 'TERMINAL', 'TANK', 'FLARE', 'FACADE', 'STOCKPILE'];
    let lastSilFrame = 0;
    function draw(now) {
      rafS = on && !reduced && !document.hidden ? requestAnimationFrame(draw) : 0;
      if (document.hidden || (MOBILE && now - lastSilFrame < 1000 / 30 - 1)) return;
      lastSilFrame = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = (reduced ? 4 : now / 1000), k = S.st || 0;
      const cols = w < 600 ? 3 : 6, rows = Math.ceil(sets.length / cols), cw = w / cols, rh = h / rows, R = Math.min(cw * 0.36, rh * 0.3);
      ctx.font = '500 ' + (w < 600 ? 8.5 : 10) + 'px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      sets.forEach((s, j) => {
        if (!s) return;
        const col = j % cols, row = Math.floor(j / cols);
        const cx = cw * (col + 0.5), cy = rh * row + rh * 0.48, a = t * 0.12 + j * 1.3, ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(tilt[j]), st = Math.sin(tilt[j]);
        ctx.fillStyle = 'rgba(142,153,166,' + (0.4 + 0.3 * clamp01(k * 1.4 - j * 0.12)).toFixed(3) + ')';
        ctx.fillText(SIL_LABELS[j], cx, rh * row + rh * 0.95);
        const lit = 0.32 + 0.5 * clamp01(k * 1.4 - j * 0.12);
        for (let i = 0; i < s.p.length / 3; i++) {
          const x = s.p[i * 3], y = s.p[i * 3 + 1], z = s.p[i * 3 + 2];
          const xr = x * ca - z * sa, zr = x * sa + z * ca;
          const yy = y * ct - zr * st;
          const dz = zr * ct + y * st;
          const drift = Math.sin(t * 0.6 + i * 0.37) * 0.012;
          const px = cx + (xr + drift) * R, py = cy - (yy - 0.5 + drift) * R;
          const f = lit * (0.55 + 0.45 * clamp01(0.5 - dz * 0.5));
          ctx.fillStyle = 'rgba(' + s.c[i * 3] + ',' + s.c[i * 3 + 1] + ',' + s.c[i * 3 + 2] + ',' + f.toFixed(3) + ')';
          ctx.fillRect(px, py, 1.15, 1.15);
        }
      });
    }
    await refreshSilhouettes();
    if (!rafS) rafS = requestAnimationFrame(draw);
  }

  // ================= STILLS (reduced motion) =================
  const stillDone = new Set();
  const nearStills = new Set();
  const stillNotes = new Map();
  function renderStills() {
    const prevHost = host;
    const previousAsset = lastVisibleAsset;
    const previousSize = { w: W, h: H };
    pumpUploads(renderer, 512);
    nearStills.forEach((cv) => {
      const kind = cv.dataset.still;
      if (stillDone.has(cv)) return;
      const need = kind === 'stock' ? 'stock' : kind;
      if (!canCaptureStill(need, ready(need), road.sets.z2?.userData)) {
        let note = stillNotes.get(cv);
        if (!note) {
          note = document.createElement('span'); note.setAttribute('role', 'status');
          note.style.cssText = 'position:absolute;inset:auto 18px 18px;color:#E9EDF0;font:500 12px/1.5 sans-serif';
          cv.parentElement.style.position = 'relative'; cv.parentElement.appendChild(note); stillNotes.set(cv, note);
        }
        note.textContent = loadingText([need]);
        return;
      }
      stillNotes.get(cv)?.remove(); stillNotes.delete(cv);
      const r = cv.getBoundingClientRect();
      const w = Math.max(200, Math.round(r.width || 640)), h = Math.max(120, Math.round(r.height || 400));
      renderer.setSize(w, h, false); W = w; H = h; renderer.getDrawingBufferSize(dbs);
      const aspect = w / h, o = { noOffset: true, still: true };
      if (kind === 'road') { setRoadCam(camA, 0.3, 0, aspect); roadState(9, 1, -9, roadAlt, dbs.y / h); drawScene('road', camA, null, o); }
      else if (kind === 'plant') { setPlantCam(camA, 0.6, 0, aspect, false); drawScene('plant', camA, null, o); }
      else if (kind === 'tank') { setTankCam(camA, 0.55, 0, aspect, false); drawScene('tank', camA, null, o); }
      else if (kind === 'flare') { setFlareCam(camA, 0.8, 0, aspect, false); flareState(1, 1, 0); drawScene('flare', camA, null, o); }
      else if (kind === 'facade') { setFacadeCam(camA, 0.85, 0, aspect, false); facadeState(9, 0.3); drawScene('facade', camA, null, o); }
      else if (kind === 'stock') {
        setStockCam(camA, 0.5, 0, aspect, false); camB.copy(camA);
        rtA.setSize(dbs.x, dbs.y); rtB.setSize(dbs.x, dbs.y); compMat.uniforms.uRes.value.set(w, h);
        composite('stock2', camA, 'stock1', camB, 3, 0.5, o);
      }
      cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
      cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height);
      cv.classList.add('is-ready');
      stillDone.add(cv);
    });
    lastVisibleAsset = previousAsset;
    // Snapshot rendering temporarily borrows the renderer, never its live host.
    // Restore the real host size/targets so the app and CTA remain intact.
    if (prevHost) resize();
    else {
      W = previousSize.w; H = previousSize.h; renderer.setSize(W, H, false);
      renderer.getDrawingBufferSize(dbs);
      rtA.setSize(Math.round(dbs.x * Q.rt), Math.round(dbs.y * Q.rt));
      rtB.setSize(Math.round(dbs.x * Q.rt), Math.round(dbs.y * Q.rt));
    }
  }

  if (reduced) {
    const stillObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) nearStills.add(entry.target); else nearStills.delete(entry.target); });
      updateDemand(); renderStills();
    }, { rootMargin: '300px 0px' });
    document.querySelectorAll('canvas[data-still]').forEach(cv => stillObserver.observe(cv));
  }
  window.__d3 = {
    S, ready: () => ({ road: road.ready, plant: plant.ready, tank: tank.ready, flare: flare.ready, facade: facade.ready, stock: stock.ready }),
    tiles: () => Object.fromEntries(Object.entries(road.sets).map(([k, s]) => [k, s.userData.loaded + '/' + s.userData.tiles.length])),
    mode: () => mode, dpr: () => DPR,
    loading: () => Object.fromEntries([...steps.keys()].map(name => [name, loader.state(name)])),
    workflows: () => Object.fromEntries(Object.keys(WORKFLOWS).map(name => [name, workflow(name)])),
    workflowView: () => ({
      plant: { points: plant.pts?.visible, model: plant.model?.visible, elevation: plant.pts?.material.uniforms.uElevOn.value },
      tank: { points: tank.pts?.visible, model: tank.model?.visible, markers: tank.markers?.visible, flightSamples: tank.flight?.samples.length || 0 },
      flare: { points: flare.pts?.visible, model: flare.model?.visible, focus: Object.keys(flare.focus || {}) },
      facade: { reveal: facade.mat?.uniforms.uReveal.value, evidence: facade.evidenceIndices },
      stock: { selected: stock.selected, piles: Object.keys(stock.piles).length, outlines: stock.outlines.length, dsm: stock.surfaces[0]?.mesh.material === stock.dsm },
      camera: { position: camA.position.toArray(), fov: camA.fov },
    }),
    info: () => ({ ms: lastMs, dpr: DPR, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pts: renderer.info.render.points, programs: renderer.info.programs.length })
  };
}

try { boot(); } catch (err) {
  console.error('[Quadrion] WebGL scene failed, showing SVG fallback.', err);
  html.classList.add('no-webgl');
}
