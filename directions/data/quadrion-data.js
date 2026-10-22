// Shared loaders for the real project datasets used by the direction prototypes.
// Requires an importmap mapping "three" and "three/addons/" (three@0.160.0).
//
// Assets (neutral names, no client identifiers):
//   plant     - industrial plant: engineering model (site.glb), 379k-point photogrammetry cloud with RGB (cloud-q.bin), orthomosaic
//   tank      - storage tank: model (tank.glb), 280k-point interior LiDAR scan with intensity, 6 graded findings with photos
//   flare     - flare stack: textured model (stack.glb), 78 mapped corrosion patches, source photos + class masks
//   stockpile - stockpile site surveyed on two dates: textured terrain meshes e1/e2 with pile meshes, volumes per pile
//   road      - urban ring road, 7.55 km: 3.25 cm orthomosaic pyramid, 1,783 PCI sample units, 2,115 mapped defects, close-ups
//   facade    - residential tower facade: tower model, 715 defect surface patches, 656 graded issues, RGB + thermal photos
//
// Every loader returns three.js objects in the asset's native metric frame (Y up).
// samplePoints() turns any of them into a fixed-size point set normalised to a common stage,
// so a single THREE.Points can morph between assets.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

const BASE = new URL('./', import.meta.url).href;
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
const raw = (p) => fetch(BASE + p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.arrayBuffer(); });
// Binary 3D data is served uncompressed by the CDN, so the build writes a gzip sibling
// (scripts/compress-data.mjs). Inflate it natively off the main thread; use the original
// file when the sibling is missing (local preview) or the browser lacks DecompressionStream.
const inflate = typeof DecompressionStream === 'function';
const bin = async (p) => {
  if (inflate) {
    try {
      const r = await fetch(BASE + p + '.gz');
      if (r.ok) {
        const buf = await r.arrayBuffer(), head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
        // A transport that already decoded the gzip hands back the original bytes.
        if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
        return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
    } catch { /* fall back to the uncompressed file */ }
  }
  return raw(p);
};
const json = (p) => fetch(BASE + p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
const gltf = (p) => bin(p).then((buf) => gltfLoader.parseAsync(buf, BASE + p.replace(/[^/]*$/, ''))).then((g) => g.scene);
// sRGB byte -> linear float, identical to Color.setRGB(v / 255, ..., SRGBColorSpace) per channel.
const SRGB_TO_LINEAR = (() => { const t = new Float32Array(256), c = new THREE.Color(); for (let i = 0; i < 256; i++) { c.setRGB(i / 255, 0, 0, THREE.SRGBColorSpace); t[i] = c.r; } return t; })();

export const ASSETS = {
  plant: { label: 'Industrial plant', kind: 'Photogrammetry cloud + engineering model', stat: '757,579 captured points' },
  tank: { label: 'Storage tank interior', kind: 'LiDAR scan + model + findings', stat: '280,000 LiDAR points · 2 cm' },
  flare: { label: 'Flare stack', kind: 'Textured model + corrosion mapping', stat: '78 mapped corrosion patches' },
  stockpile: { label: 'Stockpile site', kind: 'Two survey dates + volumes', stat: '2 surveys · 10 days apart' },
  road: { label: 'Urban ring road', kind: 'Orthomosaic + pavement condition + defects', stat: '7.55 km · 2,115 mapped defects' },
  facade: { label: 'Residential tower facade', kind: 'Tower model + mapped defects + RGB/thermal photos', stat: '656 graded issues · 715 mapped patches' },
};

// ---------- plant ----------
export const loadPlant = () => once('plant', async () => {
  // cloud-q.bin: meshopt-encoded uint16 positions + uint8 RGB (scripts/pack-plant-cloud.mjs).
  const [model, packed, meta, orthoMeta] = await Promise.all([
    gltf('plant/site.glb'), bin('plant/cloud-q.bin'), json('plant/cloud.json'), json('plant/ortho.json'), MeshoptDecoder.ready,
  ]);
  const n = meta.count, { xyzBytes, scale, offset } = meta.packed;
  const q = new Uint16Array(n * 4);
  MeshoptDecoder.decodeVertexBuffer(new Uint8Array(q.buffer), n, 8, new Uint8Array(packed, 0, xyzBytes));
  const xyz = new Float32Array(n * 3), rgb = new Uint8Array(packed, xyzBytes, n * 3);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) xyz[i * 3 + a] = q[i * 4 + a] * scale[a] + offset[a];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
  const lin = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) lin[i] = SRGB_TO_LINEAR[rgb[i]];
  geometry.setAttribute('color', new THREE.BufferAttribute(lin, 3)); // linear RGB
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true }));
  // Orthomosaic quad from its four ground corners (x/z in the model frame).
  const c = orthoMeta.placement_xz, y = geometry.boundingBox.min.y - 0.5;
  const og = new THREE.BufferGeometry();
  og.setAttribute('position', new THREE.Float32BufferAttribute([
    c.top_left[0], y, c.top_left[1], c.top_right[0], y, c.top_right[1], c.bottom_right[0], y, c.bottom_right[1], c.bottom_left[0], y, c.bottom_left[1],
  ], 3));
  og.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  og.setIndex([0, 3, 2, 0, 2, 1]); og.computeVertexNormals();
  const tex = await new THREE.TextureLoader().loadAsync(BASE + 'plant/ortho.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  const ortho = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  return { model, cloud, ortho, meta };
});

