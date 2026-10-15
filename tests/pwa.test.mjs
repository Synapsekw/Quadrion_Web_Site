import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const publicRoot = new URL('../directions/', import.meta.url);
const origin = 'https://quadrion.example';

async function worker({ offline = false, status = 200, stored = true } = {}) {
  const events = new Map(), entries = new Map(), deleted = [], requests = [];
  const state = { claimed: false };
  const caches = {
    async open(name) {
      if (!entries.has(name)) entries.set(name, new Map());
      const cache = entries.get(name);
      return {
        async addAll(paths) {
          for (const path of paths) {
            const asset = await readFile(new URL(path.slice(1), publicRoot));
            cache.set(path, new Response(asset, { headers: { 'Content-Type': path.endsWith('.html') ? 'text/html' : 'image/png' } }));
          }
        },
        async match(path) { return stored ? cache.get(path)?.clone() : undefined; },
      };
    },
    async keys() { return [...entries.keys()]; },
    async delete(name) { deleted.push(name); return entries.delete(name); },
  };
  const source = await readFile(new URL('sw.js', publicRoot), 'utf8').catch(() => '');
  runInNewContext(source, {
    self: { location: new URL('/sw.js', origin), addEventListener: (type, fn) => events.set(type, fn), clients: { async claim() { state.claimed = true; } } },
    caches, URL, Response,
    fetch: async request => {
      requests.push(request);
      if (offline) throw new TypeError('Network unavailable');
      return new Response('Live content', { status });
    },
  });
  return {
    entries, deleted, requests, state,
    async lifecycle(type) {
      assert.ok(events.has(type), `The worker must handle ${type}`);
      let pending;
      events.get(type)({ waitUntil(value) { pending = value; } });
      await pending;
    },
    fetch(path, options = {}) {
      let response;
      const request = { url: new URL(path, origin).href, mode: 'navigate', method: 'GET', ...options };
      events.get('fetch')?.({ request, respondWith(value) { response = value; } });
      return response;
    },
  };
}

test('install caches only the offline page and a small set of public app icons', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  assert.equal(sw.entries.size, 1);
  const paths = [...sw.entries.values()][0];
  assert.ok(paths.has('/offline.html'));
  assert.ok(paths.size <= 5);
  assert.ok([...paths.keys()].every(path => path === '/offline.html' || /^\/pwa-icons\/[a-z0-9-]+\.png$/.test(path)));
});

test('activation removes obsolete Quadrion offline caches while preserving unrelated caches', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  const current = [...sw.entries.keys()][0];
  sw.entries.set('quadrion-offline-obsolete', new Map());
  sw.entries.set('another-app-v1', new Map());
  sw.entries.set('quadrion-data-v1', new Map());
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['quadrion-offline-obsolete']);
  assert.ok(sw.entries.has(current));
  assert.ok(sw.entries.has('another-app-v1'));
  assert.ok(sw.entries.has('quadrion-data-v1'));
  assert.equal(sw.state.claimed, true);
});

test('public navigations use the live response and do not store its contents', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  const before = [...sw.entries.values()][0].size;
  for (const path of ['/', '/d3-quarter', '/d3-quarter/', '/d3-quarter/index.html?utm_source=pwa']) {
    const response = await sw.fetch(path);
    assert.ok(response, `Navigation ${path} must have a response`);
    assert.equal(await response.text(), 'Live content');
  }
  assert.equal([...sw.entries.values()][0].size, before);
});

test('network failure returns the stored offline page for public page navigation', async () => {
  const sw = await worker({ offline: true });
  await sw.lifecycle('install');
  const response = await sw.fetch('/d3-quarter/');
  assert.ok(response);
  assert.equal(response.headers.get('Content-Type'), 'text/html');
  assert.equal(await response.text(), await readFile(new URL('offline.html', publicRoot), 'utf8'));
});

test('missing offline cache still returns a usable plain-text offline response', async () => {
  const sw = await worker({ offline: true, stored: false });
  const response = await sw.fetch('/d3-quarter/');
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /connect/i);
});

test('HTTP errors are preserved rather than silently replaced with offline content', async () => {
  const sw = await worker({ status: 503 });
  const response = await sw.fetch('/d3-quarter/');
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Live content');
});

test('API, chat, session, auth, cross-origin, asset, POST and other navigations bypass the worker', async () => {
  const sw = await worker({ offline: true });
  const requests = [
    ['/api/quori'], ['/api/quori/session'], ['/.netlify/functions/quori'], ['/auth/callback'],
    ['/session'], ['/chat'], ['/quori/'], ['/private'], ['/data/model.glb'],
    ['/d3-quarter/demo.js'], ['/offline.html'], ['https://elsewhere.example/d3-quarter/'],
    ['/d3-quarter/', { method: 'POST' }], ['/d3-quarter/', { mode: 'cors' }],
    ['/d3-quarter/', { mode: 'no-cors' }], ['/d3-quarter/', { method: 'HEAD' }],
  ];
  for (const [path, options] of requests) assert.equal(sw.fetch(path, options), undefined, path);
  assert.equal(sw.requests.length, 0);
  assert.equal(sw.entries.size, 0);
});

