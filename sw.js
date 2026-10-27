/* IBI Audios & Radios v1.3 — service worker. Makes the app installable and opens it offline.
 * Network-first for this site's own files (always the live version online; the cache only when offline).
 * Radio streams, the station directory and CDNs are never touched. Bump CACHE with every release. */
const CACHE = 'ibi-radios-v1-3';
const PREFIX = 'ibi-radios-';
const SHELL = ['./', 'index.html', 'app.css?v=1.3', 'app.js?v=1.3', 'manifest.json', 'icons/icon-192.png', 'img/earth-2k.jpg', 'img/earth-bump.png', 'data/places.json'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).catch(() => {})); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith(PREFIX)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res && res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./') : undefined)).then((r) => r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
});
