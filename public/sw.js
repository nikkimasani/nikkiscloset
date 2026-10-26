// Service worker: lets the app install on a phone and open offline.
// App code/styles are network-first (so updates show up right away); the big, never-changing 3D/pose files are cache-first.
const CACHE = 'closet-v1';
const HEAVY = ['/vendor/', '/models/'];

// The app shell is cached at install so the very next visit (even offline) works. tests/smoke.mjs checks this list covers every file in js/.
const SHELL = ['/', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/js/app.js', '/js/aitryon.js', '/js/body.js', '/js/color.js', '/js/cutout.js', '/js/data.js', '/js/db.js', '/js/mannequin.js', '/js/meters.js',
  '/js/insights.js', '/js/plan.js', '/js/planner.js', '/js/pose.js', '/js/sample.js', '/js/sharecard.js', '/js/stage3d.js', '/js/stylist.js', '/js/sync.js', '/js/weather.js', '/js/webgl.js', '/js/world.js', '/js/character.js', '/js/gfx.js', '/js/mirror.js', '/vendor/three/three.module.min.js'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
});
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
