/* ============================================================
   Quadrion AI · Direction A2 · Mission Control
   Page shell: scroll pin, chapters, spec sheet, trust, CTA.
   The WebGL mission lives in ./scene.js (lazy imported).
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const root = document.documentElement;

const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HAS_GSAP = !!(window.gsap && window.ScrollTrigger);
const CAN_GL = (() => {
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return false;
    const ext = g.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    return true;
  } catch (e) { return false; }
})();
let FLAT = RM || !HAS_GSAP || !CAN_GL;
root.classList.toggle('flat', FLAT);
if (!CAN_GL) root.classList.add('no-gl');

/* shared state with the scene */
const S = {
  p: 0, ch: -2, still: 0,
  mx: 0, my: 0, px: 0, py: 0, over: false,
  t0: performance.now(),
};
const stage = $('#stage'), heroEl = $('#hero'), cue = $('#cue'), scrimL = $('#scrimL');
const chaps = $$('.chap'), railF = $('#railF'), railL = $$('#railL span'), chI = $('#chI');
const C_START = [0.05, 0.22, 0.475, 0.715, 0.89];
let scene = null;

/* ---------- line splitting for chapter copy ---------- */
function splitLines() {
  $$('[data-split]').forEach((el) => {
    const text = el.dataset.src || (el.dataset.src = el.textContent.replace(/\s+/g, ' ').trim());
    el.textContent = '';
    const words = text.split(' ');
    const spans = words.map((w, i) => {
      const s = document.createElement('span');
      s.textContent = i < words.length - 1 ? w + ' ' : w;
      el.appendChild(s);
      return s;
    });
    const tops = spans.map((s) => s.offsetTop);
    const lines = [];
    let cur = '', lt = tops[0];
    spans.forEach((s, i) => {
      if (Math.abs(tops[i] - lt) > 3) { lines.push(cur); cur = ''; lt = tops[i]; }
      cur += s.textContent;
    });
    lines.push(cur);
    el.textContent = '';
    lines.forEach((l) => {
      const o = document.createElement('span'); o.className = 'ln';
      const n = document.createElement('span'); n.textContent = l;
      o.appendChild(n); el.appendChild(o);
    });
  });
  chaps.forEach((c) => $$('.ln > *', c).forEach((s, i) => s.style.setProperty('--i', i)));
}

/* ---------- chapter index ticker ---------- */
let tickRaf = 0;
function tickIndex(to) {
  cancelAnimationFrame(tickRaf);
  const target = String(to).padStart(2, '0');
  if (RM) { chI.textContent = target; return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = (now - t0) / 380;
    if (k >= 1) { chI.textContent = target; return; }
    chI.textContent = '0' + String(Math.floor(Math.random() * 10));
    tickRaf = requestAnimationFrame(step);
  };
  tickRaf = requestAnimationFrame(step);
}

/* ---------- chapter state ---------- */
function setChapter(i) {
  if (i === S.ch) return;
  S.ch = i;
  stage.dataset.ch = String(i);
  chaps.forEach((c, k) => {
    c.classList.toggle('is-active', FLAT || k === i);
    c.classList.toggle('is-past', !FLAT && i >= 0 && k < i);
  });
  railL.forEach((s, k) => s.classList.toggle('on', k === i));
  if (i >= 0) tickIndex(i + 1);
  if (scene) scene.onChapter(i);
}
function chapterFor(p) {
  if (p < C_START[0]) return -1;
  let c = 0;
  for (let k = 0; k < C_START.length; k++) if (p >= C_START[k]) c = k;
  return c;
}
function onProgress(p) {
  S.p = p;
  setChapter(chapterFor(p));
  railF.style.transform = `scaleX(${clamp((p - C_START[0]) / (1 - C_START[0]), 0, 1).toFixed(4)})`;
  const h = sstep(0, 0.045, p);
  heroEl.style.opacity = (1 - h).toFixed(3);
  heroEl.style.transform = `translate3d(0,${(-h * 60).toFixed(1)}px,0)`;
  heroEl.style.visibility = h > 0.99 ? 'hidden' : 'visible';
  cue.style.opacity = (1 - sstep(0, 0.015, p)).toFixed(3);
  scrimL.style.opacity = (sstep(0.035, 0.08, p) * (1 - sstep(0.9, 0.93, p))).toFixed(3);
}

