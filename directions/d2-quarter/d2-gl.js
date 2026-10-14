// Direction D2 · The Quarter: WebGL director.
// One renderer, moved between three hosts (cinema stage, app window, CTA).
// Reads scroll state from window.QS (written by the GSAP timeline) every frame.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const html = document.documentElement;
const S = window.QS;
const layoutFn = window.QLayout;
const reduced = html.classList.contains('reduced') || !html.classList.contains('motion');
const MOBILE = innerWidth < 761 || matchMedia('(pointer: coarse)').matches;
const Q = MOBILE
  ? { dpr: 1.25, plantStride: 6, tankStride: 4, flareN: 40000, bgN: 7000, win: 320, rt: 0.8 }
  : { dpr: 2, plantStride: 1, tankStride: 1, flareN: 110000, bgN: 22000, win: 560, rt: 1 };

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

// ---------- Shaders ----------
const POINT_MATS = [];
function pointsMat(o = {}) {
  const m = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: true, toneMapped: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uSize: { value: o.size || 1 }, uScale: { value: 500 }, uMin: { value: o.minPx ?? 1 }, uMax: { value: o.maxPx || 6 },
      uPx: { value: o.px || 0 }, uOpacity: { value: o.opacity ?? 1 }, uBright: { value: o.bright ?? 1 },
      uFog: { value: new THREE.Vector2(o.fogNear ?? 1e8, o.fogFar ?? 2e8) },
      uScan: { value: -1e9 }, uScanOn: { value: o.scan ? 1 : 0 }, uClip: { value: o.clip || new THREE.Vector4(0, 0, 0, 1) }, uClipOn: { value: o.clip ? 1 : 0 }, uMint: { value: MINT.clone() }, uSoft: { value: o.soft ? 1 : 0 }
    },
    vertexShader: /* glsl */`
      uniform float uSize, uScale, uMin, uMax, uPx, uScan, uScanOn, uBright;
      uniform vec2 uFog; uniform vec4 uClip;
      varying vec3 vC; varying float vA; varying float vEdge; varying float vClip;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float s = uPx > 0.0 ? uPx : uSize * uScale / max(d, 0.001);
        gl_PointSize = clamp(s, uMin, uMax);
        vC = color * uBright;
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
      uniform float uOpacity, uSoft, uClipOn; uniform vec3 uMint;
      varying vec3 vC; varying float vA; varying float vEdge; varying float vClip;
      void main() {
        if (uClipOn > 0.5 && vClip < 0.0) discard;
        vec2 c = gl_PointCoord - 0.5;
        float r = dot(c, c);
        if (r > 0.25) discard;
        float a = uSoft > 0.5 ? pow(1.0 - sqrt(r) * 2.0, 1.6) : 1.0;
        vec3 col = mix(vC, uMint * 1.5, vEdge);
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
    // soft inner shade so the window reads as recessed
    vec2 q = abs(vUv - 0.5) * 2.0;
    col *= mix(1.0, 0.82, smoothstep(0.75, 1.0, max(q.x, q.y)) * (1.0 - uScreen));
    gl_FragColor = vec4(col, uReveal);
    #include <colorspace_fragment>
  }`;

