/* Direction D3 · The Quarter: DOM, scroll story and interactions. */
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
  var fmt = function (n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var DATA_URL = '../data/';
  // Downscaled WebP copy of a data photo (scripts/make-thumbs.mjs): 'tank/photos/F01.jpg' -> 'tank/photos/thumbs/F01-240.webp'.
  function thumb(path, w) { return path.replace(/([^/]+)\.(jpg|webp)$/, 'thumbs/$1-' + w + '.webp'); }

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
    road: [ // road.json closeups (severity is a screening grade from the 2D ortho)
      { id: 'D0941', t: 'Patching', s: 3, km: 3.714, a: 22.9, img: 'f0941' },
      { id: 'D0991', t: 'Alligator cracking', s: 3, km: 3.804, a: 64.4, img: 'f0991' },
      { id: 'D0920', t: 'Block cracking', s: 3, km: 3.963, a: 955.8, img: 'f0920' },
      { id: 'D0930', t: 'Bleeding', s: 3, km: 4.059, a: 9.5, img: 'f0930' },
      { id: 'D1319', t: 'Longitudinal cracking', s: 2, km: 3.573, a: 68.7, img: 'f1319' },
      { id: 'D1140', t: 'Transverse cracking', s: 2, km: 3.1, a: 61.0, img: 'f1140' }
    ],
    facade: [ // facade.json curated photo findings
      { id: 'D397', t: 'Warm spot behind cladding', s: 2, c: 'Thermal anomaly', side: 'West', h: 36.25, img: 'p2736' },
      { id: 'D076', t: 'Rust along the twin rods', s: 2, c: 'Corrosion on metalwork', side: 'West', h: 30.1, img: 'p2675' },
      { id: 'D178', t: 'Crack in an opaque fin panel', s: 2, c: 'Glazing damage', side: 'North', h: 64.6, img: 'p3038' },
      { id: 'D159', t: 'Run-off on canopy fascia', s: 1, c: 'Staining or run-off', side: 'North', h: 64.73, img: 'p3038' },
      { id: 'D427', t: 'Ghost staining on cladding', s: 1, c: 'Staining or run-off', side: 'West', h: 31.81, img: 'p2675' },
      { id: 'D441', t: 'Hairline crack in cladding', s: 1, c: 'Cladding or coating damage', side: 'West', h: 30.92, img: 'p2675' }
    ],
    fxClasses: [ // graded issues by class (facade.json stats.byClass), in reveal order
      ['staining', 'Staining or run-off', 211, '#c9a227'], ['soiling', 'Glazing soiling', 196, '#fad34b'], ['cladding', 'Cladding or coating', 155, '#e94b9a'],
      ['object', 'Loose object', 34, '#7cc46b'], ['sealant', 'Sealant or gasket', 31, '#ff7a2d'], ['corrosion', 'Corrosion', 14, '#b5651d'],
      ['thermal', 'Thermal anomaly', 8, '#ff4fd8'], ['water', 'Water or damp', 6, '#2f7fd8'], ['glazing', 'Glazing damage', 1, '#ee3f4b']
    ],
    piles: [['P01', 1754, 1819], ['P02', 14687, 11379], ['P03', 12742, 10237], ['P04', 1245, 1250], ['P05', 7496, 4825], ['P06', 1613, 1447], ['P07', 262, 310], ['P08', 5677, 5644], ['P09', 2018, 1631], ['P10', 11044, 11119], ['P11', 265, 293], ['P12', 65, 155], ['P13', 5423, 4444], ['P14', 1072, 795], ['P15', 177, 322], ['P16', 8627, 7209], ['P17', 134, 184], ['P18', 1314, 215], ['P19', 587, 126]],
    tot: { a: 76199, b: 63402, d: -12797 }
  };
  var sevName = { 5: 'Severity 5', 4: 'Severity 4', 3: 'Severity 3', 2: 'Severity 2', 1: 'Severity 1' };
  var roadSev = { 1: 'Low', 2: 'Medium', 3: 'High' };

  /* ---------- Shared state for the WebGL director ---------- */
  var S = window.QS = { hero: 0, sep: 0, win: 0, winq: 0, spin: 0, zoom: 0, road: 0, pci: 0, pop: 0, sweep: 0, plant: 0, iris: 0, tank: 0, rise: 0, flare: 0, scan: 0, ignite: 0, split: 0, facade: 0, cls: 0, wipe1: 0, wipe2: 0, stock: 0, st: motion ? 0 : 1, W: innerWidth, H: innerHeight };

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
  if (!html.classList.contains('gl-pending') && !hasGL()) html.classList.add('no-webgl');

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
    var parts = line.textContent.trim().split(/[ \t\n]+/); line.textContent = '';
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
  function loadImgs(scope) { if (!scope) return; $$('img[data-src]', scope).forEach(function (im) { if (!im.getAttribute('src')) { im.decoding = 'async'; im.src = im.getAttribute('data-src'); } }); }
  var nextImgs = { road: '.shot-tank', tank: '.shot-flare', flare: '.shot-facade' };
  window.addEventListener('d3:asset', function (e) {
    if (e.detail.name === 'road' && e.detail.state === 'loading') loadImgs($('.shot-road'));
    if (e.detail.state !== 'ready') return;
    if (nextImgs[e.detail.name]) loadImgs($(nextImgs[e.detail.name]));
  });
  if (!motion) { $$('img[data-src]').forEach(function (im) { im.loading = 'lazy'; }); loadImgs(document); }
  // The road's photos follow the tour's demand, rather than a page-load timer.
  window.addEventListener('d3:fallback', function () {
    $$('img[data-src]').forEach(function (im) { im.loading = 'lazy'; }); loadImgs(document);
  });

  /* ---------- Real overlays: road outline polygons, facade class boxes, PCI strip ---------- */
  var roadJson = window.fetch ? fetch(DATA_URL + 'road/road.json').then(function (r) { return r.json(); }).catch(function () { return null; }) : Promise.resolve(null);
  var facadeJson = window.fetch ? fetch(DATA_URL + 'facade/facade.json').then(function (r) { return r.json(); }).catch(function () { return null; }) : Promise.resolve(null);
  function fitPoly(svg, cu) {
    if (!svg || !cu) return;
    svg.setAttribute('viewBox', '0 0 ' + cu.size[0] + ' ' + cu.size[1]);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    var pg = $('polygon', svg); if (pg) pg.setAttribute('points', cu.polygon.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '));
  }
  roadJson.then(function (r) {
    if (!r) return;
    var byId = {}; r.closeups.forEach(function (c) { byId[c.id] = c; });
    $$('[data-closeup]').forEach(function (f) { fitPoly($('svg.poly', f), byId[f.getAttribute('data-closeup')]); });
    fitPoly($('#rd svg.poly'), byId.D0991);
    // PCI strip, 31 sections of 250 m, medium assumption, ASTM colours
    var bars = $('#rd .rd-bars'), read = $('#rd .rd-read');
    if (bars) {
      var col = function (p) { var k = r.ratings.filter(function (x) { return p >= x.min; })[0]; return k ? k.color : '#6d6d6d'; };
      bars.innerHTML = r.sections.map(function (s, i) { var p = s.pci.medium; return '<span data-i="' + i + '" style="--c:' + col(p) + ';height:' + (18 + 82 * clamp01((p - 60) / 40)).toFixed(1) + '%"></span>'; }).join('');
      var show = function (i) { var s = r.sections[i]; read.textContent = 'km ' + s.fromKm.toFixed(2) + '–' + s.toKm.toFixed(2) + ' · PCI ' + s.pci.medium.toFixed(1); };
      $$('span', bars).forEach(function (b) {
        b.addEventListener('pointerenter', function () { show(+b.getAttribute('data-i')); });
      });
      bars.addEventListener('pointerleave', function () { read.textContent = 'Network PCI 87.6 · lowest 75.7 at km 3.50'; });
      read.textContent = 'Network PCI 87.6 · lowest 75.7 at km 3.50';
    }
  });
  facadeJson.then(function (f) {
    if (!f) return;
    $$('[data-fphoto]').forEach(function (fig) {
      var ph = f.photos.filter(function (p) { return p.id === fig.getAttribute('data-fphoto'); })[0], svg = $('svg.boxes', fig);
      if (!ph || !svg) return;
      svg.setAttribute('viewBox', '0 0 ' + ph.size[0] + ' ' + ph.size[1]); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      svg.innerHTML = ph.boxes.filter(function (b) { return !b.polygon; }).map(function (b) { var x = b.bbox; return '<rect x="' + x[0] + '" y="' + x[1] + '" width="' + (x[2] - x[0]) + '" height="' + (x[3] - x[1]) + '" rx="4"/>'; }).join('');
    });
  });

  /* ---------- Facade legend (class by class, hover to isolate) ---------- */
  var fxList = $('.fx-legend'), fxBtns = [];
  if (fxList) {
    fxList.innerHTML = DATA.fxClasses.map(function (c, i) { return '<li><button type="button" data-k="' + i + '" style="--c:' + c[3] + '"><i></i><span>' + c[1] + '</span><b>' + fmt(c[2]) + '</b></button></li>'; }).join('') +
      '<li class="fx-all"><button type="button" data-k="-1" class="is-in"><i style="background:var(--mint)"></i><span>All classes</span><b>656</b></button></li>';
    fxBtns = $$('button', fxList);
    fxBtns.forEach(function (b) {
      var k = +b.getAttribute('data-k');
      var on = function () { window.dispatchEvent(new CustomEvent('d3:fx-class', { detail: k })); };
      var off = function () { window.dispatchEvent(new CustomEvent('d3:fx-class', { detail: -1 })); };
      b.addEventListener('pointerenter', on); b.addEventListener('focus', on);
      b.addEventListener('pointerleave', off); b.addEventListener('blur', off);
    });
  }
  var fxKey = '';
  function fxLegend(rev) {
    var cur = rev >= 8.999 ? -1 : Math.floor(rev);
    var key = cur + ':' + Math.min(9, Math.ceil(rev - 0.02));
    if (key === fxKey) return; fxKey = key;
    fxBtns.forEach(function (b, i) {
      if (i > 8) { b.parentNode.classList.toggle('is-now-li', cur < 0); return; }
      b.classList.toggle('is-in', i < rev - 0.02);
      b.classList.toggle('is-now', i === cur);
      b.parentNode.classList.toggle('is-now-li', i === cur);
    });
  }
  if (!motion) fxLegend(9);
  $$('.fx-all').forEach(function (li) { li.style.display = ''; });

  /* ---------- RGB / thermal wipe card ---------- */
  var tw = $('[data-tw]'), twW = { v: 100 };
  function setTw(v) { twW.v = v; if (tw) { tw.style.setProperty('--w', v.toFixed(2) + '%'); tw.setAttribute('data-side', v > 97 ? 'rgb' : v < 3 ? 'ir' : 'mix'); } }
  if (tw) {
    setTw(motion ? 100 : 50);
    var tog = $('.tw-tog', tw);
    tog.addEventListener('click', function (e) {
      e.stopPropagation();
      var to = twW.v > 50 ? 0 : 100;
      tog.setAttribute('aria-pressed', to === 0 ? 'true' : 'false');
      if (hasGsap && !reduced) gsap.to(twW, { v: to, duration: 0.9, ease: 'expo.out', onUpdate: function () { setTw(twW.v); } }); else setTw(to);
    });
    tw.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || e.target.closest('.tw-tog')) return;
      var r = tw.getBoundingClientRect(); gsap.killTweensOf(twW); setTw(100 * clamp01((e.clientX - r.left) / r.width));
    });
  }

  /* =================== One view: app recreation =================== */
  var appIssues = $('.ai-list'), aiTitle = $('.ai-title'), aiCount = $('.ai-count'), avTitle = $('.av-title');
  var agentQ = $('.app-agent .ag-q'), agentA = $('.app-agent .ag-a');
  var DS = {
    road: { title: 'Urban ring road', panel: 'Defects', count: '2,115', q: 'Where is the pavement in the worst condition?', a: 'Km 3.50 to 3.75, PCI 75.7 under the medium assumption. The network scores 87.6; 29 of the 2,115 mapped defects are high severity.', on: [0, 1, 0, 1] },
    plant: { title: 'Tank terminal', panel: 'Assets', count: '4', q: 'How big is this site?', a: 'About 2.1 km by 1 km, with 8 large storage tanks and a jetty, captured as 757,579 photogrammetry points.', on: [0, 0, 1, 1] },
    tank: { title: 'Storage tank interior', panel: 'Findings', count: '6', q: 'Which findings need action first?', a: 'F01, a crack in the bottom plate (severity 5), then F02, patch damage on the roof plate (severity 4).', on: [0, 1, 1, 0] },
    flare: { title: 'Flare stack, 80 m', panel: 'Patches', count: '78', q: 'Where is the corrosion on this stack?', a: '41 of the 78 patches sit on the flare head, around the neck and its bolted connection. 77 are moderate, 1 is light.', on: [1, 1, 1, 0] },
    facade: { title: 'Tower facade, 74 m', panel: 'Findings', count: '656', q: 'What should we fix first?', a: '182 of the 656 graded issues are moderate, 474 minor. Staining (211) and soiling (196) lead; 45 more are flagged uncertain for review.', on: [1, 1, 0, 0] },
    stock: { title: 'Stockpile yard', panel: 'Volumes', count: '19', q: 'How much did the piles change?', a: 'Net volume fell from 76,199 m³ to 63,402 m³ in 10 days. The largest drop is P02, down 3,308 m³.', on: [1, 0, 0, 1] }
  };
  function issueHTML(ds) {
    var out = '';
    if (ds === 'tank') DATA.tank.forEach(function (f) { out += '<li class="iss"><img data-src="' + DATA_URL + thumb('tank/' + f.img, 240) + '" alt="' + f.t + '" width="54" height="40"><div><b>' + f.t + '</b><span class="sev s' + f.s + '">' + sevName[f.s] + '</span> <span class="mono">' + f.id + ' · ' + f.h.toFixed(2) + ' m</span></div></li>'; });
    else if (ds === 'flare') DATA.flare.forEach(function (f) { out += '<li class="iss"><img data-src="' + DATA_URL + 'flare/patches/thumbs/' + f.id + '-240.webp" alt="' + f.comp + '" width="54" height="40"><div><b>' + f.comp + '</b><span class="sev s2">Moderate rust</span> <span class="mono">' + f.id + ' · ' + f.y.toFixed(1) + ' m</span></div></li>'; });
    else if (ds === 'road') DATA.road.forEach(function (f) { out += '<li class="iss"><img data-src="' + DATA_URL + 'road/closeups/thumbs/' + f.img + '-240.webp" alt="' + f.t + '" width="54" height="40"><div><b>' + f.t + ', ' + fmt(f.a, 1) + ' m²</b><span class="sev sv' + f.s + '">' + roadSev[f.s] + '</span> <span class="mono">' + f.id + ' · ' + f.km.toFixed(2) + ' km</span></div></li>'; });
    else if (ds === 'facade') DATA.facade.forEach(function (f) { out += '<li class="iss"><img data-src="' + DATA_URL + 'facade/photos/thumbs/' + f.img + '-240.webp" alt="' + f.t + '" width="54" height="40"><div><b>' + f.t + '</b><span class="sev sv' + f.s + '">' + (f.s > 1 ? 'Moderate' : 'Minor') + '</span> <span class="mono">' + f.id + ' · ' + f.side + ' · ' + f.h.toFixed(1) + ' m</span></div></li>'; });
    else if (ds === 'stock') DATA.piles.slice().sort(function (p, q) { return Math.abs(q[2] - q[1]) - Math.abs(p[2] - p[1]); }).slice(0, 9).forEach(function (p) {
      var mx = 14687, d = p[2] - p[1];
      out += '<li class="vol-row"><span>' + p[0] + '</span><span class="bars"><i style="width:' + (p[1] / mx * 100).toFixed(1) + '%"></i><i style="width:' + (p[2] / mx * 100).toFixed(1) + '%"></i></span><em>' + (d < 0 ? '−' : '+') + fmt(Math.abs(d)) + '</em></li>';
    });
    else {
      // asset tags only; the terminal has no graded findings in this dataset
      [['8', 'Storage tanks', 'Engineering model'], ['J', 'Jetty', 'Engineering model'], ['PC', 'Photogrammetry cloud', '757,579 points · RGB'], ['OR', 'Orthomosaic', '0.53 m / px']].forEach(function (t) {
        out += '<li class="iss"><span class="ph tag-ic">' + t[0] + '</span><div><b>' + t[1] + '</b><span class="mono">' + t[2] + '</span></div></li>';
      });
    }
    return out;
  }
  function setDs(ds, initial) {
    var d = DS[ds];
    $$('[data-ds]').forEach(function (b) { var on = b.getAttribute('data-ds') === ds; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    avTitle.textContent = d.title; aiTitle.textContent = d.panel; aiCount.textContent = d.count;
    agentQ.textContent = d.q; agentA.textContent = d.a;
    appIssues.innerHTML = issueHTML(ds);
    $$('.layers li').forEach(function (li, i) { li.classList.toggle('on', !!d.on[i]); });
    if (!initial || appImgsOn) loadImgs(appIssues);
    window.dispatchEvent(new CustomEvent('d3:dataset', { detail: ds }));
    layoutAnno();
  }
  var appImgsOn = !motion;
  $$('[data-ds]').forEach(function (b) { b.addEventListener('click', function () { setDs(b.getAttribute('data-ds')); }); });
  setDs('flare', true);

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
  var pgrid = $('#pgrid');
  if (pgrid) pgrid.innerHTML = DATA.tank.map(function (f) { return '<figure><img data-src="' + DATA_URL + thumb('tank/' + f.img, 640) + '" alt="' + f.t + '" width="1280" height="960"><figcaption><span class="sev s' + f.s + '">' + sevName[f.s] + ' · ' + f.c + '</span>' + f.t + '</figcaption></figure>'; }).join('');
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
  var rdDone = false;
  function drawRoadCh() {
    if (rdDone) return; rdDone = true;
    var rd = $('#rd'); if (!rd) return;
    loadImgs(rd);
    var pg = $('svg.poly polygon', rd), bars = $$('.rd-bars span', rd);
    if (!hasGsap || reduced) return;
    gsap.fromTo(pg, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut', delay: 0.3 });
    roadJson.then(function () { gsap.fromTo($$('.rd-bars span', rd), { scaleY: 0 }, { scaleY: 1, duration: 0.9, ease: 'expo.out', stagger: 0.02, delay: 0.2, clearProps: 'transform' }); });
  }
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
  if (!motion) { drawMask(); drawVolPlan(); typeChat(); drawRoadCh(); }
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

  /* ---------- Cursor (works with or without GSAP) ---------- */
  var finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!hasGsap) { setLayout(); return; }

  /* ---------- Lenis ---------- */
  var lenis = null;
  // Touch devices keep native scrolling: Lenis adds non-passive touch listeners that route
  // every scroll through the main thread, which stutters while the 3D data loads.
  if (motion && window.Lenis && !matchMedia('(pointer: coarse)').matches) {
    try {
      lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    } catch (e) { lenis = null; }
  }

  /* ---------- Story clock: chapter windows on the stage timeline ---------- */
  var T = 21.6;
  var CH = [[5.45, 8.85], [8.85, 10.95], [10.95, 13.35], [13.35, 16.3], [16.3, 19.15], [19.15, T]];
  var AT = { four: 2.2, road: 7.05, plant: 9.95, tank: 12.05, flare: 14.42, facade: 17.4, stock: 19.98 };
  var TOUR_AT = [AT.road, AT.plant, AT.tank, AT.flare, AT.facade, AT.stock];
  $$('.tix a').forEach(function (a, i) { a.setAttribute('data-at', ['road', 'plant', 'tank', 'flare', 'facade', 'stock'][i]); });

  /* ---------- Anchors (stage anchors map into the pinned timeline) ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href'); if (!id || id.length < 2) return;
    var y = null, at = a.getAttribute('data-at'), stage = $('#stage');
    if (id === '#top') y = 0;
    else if (motion && at && AT[at] !== undefined) y = stage.offsetTop + (AT[at] / T) * (stage.offsetHeight - innerHeight);
    else { var el = $(id); if (el) y = el.getBoundingClientRect().top + (window.scrollY || 0) - (motion ? 0 : 110); }
    if (y === null) return;
    e.preventDefault();
    var far = Math.abs(y - (window.scrollY || 0)) > innerHeight * 6;
    if (lenis) lenis.scrollTo(y, { duration: far ? 2.2 : 1.6, easing: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); } });
    else window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  });

  /* ---------- Magnetic buttons ---------- */
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

  /* ---------- Cursor: grows over controls, shrinks over text ---------- */
  if (finePointer && motion) {
    html.classList.add('has-cursor');
    var ring = $('.cursor'), dot = $('.cursor-dot'), cx = -100, cy = -100, rx = -100, ry = -100;
    addEventListener('pointermove', function (e) { cx = e.clientX; cy = e.clientY; dot.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)'; ring.classList.remove('is-out'); dot.classList.remove('is-out'); cursorTarget(e); }, { passive: true });
    gsap.ticker.add(function () { if (Math.abs(cx - rx) < 0.05 && Math.abs(cy - ry) < 0.05) return; rx += (cx - rx) * 0.2; ry += (cy - ry) * 0.2; ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)'; });
    function cursorTarget(e) {
      // Quori uses an open shadow root: the composed path retains its real controls.
      var path = e.composedPath ? e.composedPath() : [e.target];
      var ctl = path.some(function (t) { return t.matches && t.matches('a, button, select, [data-cursor], .tw, .rd-bars'); });
      var txt = !ctl && path.some(function (t) { return t.matches && t.matches('input, textarea, p, h1, h2, h3, figcaption, .ch-meta li, .stat, .counter, .tl-item, .foot li'); });
      ring.classList.toggle('is-hover', ctl); ring.classList.toggle('is-text', txt);
    }
    document.addEventListener('pointerover', cursorTarget);
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

  /* ---------- Nav: highlight the current section ---------- */
  var navLinks = {}; $$('[data-nav]').forEach(function (a) { navLinks[a.getAttribute('data-nav')] = a; });
  var navCur = '';
  var tixEl = $('.tix'), tixLive = null;
  function tixShow(on) { if (on !== tixLive) { tixLive = on; tixEl.classList.toggle('is-live', on); } }
  function navAt(id) { if (id === navCur) return; navCur = id; Object.keys(navLinks).forEach(function (k) { navLinks[k].classList.toggle('is-current', k === id); if (k === id) navLinks[k].setAttribute('aria-current', 'true'); else navLinks[k].removeAttribute('aria-current'); }); }
  var tixLinks = $$('.tix a');
  function sectionAt(stageT) {
    var mid = innerHeight * 0.45, ids = ['trust', 'features', 'oneview'];
    for (var i = 0; i < ids.length; i++) { var el = document.getElementById(ids[i]); if (el && el.getBoundingClientRect().top < mid) return ids[i]; }
    var st = $('#stage').getBoundingClientRect();
    if (st.bottom > mid) {
      if (!motion) { var r = $('#shot-road').getBoundingClientRect(); return r.top < mid ? 'tour' : $('#four').getBoundingClientRect().top < mid ? 'four' : ''; }
      return stageT >= 4.3 ? 'tour' : stageT >= 0.9 ? 'four' : '';
    }
    return '';
  }

  if (!motion) {
    // Static tour: index tracks the chapter in view; no pinned timeline.
    var shots = ['#shot-road', '#shot-plant', '#shot-tank', '#shot-flare', '#shot-facade', '#shot-stock'].map(function (s) { return $(s); });
    var tick = function () {
      var mid = innerHeight * 0.5, idx = -1;
      shots.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < mid) idx = i; });
      var stb = $('#stage').getBoundingClientRect().bottom;
      tixShow(shots[0].getBoundingClientRect().top < innerHeight * 0.7 && shots[5].getBoundingClientRect().bottom > innerHeight * 0.3);
      tixLinks.forEach(function (a, i) {
        var done = i < idx || (stb < mid && idx >= 0);
        a.classList.toggle('is-on', i === idx && stb > mid); a.classList.toggle('is-done', done);
        a.style.setProperty('--p', done || (i === idx && stb > mid) ? 1 : 0);
      });
      navAt(sectionAt(0));
    };
    addEventListener('scroll', tick, { passive: true }); tick();
    return;
  }

  /* =================== Hero intro =================== */
  // Keep headline and actions visible from the first paint, even on slow phones.
  gsap.from('.cue, .hero-hud', { autoAlpha: 0, duration: 1.2, ease: 'power2.out', delay: 1.4 });

  /* =================== The cinema: one scrubbed timeline =================== */
  var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '#stage', start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
  // A view can be clicked while an anchor is still flying between chapters.
  // Finish that arrival before holding the selected layer.
  addEventListener('d3:workflow', function (event) {
    var scene = event.detail && event.detail.scene;
    var arrivals = { plant: 9.8, tank: 11.9, flare: 14.2, facade: 17.25, stock: 19.85 };
    if (!arrivals[scene] || tl.time() >= arrivals[scene]) return;
    var stage = $('#stage'), y = stage.offsetTop + (AT[scene] / T) * (stage.offsetHeight - innerHeight);
    if (lenis) lenis.scrollTo(y, { immediate: true });
    else window.scrollTo({ top: y, behavior: 'instant' });
  });
  // A counter runs inside its stat's fade-in, so it has settled on the exact value before the copy is fully in.
  function count(el, from, to, at, dur, sign) {
    if (!el) return;
    var dec = +(el.getAttribute('data-dec') || 0), o = { v: from };
    var put = function (v) { el.textContent = (sign && v < -0.5 ? '−' : '') + fmt(Math.abs(v), dec); };
    // the count runs in the first ~55% of the fade and snaps to the exact value at 80% of its own time
    tl.fromTo(o, { v: from }, { v: to, duration: dur, ease: 'expo.out', onUpdate: function () { put(this.progress() > 0.8 ? to : o.v); } }, at);
    tl.add(function () { put(to); }, at + dur + 0.001);
  }
  function statsIn(sel, at) {
    $$(sel + ' .stat').forEach(function (s, i) {
      var t = at + i * 0.08;
      tl.fromTo(s, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.36, ease: 'power1.inOut' }, t);
      var c = $('[data-count]', s); if (c) count(c, 0, parseFloat(c.getAttribute('data-count')), t, 0.2);
    });
  }
  function copyIn(sel, at, kt) {
    // Layer controls can pause the camera at any point. Keep their supporting
    // headings and measured totals complete, rather than freezing half a count.
    if (/shot-(plant|tank|flare|facade)/.test(sel)) {
      tl.set(sel, { autoAlpha: 1 }, at - 0.02);
      return;
    }
    tl.set(sel, { autoAlpha: 1 }, at - 0.02)
      .fromTo(sel + ' .eyebrow', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3 }, at);
    if (kt) tl.fromTo(sel + ' .kt .w', kt[0], kt[1], at + 0.05);
    statsIn(sel, at + 0.35);
  }
  function callouts(sel, at, follow) {
    $$(sel + ' .callout').forEach(function (c, i) {
      var t0 = at + i * 0.16, card = $('.ccard', c), pg = $('svg.poly polygon', c);
      tl.fromTo($('.adot i', c), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.15, ease: 'back.out(2)' }, t0)
        .fromTo($('.aline path', c), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.22, ease: 'power2.out' }, t0 + 0.05)
        .fromTo(card, follow ? { autoAlpha: 0 } : { autoAlpha: 0, y: 14 }, follow ? { autoAlpha: 1, duration: 0.2 } : { autoAlpha: 1, y: 0, duration: 0.25, ease: 'power3.out' }, t0 + 0.18);
      if (pg) tl.fromTo(pg, { strokeDashoffset: 1, fillOpacity: 0 }, { strokeDashoffset: 0, fillOpacity: 1, duration: 0.4, ease: 'power2.inOut' }, t0 + 0.32);
    });
  }
  function shotOut(sel, at) {
    tl.to(sel + ' .shot-copy', { autoAlpha: 0, y: -26, duration: 0.28, ease: 'power2.in' }, at);
    if ($$(sel + ' .side-hud').length) tl.to(sel + ' .side-hud', { autoAlpha: 0, duration: 0.22 }, at);
    if ($$(sel + ' .callout').length) tl.to(sel + ' .callout', { autoAlpha: 0, duration: 0.2 }, at);
    tl.set(sel, { autoAlpha: 0 }, at + 0.32);
  }
  var RISE = [{ yPercent: 115 }, { yPercent: 0, duration: 0.55, stagger: 0.07, ease: 'expo.out' }];

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

  // 01 Road — entrance: the mint square flies at the camera and becomes the window (square portal)
  tl.fromTo('.portal-cap', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 4.15)
    .to('.portal-cap', { autoAlpha: 0, duration: 0.25 }, 4.85)
    .to(S, { zoom: 1, duration: 1.1, ease: 'power1.inOut' }, 4.35)
    .to('.wipe', { autoAlpha: 1, duration: 0.2 }, 5.2).to('.wipe', { autoAlpha: 0, duration: 0.3 }, 5.5);
  tl.fromTo('.tour-hud', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 5.45)
    .to(S, { road: 1, duration: 3.4 }, 5.45)
    .to(S, { pci: 1, duration: 1.0, ease: 'power1.inOut' }, 5.75)
    .to(S, { pop: 1, duration: 0.75 }, 6.55)
    .fromTo('.road-hud', { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 5.6);
  copyIn('.shot-road', 5.55, RISE);
  callouts('.shot-road', 7.75);
  shotOut('.shot-road', 8.75);

  // 02 Terminal — entrance: retreat from the road, descend into the terminal
  tl.to(S, { sweep: 1, duration: 0.95, ease: 'none' }, 8.85)
    .to(S, { plant: 1, duration: 0.85 }, 9.8);
  copyIn('.shot-plant', 9.4, [{ autoAlpha: 0, rotationX: -80, transformOrigin: '50% 100%' }, { autoAlpha: 1, rotationX: 0, duration: 0.6, stagger: 0.08, ease: 'expo.out' }]);
  shotOut('.shot-plant', 10.7);

  // 03 Tank — entrance: pull back from the terminal, approach the tank
  tl.to(S, { iris: 1, duration: 0.95, ease: 'none' }, 10.95)
    .to(S, { tank: 1, duration: 1.15 }, 11.9);
  copyIn('.shot-tank', 11.75, [{ autoAlpha: 0, letterSpacing: '0.4em', xPercent: -8 }, { autoAlpha: 1, letterSpacing: '-0.04em', xPercent: 0, duration: 0.6, stagger: 0.09, ease: 'expo.out' }]);
  callouts('.shot-tank', 12.25);
  shotOut('.shot-tank', 13.1);

  // 04 Flare — entrance: lift out of the tank, approach the flare, then scan
  tl.to(S, { rise: 1, duration: 0.85, ease: 'none' }, 13.35)
    .to(S, { flare: 1, duration: 1.7 }, 14.2)
    .to(S, { scan: 1, duration: 0.8, ease: 'power1.inOut' }, 14.25)
    .to(S, { ignite: 1, duration: 0.7 }, 15.0);
  copyIn('.shot-flare', 14.3, [{ yPercent: 150, scaleY: 1.5, transformOrigin: '50% 100%' }, { yPercent: 0, scaleY: 1, duration: 0.6, stagger: 0.1, ease: 'expo.out' }]);
  callouts('.shot-flare', 15.4);
  shotOut('.shot-flare', 16.05);

  // 05 Facade — entrance: retreat from the flare, approach the facade
  tl.to(S, { split: 1, duration: 0.95, ease: 'none' }, 16.3)
    .to(S, { facade: 1, duration: 1.6 }, 17.25)
    .to(S, { cls: 1, duration: 1.05 }, 17.3)
    .fromTo('.fx-hud', { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 17.15);
  copyIn('.shot-facade', 16.95, [{ autoAlpha: 0, scale: 0.86, transformOrigin: '0% 100%' }, { autoAlpha: 1, scale: 1, duration: 0.6, stagger: 0.08, ease: 'expo.out' }]);
  callouts('.shot-facade', 18.15);
  tl.fromTo(twW, { v: 100 }, { v: 42, duration: 0.4, ease: 'power2.inOut', onUpdate: function () { setTw(twW.v); } }, 18.5);
  shotOut('.shot-facade', 18.95);

  // 06 Stockpile — entrance: fly from the facade into the survey; compare dates afterward
  tl.to(S, { wipe1: 1, duration: 0.7, ease: 'none' }, 19.15)
    .to(S, { stock: 1, duration: 1.65 }, 19.85)
    .set('.divider', { className: 'divider is-w2' }, 19.9)
    .set('.shot-stock', { autoAlpha: 1 }, 19.63)
    .to(S, { wipe2: 1, duration: 0.95, ease: 'power1.inOut' }, 20.05);
  [['a', 0, DATA.tot.a], ['b', 0, DATA.tot.b], ['d', 0, DATA.tot.d]].forEach(function (c, i) {
    var t = 19.95 + i * 0.07, el = $('[data-vol="' + c[0] + '"]');
    tl.fromTo(el.closest('.counter'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.34, ease: 'power1.inOut' }, t);
    count(el, c[1], c[2], t, 0.2, c[0] === 'd');
  });
  callouts('.shot-stock', 20.2, true);
  tl.to({}, { duration: 0.01 }, T);

  /* Tour index + nav: driven by the timeline's own clock */
  var lastKey = '';
  gsap.ticker.add(function () {
    var t = tl.time(), idx = -1, p = 0;
    for (var i = 0; i < CH.length; i++) if (t >= CH[i][0] - 0.12) { idx = i; p = clamp01((t - CH[i][0]) / (CH[i][1] - CH[i][0])); }
    var past = $('#stage').getBoundingClientRect().bottom < innerHeight * 0.5;
    tixShow(t >= 5.3 && $('#stage').getBoundingClientRect().bottom > innerHeight * 0.98);
    var key = idx + ':' + p.toFixed(3) + ':' + past;
    if (key !== lastKey) {
      lastKey = key;
      tixLinks.forEach(function (a, i) {
        var done = past || i < idx;
        a.classList.toggle('is-on', !past && i === idx); a.classList.toggle('is-done', done);
        a.style.setProperty('--p', done ? 1 : i === idx ? p.toFixed(3) : 0);
      });
    }
    fxLegend(S.cls * 9);
    navAt(sectionAt(t));
  });

  /* SVG fallback for the mark (no WebGL) */
  var fb = $('#fbStage'), fbG = $$('.fbp', fb), fbKey = '';
  var CEN = [[15.53, 15.53], [42.47, 15.53], [15.53, 42.47], [45.5, 45.5]], DIR = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  gsap.ticker.add(function () {
    if (!html.classList.contains('no-webgl') && !html.classList.contains('gl-pending')) return;
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
  ScrollTrigger.create({ trigger: '.statement', start: 'top bottom', end: 'bottom top', onUpdate: function (self) { S.st = self.progress; } });

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
  var shows = [[$('#cor'), drawMask], [$('#rd'), drawRoadCh], [$('#vol'), drawVolPlan], [$('#chat'), typeChat]];
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
      var s = '09.' + Math.max(1, idx); if (s !== lastCur) { lastCur = s; cur.textContent = s; }
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
