/* =====================================================================
   Quadrion AI · Direction B2 · bento tiles, tilt, magnetic CTA, SVGs.
   Real imagery: flare corrosion photos + class masks, tank finding photos,
   the terminal orthomosaic and a cut/fill map rasterised from both stockpile surveys.
   ===================================================================== */
import { stockGrids, drawGrid } from './grids.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const ramp = (x, a, b) => clamp((x - a) / (b - a));
const xout = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const DATA = '../data/';
export const SEV5 = { 5: '#E5484D', 4: '#F2994A', 3: '#E8C547', 2: '#5B9BD5', 1: '#5B9BD5' };
const MASKC = { 1: [232, 197, 71], 2: [242, 153, 74], 3: [229, 72, 77], 4: [142, 153, 166] };
const CLS = { light: ['LIGHT', 'var(--yellow)'], moderate: ['MODERATE', 'var(--orange)'], heavy: ['HEAVY', 'var(--red)'] };

class Spring {
  constructor(v = 0, k = 120, c = 18) { this.x = v; this.v = 0; this.t = v; this.k = k; this.c = c; }
  step(dt) { const a = this.k * (this.t - this.x) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
  get rest() { return Math.abs(this.t - this.x) < 1e-4 && Math.abs(this.v) < 1e-4; }
}

/* Class masks are 8-bit class ids (1 light, 2 moderate, 3 heavy, 4 uncertain). Colourise into a canvas. */
export function maskCanvas(url, alpha = 0.66) {
  return new Promise((res) => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => {
      const w = Math.min(im.naturalWidth, 768), h = Math.round(im.naturalHeight * w / im.naturalWidth);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const k = p[i], col = MASKC[k];
        if (!col) { p[i + 3] = 0; continue; }
        p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = 255 * alpha;
      }
      x.putImageData(d, 0, 0);
      // crisp class outline on top
      x.globalCompositeOperation = 'source-over';
      res(c);
    };
    im.onerror = () => res(null);
    im.src = url;
  });
}

/* ---------- micro animation scheduler ---------- */
const micros = [];
const mio = new IntersectionObserver((es) => { es.forEach((e) => { if (e.target.__m) e.target.__m.vis = e.isIntersecting; }); kick(); }, { rootMargin: '80px' });
function addMicro(el, m) { m.el = el; m.vis = false; el.__m = m; micros.push(m); mio.observe(el); if (m.size) new ResizeObserver(() => { m.size(); if (reduced) m.draw(m.still); }).observe(el); }
let run = false; const T0 = performance.now();
function kick() {
  if (reduced) { micros.forEach((m) => { if (m.vis && !m.drawn) { m.draw(m.still); m.drawn = true; } }); return; }
  if (!run && micros.some((m) => m.vis)) { run = true; requestAnimationFrame(loop); }
}
function loop(now) {
  const t = (now - T0) / 1000; let any = false;
  for (const m of micros) if (m.vis) { any = true; m.draw(t); }
  if (any) requestAnimationFrame(loop); else run = false;
}
function sizer(cv) {
  const o = { W: 0, H: 0, dpr: 1 };
  o.size = () => { o.dpr = Math.min(devicePixelRatio || 1, 2); o.W = cv.clientWidth; o.H = cv.clientHeight; cv.width = Math.max(1, Math.round(o.W * o.dpr)); cv.height = Math.max(1, Math.round(o.H * o.dpr)); };
  return o;
}

