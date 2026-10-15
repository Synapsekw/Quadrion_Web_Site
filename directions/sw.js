/* Keep this cache version in step with changes to the offline page or app icons. */
const CACHE_PREFIX = 'quadrion-offline-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const OFFLINE_URL = '/offline.html';
const OFFLINE_ASSETS = [
  OFFLINE_URL,
  '/pwa-icons/icon-192.png',
  '/pwa-icons/icon-512.png',
  '/pwa-icons/maskable-512.png',
  '/pwa-icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_ASSETS)));
  // Updates wait for existing tabs to close; never reload an active demo or chat.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Only the public landing page gets an offline fallback. Do not intercept API,
// chat, auth, session, private routes, cross-origin requests, or 3D assets.
const PUBLIC_PAGES = new Set(['/', '/d3-quarter', '/d3-quarter/', '/d3-quarter/index.html']);
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !PUBLIC_PAGES.has(url.pathname)) return;

  event.respondWith((async () => {
    try {
      // No runtime writes: responses and query strings are never saved in Cache Storage.
      return await fetch(request);
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const offline = await cache.match(OFFLINE_URL);
      return offline || new Response('You are offline. Reconnect to open Quadrion AI.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  })());
});
