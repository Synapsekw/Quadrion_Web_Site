// Height grids for the stockpile yard (Survey 1 and Survey 2), rasterised from the real terrain meshes.
// Shared by the scroll story (cut/fill shading) and the bento tile (diff map). Memoised.
import * as THREE from 'three';
import { load } from '../data/quadrion-data.js';

let memo = null;
export const stockGrids = () => memo || (memo = build());

const yieldTask = () => new Promise((r) => setTimeout(r, 0));

function terrainOf(root) {
  root.updateMatrixWorld(true);
  let t = null;
  root.traverse((o) => { if (!t && o.isMesh && /terrain/i.test(o.name)) t = o; });
  return t;
}

// Triangle rasteriser: writes interpolated heights into a regular x/z grid (native metres).
function rasterise(mesh, g) {
  const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index, m = mesh.matrixWorld;
  const n = pos.count, W = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
  const h = new Float32Array(g.GW * g.GH).fill(NaN);
  const tri = idx ? idx.count / 3 : n / 3, { x0, z0, cell, GW, GH } = g;
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = (W[a * 3] - x0) / cell, az = (W[a * 3 + 2] - z0) / cell, ay = W[a * 3 + 1];
    const bx = (W[b * 3] - x0) / cell, bz = (W[b * 3 + 2] - z0) / cell, by = W[b * 3 + 1];
    const cx = (W[c * 3] - x0) / cell, cz = (W[c * 3 + 2] - z0) / cell, cy = W[c * 3 + 1];
    const minx = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), maxx = Math.min(GW - 1, Math.floor(Math.max(ax, bx, cx)));
    const minz = Math.max(0, Math.ceil(Math.min(az, bz, cz))), maxz = Math.min(GH - 1, Math.floor(Math.max(az, bz, cz)));
    if (minx > maxx || minz > maxz) continue;
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) continue;
    for (let j = minz; j <= maxz; j++) for (let i = minx; i <= maxx; i++) {
      const w1 = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / den;
      const w2 = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / den;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue;
      const y = w1 * ay + w2 * by + w3 * cy, k = j * GW + i;
      if (!(h[k] >= y)) h[k] = y;
    }
  }
  return h;
}

async function build() {
  const { e1, e2, volumes } = await load('stockpile');
  const t1 = terrainOf(e1), t2 = terrainOf(e2);
  const box = new THREE.Box3().setFromObject(t1).union(new THREE.Box3().setFromObject(t2));
  const cell = 1.25, x0 = box.min.x, z0 = box.min.z;
  const GW = Math.ceil((box.max.x - x0) / cell) + 1, GH = Math.ceil((box.max.z - z0) / cell) + 1;
  const g = { x0, z0, cell, GW, GH, y0: box.min.y, y1: box.max.y, volumes, e1, e2, t1, t2 };
  await yieldTask();
  g.h1 = rasterise(t1, g);
  await yieldTask();
  g.h2 = rasterise(t2, g);
  g.at = (h, x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GW - 1 || j >= GH - 1) return NaN;
    const u = fx - i, w = fz - j, k = j * GW + i;
    const a = h[k], b = h[k + 1], c = h[k + GW], d = h[k + GW + 1];
    if (a !== a || b !== b || c !== c || d !== d) { const m = [a, b, c, d].filter((q) => q === q); return m.length ? m.reduce((s, q) => s + q, 0) / m.length : NaN; }
    return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
  };
  // Pile centroids from the surveyed toe rings (native x/z) and their real volumes.
  g.piles = volumes.piles.map((p) => {
    const r1 = p.epochs.e1?.ring || p.epochs.e2?.ring || [];
    let sx = 0, sz = 0; r1.forEach(([x, z]) => { sx += x; sz += z; });
    const cx = sx / Math.max(1, r1.length), cz = sz / Math.max(1, r1.length);
    let top = -Infinity;
    for (let dz = -6; dz <= 6; dz += 1.5) for (let dx = -6; dx <= 6; dx += 1.5) { const y = g.at(g.h2, cx + dx, cz + dz); if (y > top) top = y; }
    return { id: p.id, x: cx, z: cz, top, e1: p.epochs.e1, e2: p.epochs.e2 };
  });
  return g;
}

// Draws a cut/fill map (Survey 2 minus Survey 1) with hillshade into a canvas. side: 'diff' | 's1' | 's2'.
export function drawGrid(g, mode, maxW = 640) {
  const { GW, GH, h1, h2 } = g, s = Math.min(1, maxW / GW);
  const w = Math.max(1, Math.round(GW * s)), hh = Math.max(1, Math.round(GH * s));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const x = c.getContext('2d'), im = x.createImageData(w, hh), d = im.data;
  const src = mode === 's1' ? h1 : h2;
  for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
    const gi = Math.min(GW - 2, Math.floor(i / s)), gj = Math.min(GH - 2, Math.floor(j / s)), k = gj * GW + gi;
    const y = src[k], o = (j * w + i) * 4;
    if (y !== y) { d[o + 3] = 0; continue; }
    const yx = src[k + 1], yz = src[k + GW];
    const dx = (yx === yx ? yx : y) - y, dz = (yz === yz ? yz : y) - y;
    const sh = Math.max(0.35, Math.min(1.35, 0.92 + (-dx * 0.55 - dz * 0.75) * 0.9));
    let r = 118 * sh, gg = 112 * sh, b = 102 * sh;
    if (mode === 'diff') {
      const a = h1[k], df = y - a;
      if (a === a && Math.abs(df) > 0.1) {
        const t = Math.min(1, (Math.abs(df) - 0.1) / 2.4) * 0.88;
        const [cr, cg, cb] = df < 0 ? [229, 72, 77] : [91, 155, 213];
        r = r + (cr - r) * t; gg = gg + (cg - gg) * t; b = b + (cb - b) * t;
      } else { r *= 0.62; gg *= 0.64; b *= 0.66; }
    }
    d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}