/* A · flare corrosion photos with class masks */
(async function () {
  const root = $('#mCor'); if (!root) return;
  const tile = root.closest('.tile');
  const IDS = ['F44', 'F61', 'F69', 'F47'];
  let recs = [];
  try { const d = await fetch(DATA + 'flare/data.json').then((r) => r.json()); recs = IDS.map((id) => d.records.find((r) => r.id === id)).filter(Boolean); } catch (e) { return; }
  const frames = recs.map((r, i) => {
    const fr = document.createElement('div'); fr.className = 'fr' + (i === 0 ? ' on' : '');
    const img = document.createElement('img'); img.alt = `Inspection photo of ${r.component.toLowerCase()}, ${r.zone.toLowerCase()}, with ${CLS[r.classId]?.[0].toLowerCase() || 'graded'} corrosion`; img.decoding = 'async'; img.loading = 'lazy';
    img.width = 1024; img.height = 683;
    fr.appendChild(img); root.insertBefore(fr, root.firstChild);
    return { r, fr, img, mask: null, loading: false };
  });
  const scan = $('.scan', root), cid = $('#corId'), csev = $('#corSev'), ccomp = $('#corComp'), ccov = $('#corCov');
  let hover = false; tile.addEventListener('pointerenter', () => { hover = true; }); tile.addEventListener('pointerleave', () => { hover = false; });
  const ensure = (f) => {
    if (f.loading) return; f.loading = true;
    f.img.src = DATA + 'flare/patches/' + f.r.photo;
    maskCanvas(DATA + 'flare/patches/' + f.r.mask).then((c) => { if (c) { f.mask = c; f.fr.appendChild(c); } });
  };
  ensure(frames[0]); if (frames[1]) ensure(frames[1]);
  let cur = -1;
  const CYC = 4.2;
  function draw(t) {
    const k = Math.floor(t / CYC) % frames.length, lt = t % CYC;
    if (k !== cur) {
      cur = k; frames.forEach((f, i) => f.fr.classList.toggle('on', i === k));
      ensure(frames[k]); ensure(frames[(k + 1) % frames.length]);
      const r = frames[k].r, cl = CLS[r.classId] || ['GRADED', 'var(--t2)'];
      cid.textContent = r.id; csev.innerHTML = `<i style="background:${cl[1]}"></i>${cl[0]}`;
      ccomp.textContent = `${r.component} · ${r.zone}`; ccov.textContent = `${r.coverage.toFixed(1)} %`;
    }
    const w = hover || reduced ? 100 : 100 * xout(ramp(lt, 0.5, 2.1)) * (1 - ramp(lt, CYC - 0.35, CYC));
    root.style.setProperty('--w', w.toFixed(2) + '%');
    scan.style.opacity = (w > 0.5 && w < 99.5) ? '1' : '0';
  }
  addMicro(root, { draw, still: 2.5 });
})();

/* B · tank interior findings with real photos */
(async function () {
  const root = $('#mFind'); if (!root) return;
  let list = [];
  try { const d = await fetch(DATA + 'tank/findings.json').then((r) => r.json()); list = d.photos || []; } catch (e) { return; }
  const ph = $('.ph', root);
  const imgs = list.map((f, i) => { const im = document.createElement('img'); im.alt = `${f.title}: ${f.class.toLowerCase()} on the ${f.area.toLowerCase()}`; im.loading = 'lazy'; im.decoding = 'async'; im.width = 1280; im.height = 960; im.src = DATA + 'tank/' + f.file; if (i === 0) im.classList.add('on'); ph.appendChild(im); return im; });
  const sev = $('#fdSev'), cnt = $('#fdCnt'), id = $('#fdId'), area = $('#fdArea'), tt = $('#fdT'), dd = $('#fdD'), bars = $$('#fdScale i');
  let cur = -1;
  function draw(t) {
    const k = Math.floor(t / 3.4) % list.length; if (k === cur) return; cur = k;
    const f = list[k], c = SEV5[f.severity];
    imgs.forEach((im, i) => im.classList.toggle('on', i === k));
    sev.innerHTML = `<i style="background:${c}"></i>SEV ${f.severity} / 5`; cnt.textContent = `${k + 1} / ${list.length}`;
    id.textContent = `${f.finding_id} · ${f.class.toUpperCase()}`; area.textContent = f.area.toUpperCase();
    tt.textContent = f.title; dd.textContent = f.description;
    bars.forEach((b, i) => { b.classList.toggle('on', i < f.severity); b.style.setProperty('--c', c); });
  }
  addMicro(root, { draw, still: 0 });
})();