async function page({ loaded = false, secure = true, standalone = false, serviceWorker = true, idle = true, registrationFails = false } = {}) {
  const events = new Map(), buttonEvents = new Map(), scheduled = [], registrations = [];
  const button = { hidden: true, disabled: false, addEventListener: (type, fn) => buttonEvents.set(type, fn) };
  const window = {
    isSecureContext: secure,
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (type, fn) => events.set(type, fn),
    ...(idle ? { requestIdleCallback: fn => scheduled.push(fn) } : {}),
    setTimeout: fn => scheduled.push(fn),
  };
  const navigator = { ...(serviceWorker ? { serviceWorker: { async register(...args) { registrations.push(args); if (registrationFails) throw new Error('Unavailable'); } } } : {}) };
  const source = await readFile(new URL('pwa.js', publicRoot), 'utf8').catch(() => '');
  runInNewContext(source, { window, navigator, document: { readyState: loaded ? 'complete' : 'interactive', querySelectorAll: () => [button] }, setTimeout: window.setTimeout });
  return {
    button, registrations, scheduled,
    async emit(type, event) { return events.get(type)?.(event); },
    async click() { return buttonEvents.get('click')?.(); },
    async flush() { for (const callback of scheduled.splice(0)) await callback(); },
  };
}

test('registration waits for load and idle time, then uses the root worker scope', async () => {
  const browser = await page();
  assert.equal(browser.registrations.length, 0);
  assert.equal(browser.scheduled.length, 0);
  await browser.emit('load');
  assert.equal(browser.registrations.length, 0);
  assert.equal(browser.scheduled.length, 1);
  await browser.flush();
  assert.equal(browser.registrations.length, 1);
  assert.equal(browser.registrations[0][0], '/sw.js');
  assert.equal(browser.registrations[0][1].scope, '/');
});

test('already-loaded pages schedule registration with a timer when idle callbacks are unavailable', async () => {
  const browser = await page({ loaded: true, idle: false });
  assert.equal(browser.registrations.length, 0);
  await browser.flush();
  assert.equal(browser.registrations.length, 1);
});

test('insecure and unsupported browsers do not attempt service-worker registration', async () => {
  for (const options of [{ secure: false }, { serviceWorker: false }]) {
    const browser = await page({ ...options, loaded: true });
    await browser.flush();
    assert.equal(browser.registrations.length, 0);
  }
});

test('a registration failure is handled without breaking the page', async () => {
  const browser = await page({ loaded: true, registrationFails: true });
  await assert.doesNotReject(() => browser.flush());
  assert.equal(browser.registrations.length, 1);
});

test('installation becomes available only after the browser offers it and prompts only on click', async () => {
  const browser = await page();
  let prompted = 0, prevented = 0;
  const offer = { preventDefault() { prevented++; }, async prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
  assert.equal(browser.button.hidden, true);
  await browser.emit('beforeinstallprompt', offer);
  assert.equal(prevented, 1);
  assert.equal(browser.button.hidden, false);
  assert.equal(browser.button.disabled, false);
  assert.equal(prompted, 0);
  await browser.click();
  assert.equal(prompted, 1);
  assert.equal(browser.button.hidden, true);
  await browser.click();
  assert.equal(prompted, 1);
});

test('installed applications keep the install control hidden', async () => {
  const offer = { preventDefault() {}, async prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  const browser = await page();
  await browser.emit('beforeinstallprompt', offer);
  assert.equal(browser.button.hidden, false);
  await browser.emit('appinstalled');
  assert.equal(browser.button.hidden, true);
  const installed = await page({ standalone: true });
  await installed.emit('beforeinstallprompt', offer);
  assert.equal(installed.button.hidden, true);
});

test('a rejected install prompt is handled and cannot be reused', async () => {
  const browser = await page();
  let prompted = 0;
  await browser.emit('beforeinstallprompt', { preventDefault() {}, async prompt() { prompted++; throw new Error('Not available'); } });
  await assert.doesNotReject(() => browser.click());
  await browser.click();
  assert.equal(prompted, 1);
  assert.equal(browser.button.hidden, true);
});

test('manifest has a stable standalone identity and correctly sized local PNG app icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', publicRoot), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/d3-quarter/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name, 'Quadrion AI');
  assert.equal(manifest.background_color, '#0B0F13');
  assert.equal(manifest.theme_color, '#0B0F13');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  const icons = [...manifest.icons, { src: '/pwa-icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }];
  for (const icon of icons) {
    assert.equal(icon.type, 'image/png');
    assert.ok(icon.src.startsWith('/pwa-icons/'));
    const png = await readFile(new URL(icon.src.slice(1), publicRoot));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});
