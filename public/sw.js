// Service worker: lets the app install on a phone and open offline.
// App code/styles are network-first (so updates show up right away); the big, never-changing pictures and libraries are cache-first.
const CACHE = 'closet-v2'; // raise to drop every cached file on the next visit
const HEAVY = ['/vendor/', '/assets/'];

// The app shell is cached at install so the very next visit (even offline) works. tests/smoke.mjs checks this list covers every file in js/.
const SHELL = ['/', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/js/aitryon.js', '/js/app.js', '/js/bodymap.js', '/js/closet.js', '/js/color.js', '/js/cutmask.js', '/js/cutout.js', '/js/data.js', '/js/db.js', '/js/doll.js', '/js/editor.js', '/js/fitting.js', '/js/game.js', '/js/garment.js', '/js/insights.js', '/js/intake.js', '/js/landmarks.js', '/js/meters.js', '/js/photo.js', '/js/plan.js', '/js/planner.js', '/js/segment.js', '/js/sharecard.js', '/js/stylist.js', '/js/sync.js', '/js/warp.js', '/js/weather.js'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// "Share to Nikki's Closet" (Android / desktop installed app): keep the shared picture for the page to pick up, then open the add dialog.
async function takeShare(request) {
  try {
    const f = await request.formData(), file = f.get('photo');
    if (file && file.size) { const c = await caches.open('closet-share'); await c.put('/shared/photo', new Response(file, { headers: { 'content-type': file.type || 'image/png' } })); }
    const link = String(f.get('url') || f.get('text') || '').match(/https?:\/\/[^\s]+/)?.[0] || '';
    return Response.redirect(new URL(`/?add=shared${link ? '&u=' + encodeURIComponent(link) : ''}`, request.url).href, 303); // Response.redirect needs an absolute URL
  } catch { return Response.redirect(new URL('/', request.url).href, 303); }
}

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method === 'POST' && u.origin === location.origin && u.pathname === '/share') { e.respondWith(takeShare(r)); return; }
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // never cache the AI endpoint
  const heavy = HEAVY.some((p) => u.pathname.startsWith(p)) && !u.pathname.endsWith('.json'); // (settings files like config.json always come fresh when online)
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