/* C · orthomosaic crop with a loupe */
(function () {
  const root = $('#mOrtho'); if (!root) return;
  const img = $('img', root), lp = $('.lp', root), xy = $('#orthXY');
  const GSD = 0.5327;
  function draw(t) { const a = Math.sin(t * 0.11) * 3.2, b = Math.cos(t * 0.08) * 2.2; img.style.transform = `translate3d(${a.toFixed(2)}%,${b.toFixed(2)}%,0)`; }
  addMicro(root, { draw, still: 0 });
  if (!finePointer) return;
  lp.style.backgroundImage = `url(${img.src})`;
  root.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect(), ir = img.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top, Z = 2.6;
    const ix = (e.clientX - ir.left) / ir.width, iy = (e.clientY - ir.top) / ir.height;
    lp.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    lp.style.backgroundSize = `${(ir.width * Z).toFixed(0)}px auto`;
    lp.style.backgroundPosition = `${(-ix * ir.width * Z + 55).toFixed(1)}px ${(-iy * ir.height * Z + 55).toFixed(1)}px`;
    xy.textContent = `X ${(ix * 4096 * GSD).toFixed(1)} · Y ${(iy * 2451 * GSD).toFixed(1)} m`;
  });
})();

/* D · GPU race */
(function () {
  const root = $('#mRace'); if (!root) return;
  const vc = $('[data-v="cpu"]', root), vg = $('[data-v="gpu"]', root), bc = $('[data-b="cpu"]', root), bg = $('[data-b="gpu"]', root);
  const D = 4.6, CYC = 6.6;
  function draw(t) {
    const lt = t % CYC, k = clamp(lt / D), sim = 255 * Math.pow(k, 2.2), fade = 1 - ramp(lt, CYC - 0.45, CYC), g = Math.min(sim, 12.9);
    vc.textContent = sim.toFixed(1) + ' s'; vg.textContent = g.toFixed(1) + ' s'; vg.classList.toggle('done', sim >= 12.9);
    bc.style.transform = `scaleX(${(sim / 255 * fade).toFixed(4)})`; bg.style.transform = `scaleX(${(g / 12.9 * fade).toFixed(4)})`;
  }
  addMicro(root, { draw, still: 5.5 });
})();

/* E · agent */
(function () {
  const root = $('#mAgent'); if (!root) return;
  const tog = $('.tog', root), st = $('.ag-st', root), msg = $('.msg', root), step = $('.step', root), code = $('code', root), caret = $('.caret', root), chips = $('.chips', root), ok = $('.ok', root), res = $('.res', root);
  const TXT = 'issues.filter({ asset: "Storage tank interior", severity: 5 })', CYC = 8.4;
  let last = '';
  function draw(t) {
    const lt = t % CYC, on = lt > 0.5 && lt < CYC - 0.5, n = Math.floor(clamp((lt - 1.3) / 2.2) * TXT.length);
    const key = [on, lt > 0.8, lt > 1.2, n, lt > 3.7, lt > 4.4 && lt < 4.75, lt > 4.75, lt > 4.9, lt < CYC - 0.6].join('|');
    if (key === last) return; last = key;
    tog.classList.toggle('on', on); st.textContent = on ? 'ON' : 'OFF';
    const vis = lt < CYC - 0.6;
    msg.classList.toggle('hide', !(lt > 0.8 && vis)); step.classList.toggle('hide', !(lt > 1.2 && vis));
    code.textContent = TXT.slice(0, n); caret.style.display = lt > 3.7 ? 'none' : '';
    chips.classList.toggle('hide', !(lt > 3.7 && vis));
    ok.classList.toggle('press', lt > 4.4 && lt < 4.75); ok.classList.toggle('done', lt > 4.75);
    res.classList.toggle('hide', !(lt > 4.9 && vis));
  }
  addMicro(root, { draw, still: 6.2 });
})();

