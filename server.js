// Tiny static file server. No dependencies. `npm start` -> http://localhost:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTryOn } from './lib/tryon.js';
import { handleCutout, handlePin, handleTag, handleProduct } from './lib/ai.js';

const API = { '/api/tryon': handleTryOn, '/api/cutout': handleCutout, '/api/tag': handleTag, '/api/pin': handlePin, '/api/product': handleProduct };

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = process.env.PORT || 5173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
};

// Keep in sync with public/_headers and vercel.json.
const security = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data: https://kyswqvjgbgztkqamkmac.supabase.co https://api.open-meteo.com https://geocoding-api.open-meteo.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(self)',
};
// The hidden on-device-cutout page (and only it) may fetch its model from staticimgly.com and start blob workers, and the app may frame it.
const labSecurity = { ...security, 'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://staticimgly.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data: https://staticimgly.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" };

// The tap-to-select page (OpenCV) needs eval for its bindings, so it gets its own policy: same-origin only, no network at all.
const segSecurity = { ...security, 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" };

createServer(async (req, res) => {
  try {
    const route = API[new URL(req.url, 'http://localhost').pathname];
    if (route) { // same handlers Vercel/Cloudflare run
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await route(new Request(new URL(req.url, 'http://localhost'), { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), process.env);
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(root, normalize(p));
    if (!file.startsWith(root)) throw new Error('nope');
    const body = await readFile(file);
    res.writeHead(200, { ...(p.startsWith('/lab/segment') ? segSecurity : p.startsWith('/lab/') ? labSecurity : security), 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => console.log(`Nikki's Closet running at http://localhost:${port}`));