// ---------- tank ----------
export const loadTank = () => once('tank', async () => {
  const [model, buf, meta, findings] = await Promise.all([gltf('tank/tank.glb'), bin('tank/cloud.bin'), json('tank/cloud.json'), json('tank/findings.json')]);
  const n = meta.point_count, raw = new Int16Array(buf, 0, n * 3), intensity = new Uint8Array(buf, n * 6, n);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = raw[i] * meta.scale + meta.offset[i % 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('intensity', new THREE.BufferAttribute(intensity, 1, true));
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = 0.25 + 0.75 * intensity[i] / 255; col[i * 3] = v * 0.86; col[i * 3 + 1] = v * 0.92; col[i * 3 + 2] = v; }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.02, vertexColors: true }));
  // Findings: { id, title, severity (1-5), class, area, description, position: Vector3, photo: url }
  const list = (findings.photos || []).map((f) => ({
    id: f.finding_id, title: f.title, severity: f.severity, class: f.class, area: f.area, description: f.description,
    position: new THREE.Vector3(...f.location.pos_m), photo: BASE + 'tank/' + f.file,
  }));
  return { model, cloud, findings: list, meta };
});

// ---------- flare ----------
export const loadFlare = () => once('flare', async () => {
  const [model, buf, data] = await Promise.all([gltf('flare/stack.glb'), bin('flare/patches.bin'), json('flare/data.json')]);
  model.applyMatrix4(new THREE.Matrix4().fromArray(data.transform));
  model.updateMatrixWorld(true);
  const texLoader = new THREE.TextureLoader();
  const patches = await Promise.all(data.records.map(async (r) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, r.offset, r.vertexCount * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, r.offset + r.vertexCount * 12, r.vertexCount * 2), 2));
    g.computeBoundingSphere();
    const map = await texLoader.loadAsync(BASE + 'flare/patches/' + r.texture);
    map.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, alphaTest: 0.025,
    }));
    // record: { id, title, description, component, zone, severity (1-3), classId, center [x,y,z], coverage, camera{pos,q,lens} }
    return { mesh, record: r, center: new THREE.Vector3(...r.center), photo: BASE + 'flare/patches/' + r.photo, mask: BASE + 'flare/patches/' + r.mask };
  }));
  return { model, patches, records: data.records };
});

// ---------- stockpile ----------
export const loadStockpile = () => once('stockpile', async () => {
  const [e1, e2, volumes] = await Promise.all([gltf('stockpile/survey-e1.glb'), gltf('stockpile/survey-e2.glb'), json('stockpile/volumes.json')]);
  // Child names: "Terrain_e1" plus one mesh per pile "P01_e1" ... (triangles + outline lines).
  // volumes.piles[i].epochs.e1/e2 -> { areaM2, heightM, ring [[x,z]...], volumes: { tin: { fill, cut, net }, ... } }
  // volumes.captures -> [{ epoch:'e1', label:'31 Dec 2020' }, { epoch:'e2', label:'10 Jan 2021' }]
  return { e1, e2, volumes };
});