/* F · .aio package sealing */
(function () {
  const svg = $('#mSeal'); if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, at, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); parent.appendChild(e); return e; };
  el('rect', { x: 64, y: 36, width: 150, height: 88, rx: 10, fill: '#11161C', stroke: '#3A4654' });
  const bars = ['#3F4B5B', '#6d6253', '#8E99A6', '#5ED1B3'].map((c, i) => {
    const g = el('g', {}); el('rect', { x: 80, y: 50 + i * 15, width: 118, height: 9, rx: 2, fill: i === 3 ? '#1E2630' : c, stroke: i === 3 ? '#3A4654' : 'none' }, g);
    if (i === 3) ['#E5484D', '#F2994A', '#E8C547'].forEach((cc, k) => el('rect', { x: 86 + k * 12, y: 52 + i * 15, width: 5, height: 5, rx: 1, fill: cc }, g));
    return g;
  });
  const lid = el('g', {}); el('rect', { x: 58, y: 28, width: 162, height: 14, rx: 5, fill: '#1E2630', stroke: '#4A5868' }, lid);
  el('text', { x: 139, y: 145, 'text-anchor': 'middle', fill: '#8E99A6', 'font-family': 'IBM Plex Mono, monospace', 'font-size': 10, 'letter-spacing': '1' }).textContent = 'tank-terminal.aio';
  const lock = el('g', {}); const shk = el('path', { d: 'M226 96v-8a9 9 0 0 1 18 0v8', fill: 'none', 'stroke-width': 2.2 }, lock);
  const body = el('rect', { x: 221, y: 96, width: 28, height: 22, rx: 4, 'stroke-width': 1.4 }, lock);
  el('circle', { cx: 235, cy: 106, r: 2.4, fill: '#0B0F13' }, lock);
  const tag = el('text', { x: 235, y: 136, 'text-anchor': 'middle', fill: '#5ED1B3', 'font-family': 'IBM Plex Mono, monospace', 'font-size': 9, 'letter-spacing': '1.2' }); tag.textContent = 'SEALED';
  const CYC = 5.6;
  function draw(t) {
    const lt = t % CYC, out = 1 - ramp(lt, CYC - 0.5, CYC);
    bars.forEach((g, i) => { const k = xout(ramp(lt, 0.1 + i * 0.3, 0.75 + i * 0.3)); g.setAttribute('transform', `translate(0 ${(-46 * (1 - k)).toFixed(2)})`); g.style.opacity = (k * out).toFixed(3); });
    const lk = xout(ramp(lt, 1.6, 2.2)); lid.setAttribute('transform', `translate(0 ${(-24 * (1 - lk)).toFixed(2)})`); lid.style.opacity = (Math.min(1, lk * 1.5) * out).toFixed(3);
    const la = xout(ramp(lt, 2.2, 2.7)), sd = xout(ramp(lt, 2.7, 3.1)), sealed = lt > 3.05;
    lock.style.opacity = (la * out).toFixed(3); lock.setAttribute('transform', `translate(0 ${(6 * (1 - la)).toFixed(2)})`);
    shk.setAttribute('transform', `translate(0 ${(-7 * (1 - sd)).toFixed(2)})`);
    const col = sealed ? '#5ED1B3' : '#8E99A6'; shk.setAttribute('stroke', col); body.setAttribute('stroke', col); body.setAttribute('fill', sealed ? 'rgba(94,209,179,.16)' : '#1E2630');
    tag.style.opacity = (ramp(lt, 3.1, 3.5) * out).toFixed(3);
  }
  addMicro(svg, { draw, still: 4.2 });
})();

