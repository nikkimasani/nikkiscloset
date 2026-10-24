// Tiny static file server. No dependencies. `npm start` -> http://localhost:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = process.env.PORT || 5173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
};

// Keep in sync with public/_headers and vercel.json.
const security = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(root, normalize(p));
    if (!file.startsWith(root)) throw new Error('nope');
    const body = await readFile(file);
    res.writeHead(200, { ...security, 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => console.log(`Nikki's Closet running at http://localhost:${port}`));