/* ---------- smooth scroll + pin ---------- */
let lenis = null, pinST = null;
function setupScroll() {
  if (FLAT) { setupFlat(); return; }
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  if (window.Lenis) {
    lenis = new window.Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  pinST = ScrollTrigger.create({
    trigger: stage,
    start: 'top top',
    end: () => '+=' + Math.round(window.innerHeight * 12),
    pin: true,
    pinSpacing: true,
    anticipatePin: 1,
    invalidateOnRefresh: true,
    onUpdate: (self) => onProgress(self.progress),
  });
  onProgress(pinST.progress);
}

/* reduced motion / no GSAP / no WebGL: sticky stills that step per chapter */
let flatIO = null;
function setupFlat() {
  chaps.forEach((c) => { c.classList.add('is-active'); c.classList.remove('is-past'); });
  setChapter(-1);
  const heroSentinel = $('#view');
  const pick = () => {
    const mid = window.innerHeight * 0.5;
    let k = -1;
    chaps.forEach((c, i) => { const r = c.getBoundingClientRect(); if (r.top < mid) k = i; });
    if (k !== S.ch) {
      setChapter(k);
      S.still = k + 1;
      if (scene) scene.setStill(S.still);
    }
  };
  let tk = false;
  window.addEventListener('scroll', () => { if (!tk) { tk = true; requestAnimationFrame(() => { tk = false; pick(); }); } }, { passive: true });
  pick();
  flatIO = heroSentinel;
}
function goFlat() {
  if (FLAT) return;
  FLAT = true;
  root.classList.add('flat');
  if (pinST) { pinST.kill(true); pinST = null; }
  heroEl.style.opacity = ''; heroEl.style.transform = ''; heroEl.style.visibility = '';
  scrimL.style.opacity = '';
  S.ch = -2;
  setupFlat();
  if (window.ScrollTrigger) window.ScrollTrigger.refresh();
}

/* ---------- anchors ---------- */
$$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href');
  if (!id || id.length < 2) return;
  const el = id === '#top' ? document.body : $(id);
  if (!el) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(id === '#top' || id === '#stage' ? 0 : el, { offset: -40, duration: 1.6 });
  else if (id === '#top' || id === '#stage') window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
  else el.scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
}));

/* ---------- nav state ---------- */
const nav = $('#nav');
let navTick = false;
const navUpdate = () => { navTick = false; nav.classList.toggle('solid', window.scrollY > 8); };
window.addEventListener('scroll', () => { if (!navTick) { navTick = true; requestAnimationFrame(navUpdate); } }, { passive: true });
navUpdate();

/* ---------- reveals ---------- */
const revealEls = $$('[data-reveal], #spec');
if (RM || !('IntersectionObserver' in window)) revealEls.forEach((el) => el.classList.add('in'));
else {
  const io = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  revealEls.forEach((el) => io.observe(el));
}