/* G · stockpile cut/fill, rasterised from both real surveys */
(function () {
  const root = $('#mDiff'); if (!root) return;
  const cv = $('canvas', root), x = cv.getContext('2d'), S = sizer(cv), ld = $('.ld', root);
  let A = null, B = null, started = false;
  const start = () => {
    if (started) return; started = true;
    stockGrids().then((g) => { A = drawGrid(g, 's1', 720); B = drawGrid(g, 'diff', 720); ld.remove(); if (reduced) draw(0); }).catch(() => { ld.textContent = 'SURVEY DATA UNAVAILABLE'; });
  };
  new IntersectionObserver(([e]) => { if (e.isIntersecting) start(); }, { rootMargin: '600px' }).observe(root);
  function draw(t) {
    const { W, H, dpr } = S; if (!W || !A) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#0d1217'; x.fillRect(0, 0, W, H);
    // the yard is portrait; rotate it a quarter turn so it fills the wide tile
    const rot = W > H * 1.15, iw = rot ? A.height : A.width, ih = rot ? A.width : A.height;
    const sc = Math.max(W / iw, H / ih) * 1.04, dw = iw * sc, dh = ih * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
    const p = reduced ? 0.42 : 0.5 + 0.36 * Math.sin(t * 0.7), wx = Math.round(W * p) + 0.5;
    const paint = (im) => { x.save(); x.translate(ox + dw / 2, oy + dh / 2); if (rot) x.rotate(-Math.PI / 2); x.imageSmoothingQuality = 'high'; x.drawImage(im, -im.width * sc / 2, -im.height * sc / 2, im.width * sc, im.height * sc); x.restore(); };
    paint(A);
    x.save(); x.beginPath(); x.rect(wx, 0, W - wx, H); x.clip(); paint(B); x.restore();
    x.fillStyle = 'rgba(238,242,245,.95)'; x.fillRect(wx - 0.5, 0, 1, H);
    x.fillStyle = '#0B0F13'; x.strokeStyle = '#EEF2F5'; x.lineWidth = 1; x.beginPath(); x.arc(wx, H / 2, 12, 0, Math.PI * 2); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(wx - 3, H / 2 - 4); x.lineTo(wx - 7, H / 2); x.lineTo(wx - 3, H / 2 + 4); x.moveTo(wx + 3, H / 2 - 4); x.lineTo(wx + 7, H / 2); x.lineTo(wx + 3, H / 2 + 4); x.stroke();
  }
  addMicro(root, { size: S.size, draw, still: 0 });
})();

/* static story (reduced motion / no WebGL): cut/fill still */
(function () {
  const cv = $('[data-still-diff]'); if (!cv) return;
  new IntersectionObserver(([e], ob) => {
    if (!e.isIntersecting) return; ob.disconnect();
    stockGrids().then((g) => {
      const im = drawGrid(g, 'diff', 900); const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
      const x = cv.getContext('2d'); x.fillStyle = '#0d1217'; x.fillRect(0, 0, cv.width, cv.height);
      x.translate(cv.width / 2, cv.height / 2); x.rotate(-Math.PI / 2);
      const sc = Math.max(cv.width / im.height, cv.height / im.width); x.drawImage(im, -im.width * sc / 2, -im.height * sc / 2, im.width * sc, im.height * sc);
    }).catch(() => {});
  }, { rootMargin: '400px' }).observe(cv);
})();

/* ---------- tile tilt + spotlight ---------- */
(function () {
  if (!finePointer || reduced) return;
  const items = $$('.tile').map((t) => ({ t, in: $('.tile-in', t), rx: new Spring(0, 160, 19), ry: new Spring(0, 160, 19) }));
  let running = false, last = 0;
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now; let moving = false;
    for (const it of items) { it.rx.step(dt); it.ry.step(dt); if (!it.rx.rest || !it.ry.rest) moving = true; it.in.style.transform = `perspective(1100px) rotateX(${it.rx.x.toFixed(3)}deg) rotateY(${it.ry.x.toFixed(3)}deg)`; }
    if (moving) requestAnimationFrame(frame); else running = false;
  }
  const go = () => { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } };
  items.forEach((it) => {
    it.t.addEventListener('pointermove', (e) => {
      const r = it.t.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      it.rx.t = (0.5 - py) * 10; it.ry.t = (px - 0.5) * 10;
      it.in.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px'); it.in.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
      go();
    });
    it.t.addEventListener('pointerleave', () => { it.rx.t = 0; it.ry.t = 0; go(); });
  });
})();

