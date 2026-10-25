// Service worker: lets the app install on a phone and open offline.
// App code/styles are network-first (so updates show up right away); the big, never-changing 3D/pose files are cache-first.
const CACHE = 'closet-v1';
const HEAVY = ['/vendor/', '/models/'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // never cache the AI endpoint
  const heavy = HEAVY.some((p) => u.pathname.startsWith(p));
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (heavy) { const hit = await cache.match(r); if (hit) return hit; }
    try {
      const res = await fetch(r);
      if (res.ok) cache.put(r, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(r) || (r.mode === 'navigate' && await cache.match('/'));
      if (hit) return hit;
      throw err;
    }
  })());
});