/* ---------- spec rows: odometer, count-up, cursor peek of real stills ---------- */
const peek = $('#peek'), peekImg = $('#peekImg'), peekC = $('#peekC'), peekC2 = $('#peekC2');
const pk = { x: 0, y: 0, tx: 0, ty: 0, on: false, raf: 0 };
function peekLoop() {
  pk.x += (pk.tx - pk.x) * 0.16; pk.y += (pk.ty - pk.y) * 0.16;
  peek.style.transform = `translate3d(${pk.x.toFixed(1)}px,${pk.y.toFixed(1)}px,0)`;
  if (pk.on || Math.abs(pk.tx - pk.x) > 0.5) pk.raf = requestAnimationFrame(peekLoop); else pk.raf = 0;
}
function peekAt(e) {
  const w = 280, h = 214;
  pk.tx = e.clientX + 28 + w > window.innerWidth ? e.clientX - w - 28 : e.clientX + 28;
  pk.ty = clamp(e.clientY - h * 0.5, 72, window.innerHeight - h - 16);
}
$$('.row').forEach((row) => {
  const idx = $('.r-idx', row);
  const n = Number(row.dataset.n);
  const cnt = $('[data-count]', row);
  let raf = 0;
  const run = () => {
    if (RM) return;
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const to = cnt ? Number(cnt.dataset.count) : 0;
    const pre = cnt ? (cnt.dataset.pre || '') : '';
    const suf = cnt ? (cnt.dataset.suf || '') : '';
    const step = (now) => {
      const k = clamp((now - t0) / 750, 0, 1);
      const e = 1 - Math.pow(1 - k, 4);
      idx.textContent = String(Math.round(e * n)).padStart(2, '0');
      if (cnt) cnt.textContent = pre + Math.round(e * to) + suf;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  row.addEventListener('pointerenter', (e) => {
    run();
    if (!row.dataset.peek || e.pointerType === 'touch' || window.innerWidth < 1100) return;
    if (peekImg.getAttribute('src') !== row.dataset.peek) peekImg.src = row.dataset.peek;
    peekC.textContent = row.dataset.cap || '';
    peekC2.textContent = row.dataset.cap2 || '';
    if (!pk.on) { peekAt(e); pk.x = pk.tx; pk.y = pk.ty + 18; }
    pk.on = true; peek.classList.add('on');
    if (!pk.raf) pk.raf = requestAnimationFrame(peekLoop);
  });
  row.addEventListener('pointermove', (e) => { if (pk.on) peekAt(e); });
  row.addEventListener('pointerleave', () => { pk.on = false; peek.classList.remove('on'); });
  row.addEventListener('focus', run);
});

/* ---------- trust ticker ---------- */
const ioEl = $('#io'), upT = $('#upT');
let ioV = 412.6;
function trustTick() {
  const s = Math.floor((performance.now() - S.t0) / 1000);
  upT.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
  ioV = clamp(ioV + (Math.random() - 0.5) * 38, 180, 690);
  ioEl.textContent = ioV.toFixed(1).padStart(5, '0') + ' MB/s';
}
if (!RM) setInterval(trustTick, 700);

/* ---------- CTA topography ---------- */
function hash(i, j) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, z) { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }
(function topo() {
  const svg = $('#topo');
  let out = '';
  const cx = 1080, cy = 380;
  for (let k = 0; k < 17; k++) {
    const r0 = 26 + k * 30;
    let d = '';
    for (let a = 0; a <= 120; a++) {
      const th = (a / 120) * Math.PI * 2;
      const n = fbm(Math.cos(th) * 1.3 + 4.2, Math.sin(th) * 1.3 + k * 0.05);
      const r = r0 * (1 + 0.26 * n);
      d += (a ? 'L' : 'M') + (cx + Math.cos(th) * r * 1.45).toFixed(1) + ' ' + (cy + Math.sin(th) * r * 0.82).toFixed(1);
    }
    out += `<path d="${d}Z"${k === 6 ? ' class="hi"' : ''}/>`;
  }
  svg.innerHTML = out;
})();

/* ---------- footer lockup (clone nav mark) ---------- */
(function footMark() {
  const src = $('.nav .brand svg'), dst = $('.foot .brand svg');
  if (src && dst) dst.innerHTML = src.innerHTML;
})();

/* ---------- pointer over the stage ---------- */
const view = $('#view');
view.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const r = view.getBoundingClientRect();
  S.px = e.clientX - r.left; S.py = e.clientY - r.top;
  S.mx = (S.px / r.width) * 2 - 1; S.my = (S.py / r.height) * 2 - 1;
  S.over = true;
});
view.addEventListener('pointerleave', () => { S.over = false; S.mx = 0; S.my = 0; });

/* ---------- boot ---------- */
splitLines();
setupScroll();
let rsT = 0, lastW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(rsT);
  rsT = setTimeout(() => {
    if (window.innerWidth !== lastW) { lastW = window.innerWidth; splitLines(); }
  }, 180);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
  splitLines();
  if (window.ScrollTrigger && !FLAT) window.ScrollTrigger.refresh();
});

function glFail() {
  root.classList.add('no-gl');
  root.classList.remove('gl-ok');
  goFlat();
}

if (CAN_GL) {
  import('./scene.js')
    .then((m) => m.init({ S, RM, isFlat: () => FLAT, onFail: glFail }))
    .then((api) => {
      if (!api) return;
      scene = api;
      if (S.ch > -2) scene.onChapter(S.ch);
      if (FLAT) scene.setStill(S.still);
    })
    .catch((e) => { console.error(e); glFail(); });
}