// ---------- road ----------
// Local metres: x east, z south, ground at y = 0, corridor centre at the origin. ~7.5 km long.
export const PCI_COLOR = (pci) => (pci >= 86 ? 0x1f9d55 : pci >= 71 ? 0x8bc34a : pci >= 56 ? 0xf2c94c : pci >= 41 ? 0xf2994a : pci >= 26 ? 0xeb5757 : pci >= 11 ? 0xb0232a : 0x6d6d6d);
export const loadRoad = () => once('road', async () => {
  const [road, pci, def] = await Promise.all([json('road/road.json'), json('road/pci.json'), json('road/defects.json')]);
  // Centreline as a line at y = 0.3.
  const centreline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(road.centreline.map(([x, z]) => new THREE.Vector3(x, 0.3, z))),
    new THREE.LineBasicMaterial({ color: 0x5ed1b3 }));
  // PCI cells: one merged mesh, vertex colours from the PCI rating (index 1 = Medium-severity assumption).
  const pos = [], col = [], c = new THREE.Color();
  for (const cell of pci.cells) {
    c.setHex(PCI_COLOR(cell.pci[1]));
    for (const ring of cell.rings) {
      const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
      if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop();
      for (const tri of THREE.ShapeUtils.triangulateShape(pts, [])) for (const k of tri) { pos.push(pts[k].x, 0.2, pts[k].y); col.push(c.r, c.g, c.b); }
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const pciMesh = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  // Defects: points coloured by severity (1 low grey, 2 medium amber, 3 high red).
  const sevCol = { 1: new THREE.Color(0x8e99a6), 2: new THREE.Color(0xf2994a), 3: new THREE.Color(0xe5484d) };
  const dp = new Float32Array(def.defects.length * 3), dc = new Float32Array(def.defects.length * 3);
  def.defects.forEach((d, i) => { dp.set([d.x, 0.5, d.z], i * 3); sevCol[d.sev].toArray(dc, i * 3); });
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dg.setAttribute('color', new THREE.BufferAttribute(dc, 3));
  const defectPoints = new THREE.Points(dg, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true }));
  // road.closeups[i]: { id, type, severity 1-3, km, area, extent, photo, polygon [[px,py]...] in image pixels, size [w,h] }
  return { road, cells: pci.cells, defects: def.defects, centreline, pciMesh, defectPoints,
    closeups: road.closeups.map((d) => ({ ...d, photo: BASE + 'road/' + d.photo })) };
});