const compFS = /* glsl */`
  uniform sampler2D tA, tB; uniform int uMode; uniform float uP; uniform vec2 uRes; uniform vec3 uMint;
  varying vec2 vUv;
  float sdQ(vec2 p, vec2 c, vec2 sg, float rin, float rout) {
    vec2 q = p - c; float r = length(q);
    return max(max(rin - r, r - rout), max(-q.x * sg.x, -q.y * sg.y));
  }
  float sdBox(vec2 p, vec2 b0, vec2 b1) {
    vec2 c = (b0 + b1) * 0.5, h = (b1 - b0) * 0.5, d = abs(p - c) - h;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  void main() {
    vec2 uv = vUv; vec3 col;
    float t = uP;
    if (uMode == 1) {
      // Iris: the Quadrion mark opens from the centre and becomes the frame.
      vec2 px = (uv - 0.5) * uRes;
      float ang = (1.0 - t) * -1.1;
      mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
      float cover = length(uRes) * 0.5 / 23.0 * 1.1;
      float s = max(cover * pow(t, 2.3), 1e-4);
      vec2 p = R * px / s;
      float g = 2.0 * (1.0 - smoothstep(0.25, 0.85, t));
      float rin = 10.5 * (1.0 - smoothstep(0.2, 0.85, t));
      float d = sdQ(p, vec2(-g, g), vec2(-1.0, 1.0), rin, 23.0);
      d = min(d, sdQ(p, vec2(g, g), vec2(1.0, 1.0), rin, 23.0));
      d = min(d, sdQ(p, vec2(-g, -g), vec2(-1.0, -1.0), rin, 23.0));
      float so = 6.0 * (1.0 - smoothstep(0.3, 0.9, t));
      float dsq = sdBox(p, vec2(so, -27.0), vec2(27.0, -so));
      d = min(d, dsq);
      float dpx = d * s;
      float m = 1.0 - smoothstep(-0.8, 0.8, dpx);
      vec3 a = texture2D(tA, uv).rgb * (1.0 - 0.45 * smoothstep(0.0, 0.6, t));
      vec3 b = texture2D(tB, uv).rgb;
      col = mix(a, b, m);
      float edge = (1.0 - smoothstep(0.0, 1.4, abs(dpx))) * (1.0 - smoothstep(0.8, 1.0, t));
      col = mix(col, uMint, edge * 0.85);
    } else if (uMode == 2) {
      // Vertical rise: the next shot lifts the current one out of frame.
      if (uv.y < t) col = texture2D(tB, vec2(uv.x, uv.y + 1.0 - t)).rgb;
      else col = texture2D(tA, vec2(uv.x, uv.y - t)).rgb * (1.0 - 0.55 * t);
      float e = 1.0 - smoothstep(0.0, 1.5, abs(uv.y - t) * uRes.y);
      col = mix(col, uMint, e * 0.9 * step(0.002, t) * step(t, 0.998));
    } else {
      // Divider: left = A, right = B.
      col = uv.x < t ? texture2D(tA, uv).rgb : texture2D(tB, uv).rgb;
      float e = 1.0 - smoothstep(0.0, 1.2, abs(uv.x - t) * uRes.x);
      col = mix(col, uMint, e * step(0.001, t) * step(t, 0.999));
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
  const DPR = Math.min(window.devicePixelRatio || 1, Q.dpr);
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
  markScene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
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
    // Window pane: the front cap triangles, lifted a hair, with a planar UV.
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

  // Deep background: the real plant cloud, sampled sparse
  const bgMat = pointsMat({ px: MOBILE ? 1.3 : 1.6, minPx: 1, maxPx: 3, opacity: 0, bright: 0.5, soft: false });
  bgMat.depthWrite = false;
  const bgPts = new THREE.Points(new THREE.BufferGeometry(), bgMat);
  bgPts.renderOrder = -5; bgPts.visible = false; bgPts.frustumCulled = false;
  const bgRig = new THREE.Group(); bgRig.add(bgPts); markScene.add(bgRig);

  // ================= DATA SCENES =================
  const mk = () => { const s = new THREE.Scene(); return s; };
  const plant = { scene: mk(), ready: false, center: V(), size: V() };
  const tank = { scene: mk(), ready: false, findings: [] };
  const flare = { scene: mk(), ready: false, patches: [], order: [], axis: V(), M: new THREE.Matrix4() };
  const stock = { scene: mk(), ready: false, e1: null, e2: null, piles: {} };
  const scanPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

  const camA = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  const camB = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  const camApp = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  const winCams = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(36, 1, 0.1, 10000));

  // --- camera paths (p = 0..1 across each shot) ---
  function setPlantCam(cam, p, t = 0, aspect = 1) {
    const c = plant.center, L = Math.max(plant.size.x, plant.size.z, 200);
    const e = sine(p);
    const az = lerp(-1.95, -1.3, e) + t;
    const el = lerp(1.18, 0.5, e);
    const dist = lerp(0.62, 0.36, e) * L * (aspect < 1 ? 1.5 : 1);
    cam.fov = 40;
    cam.position.set(c.x + Math.cos(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.sin(az) * Math.cos(el) * dist);
    cam.near = dist * 0.02; cam.far = dist * 8;
    cam.lookAt(c.x + lerp(0, 0.06, e) * L, c.y, c.z);
  }
  const tankClip = new THREE.Vector4(1, 0, 0, 0.35);
  function setTankCam(cam, p, up = 0, aspect = 1) {
    const e = sine(p);
    cam.fov = 40;
    const az = Math.PI + lerp(-0.55, 0.3, e);
    const r = lerp(16.5, 14, e) * (aspect < 1 ? 1.6 : 1);
    cam.position.set(Math.cos(az) * r, lerp(13.2, 10.6, e) + up * 16, Math.sin(az) * r);
    cam.near = 0.1; cam.far = 120;
    cam.lookAt(0.5, lerp(3.9, 4.4, e) + up * 22, 0);
  }
  function sectionTank(cam) {
    // Slice: keep the half of the scan beyond the tank axis, so the camera looks into the interior.
    const x = cam.position.x, z = cam.position.z, l = Math.hypot(x, z) || 1;
    tankClip.set(-x / l, 0, -z / l, 0.35);
    // depth shading: the far wall falls back, the cut edges come forward, so the cylinder reads
    if (tank.mat) tank.mat.uniforms.uFog.value.set(l - 1, l + 10);
  }
  function setFlareCam(cam, p, t = 0, aspect = 1) {
    const e = sine(p);
    const a = flare.axis;
    const r = (aspect < 1 ? 15 : 10.5) - e * 1.2;
    const az = lerp(0.35, 1.25, e) + t;
    cam.fov = 44;
    cam.position.set(a.x + Math.cos(az) * r, lerp(1.2, 15.2, e), a.z + Math.sin(az) * r);
    cam.near = 0.1; cam.far = 200;
    cam.lookAt(a.x, lerp(6.5, 17.2, e), a.z);
  }
  function setStockCam(cam, p, t = 0, aspect = 1) {
    const e = sine(p);
    const c = stock.center || V();
    const az = lerp(0.95, 1.45, e) + t;
    const el = lerp(0.95, 0.72, e);
    const dist = lerp(345, 285, e) * (aspect < 1 ? 1.5 : 1);
    cam.fov = 38;
    cam.position.set(c.x + Math.cos(az) * Math.cos(el) * dist, c.y + Math.sin(el) * dist, c.z + Math.sin(az) * Math.cos(el) * dist);
    cam.near = 2; cam.far = 3000;
    cam.lookAt(c.x, c.y, c.z);
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

  // ================= RENDER TARGETS & COMPOSITE =================
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true };
  const rtA = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const winRT = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(Q.win, Q.win, rtOpts));
  pieces.forEach((pc, i) => { pc.pane.material.uniforms.tMap.value = winRT[i].texture; });
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
  function attach(h) {
    if (host === h) return;
    host = h; h.appendChild(canvas);
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
        cx = right ? c.box.l : c.box.l + c.box.w; cy = c.box.t + 22;
      }
      if (c.path) {
        const mx = cx + (cx > x ? -28 : 28);
        c.path.setAttribute('d', vis ? 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'L' + mx.toFixed(1) + ' ' + cy.toFixed(1) + 'L' + cx.toFixed(1) + ' ' + cy.toFixed(1) : 'M0 0');
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
    if (m === 'stage') { attach(hostStage); if (prev === 'cta') asmT0 = -100; }
    if (m === 'app') attach(hostApp);
    if (m === 'cta') { attach(hostCta); asmT0 = performance.now() / 1000 + 0.1; }
    if (m === 'none') stop(); else start();
  }, { threshold: 0, rootMargin: '120px 0px' });
  io.observe(hostStage);
  if (hostApp) io.observe(hostApp);
  if (hostCta) io.observe(hostCta);

  // Pointer spring
  const ptr = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0, vx: 0, vy: 0 };
  addEventListener('pointermove', (e) => { ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });

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
      // windows face the viewer with a slow drift
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
      // pane state
      const u = p.pane.material.uniforms;
      const ready = [plant, tank, flare, stock][i].ready;
      const winK = mode === 'cta' ? 0 : (i === 3 ? S.win : S.winq);
      u.uHasMap.value = ready ? 1 : 0;
      u.uReveal.value = Math.max(winK * (ready ? 1 : 0.0), i === 3 ? smooth(0, 0.25, zoom) * (plant.ready ? 1 : 0) : 0);
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

    // background cloud
    if (bgPts.visible) {
      const k2 = mode === 'cta' ? 0 : 1;
      bgMat.uniforms.uOpacity.value = Math.min(1, (t - bgT0) / 2.5) * k2 * (0.72 - 0.4 * sep) * (1 - smooth(0, 0.6, zoom));
      bgRig.position.set(-tilt.y * 1.6, -heroK * 3.2 + sep * 1.5 + tilt.x * 1.2, -42 + heroK * 6);
      bgPts.rotation.y = (reduced ? 0.6 : t * 0.018) + heroK * 0.35;
    }
  }

  // ================= WINDOWS =================
  function renderWindows(t) {
    const sz = Q.win;
    setPointScale(sz, 36);
    renderer.setClearColor(BG, 1);
    if (plant.ready) {
      const c = winCams[0]; setPlantCam(c, 0.55, t * 0.03); c.fov = 36; c.aspect = 1; c.updateProjectionMatrix();
      renderer.setRenderTarget(winRT[0]); renderer.render(plant.scene, c);
    }
    if (tank.ready) {
      const c = winCams[1]; const a = t * 0.18;
      c.fov = 36; c.aspect = 1; c.near = 0.1; c.far = 100;
      c.position.set(Math.cos(a) * 15, 9, Math.sin(a) * 15); c.lookAt(0, 4.2, 0); c.updateProjectionMatrix();
      setPointScale(sz, 36); sectionTank(c);
      renderer.setRenderTarget(winRT[1]); renderer.render(tank.scene, c);
    }
    if (flare.ready) {
      const c = winCams[2]; const a = t * 0.12 + 0.6, ax = flare.axis;
      c.fov = 36; c.aspect = 1; c.near = 0.1; c.far = 200;
      c.position.set(ax.x + Math.cos(a) * 9, 12.5, ax.z + Math.sin(a) * 9); c.lookAt(ax.x, 16.2, ax.z); c.updateProjectionMatrix();
      flareState(1, 1, t);
      renderer.setRenderTarget(winRT[2]); renderer.render(flare.scene, c);
    }
    if (stock.ready) {
      const c = winCams[3]; setStockCam(c, 0.3, t * 0.04); c.aspect = 1; c.updateProjectionMatrix();
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
    renderer.setRenderTarget(null);
  }

  // ================= RENDER HELPERS =================
  function rtHeight(target) { return target ? target.height : dbs.y; }
  function drawScene(name, cam, target, tt) {
    const h = rtHeight(target);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    setPointScale(h, cam.fov);
    renderer.setRenderTarget(target || null);
    renderer.setClearColor(BG, 1);
    if (name === 'stock1' || name === 'stock2') {
      stock.e1.visible = name === 'stock1'; stock.e2.visible = name === 'stock2';
      renderer.render(stock.scene, cam);
    } else if (name === 'flare') renderer.render(flare.scene, cam);
    else { if (name === 'tank') sectionTank(cam); renderer.render({ plant: plant.scene, tank: tank.scene }[name], cam); }
  }
  function composite(nameA, camA_, nameB, camB_, modeId, p) {
    drawScene(nameA, camA_, rtA);
    drawScene(nameB, camB_, rtB);
    compMat.uniforms.tA.value = rtA.texture; compMat.uniforms.tB.value = rtB.texture;
    compMat.uniforms.uMode.value = modeId; compMat.uniforms.uP.value = p;
    renderer.setRenderTarget(null);
    renderer.render(compScene, compCam);
  }
  const ready = (n) => (n === 'plant' ? plant.ready : n === 'tank' ? tank.ready : n === 'flare' ? flare.ready : stock.ready);

  // ================= HUD =================
  const hudCam = document.getElementById('hudCam');
  const divEl = document.querySelector('.divider');
  let hudN = 0;
  function hud(cam, scale = 1) {
    if (!hudCam || (hudN++ % 5)) return;
    const p = cam.position;
    const f = (v) => (v < 0 ? '−' : '+') + Math.abs(v * scale).toFixed(1);
    hudCam.textContent = 'CAM  X ' + f(p.x) + '   Y ' + f(-p.z) + '   Z ' + f(p.y) + ' m';
  }
  function setDivider(d, on) {
    if (!divEl) return;
    divEl.style.transform = 'translate3d(' + (d * W).toFixed(1) + 'px,0,0)';
    divEl.style.visibility = on ? 'visible' : 'hidden';
  }

  // ================= STAGE FRAME =================
  let bgT0 = 0;
  function stageFrame(t, dt) {
    const aspect = W / H;
    if (S.zoom < 0.999) {
      setDivider(0, false);
      updateMark(t, dt);
      if ((S.win > 0.001 || S.winq > 0.001) && S.zoom < 0.3) renderWindows(t);
      if (S.zoom > 0.001 && plant.ready) {
        setPlantCam(camA, 0, 0, aspect);
        drawScene('plant', camA, rtA);
        pieces[3].pane.material.uniforms.tScreen.value = rtA.texture;
      }
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.render(markScene, camera);
      return;
    }
    // ---- the tour ----
    const pl = S.plant, ir = S.iris, tk = S.tank, ri = S.rise, fl = S.flare, w1 = S.wipe1, w2 = S.wipe2, st = S.stock;
    const fS = () => flareState(S.scan, S.ignite, t);
    if (ir <= 0.0005) {
      setDivider(0, false);
      if (!plant.ready) return clearBg();
      setPlantCam(camA, pl, 0, aspect); drawScene('plant', camA, null); hud(camA);
    } else if (ir < 0.9995) {
      setDivider(0, false);
      if (!plant.ready || !tank.ready) return clearBg();
      setPlantCam(camA, pl, 0, aspect); setTankCam(camB, tk, 0, aspect);
      composite('plant', camA, 'tank', camB, 1, ir); hud(camB);
    } else if (ri <= 0.0005) {
      setDivider(0, false);
      if (!tank.ready) return clearBg();
      setTankCam(camA, tk, 0, aspect); drawScene('tank', camA, null); placeCallouts('tank', camA); hud(camA);
    } else if (ri < 0.9995) {
      setDivider(0, false);
      if (!tank.ready || !flare.ready) return clearBg();
      setTankCam(camA, tk, sine(ri), aspect); setFlareCam(camB, fl, 0, aspect); fS();
      composite('tank', camA, 'flare', camB, 2, sine(ri)); hud(camB);
    } else if (w1 <= 0.0005) {
      setDivider(0, false);
      if (!flare.ready) return clearBg();
      setFlareCam(camA, fl, 0, aspect); fS(); drawScene('flare', camA, null); placeCallouts('flare', camA); hud(camA, 4);
    } else if (w1 < 0.9995) {
      if (!flare.ready || !stock.ready) return clearBg();
      const d = 1 - w1;
      setFlareCam(camA, fl, 0, aspect); fS(); setStockCam(camB, st, 0, aspect);
      composite('flare', camA, 'stock1', camB, 3, d); setDivider(d, true); hud(camB);
    } else {
      if (!stock.ready) return clearBg();
      setStockCam(camA, st, 0, aspect);
      if (w2 <= 0.0005) { drawScene('stock1', camA, null); setDivider(0, false); }
      else if (w2 >= 0.9995) { drawScene('stock2', camA, null); setDivider(1, false); }
      else { camB.copy(camA); composite('stock2', camA, 'stock1', camB, 3, w2); setDivider(w2, true); }
      placeCallouts('stock', camA, { div: w2 }); hud(camA);
    }
  }
  function clearBg() { renderer.setRenderTarget(null); renderer.setClearColor(BG, 1); renderer.clear(); }

  // ================= APP FRAME =================
  let appDs = 'flare', appT0 = 0;
  window.addEventListener('d2:dataset', (e) => { appDs = e.detail; appT0 = performance.now() / 1000; if (reduced && mode === 'app') renderOnce(); });
  function appFrame(t) {
    const aspect = W / H, k = reduced ? 0 : t * 0.05;
    tilt.x += (ptr.y * 0.15 - tilt.x) * 0.05; tilt.y += (ptr.x * 0.2 - tilt.y) * 0.05;
    if (!ready(appDs)) return clearBg();
    if (appDs === 'plant') { setPlantCam(camApp, 0.7, k + tilt.y * 0.4, aspect); drawScene('plant', camApp, null); }
    else if (appDs === 'tank') {
      const a = k * 3 + 0.4 + tilt.y; camApp.fov = 34; camApp.near = 0.1; camApp.far = 100;
      camApp.position.set(Math.cos(a) * 15, 8 + tilt.x * 3, Math.sin(a) * 15); camApp.lookAt(0, 4.4, 0);
      drawScene('tank', camApp, null);
    } else if (appDs === 'flare') {
      const ax = flare.axis, a = k * 2 + 0.8 + tilt.y;
      camApp.fov = 40; camApp.near = 0.1; camApp.far = 300;
      camApp.position.set(ax.x + Math.cos(a) * 11, 14.5 + tilt.x * 3, ax.z + Math.sin(a) * 11); camApp.lookAt(ax.x, 15.8, ax.z);
      flareState(1, 1, t); drawScene('flare', camApp, null);
    } else { setStockCam(camApp, 0.55, k + tilt.y * 0.4, aspect); drawScene('stock2', camApp, null); }
  }

  // ================= LOOP =================
  let last = performance.now() / 1000, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const t = now / 1000, dt = Math.min(0.05, Math.max(0.001, t - last)); last = t;
    render(t, dt);
  }
  let lastMs = 0;
  function render(t, dt) {
    const t0 = performance.now();
    renderTimed(t, dt);
    lastMs = lastMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  function renderTimed(t, dt) {
    if (mode === 'stage') stageFrame(t, dt);
    else if (mode === 'app') appFrame(t);
    else if (mode === 'cta') { updateMark(t, dt); renderer.setRenderTarget(null); renderer.setClearColor(0, 0); renderer.render(markScene, camera); }
  }
  function renderOnce() { render(performance.now() / 1000, 0.016); }
  function start() { if (reduced) { renderOnce(); return; } if (!raf) { last = performance.now() / 1000; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  window.__qglReady = true;
  html.classList.add('gl-ready');

  // ================= DATA =================
  const status = (n, s) => { document.querySelectorAll('[data-status="' + n + '"]').forEach((el) => el.setAttribute('data-state', s)); window.dispatchEvent(new CustomEvent('d2:asset', { detail: { name: n, state: s } })); };
  const toBasic = (root, extra = {}) => root.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    o.material = new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : (m.color || 0xcccccc), side: THREE.DoubleSide, toneMapped: false, ...extra });
  });

  async function loadAll() {
    let D;
    try { D = await import('../data/quadrion-data.js'); } catch (e) { console.warn('[D2] data module unavailable', e); return; }
    if (D.ASSETS) window.dispatchEvent(new CustomEvent('d2:assets', { detail: D.ASSETS }));
    const steps = [
      ['plant', async () => {
        const a = await D.loadPlant();
        const geo = decimate(a.cloud.geometry, Q.plantStride);
        const pts = new THREE.Points(geo, pointsMat({ size: 2.4, minPx: 1, maxPx: MOBILE ? 3 : 4.5 }));
        pts.frustumCulled = false;
        plant.scene.add(pts);
        // frame the engineering model (skip sea / land planes)
        const box = new THREE.Box3(), sz = V();
        a.model.updateMatrixWorld(true);
        a.model.traverse((o) => {
          if (!o.isMesh) return;
          const b = new THREE.Box3().setFromObject(o); b.getSize(sz);
          if (sz.length() > 1500 || (sz.y < 0.5 && Math.max(sz.x, sz.z) > 800)) return;
          box.union(b);
        });
        box.getCenter(plant.center); box.getSize(plant.size);
        // ground level from the cloud (robust low percentile)
        const ys = []; const p = a.cloud.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 97) ys.push(p.getY(i));
        ys.sort((x, y) => x - y);
        const ground = ys[Math.floor(ys.length * 0.08)];
        plant.center.y = ground + 4;
        const ortho = a.ortho.clone();
        ortho.material = new THREE.MeshBasicMaterial({ map: a.ortho.material.map, color: 0x9a9a9a, toneMapped: false, side: THREE.DoubleSide, depthWrite: true });
        ortho.position.y = ground - a.ortho.geometry.attributes.position.getY(0) - 0.6;
        plant.scene.add(ortho);
        // hero background: sparse real points
        const s = await D.samplePoints('plant', Q.bgN, 10);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(s.colors, 3));
        bgPts.geometry = g; bgPts.scale.setScalar(2.4); bgPts.rotation.x = 0; bgPts.position.y = -4;
        bgRig.rotation.x = 0.62;
        bgPts.visible = true; bgT0 = performance.now() / 1000;
        plant.ready = true;
      }],
      ['tank', async () => {
        const a = await D.loadTank();
        const tg = decimate(a.cloud.geometry, Q.tankStride);
        // LiDAR intensity on a slate-to-white ramp, so weld seams and plate edges read
        const it = tg.attributes.intensity, tc = new Float32Array(it.count * 3);
        for (let i = 0; i < it.count; i++) { const v = Math.pow(it.getX(i), 0.85); tc[i * 3] = 0.07 + 0.88 * v; tc[i * 3 + 1] = 0.09 + 0.89 * v; tc[i * 3 + 2] = 0.11 + 0.9 * v; }
        tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
        const pts = new THREE.Points(tg, tank.mat = pointsMat({ size: 0.022 * Math.sqrt(Q.tankStride), minPx: 1, maxPx: MOBILE ? 2.5 : 3, bright: 1.15, clip: tankClip }));
        pts.frustumCulled = false;
        tank.scene.add(pts);
        tank.findings = a.findings;
        a.findings.forEach((f) => callouts.forEach((c) => { if (c.scene === 'tank' && c.id === f.id) c.pos = f.position.clone(); }));
        tank.ready = true;
      }],
      ['stockpile', async () => {
        const a = await D.loadStockpile();
        toBasic(a.e1); toBasic(a.e2);
        [a.e1, a.e2].forEach((r) => r.traverse((o) => { if (o.isLine || o.isLineSegments) { o.material = new THREE.LineBasicMaterial({ color: 0xffc400, toneMapped: false, transparent: true, opacity: 0.9 }); } }));
        stock.scene.add(a.e1, a.e2);
        stock.e1 = a.e1; stock.e2 = a.e2;
        const box = new THREE.Box3().setFromObject(a.e2);
        stock.center = V();
        // centre on the piles
        let sx = 0, sz2 = 0, n = 0;
        a.volumes.piles.forEach((p) => p.epochs.e2.ring.forEach(([x, z]) => { sx += x; sz2 += z; n++; }));
        stock.center.set(sx / n, (box.min.y + box.max.y) * 0.4, sz2 / n);
        // pile anchors: ring centroid, height from a ray onto the terrain
        let terrain = null; a.e2.traverse((o) => { if (o.isMesh && /terrain/i.test(o.name)) terrain = o; });
        const rc = new THREE.Raycaster();
        a.volumes.piles.forEach((p) => {
          const r = p.epochs.e2.ring; let cx = 0, cz = 0; r.forEach(([x, z]) => { cx += x; cz += z; }); cx /= r.length; cz /= r.length;
          let y = box.max.y;
          if (terrain) { rc.set(new THREE.Vector3(cx, box.max.y + 50, cz), new THREE.Vector3(0, -1, 0)); const hit = rc.intersectObject(terrain, false)[0]; if (hit) y = hit.point.y; }
          callouts.forEach((c) => { if (c.scene === 'stock' && c.id === p.id) c.pos = new THREE.Vector3(cx, y, cz); });
        });
        stock.ready = true;
      }],
      ['flare', async () => {
        const a = await D.loadFlare();
        const s = await D.samplePoints('flare', Q.flareN, 10);
        const M = await D.stageTransform('flare', 10, Q.flareN);
        flare.M.copy(M);
        const rig = new THREE.Group(); rig.matrixAutoUpdate = false; rig.matrix.copy(M);
        toBasic(a.model, { clippingPlanes: [scanPlane] });
        rig.add(a.model);
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
        // scan ring
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.03, 6, 96), new THREE.MeshBasicMaterial({ color: MINT, toneMapped: false, transparent: true, opacity: 0.9 }));
        ring.rotation.x = Math.PI / 2; ring.position.x = flare.axis.x; ring.position.z = flare.axis.z;
        flare.scene.add(ring); flare.scanRing = ring;
        // patch ignition order: by height
        flare.order = a.patches.slice().sort((p, q) => p.center.y - q.center.y);
        flare.order.forEach((p) => { p.world = p.center.clone().applyMatrix4(M); });
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(flare.order.flatMap((p) => p.world.toArray()), 3));
        flare.glowCol = new THREE.Float32BufferAttribute(new Float32Array(flare.order.length * 3), 3);
        gg.setAttribute('color', flare.glowCol);
        const glow = new THREE.Points(gg, pointsMat({ size: 1.1, minPx: 2, maxPx: 70, additive: true, soft: true }));
        glow.material.depthWrite = false; glow.renderOrder = 5;
        flare.scene.add(glow);
        a.patches.forEach((p) => callouts.forEach((c) => { if (c.scene === 'flare' && c.id === p.record.id) c.pos = p.center.clone().applyMatrix4(M); }));
        flare.ready = true;
      }]
    ];
    for (const [name, fn] of steps) {
      status(name, 'loading');
      try { await fn(); status(name, 'ready'); }
      catch (e) { console.warn('[D2] ' + name + ' failed', e); status(name, 'error'); }
      if (reduced) renderStills();
      await new Promise((r) => setTimeout(r, 30));
    }
    measureCallouts();
  }

  // ================= STILLS (reduced motion) =================
  const stillDone = new Set();
  function renderStills() {
    const prevHost = host;
    document.querySelectorAll('canvas[data-still]').forEach((cv) => {
      const kind = cv.dataset.still;
      if (stillDone.has(cv)) return;
      const need = kind.startsWith('stock') ? 'stock' : kind;
      if (!ready(need)) return;
      const r = cv.getBoundingClientRect();
      const w = Math.max(200, Math.round(r.width || 640)), h = Math.max(120, Math.round(r.height || 400));
      renderer.setSize(w, h, false); W = w; H = h; renderer.getDrawingBufferSize(dbs);
      const aspect = w / h;
      if (kind === 'plant') { setPlantCam(camA, 0.6, 0, aspect); drawScene('plant', camA, null); }
      else if (kind === 'tank') { setTankCam(camA, 0.55, 0, aspect); drawScene('tank', camA, null); }
      else if (kind === 'flare') { setFlareCam(camA, 0.8, 0, aspect); flareState(1, 1, 0); drawScene('flare', camA, null); }
      else if (kind === 'stock') {
        setStockCam(camA, 0.5, 0, aspect); camB.copy(camA);
        rtA.setSize(dbs.x, dbs.y); rtB.setSize(dbs.x, dbs.y); compMat.uniforms.uRes.value.set(w, h);
        composite('stock2', camA, 'stock1', camB, 3, 0.5);
      }
      cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
      cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height);
      cv.classList.add('is-ready');
      stillDone.add(cv);
    });
    host = null; if (prevHost) attach(prevHost); else { W = 1; H = 1; }
  }

  // Kick off data after first paint
  const go = () => loadAll();
  if (document.readyState === 'complete') setTimeout(go, 60); else addEventListener('load', () => setTimeout(go, 60));
  window.__d2 = { S, ready: () => ({ plant: plant.ready, tank: tank.ready, flare: flare.ready, stock: stock.ready }), mode: () => mode, info: () => ({ ms: lastMs, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pts: renderer.info.render.points, programs: renderer.info.programs.length }) };
}

try { boot(); } catch (err) {
  console.error('[Quadrion] WebGL scene failed, showing SVG fallback.', err);
  html.classList.add('no-webgl');
}
