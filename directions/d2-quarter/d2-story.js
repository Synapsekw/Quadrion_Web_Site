/* Direction D2 · The Quarter: DOM, scroll story and interactions. */
(function () {
  'use strict';
  var html = document.documentElement;
  var reduced = html.classList.contains('reduced');
  var hasGsap = !!(window.gsap && window.ScrollTrigger);
  var motion = hasGsap && !reduced;
  if (!motion) html.classList.remove('motion');
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);

  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Real data used by the DOM (extracted from directions/data) ---------- */
  var DATA = {
    tank: [
      { id: 'F01', t: 'Crack in bottom plate', s: 5, c: 'Crack', a: 'Bottom plate', h: 0.04, img: 'photos/F01_109_0256.jpg' },
      { id: 'F02', t: 'Top plate patch damage', s: 4, c: 'Patch damage', a: 'Roof', h: 8.48, img: 'photos/F02_106_0172.jpg' },
      { id: 'F04', t: 'Top plate blisters', s: 3, c: 'Coating blister', a: 'Roof', h: 8.69, img: 'photos/F04_101_0035.jpg' },
      { id: 'F05', t: 'Top plate corrosion', s: 3, c: 'Corrosion', a: 'Roof', h: 8.56, img: 'photos/F05_108_0220.jpg' },
      { id: 'F06', t: 'Top ring joint blisters', s: 3, c: 'Coating blister', a: 'Roof to shell joint', h: 8.28, img: 'photos/F06_107_0186.jpg' },
      { id: 'F09', t: "Vertical joint 3 o'clock", s: 3, c: 'Coating blister', a: 'Shell', h: 4.74, img: 'photos/F09_105_0144.jpg' }
    ],
    flare: [
      { id: 'F04', comp: 'Flare neck / bolted connection', z: 'Flare head', y: 76.7 },
      { id: 'F31', comp: 'Flare neck / bolted connection', z: 'Flare head', y: 75.9 },
      { id: 'F44', comp: 'Stack cladding / seam', z: 'Stack / access', y: 55.3 },
      { id: 'F47', comp: 'Stack cladding / seam', z: 'Stack / access', y: 50.0 },
      { id: 'F60', comp: 'Stack cladding / seam', z: 'Base / inlet', y: 10.4 },
      { id: 'F70', comp: 'Large inlet flange', z: 'Base / inlet', y: 3.4 }
    ],
    piles: [['P01', 1754, 1819], ['P02', 14687, 11379], ['P03', 12742, 10237], ['P04', 1245, 1250], ['P05', 7496, 4825], ['P06', 1613, 1447], ['P07', 262, 310], ['P08', 5677, 5644], ['P09', 2018, 1631], ['P10', 11044, 11119], ['P11', 265, 293], ['P12', 65, 155], ['P13', 5423, 4444], ['P14', 1072, 795], ['P15', 177, 322], ['P16', 8627, 7209], ['P17', 134, 184], ['P18', 1314, 215], ['P19', 587, 126]],
    tot: { a: 76199, b: 63402, d: -12797 } // volumes.json totals.e1.tin / e2.tin, net (triangulated toe)
  };
  var DATA_URL = '../data/';
  var sevName = { 5: 'Severity 5', 4: 'Severity 4', 3: 'Severity 3', 2: 'Severity 2', 1: 'Severity 1' };

  /* ---------- Shared state for the WebGL director ---------- */
  var S = window.QS = { hero: 0, sep: 0, win: 0, winq: 0, spin: 0, zoom: 0, plant: 0, iris: 0, tank: 0, rise: 0, flare: 0, scan: 0, ignite: 0, wipe1: 0, wipe2: 0, stock: 0, W: innerWidth, H: innerHeight };

  window.QLayout = function (W, H) {
    var m = W < 761;
    var fs = m ? Math.min(W * 0.84, H * 0.42) : Math.min(H * 0.66, W * 0.4);
    var pc = fs * 0.443;
    return {
      m: m, hx: W / 2, hy: H * (m ? 0.27 : 0.4), hs: m ? Math.min(H * 0.28, W * 0.6) : Math.min(H * 0.44, W * 0.34),
      sx: W / 2, sy: H * 0.5, ss: m ? Math.min(W * 0.46, H * 0.25) : Math.min(H * 0.34, W * 0.28),
      fs: fs, pc: pc, fy: H * (m ? 0.47 : 0.535),
      spx: m ? pc / 2 + 8 : pc / 2 + Math.min(W * 0.03, 44),
      spy: m ? pc / 2 + 48 : pc / 2 + Math.min(H * 0.035, 32)
    };
  };

  function hasGL() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      return true;
    } catch (e) { return false; }
  }
  if (!hasGL()) html.classList.add('no-webgl');
  else setTimeout(function () { if (!window.__qglReady) html.classList.add('no-webgl'); }, 9000);

  /* ---------- Layout vars ---------- */
  var pin = $('.stage-pin');
  function setLayout() {
    var W = pin.clientWidth || innerWidth;
    var H = motion ? (pin.clientHeight || innerHeight) : innerHeight;
    var L = window.QLayout(W, H);
    S.W = W; S.H = H;
    pin.style.setProperty('--spx', L.spx.toFixed(1));
    pin.style.setProperty('--spy', L.spy.toFixed(1));
    pin.style.setProperty('--pc', L.pc.toFixed(1));
    pin.style.setProperty('--fy', L.fy.toFixed(1));
    layoutAnno();
  }

  /* ---------- Nav ---------- */
  var nav = $('#nav'), navOn = false;
  function onScrollNav() { var on = (window.scrollY || 0) > 24; if (on !== navOn) { navOn = on; nav.classList.toggle('is-scrolled', on); } }
  addEventListener('scroll', onScrollNav, { passive: true }); onScrollNav();

  /* ---------- Split words ---------- */
  var words = [];
  $$('.st-line').forEach(function (line) {
    var parts = line.textContent.trim().split(/\s+/); line.textContent = '';
    parts.forEach(function (p, i) { var s = document.createElement('span'); s.className = 'w'; s.textContent = p; line.appendChild(s); words.push(s); if (i < parts.length - 1) line.appendChild(document.createTextNode(' ')); });
  });
  $$('.kt .ln').forEach(function (ln) {
    var nodes = Array.prototype.slice.call(ln.childNodes); ln.textContent = '';
    nodes.forEach(function (n) {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { ln.appendChild(document.createTextNode(' ')); return; }
          var w = document.createElement('span'); w.className = 'w'; w.textContent = part; ln.appendChild(w);
        });
      } else { var w2 = document.createElement('span'); w2.className = 'w'; w2.appendChild(n); ln.appendChild(w2); }
    });
  });

  /* ---------- Trust switches ---------- */
  $$('.sw').forEach(function (sw) {
    sw.addEventListener('click', function () { sw.classList.remove('is-click'); void sw.offsetWidth; sw.classList.add('is-click'); clearTimeout(sw._t); sw._t = setTimeout(function () { sw.classList.remove('is-click'); }, 1600); });
  });

  /* ---------- Lazy images: preload the next asset's photos early ---------- */
  function loadImgs(scope) { $$('img[data-src]', scope).forEach(function (im) { if (!im.getAttribute('src')) { im.decoding = 'async'; im.src = im.getAttribute('data-src'); } }); }
  window.addEventListener('d2:asset', function (e) {
    if (e.detail.state !== 'ready') return;
    if (e.detail.name === 'plant') loadImgs($('.shot-tank'));
    if (e.detail.name === 'tank') loadImgs($('.shot-flare'));
  });
  window.addEventListener('d2:assets', function (e) {
    var A = e.detail || {};
    $$('[data-stat]').forEach(function (el) { var a = A[el.getAttribute('data-stat')]; if (a && a.stat) el.textContent = a.stat; });
    $$('[data-kind]').forEach(function (el) { var a = A[el.getAttribute('data-kind')]; if (a && a.kind) el.textContent = a.kind; });
  });
  if (!motion) { $$('img[data-src]').forEach(function (im) { im.loading = 'lazy'; }); loadImgs(document); }
  else setTimeout(function () { loadImgs($('.shot-tank')); }, 6000);

  /* =================== One view: app recreation =================== */
  var appIssues = $('.ai-list'), aiTitle = $('.ai-title'), aiCount = $('.ai-count'), avTitle = $('.av-title');
  var agentQ = $('.app-agent .ag-q'), agentA = $('.app-agent .ag-a');
  var DS = {
    plant: { title: 'Tank terminal', panel: 'Layers', count: '3', q: 'How big is this site?', a: 'About 2.1 km by 1 km, with 8 large storage tanks and a jetty, captured as 757,579 photogrammetry points.',
      layers: ['Point cloud', 'Orthomosaic', 'Engineering model'], on: [1, 1, 0, 0, 0] },
    tank: { title: 'Storage tank interior', panel: 'Findings', count: '6', q: 'Which findings need action first?', a: 'F01, a crack in the bottom plate (severity 5), then F02, patch damage on the roof plate (severity 4).', on: [0, 1, 1, 0, 0] },
    flare: { title: 'Flare stack, 80 m', panel: 'Issues', count: '78', q: 'Where is the corrosion on this stack?', a: '41 of 78 patches sit on the flare neck and its bolted connection. The rest are on cladding seams and the base inlet.', on: [1, 1, 1, 0, 0] },
    stock: { title: 'Stockpile yard', panel: 'Volumes', count: '19', q: 'How much did the piles change?', a: 'Net volume fell from 76,199 m³ to 63,402 m³ in 10 days. The largest drop is P02, down 3,308 m³.', on: [1, 0, 0, 1, 0] }
  };
  function issueHTML(ds) {
    var out = '';
    if (ds === 'tank') DATA.tank.forEach(function (f) { out += '<li class="iss"><img data-src="' + DATA_URL + 'tank/' + f.img + '" alt="' + f.t + '" width="54" height="40"><div><b>' + f.t + '</b><span class="sev s' + f.s + '">' + sevName[f.s] + '</span> <span class="mono">' + f.id + ' · ' + f.h.toFixed(2) + ' m</span></div></li>'; });
    else if (ds === 'flare') DATA.flare.forEach(function (f) { out += '<li class="iss"><img data-src="' + DATA_URL + 'flare/patches/' + f.id + '.webp" alt="' + f.comp + '" width="54" height="40"><div><b>' + f.comp + '</b><span class="sev s2">Moderate rust</span> <span class="mono">' + f.id + ' · ' + f.y.toFixed(1) + ' m</span></div></li>'; });
    else if (ds === 'stock') DATA.piles.slice().sort(function (p, q) { return Math.abs(q[2] - q[1]) - Math.abs(p[2] - p[1]); }).slice(0, 9).forEach(function (p) {
      var mx = 14687, d = p[2] - p[1];
      out += '<li class="vol-row"><span>' + p[0] + '</span><span class="bars"><i style="width:' + (p[1] / mx * 100).toFixed(1) + '%"></i><i style="width:' + (p[2] / mx * 100).toFixed(1) + '%"></i></span><em>' + (d < 0 ? '−' : '+') + fmt(Math.abs(d)) + '</em></li>';
    });
    else {
      out += '<li class="iss"><span class="ph" style="background:linear-gradient(135deg,#2c3a33,#4a4c3f)"></span><div><b>Photogrammetry cloud</b><span class="mono">757,579 points · RGB</span></div></li>';
      out += '<li class="iss"><img data-src="' + DATA_URL + 'plant/ortho.jpg" alt="Orthomosaic" width="54" height="40"><div><b>Orthomosaic</b><span class="mono">0.53 m / px</span></div></li>';
      out += '<li class="iss"><span class="ph" style="background:linear-gradient(135deg,#3a4350,#6b7682)"></span><div><b>Engineering model</b><span class="mono">Tanks, pipe racks, jetty</span></div></li>';
    }
    return out;
  }
  var curDs = 'flare';
  function setDs(ds, initial) {
    curDs = ds;
    var d = DS[ds];
    $$('[data-ds]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ds') === ds); b.setAttribute('aria-pressed', b.getAttribute('data-ds') === ds ? 'true' : 'false'); });
    avTitle.textContent = d.title; aiTitle.textContent = d.panel; aiCount.textContent = d.count;
    agentQ.textContent = d.q; agentA.textContent = d.a;
    appIssues.innerHTML = issueHTML(ds);
    $$('.layers li').forEach(function (li, i) { li.classList.toggle('on', !!d.on[i]); });
    if (!initial || appImgsOn) loadImgs(appIssues);
    window.dispatchEvent(new CustomEvent('d2:dataset', { detail: ds }));
    layoutAnno();
  }
  var appImgsOn = !motion;
  $$('[data-ds]').forEach(function (b) { b.addEventListener('click', function () { setDs(b.getAttribute('data-ds')); }); });
  setDs('flare', true);

  /* Leader labels anchored to real elements of the recreated app (fixes the round 1 stray line) */
  var win = $('.win'), anno = $('.win-anno'), leaderSvg = $('.leaders', anno), leaderPaths = $$('.leaders path', anno);
  var pins = $$('.pin', anno), tags = $$('.tag', anno);
  function offsetIn(el, root) { var x = 0, y = 0; while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return { x: x, y: y }; }
  function layoutAnno() {
    if (!win) return;
    var w = win.offsetWidth, h = win.offsetHeight; if (!w || !h) return;
    leaderSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var pick = [
      [$('.ds.on'), 0.12, 0.5, 'l'], [$('.app-view'), 0.62, 0.28, 'l'], [$('.ai-list li'), 0.08, 0.5, 'r'],
      [$$('.app-time .trk')[1], 0.62, 0.5, 'r'], [$('.app-agent'), 0.04, 0.2, 'l']
    ];
    var pts = pick.map(function (p) {
      var el = p[0]; if (!el || !el.offsetWidth) return null;
      var o = offsetIn(el, win); return { x: o.x + el.offsetWidth * p[1], y: o.y + el.offsetHeight * p[2], side: p[3] };
    });
    // tag rows, spaced so they never overlap
    var ty = pts.map(function (p) { return p ? p.y : 0; });
    ['l', 'r'].forEach(function (side) {
      var idx = pts.map(function (p, i) { return p && p.side === side ? i : -1; }).filter(function (i) { return i > -1; }).sort(function (a, b) { return ty[a] - ty[b]; });
      for (var k = 1; k < idx.length; k++) if (ty[idx[k]] - ty[idx[k - 1]] < 52) ty[idx[k]] = ty[idx[k - 1]] + 52;
    });
    pts.forEach(function (p, i) {
      if (!p) { pins[i].style.display = 'none'; tags[i].style.display = 'none'; leaderPaths[i].setAttribute('d', ''); return; }
      pins[i].style.display = ''; tags[i].style.display = '';
      pins[i].style.left = p.x.toFixed(1) + 'px'; pins[i].style.top = p.y.toFixed(1) + 'px';
      var tx = p.side === 'l' ? -0.035 * w : 1.035 * w;
      tags[i].style.left = tx.toFixed(1) + 'px'; tags[i].style.top = ty[i].toFixed(1) + 'px';
      var xm = tx + (p.side === 'l' ? 22 : -22);
      leaderPaths[i].setAttribute('d', 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + 'L' + xm.toFixed(1) + ' ' + ty[i].toFixed(1) + 'L' + tx.toFixed(1) + ' ' + ty[i].toFixed(1));
    });
  }

  /* =================== Chapters content (real data) =================== */
  // Tank findings grid
  var pgrid = $('#pgrid');
  if (pgrid) pgrid.innerHTML = DATA.tank.map(function (f) { return '<figure><img data-src="' + DATA_URL + 'tank/' + f.img + '" alt="' + f.t + '" width="1280" height="960"><figcaption><span class="sev s' + f.s + '">' + sevName[f.s] + ' · ' + f.c + '</span>' + f.t + '</figcaption></figure>'; }).join('');
  // Volume bars
  var vbars = $('#vol .vbars');
  if (vbars) {
    var top = DATA.piles.slice().sort(function (p, q) { return Math.abs(q[2] - q[1]) - Math.abs(p[2] - p[1]); }).slice(0, 6);
    vbars.innerHTML = top.map(function (p) { var d = p[2] - p[1]; return '<div class="vbar"><span>' + p[0] + '</span><span class="tr"><i class="a" style="width:' + (p[1] / 14687 * 100).toFixed(1) + '%"></i><i class="b" style="width:' + (p[2] / 14687 * 100).toFixed(1) + '%"></i></span><em class="' + (d > 0 ? 'up' : '') + '">' + (d < 0 ? '−' : '+') + fmt(Math.abs(d)) + ' m³</em></div>'; }).join('');
  }
  var volDrawn = false;
  function drawVolPlan() {
    if (volDrawn) return; volDrawn = true;
    var svg = $('#vol svg'); if (!svg || !window.fetch) return;
    fetch(DATA_URL + 'stockpile/volumes.json').then(function (r) { return r.json(); }).then(function (v) {
      var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      v.piles.forEach(function (p) { ['e1', 'e2'].forEach(function (e) { p.epochs[e].ring.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }); }); });
      var pad = 16; svg.setAttribute('viewBox', (x0 - pad) + ' ' + (z0 - pad) + ' ' + (x1 - x0 + 2 * pad) + ' ' + (z1 - z0 + 2 * pad));
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      var g = '';
      for (var gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) g += '<line x1="' + gx + '" x2="' + gx + '" y1="' + (z0 - pad) + '" y2="' + (z1 + pad) + '" stroke="#1E2630" stroke-width="1" vector-effect="non-scaling-stroke"/>';
      for (var gz = Math.ceil(z0 / 50) * 50; gz < z1; gz += 50) g += '<line y1="' + gz + '" y2="' + gz + '" x1="' + (x0 - pad) + '" x2="' + (x1 + pad) + '" stroke="#1E2630" stroke-width="1" vector-effect="non-scaling-stroke"/>';
      v.piles.forEach(function (p) {
        var a = p.epochs.e1, b = p.epochs.e2, d = b.volumes.tin.net - a.volumes.tin.net;
        var col = d < -50 ? '#F2994A' : d > 50 ? '#5B9BD5' : '#8E99A6';
        var pa = a.ring.map(function (q) { return q[0] + ',' + q[1]; }).join(' ');
        var pb = b.ring.map(function (q) { return q[0] + ',' + q[1]; }).join(' ');
        g += '<polygon points="' + pb + '" fill="' + col + '" fill-opacity=".28" stroke="' + col + '" stroke-width="1.2" vector-effect="non-scaling-stroke"/>';
        g += '<polygon points="' + pa + '" fill="none" stroke="#C5CDD6" stroke-opacity=".7" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke"/>';
        if (Math.abs(d) > 1000) {
          var cx = 0, cz = 0; b.ring.forEach(function (q) { cx += q[0]; cz += q[1]; }); cx /= b.ring.length; cz /= b.ring.length;
          g += '<text x="' + cx.toFixed(1) + '" y="' + (cz + 3).toFixed(1) + '" fill="#EEF2F5" font-family="IBM Plex Mono" font-size="9" text-anchor="middle">' + p.id + '</text>';
        }
      });
      svg.innerHTML = g;
    }).catch(function () {});
  }
  // Corrosion mask: class indices recoloured with the legend
  var corDone = false;
  function drawMask() {
    if (corDone) return; corDone = true;
    var cor = $('#cor'); if (!cor) return;
    loadImgs(cor);
    var cv = $('canvas', cor), img = new Image();
    img.onload = function () {
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      var cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      var d = cx.getImageData(0, 0, cv.width, cv.height), a = d.data;
      var pal = { 1: [250, 211, 75], 2: [255, 122, 45], 3: [238, 63, 75], 4: [182, 142, 248] };
      for (var i = 0; i < a.length; i += 4) { var c = pal[a[i]]; if (c) { a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 200; } else a[i + 3] = 0; }
      cx.putImageData(d, 0, 0);
    };
    img.src = DATA_URL + 'flare/patches/F44-mask.png';
    var setCut = function (v) { cor.style.setProperty('--cut', (v * 100).toFixed(2) + '%'); };
    var o = { v: 1 };
    if (hasGsap && !reduced) gsap.to(o, { v: 0.42, duration: 1.8, ease: 'expo.out', delay: 0.2, onUpdate: function () { setCut(o.v); } });
    else setCut(0.42);
    cor.addEventListener('pointermove', function (e) { var r = cor.getBoundingClientRect(); setCut(clamp01((e.clientX - r.left) / r.width)); });
  }
  // Agent chat typewriter
  var chatDone = false;
  function typeChat() {
    if (chatDone) return; chatDone = true;
    var chat = $('#chat'); if (!chat) return;
    loadImgs(chat);
    var spans = $$('[data-full]', chat);
    if (!hasGsap || reduced) { spans.forEach(function (s) { s.textContent = s.getAttribute('data-full'); }); return; }
    var caret = document.createElement('span'); caret.className = 'caret';
    var tl2 = gsap.timeline();
    spans.forEach(function (s, k) {
      var full = s.getAttribute('data-full'), o = { n: 0 };
      tl2.add(function () { s.parentNode.insertBefore(caret, s.nextSibling); }, k === 0 ? 0.3 : '+=0.5')
        .to(o, { n: full.length, duration: full.length / 70, ease: 'none', onUpdate: function () { s.textContent = full.slice(0, Math.round(o.n)); } });
    });
    tl2.add(function () { caret.remove(); }, '+=0.6');
  }
  if (!motion) { drawMask(); drawVolPlan(); typeChat(); }
  else if ('IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { loadImgs($('#features')); cio.disconnect(); } });
    }, { rootMargin: '0px 0px 120% 0px' });
    cio.observe($('#features'));
    var aio = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { appImgsOn = true; loadImgs($('.oneview')); aio.disconnect(); } });
    }, { rootMargin: '0px 0px 100% 0px' });
    aio.observe($('.oneview'));
  }
  if (!hasGsap) { setLayout(); return; }

  /* ---------- Lenis ---------- */
  var lenis = null;
  if (motion && window.Lenis) {
    try {
      lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    } catch (e) { lenis = null; }
  }

  /* ---------- Anchors (stage anchors map into the pinned timeline) ---------- */
  var T = 15, AT = { four: 2.2, plant: 6.1 };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href'); if (!id || id.length < 2) return;
    var y = null, at = a.getAttribute('data-at'), stage = $('#stage');
    if (id === '#top') y = 0;
    else if (motion && at && AT[at] !== undefined) y = stage.offsetTop + (AT[at] / T) * (stage.offsetHeight - innerHeight);
    else { var el = $(id); if (el) y = el.getBoundingClientRect().top + (window.scrollY || 0); }
    if (y === null) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(y, { duration: 1.8 }); else window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  });

  /* ---------- Magnetic buttons ---------- */
  var finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  $$('[data-magnetic]').forEach(function (btn) {
    var fill = $('.btn-fill', btn), label = $('.btn-label', btn), rect = null, enter = { x: 0, y: 0 }, dia = 0;
    var xTo = gsap.quickTo(btn, 'x', { duration: 0.9, ease: 'expo.out' }), yTo = gsap.quickTo(btn, 'y', { duration: 0.9, ease: 'expo.out' });
    var lxTo = gsap.quickTo(label, 'x', { duration: 0.9, ease: 'expo.out' }), lyTo = gsap.quickTo(label, 'y', { duration: 0.9, ease: 'expo.out' });
    btn.addEventListener('pointerenter', function (e) {
      rect = btn.getBoundingClientRect();
      var w = btn.offsetWidth, h = btn.offsetHeight;
      enter.x = e.clientX - rect.left; enter.y = e.clientY - rect.top;
      dia = 2.1 * Math.hypot(Math.max(enter.x, w - enter.x), Math.max(enter.y, h - enter.y));
      gsap.killTweensOf(fill);
      gsap.set(fill, { left: enter.x, top: enter.y, width: dia, height: dia, xPercent: -50, yPercent: -50, transformOrigin: '50% 50%' });
      gsap.fromTo(fill, { scale: 0 }, { scale: 1, duration: reduced ? 0.01 : 0.75, ease: 'expo.out' });
    });
    btn.addEventListener('pointermove', function (e) {
      if (!rect || !finePointer || reduced) return;
      var mx = e.clientX - (rect.left + rect.width / 2), my = e.clientY - (rect.top + rect.height / 2);
      xTo(mx * 0.28); yTo(my * 0.38); lxTo(mx * 0.1); lyTo(my * 0.12);
    });
    btn.addEventListener('pointerleave', function (e) {
      var r = rect || btn.getBoundingClientRect(), ex = e.clientX - r.left, ey = e.clientY - r.top;
      gsap.killTweensOf(fill);
      gsap.to(fill, { scale: 0, duration: 0.6, ease: 'expo.out', transformOrigin: (ex - (enter.x - dia / 2)) + 'px ' + (ey - (enter.y - dia / 2)) + 'px' });
      xTo(0); yTo(0); lxTo(0); lyTo(0); rect = null;
    });
  });

  /* ---------- Cursor ---------- */
  if (finePointer && motion) {
    html.classList.add('has-cursor');
    var ring = $('.cursor'), dot = $('.cursor-dot'), cx = -100, cy = -100, rx = -100, ry = -100;
    addEventListener('pointermove', function (e) { cx = e.clientX; cy = e.clientY; dot.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)'; ring.classList.remove('is-out'); dot.classList.remove('is-out'); }, { passive: true });
    gsap.ticker.add(function () { if (Math.abs(cx - rx) < 0.05 && Math.abs(cy - ry) < 0.05) return; rx += (cx - rx) * 0.2; ry += (cy - ry) * 0.2; ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)'; });
    document.addEventListener('pointerover', function (e) { ring.classList.toggle('is-hover', !!(e.target.closest && e.target.closest('a, button, [data-cursor]'))); });
    document.addEventListener('pointerdown', function () { ring.classList.add('is-down'); });
    document.addEventListener('pointerup', function () { ring.classList.remove('is-down'); });
    html.addEventListener('pointerleave', function () { ring.classList.add('is-out'); dot.classList.add('is-out'); });
  }

  /* ---------- Chapter frame tilt ---------- */
  if (finePointer && !reduced) {
    $$('.ch-frame').forEach(function (f) {
      var rxTo = gsap.quickTo(f, 'rotationX', { duration: 0.9, ease: 'expo.out' }), ryTo = gsap.quickTo(f, 'rotationY', { duration: 0.9, ease: 'expo.out' }), r = null;
      f.addEventListener('pointerenter', function () { r = f.getBoundingClientRect(); });
      f.addEventListener('pointermove', function (e) {
        if (!r) r = f.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
        ryTo((nx - 0.5) * 7); rxTo(-(ny - 0.5) * 5);
        f.style.setProperty('--mx', (nx * 100).toFixed(1) + '%'); f.style.setProperty('--my', (ny * 100).toFixed(1) + '%');
      });
      f.addEventListener('pointerleave', function () { rxTo(0); ryTo(0); r = null; });
    });
  }

  if (motion) {
    ScrollTrigger.batch('[data-reveal]', { start: 'top 88%', once: true, onEnter: function (b) { gsap.fromTo(b, { autoAlpha: 0, y: 32 }, { autoAlpha: 1, y: 0, duration: 1.3, ease: 'expo.out', stagger: 0.09, overwrite: true }); } });
  }

  setLayout();
  var rT;
  addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(setLayout, 80); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(setLayout);

  if (!motion) return;

  /* =================== Hero intro =================== */
  gsap.fromTo('.hero-h .line > span', { y: 0, yPercent: 112 }, { yPercent: 0, duration: 1.6, ease: 'expo.out', stagger: 0.13, delay: 0.55 });
  gsap.fromTo('.h-anim', { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 1.4, ease: 'expo.out', stagger: 0.09, delay: 0.85 });
  gsap.from('.nav', { autoAlpha: 0, y: -14, duration: 1.2, ease: 'expo.out', delay: 0.25 });
  gsap.from('.cue, .hero-hud, .hero-data', { autoAlpha: 0, duration: 1.2, ease: 'power2.out', delay: 1.4 });

  /* =================== The cinema: one scrubbed timeline =================== */
  var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '#stage', start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
  function count(el, from, to, at, dur, sign) {
    if (!el) return;
    var o = { v: from };
    var put = function (v) { el.textContent = (sign && v < -0.5 ? '−' : '') + fmt(Math.abs(v)); };
    tl.fromTo(o, { v: from }, { v: to, duration: dur, ease: 'power2.out', onUpdate: function () { put(o.v); }, onComplete: function () { put(to); } }, at);
    tl.add(function () { put(to); }, at + dur + 0.001);
  }
  function callouts(sel, at, follow) {
    $$(sel + ' .callout').forEach(function (c, i) {
      var t0 = at + i * 0.16, card = $('.ccard', c);
      tl.fromTo($('.adot i', c), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.15, ease: 'back.out(2)' }, t0)
        .fromTo($('.aline path', c), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.22, ease: 'power2.out' }, t0 + 0.05)
        .fromTo(card, follow ? { autoAlpha: 0 } : { autoAlpha: 0, y: 14 }, follow ? { autoAlpha: 1, duration: 0.2 } : { autoAlpha: 1, y: 0, duration: 0.25, ease: 'power3.out' }, t0 + 0.18);
    });
  }
  function shotOut(sel, at) {
    tl.to(sel + ' .shot-copy', { autoAlpha: 0, y: -26, duration: 0.28, ease: 'power2.in' }, at);
    if ($$(sel + ' .callout').length) tl.to(sel + ' .callout', { autoAlpha: 0, duration: 0.2 }, at);
    tl.set(sel, { autoAlpha: 0 }, at + 0.32);
  }

  // 0 → 1: hero leaves
  tl.to(S, { hero: 1, duration: 1, ease: 'power2.inOut' }, 0)
    .to('.hero-inner', { y: -70, duration: 0.65, ease: 'power2.in' }, 0.05)
    .to('.hero', { autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, 0.1);

  // Four dimensions: the quarters separate and open as windows onto real assets
  tl.set('.four', { autoAlpha: 1 }, 0.85).set('.numerals', { autoAlpha: 1 }, 0.85)
    .fromTo('.four-head .eyebrow', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 0.9)
    .fromTo('.four-h .line > span', { y: 0, yPercent: 112 }, { yPercent: 0, duration: 0.55, ease: 'expo.out' }, 0.95)
    .to(S, { sep: 1, duration: 1.05, ease: 'power3.inOut' }, 0.95)
    .to(S, { win: 1, winq: 1, duration: 0.7, ease: 'power2.inOut' }, 1.45)
    .fromTo('.q-in', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.14 }, 1.6)
    .fromTo('.four-foot', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 2.1)
    .fromTo('.num', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, stagger: 0.08 }, 1.0)
    .fromTo('.n1', { yPercent: 55 }, { yPercent: -60, duration: 2.9 }, 0.9)
    .fromTo('.n2', { yPercent: 90 }, { yPercent: -35, duration: 2.9 }, 0.9)
    .fromTo('.n3', { yPercent: 40 }, { yPercent: -95, duration: 2.9 }, 0.9)
    .fromTo('.n4', { yPercent: 75 }, { yPercent: -50, duration: 2.9 }, 0.9);

  // Gather: X, Y, Z close, the mark re-forms with one turn, T keeps its window
  tl.to('.q-in', { autoAlpha: 0, y: -18, duration: 0.3, stagger: 0.05, ease: 'power2.in' }, 3.3)
    .to('.four-foot, .four-head .eyebrow', { autoAlpha: 0, duration: 0.3 }, 3.3)
    .to('.four-h .line > span', { yPercent: -112, duration: 0.4, ease: 'power2.in' }, 3.4)
    .to('.num', { autoAlpha: 0, duration: 0.4 }, 3.45)
    .to(S, { winq: 0, duration: 0.45 }, 3.4)
    .to(S, { sep: 0, duration: 0.85, ease: 'power3.inOut' }, 3.45)
    .to(S, { spin: 1, duration: 0.95, ease: 'power2.inOut' }, 3.4)
    .set('.four', { autoAlpha: 0 }, 4.3).set('.numerals', { autoAlpha: 0 }, 4.3);

  // Portal: the mint square flies at the camera and becomes a window into the terminal
  tl.fromTo('.portal-cap', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 4.15)
    .to('.portal-cap', { autoAlpha: 0, duration: 0.25 }, 4.85)
    .to(S, { zoom: 1, duration: 1.1, ease: 'power1.inOut' }, 4.35)
    .to('.wipe', { autoAlpha: 1, duration: 0.2 }, 5.2).to('.wipe', { autoAlpha: 0, duration: 0.3 }, 5.5);

  // Shot 1: plant cloud at true colour
  tl.fromTo('.tour-hud', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 5.45)
    .to(S, { plant: 1, duration: 1.9 }, 5.45)
    .set('.shot-plant', { autoAlpha: 1 }, 5.45)
    .fromTo('.shot-plant .eyebrow', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 5.5)
    .fromTo('.shot-plant .kt .w', { yPercent: 115 }, { yPercent: 0, duration: 0.55, stagger: 0.07, ease: 'expo.out' }, 5.55)
    .fromTo('.shot-plant .stat', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.08, ease: 'power3.out' }, 5.85);
  count($('.shot-plant [data-count]'), 0, 757579, 5.85, 0.6);
  shotOut('.shot-plant', 6.95);

  // Iris into the tank (mask = the mark), then the LiDAR interior
  tl.to(S, { iris: 1, duration: 0.95, ease: 'power2.inOut' }, 7.15)
    .to(S, { tank: 1, duration: 2.0 }, 7.6)
    .set('.shot-tank', { autoAlpha: 1 }, 7.9)
    .fromTo('.shot-tank .eyebrow', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 7.95)
    .fromTo('.shot-tank .kt .w', { autoAlpha: 0, letterSpacing: '0.4em', xPercent: -8 }, { autoAlpha: 1, letterSpacing: '-0.04em', xPercent: 0, duration: 0.6, stagger: 0.09, ease: 'expo.out' }, 8.0)
    .fromTo('.shot-tank .stat', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.08, ease: 'power3.out' }, 8.25);
  count($('.shot-tank [data-count]'), 0, 280000, 8.25, 0.6);
  callouts('.shot-tank', 8.4);
  shotOut('.shot-tank', 9.3);

  // Vertical rise onto the flare stack: scan resolve, then patch ignition
  tl.to(S, { rise: 1, duration: 0.85 }, 9.55)
    .to(S, { flare: 1, duration: 2.2 }, 10.4)
    .to(S, { scan: 1, duration: 0.8, ease: 'power1.inOut' }, 10.45)
    .to(S, { ignite: 1, duration: 0.7 }, 11.2)
    .set('.shot-flare', { autoAlpha: 1 }, 10.5)
    .fromTo('.shot-flare .eyebrow', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 10.55)
    .fromTo('.shot-flare .kt .w', { yPercent: 150, scaleY: 1.5, transformOrigin: '50% 100%' }, { yPercent: 0, scaleY: 1, duration: 0.6, stagger: 0.1, ease: 'expo.out' }, 10.6)
    .fromTo('.shot-flare .stat', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.08, ease: 'power3.out' }, 10.9);
  count($('.shot-flare [data-count]'), 0, 78, 10.9, 0.45);
  callouts('.shot-flare', 11.6);
  shotOut('.shot-flare', 12.3);

  // Time-wipe: the mint square slides between flare, Survey 1 and Survey 2
  tl.to(S, { wipe1: 1, duration: 0.7, ease: 'power2.inOut' }, 12.55)
    .to(S, { stock: 1, duration: 2.4 }, 12.55)
    .set('.divider', { className: 'divider is-w2' }, 13.3)
    .set('.shot-stock', { autoAlpha: 1 }, 13.05)
    .fromTo('.shot-stock .eyebrow', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 13.05)
    .fromTo('.shot-stock .kt .w', { xPercent: 70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.55, stagger: 0.08, ease: 'expo.out' }, 13.1)
    .fromTo('.shot-stock .counter', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.07, ease: 'power3.out' }, 13.25)
    .to(S, { wipe2: 1, duration: 0.95, ease: 'power1.inOut' }, 13.45);
  count($('[data-vol="a"]'), 0, DATA.tot.a, 13.25, 0.3);
  count($('[data-vol="b"]'), DATA.tot.a, DATA.tot.b, 13.45, 0.5);
  count($('[data-vol="d"]'), 0, DATA.tot.d, 13.45, 0.5, true);
  callouts('.shot-stock', 13.4, true);
  tl.to({}, { duration: 0.01 }, T);

  /* Tour HUD: which asset is on screen */
  var hudSpans = $$('.th-assets span'), hudIdx = -1;
  gsap.ticker.add(function () {
    var i = S.iris < 0.5 ? 0 : S.rise < 0.5 ? 1 : S.wipe1 < 0.5 ? 2 : 3;
    if (i !== hudIdx) { hudIdx = i; hudSpans.forEach(function (s, k) { s.classList.toggle('on', k === i); }); }
  });

  /* SVG fallback for the mark (no WebGL) */
  var fb = $('#fbStage'), fbG = $$('.fbp', fb), fbKey = '';
  var CEN = [[15.53, 15.53], [42.47, 15.53], [15.53, 42.47], [45.5, 45.5]], DIR = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  gsap.ticker.add(function () {
    if (!html.classList.contains('no-webgl')) return;
    var key = S.hero.toFixed(4) + S.sep.toFixed(4) + S.spin.toFixed(4) + S.zoom.toFixed(4) + S.W + 'x' + S.H;
    if (key === fbKey) return; fbKey = key;
    var L = window.QLayout(S.W, S.H), e = S.hero;
    var ax = lerp(L.hx, L.sx, e), ay = lerp(lerp(L.hy, L.sy, e), L.fy, S.sep), size = lerp(lerp(L.hs, L.ss, e), L.fs, S.sep);
    fb.style.transform = 'translate3d(' + (ax - 50).toFixed(2) + 'px,' + (ay - 50).toFixed(2) + 'px,0) scale(' + (size / 100).toFixed(4) + ') rotate(' + (S.spin * 360).toFixed(2) + 'deg)';
    fb.style.opacity = S.zoom > 0.98 ? 0 : 1;
    var u = 60 / size;
    for (var k = 0; k < 4; k++) {
      var tx = S.sep * (DIR[k][0] * L.spx * u - (CEN[k][0] - 30)), ty = S.sep * (DIR[k][1] * L.spy * u - (CEN[k][1] - 30));
      var tr = 'translate(' + tx.toFixed(3) + ' ' + ty.toFixed(3) + ')';
      if (k === 3 && S.zoom > 0) {
        var z = S.zoom, sc = 1 + Math.pow(z, 3) * 90, cm = clamp01(z / 0.6); cm = cm * cm * (3 - 2 * cm);
        tr = 'translate(' + (tx + (30 - CEN[3][0]) * cm).toFixed(3) + ' ' + (ty + (30 - CEN[3][1]) * cm).toFixed(3) + ') translate(45.5 45.5) scale(' + sc.toFixed(3) + ') translate(-45.5 -45.5)';
      }
      fbG[k].setAttribute('transform', tr);
    }
  });

  /* =================== Statement =================== */
  gsap.timeline({ scrollTrigger: { trigger: '.statement', start: 'top top', end: 'bottom bottom', scrub: 0.5 } })
    .fromTo(words, { color: '#8E99A6' }, { color: function (i, el) { return el.closest('.st-mint') ? '#5ED1B3' : '#EEF2F5'; }, duration: 0.3, stagger: 0.12, ease: 'none' })
    .fromTo('.st-foot span', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.1 }, '-=0.1');

  /* =================== One view: window tilts face-on, labels pop =================== */
  var mm = gsap.matchMedia();
  mm.add('(min-width: 761px)', function () {
    var t2 = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.oneview', start: 'top top', end: 'bottom bottom', scrub: 0.7, onRefresh: layoutAnno } });
    t2.fromTo('.win', { rotationX: 32, rotationY: -8, scale: 0.72, yPercent: 14, transformOrigin: '50% 30%' }, { rotationX: 0, rotationY: 0, scale: 1, yPercent: 0, duration: 1.3, ease: 'power2.out' }, 0)
      .fromTo('.ov-eb', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 0)
      .fromTo('.ov-h .line > span', { yPercent: 112 }, { yPercent: 0, duration: 0.5, ease: 'expo.out' }, 0.05)
      .fromTo('.ov-sub', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.4 }, 0.2);
    var items = $$('.tl-item');
    for (var i = 0; i < 5; i++) {
      var at = 1.35 + i * 0.17;
      t2.fromTo(pins[i], { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.16, ease: 'back.out(2.2)' }, at)
        .fromTo(leaderPaths[i], { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.22, ease: 'power2.out' }, at + 0.06)
        .fromTo($('.tag-in', tags[i]), { autoAlpha: 0, scale: 0.72, y: 8 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.22, ease: 'back.out(1.9)' }, at + 0.2)
        .fromTo(items[i], { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.2 }, at + 0.1);
    }
    t2.to({}, { duration: 0.6 }, 2.4);
  });
  mm.add('(max-width: 760px)', function () {
    var t3 = gsap.timeline({ scrollTrigger: { trigger: '.win', start: 'top 85%', once: true } });
    t3.fromTo('.win', { rotationX: 18, scale: 0.92, autoAlpha: 0 }, { rotationX: 0, scale: 1, autoAlpha: 1, duration: 1.2, ease: 'expo.out' })
      .fromTo('.pin', { scale: 0 }, { scale: 1, duration: 0.4, stagger: 0.08, ease: 'back.out(2)' }, 0.4);
  });

  /* =================== Chapters: horizontal pinned scroll =================== */
  var gpuNum = $('.gpu-num'), bars = $$('.bar-fill');
  function setGpu(p) {
    var e = 1 - Math.pow(1 - clamp01(p), 3), n = Math.max(1, Math.round(1 + 19 * e));
    if (gpuNum.textContent !== String(n)) gpuNum.textContent = n;
    bars.forEach(function (b) { b.style.transform = 'scaleX(' + (parseFloat(b.getAttribute('data-w')) * e).toFixed(4) + ')'; });
  }
  var shows = [[$('#cor'), drawMask], [$('#vol'), drawVolPlan], [$('#chat'), typeChat]];
  mm.add('(min-width: 761px)', function () {
    var sec = $('.chapters'), track = $('.ch-track', sec), panels = $$('.ch', sec);
    var gpuIdx = panels.findIndex(function (p) { return p.hasAttribute('data-gpu'); });
    var showIdx = shows.map(function (s) { return panels.indexOf(s[0] && s[0].closest('.ch')); });
    var railFill = $('.ch-hud .rail i', sec), cur = $('.ch-cur', sec);
    var cache = [], dist = 1, vw = innerWidth;
    function measure() { vw = innerWidth; dist = Math.max(1, track.scrollWidth - vw); sec.style.height = (dist + innerHeight) + 'px'; cache = panels.map(function (p) { return { l: p.offsetLeft, w: p.offsetWidth }; }); }
    measure();
    ScrollTrigger.addEventListener('refreshInit', measure);
    var lastCur = '';
    function update() {
      var x = gsap.getProperty(track, 'x') || 0, vc = vw / 2;
      railFill.style.transform = 'scaleX(' + clamp01(-x / dist).toFixed(4) + ')';
      var idx = 1; for (var j = 1; j < cache.length; j++) if (cache[j].l + x < vc) idx = j;
      var s = '0' + Math.max(1, idx); if (s !== lastCur) { lastCur = s; cur.textContent = s; }
      if (gpuIdx > -1) setGpu((vw - (cache[gpuIdx].l + x)) / (vw * 0.7));
      showIdx.forEach(function (pi, k) { if (pi > -1 && cache[pi] && cache[pi].l + x < vw * 0.55) shows[k][1](); });
    }
    gsap.to(track, { x: function () { return -dist; }, ease: 'none', onUpdate: update, scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true } });
    update();
    return function () { ScrollTrigger.removeEventListener('refreshInit', measure); sec.style.height = ''; gsap.set(track, { clearProps: 'x' }); };
  });
  mm.add('(max-width: 760px)', function () {
    var o = { p: 0 }; setGpu(0);
    var sts = [ScrollTrigger.create({ trigger: '.ch-gpu', start: 'top 70%', once: true, onEnter: function () { gsap.to(o, { p: 1, duration: 1.8, ease: 'power2.out', onUpdate: function () { setGpu(o.p); } }); } })];
    shows.forEach(function (s) { if (s[0]) sts.push(ScrollTrigger.create({ trigger: s[0], start: 'top 80%', once: true, onEnter: s[1] })); });
    return function () { sts.forEach(function (t) { t.kill(); }); };
  });

  addEventListener('load', function () { setLayout(); ScrollTrigger.refresh(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
})();