/* ---------- magnetic CTA ---------- */
(function () {
  if (!finePointer || reduced) return;
  const zone = $('#cta');
  $$('.magnet').forEach((b) => {
    const inner = $('.lbl-in', b), sx = new Spring(0, 150, 14), sy = new Spring(0, 150, 14);
    let running = false, last = 0;
    const frame = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now; sx.step(dt); sy.step(dt);
      b.style.transform = `translate3d(${sx.x.toFixed(2)}px,${sy.x.toFixed(2)}px,0)`; inner.style.transform = `translate3d(${(sx.x * 0.45).toFixed(2)}px,${(sy.x * 0.45).toFixed(2)}px,0)`;
      if (!sx.rest || !sy.rest) requestAnimationFrame(frame); else running = false;
    };
    const go = () => { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } };
    zone.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy), R = 150;
      if (d < R) { const f = 0.38 * (1 - d / R * 0.4); sx.t = dx * f; sy.t = dy * f; } else { sx.t = 0; sy.t = 0; }
      go();
    });
    zone.addEventListener('pointerleave', () => { sx.t = 0; sy.t = 0; go(); });
  });
})();

/* ---------- air-gap visual + CTA backdrop ---------- */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = $('#airgap'); if (!svg) return;
  const k = 21;
  const iso = (x, y, z) => [(x - z) * 0.866 * k, (x + z) * 0.5 * k - y * k];
  const pt = (x, y, z) => iso(x, y, z).map((v) => v.toFixed(1)).join(',');
  const el = (tag, at, p = svg) => { const e = document.createElementNS(NS, tag); for (const a in at) e.setAttribute(a, at[a]); p.appendChild(e); return e; };
  const B = 6.4, HB = 8.4;
  { const x0 = -B * 2 * 0.866 * k - 30, x1 = (B + 7.5) * 0.866 * k + 30, y0 = -(B * k + HB * k) - 60, y1 = B * k + 50; svg.setAttribute('viewBox', `${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}`); }
  const edge = (a, b, dashed) => el('line', { x1: iso(...a)[0], y1: iso(...a)[1], x2: iso(...b)[0], y2: iso(...b)[1], stroke: dashed ? '#3A4654' : '#6B7A8B', 'stroke-width': 1, 'stroke-dasharray': dashed ? '3 5' : 'none', 'vector-effect': 'non-scaling-stroke' });
  el('polygon', { points: [pt(-B, 0, -B), pt(B, 0, -B), pt(B, 0, B), pt(-B, 0, B)].join(' '), fill: 'rgba(17,22,28,.65)', stroke: '#2A3340' });
  edge([-B, 0, -B], [-B, HB, -B], true); edge([-B, HB, -B], [B, HB, -B], true); edge([-B, HB, -B], [-B, HB, B], true);
  const LY = [1.3, 2.9, 4.5, 6.1], s = 4.5;
  LY.forEach((y, i) => {
    const g = el('g', { class: 'ag-layer' });
    const fills = ['rgba(30,38,48,.85)', 'rgba(96,104,98,.7)', 'rgba(24,31,39,.85)', 'rgba(24,31,39,.7)'];
    el('polygon', { points: [pt(-s, y, -s), pt(s, y, -s), pt(s, y, s), pt(-s, y, s)].join(' '), fill: fills[i], stroke: '#4A5868', 'stroke-width': 1 }, g);
    if (i === 0) for (let q = -3; q <= 3; q += 1.5) { el('line', { x1: iso(q, y, -s)[0], y1: iso(q, y, -s)[1], x2: iso(q, y, s)[0], y2: iso(q, y, s)[1], stroke: '#2E3946' }, g); el('line', { x1: iso(-s, y, q)[0], y1: iso(-s, y, q)[1], x2: iso(s, y, q)[0], y2: iso(s, y, q)[1], stroke: '#2E3946' }, g); }
    if (i === 2) [1, 1.8, 2.6, 3.4].forEach((r) => { const pts = []; for (let a = 0; a <= 40; a++) { const tt = a / 40 * Math.PI * 2; pts.push(pt(Math.cos(tt) * r * 0.9, y, Math.sin(tt) * r * 0.75)); } el('polygon', { points: pts.join(' '), fill: 'none', stroke: 'rgba(142,153,166,.45)' }, g); });
    if (i === 3) [[-2, -1, 5], [1.5, -2.5, 4], [0.5, 2, 3], [2.8, 1.2, 3]].forEach(([px, pz, sv]) => { const a = iso(px, y, pz), b = iso(px, y + 0.9, pz); el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#8E99A6' }, g); el('circle', { cx: b[0], cy: b[1], r: 4, fill: SEV5[sv], stroke: '#0B0F13', 'stroke-width': 1.5 }, g); });
  });
  edge([B, 0, -B], [B, HB, -B]); edge([-B, 0, B], [-B, HB, B]); edge([B, 0, B], [B, HB, B]);
  edge([B, HB, -B], [B, HB, B]); edge([-B, HB, B], [B, HB, B]);
  [[B, HB, B], [-B, HB, B], [B, HB, -B], [B, 0, B]].forEach((c) => { const p = iso(...c); el('path', { d: `M${p[0] - 6},${p[1]}h12M${p[0]},${p[1] - 6}v12`, stroke: '#5ED1B3', 'stroke-width': 1 }); });
  const lp = iso(-B, HB + 0.9, B);
  const lg = el('g', { transform: `translate(${lp[0].toFixed(1)} ${lp[1].toFixed(1)})` });
  el('rect', { x: -2, y: -9, width: 7, height: 7, rx: 1.5, fill: '#5ED1B3' }, lg);
  el('text', { x: 14, y: -2, fill: '#EEF2F5', 'font-family': 'IBM Plex Mono, monospace', 'font-size': 12, 'font-weight': 500, 'letter-spacing': '1.8' }, lg).textContent = 'NO NETWORK REQUIRED';
  const a0 = iso(B + 6.5, 4.2, -1), a1 = iso(B + 1.4, 4.2, -1), xm = iso(B + 0.7, 4.2, -1);
  el('line', { x1: a0[0], y1: a0[1], x2: a1[0], y2: a1[1], stroke: '#8E99A6', 'stroke-width': 1, class: 'wan' });
  el('path', { d: `M${xm[0] - 5},${xm[1] - 5}l10,10M${xm[0] + 5},${xm[1] - 5}l-10,10`, stroke: '#E5484D', 'stroke-width': 1.4 });
  el('text', { x: a0[0] - 4, y: a0[1] - 10, fill: '#8E99A6', 'font-family': 'IBM Plex Mono, monospace', 'font-size': 10.5, 'letter-spacing': '1.4', 'text-anchor': 'end' }).textContent = 'WAN · NOT CONNECTED';
  const bp = iso(B, 0, B);
  el('text', { x: bp[0], y: bp[1] + 26, fill: '#8E99A6', 'font-family': 'IBM Plex Mono, monospace', 'font-size': 10.5, 'letter-spacing': '1.4', 'text-anchor': 'middle' }).textContent = 'LOCAL DISK · YOUR HARDWARE';

  const cb = $('#ctaBg'), k2 = 26, iso2 = (x, y, z) => [490 + (x - z) * 0.866 * k2, 330 + (x + z) * 0.5 * k2 - y * k2];
  for (let i = 0; i < 5; i++) {
    const y = i * 1.7 - 3.2, s2 = 7.2, P = [iso2(-s2, y, -s2), iso2(s2, y, -s2), iso2(s2, y, s2), iso2(-s2, y, s2)];
    const e = document.createElementNS(NS, 'polygon'); e.setAttribute('points', P.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '));
    e.setAttribute('fill', 'none'); e.setAttribute('stroke', i === 4 ? 'rgba(94,209,179,.35)' : 'rgba(58,70,84,.55)'); e.setAttribute('stroke-width', '1'); cb.appendChild(e);
  }
})();