// Orthomosaic tiles of one pyramid level as textured planes at y = 0.
// Levels: 0-4 cover the whole corridor (416, 208, 104, 52, 26 cm/px); level 6 (6.5 cm/px) covers only the hero stretch around road.hero.km.
// Tiles load lazily and fade in; the Group is returned immediately.
export function roadOrtho(road, z = 3) {
  const lvl = road.ortho.levels.find((l) => l.z === z), size = road.ortho.square.size, [tlx, tlz] = road.ortho.square.tl;
  const t = size / lvl.cols, group = new THREE.Group(), loader = new THREE.TextureLoader();
  for (const key of road.ortho.tiles[String(z)] || []) {
    const [x, y] = key.split('_').map(Number);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    loader.load(BASE + 'road/ortho/' + z + '/' + key + '.webp', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; mat.map = tex; mat.opacity = 1; mat.needsUpdate = true;
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(t, t), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(tlx + (x + 0.5) * t, 0, tlz + (y + 0.5) * t); m.renderOrder = z;
    group.add(m);
  }
  return group;
}

// ---------- facade ----------
// Local metres, Y up, origin at the tower base. Defect patches are one merged mesh coloured by defect class.
export const loadFacade = () => once('facade', async () => {
  const [model, buf, meta] = await Promise.all([gltf('facade/tower.glb'), bin('facade/patches.bin'), json('facade/facade.json')]);
  model.applyMatrix4(new THREE.Matrix4().fromArray(meta.transform));
  model.updateMatrixWorld(true);
  const classColor = Object.fromEntries(meta.classes.map((k) => [k.id, new THREE.Color(k.color)]));
  const n = meta.patches.reduce((t, p) => t + p.vertexCount, 0);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), patchIndex = new Float32Array(n);
  let v = 0;
  meta.patches.forEach((p, i) => {
    pos.set(new Float32Array(buf, p.offset, p.vertexCount * 3), v * 3);
    const c = classColor[p.cls] || new THREE.Color(0xb68ef8);
    for (let k = 0; k < p.vertexCount; k++) { c.toArray(col, (v + k) * 3); patchIndex[v + k] = i; }
    v += p.vertexCount;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('patchIndex', new THREE.BufferAttribute(patchIndex, 1));
  const patches = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
  }));
  // meta.patches[i]: { issue, cls, sev 1-2, component, center }. meta.photos: 4 curated RGB photos with class overlays + findings.
  // meta.thermal: 2 thermal frames with thermal-class findings. meta.stats / meta.classes / meta.legend / meta.components.
  const fix = (p) => BASE + 'facade/' + p;
  return { model, patches, meta, classColor,
    photos: meta.photos.map((p) => ({ ...p, photo: fix(p.photo), overlay: fix(p.overlay) })),
    thermal: meta.thermal.map((t) => ({ ...t, photo: fix(t.photo) })) };
});

export const load = (name) => ({ plant: loadPlant, tank: loadTank, flare: loadFlare, stockpile: loadStockpile, road: loadRoad, facade: loadFacade })[name]();

// ---------- sampling into a common stage ----------
// Returns { positions: Float32Array(N*3), colors: Float32Array(N*3), heights: Float32Array(N) (0..1),
//           center: Vector3, scale: number } where positions are centred on the asset and scaled so its
// bounding-sphere radius equals `radius`. Colours are linear-ish 0..1 RGB from real data
// (cloud RGB, LiDAR intensity, or mesh texture), already converted to linear for vertexColors. Same N for every asset, so buffers can be lerped.
export async function samplePoints(name, N = 120000, radius = 10) {
  const key = `sample:${name}:${N}`;
  const raw = await once(key, async () => {
    const a = await load(name);
    if (name === 'plant') return fromCloud(a.cloud, N, { clipToModel: a.model });
    if (name === 'tank') return fromCloud(a.cloud, N);
    if (name === 'flare') return fromMeshes(a.model, N);
    if (name === 'stockpile') return fromMeshes(a.e2, N, (m) => /terrain/i.test(m.name) || /terrain/i.test(m.parent?.name || ''));
    if (name === 'road') return fromMeshes(a.pciMesh, N, () => true, true);
    if (name === 'facade') return fromMeshes(a.model, N);
  });
  return normalise(raw, radius);
}

function fromCloud(points, N, { clipToModel } = {}) {
  // Both attributes are plain, non-interleaved Float32 (itemSize 3), so read the arrays directly.
  const p = points.geometry.attributes.position.array, c = points.geometry.attributes.color.array, count = p.length / 3;
  let idx = new Uint32Array(count), m = 0;
  if (clipToModel) {
    // Keep cloud points near the engineering model so the sample frames the plant, not the whole survey area.
    const { min, max } = new THREE.Box3().setFromObject(clipToModel).expandByScalar(40);
    for (let i = 0; i < count; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z) idx[m++] = i;
    }
  } else for (; m < count; m++) idx[m] = m;
  const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    const i = idx[Math.floor(Math.random() * m)] * 3;
    positions[k * 3] = p[i]; positions[k * 3 + 1] = p[i + 1]; positions[k * 3 + 2] = p[i + 2];
    colors[k * 3] = c[i]; colors[k * 3 + 1] = c[i + 1]; colors[k * 3 + 2] = c[i + 2];
  }
  return { positions, colors };
}

function fromMeshes(root, N, filter = () => true, useVertexColors = false) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry.attributes.position && filter(o)) meshes.push(o); });
  // Allocate samples by world-space surface area.
  const areas = meshes.map((m) => worldArea(m)), total = areas.reduce((a, b) => a + b, 0);
  const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), col = new THREE.Color(), uv = new THREE.Vector2();
  let k = 0;
  meshes.forEach((mesh, mi) => {
    const count = mi === meshes.length - 1 ? N - k : Math.round(N * areas[mi] / total);
    if (count <= 0) return;
    const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(geom)).build();
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const px = useVertexColors ? null : texturePixels(mat?.map), base = mat?.color || new THREE.Color(0.7, 0.72, 0.74);
    const vc = useVertexColors && geom.attributes.color ? new THREE.Color() : null;
    for (let s = 0; s < count && k < N; s++, k++) {
      sampler.sample(v, n, vc || undefined, geom.attributes.uv ? uv : undefined);
      v.applyMatrix4(mesh.matrixWorld);
      positions[k * 3] = v.x; positions[k * 3 + 1] = v.y; positions[k * 3 + 2] = v.z;
      if (px && geom.attributes.uv) {
        const x = Math.min(px.w - 1, Math.max(0, Math.floor(((uv.x % 1) + 1) % 1 * px.w)));
        const y = Math.min(px.h - 1, Math.max(0, Math.floor(((uv.y % 1) + 1) % 1 * px.h)));
        const o = (y * px.w + x) * 4;
        col.setRGB(px.d[o] / 255, px.d[o + 1] / 255, px.d[o + 2] / 255, THREE.SRGBColorSpace);
      } else if (vc) col.copy(vc); else col.copy(base);
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
    }
  });
  return { positions, colors };
}

function worldArea(mesh) {
  const g = mesh.geometry, p = g.attributes.position, idx = g.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Triangle();
  const tri = idx ? idx.count / 3 : p.count / 3; let area = 0;
  for (let i = 0; i < tri; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3, i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(p, i0).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(p, i1).applyMatrix4(mesh.matrixWorld); c.fromBufferAttribute(p, i2).applyMatrix4(mesh.matrixWorld);
    area += t.set(a, b, c).getArea();
  }
  return area;
}

const pixelCache = new WeakMap();
function texturePixels(tex) {
  const img = tex?.image; if (!img || !img.width) return null;
  if (pixelCache.has(img)) return pixelCache.get(img);
  const w = Math.min(img.width, 1024), h = Math.round(img.height * w / img.width);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (tex.flipY) { cx.translate(0, h); cx.scale(1, -1); }
  cx.drawImage(img, 0, 0, w, h);
  const out = { w, h, d: cx.getImageData(0, 0, w, h).data };
  pixelCache.set(img, out); return out;
}

function normalise({ positions, colors }, radius) {
  const N = positions.length / 3, box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) box.expandByPoint(v.fromArray(positions, i * 3));
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const scale = radius / (0.5 * Math.max(size.x, size.y, size.z));
  const out = new Float32Array(N * 3), heights = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    out[i * 3] = (positions[i * 3] - center.x) * scale;
    out[i * 3 + 1] = (positions[i * 3 + 1] - box.min.y) * scale; // sits on y = 0
    out[i * 3 + 2] = (positions[i * 3 + 2] - center.z) * scale;
    heights[i] = (positions[i * 3 + 1] - box.min.y) / Math.max(1e-6, size.y);
  }
  return { positions: out, colors, heights, center, scale, size };
}

// Places a native-frame object (model, cloud, patches) onto the same stage as samplePoints(name, _, radius).
export async function stageTransform(name, radius = 10, N = 120000) {
  const s = await samplePoints(name, N, radius);
  const m = new THREE.Matrix4().makeScale(s.scale, s.scale, s.scale);
  m.multiply(new THREE.Matrix4().makeTranslation(-s.center.x, -(s.center.y - s.size.y / 2), -s.center.z));
  return m;
}
