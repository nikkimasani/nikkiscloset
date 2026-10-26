// The starter closet, in the app: each piece on the list (starter/items.js) is generated on the server (/api/starter: Cloudflare Workers AI,
// fal only as a fallback), then goes
// through the normal pipeline here: white background removed, colours read, tags from the list. Landmarks are suggested the first time
// the piece is fitted, like any other. Nothing is saved until you approve the batch.
import { ITEMS, seedFor } from '../starter/items.js';
import { loadImage, toCanvas, removeBackground, canvasToBlob } from './cutout.js';
import { palette, colorName } from './color.js';
import { uid } from './db.js';

/** Cloudflare Workers AI, FLUX.1 schnell at 4 steps: 4 tiles x 4.8 + 4 steps x 9.6 neurons a picture; 10,000 free a day (resets 00:00 UTC). */
export const NEURONS_EACH = 57.6, DAILY_FREE = 10000, BUDGET = 9800; // (stops a little under the limit)
export const isStarter = (i) => i?.source === 'starter';
/** Pieces of a batch not yet in your closet (approved ones are skipped, so a batch can be topped up later). */
export const missingIn = (batch, items) => { const have = new Set(items.map((i) => i.starterId).filter(Boolean)); return ITEMS.filter((i) => i.batch === batch && !have.has(i.id)); };

const today = () => new Date().toISOString().slice(0, 10); // (a UTC day, like Cloudflare's allowance)
export const nextReset = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
/** Neurons used today (estimated, counted on this device). */
export function usedToday() { try { const u = JSON.parse(localStorage.getItem('starter_neurons') || '{}'); return u.day === today() ? u.n : 0; } catch { return 0; } }
const addUsed = (n) => { try { localStorage.setItem('starter_neurons', JSON.stringify({ day: today(), n: usedToday() + n })); } catch { /* private mode */ } };
/** Room for one more picture today? */
export const canGenerate = () => usedToday() + NEURONS_EACH <= BUDGET;
export class DailyLimit extends Error { constructor(resetAt) { super('Daily free limit reached'); this.resetAt = resetAt; } }

/* Progress is kept: every picture made is stored as a draft (Cache Storage) until its batch is approved, so a batch interrupted by the
   daily limit, a closed tab or Cancel carries on where it stopped instead of paying for the same pictures again. */
const DRAFTS = 'closet-starter-drafts', key = (id) => `/starter-draft/${id}`;
export async function draftOf(id) { try { const r = await (await caches.open(DRAFTS)).match(key(id)); return r ? await r.blob() : null; } catch { return null; } }
export async function saveDraft(id, blob) { try { await (await caches.open(DRAFTS)).put(key(id), new Response(blob, { headers: { 'content-type': blob.type || 'image/jpeg' } })); } catch { /* storage full or blocked: it just won't resume */ } }
export async function dropDraft(id) { try { await (await caches.open(DRAFTS)).delete(key(id)); } catch { /* nothing to drop */ } }

/** Ask the server for one piece's product photo: { blob, info } (info is for the review log). Throws DailyLimit when today's free neurons are used up. */
export async function generate(it, pass, { attempt = 0, engine } = {}) {
  if (engine !== 'fal' && !canGenerate()) throw new DailyLimit(nextReset());
  const seed = seedFor(it, attempt), t0 = Date.now();
  const r = await fetch('/api/starter', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': pass }, body: JSON.stringify({ id: it.id, seed, ...(engine && { engine }) }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429 && j.limit) { addUsed(Math.max(0, DAILY_FREE - usedToday())); throw new DailyLimit(j.resetAt || nextReset()); } // Cloudflare says so: nothing more today
  if (!r.ok || !j.image) throw Object.assign(new Error(j.error || `Generating failed (${r.status})`), { info: { attempt, seed, status: r.status } });
  addUsed(j.neurons ?? NEURONS_EACH);
  const blob = await (await fetch(j.image)).blob(); // this piece's own picture, decoded from its own response
  await saveDraft(it.id, blob);
  return { blob, info: { attempt, seed, status: r.status, engine: j.engine, bytes: blob.size, key: key(it.id), ms: Date.now() - t0, prompt: j.prompt || '' } };
}

/* ── the automatic check: plain white background, the whole item in frame, nothing else in the picture ── */
const WARM = /nude|beige|camel|tan|brown|cognac|oatmeal|taupe|champagne|gold|butter|cream|ivory|chocolate|straw|tortoise/;
/** Look at a generated picture: { ok, reasons[] }. Pure pixel checks (no AI): white border, margin on every side, one main shape, no skin. */
export function checkPicture(img, it) {
  const s = Math.min(1, 256 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)), w = Math.round((img.naturalWidth || img.width) * s), h = Math.round((img.naturalHeight || img.height) * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, fg = new Uint8Array(w * h).fill(1), reasons = [];
  const white = (o) => Math.min(d[o], d[o + 1], d[o + 2]) >= 244 && Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]) <= 10;
  // the background is the white reached from the picture's edges, so a white or cream piece (outlined by its own seams and shading) stays whole
  const q0 = new Int32Array(w * h); let qh = 0, qt = 0;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (fg[i] && white(i * 4)) { fg[i] = 0; q0[qt++] = i; } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (fg[i] && white(i * 4)) { fg[i] = 0; q0[qt++] = i; } }
  while (qh < qt) { const p = q0[qh++], x = p % w; for (const k of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (k >= 0 && k < w * h && fg[k] && white(k * 4)) { fg[k] = 0; q0[qt++] = k; } }
  let ring = 0, ringWhite = 0, skin = 0, n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  const m = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4, edge = x < m || y < m || x >= w - m || y >= h - m;
    if (edge) { ring++; if (!fg[i]) ringWhite++; }
    if (fg[i]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const [r, gg, b] = [d[o], d[o + 1], d[o + 2]], cr = 128 + 0.5 * r - 0.4187 * gg - 0.0813 * b, cb = 128 - 0.1687 * r - 0.3313 * gg + 0.5 * b;
      if (cr > 138 && cr < 175 && cb > 85 && cb < 125 && r > 90 && r > gg && gg > b) skin++; }
  }
  if (ringWhite / ring < 0.97) reasons.push('background is not plain white');
  if (n && (x0 < 2 || y0 < 2 || x1 > w - 3 || y1 > h - 3)) reasons.push('item runs off the edge');
  const area = n / (w * h);
  if (area < 0.03) reasons.push('item is missing or tiny'); else if ((x1 - x0) * (y1 - y0) > 0.92 * w * h) reasons.push('item fills the whole picture');
  // separate shapes: big ones are parts of the item (two trouser legs, the halves of an open jacket, a pair of shoes); small-to-medium ones
  // standing apart are text, a logo, a hanger or a prop. A pair or set of small things (earrings, rings) may have a few of those.
  const lab = new Int32Array(w * h), q = new Int32Array(w * h), sizes = []; let k = 0;
  for (let i = 0; i < w * h; i++) { if (!fg[i] || lab[i]) continue; k++; let hd = 0, tl = 0; q[tl++] = i; lab[i] = k;
    while (hd < tl) { const p = q[hd++], x = p % w; for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (j >= 0 && j < w * h && fg[j] && !lab[j]) { lab[j] = k; q[tl++] = j; } }
    sizes.push(tl); }
  sizes.sort((a, b) => b - a);
  const many = it.type === 'shoes' || ['earrings', 'rings', 'necklace', 'bracelet', 'anklet'].includes(it.acc) || /set|pair/i.test(it.detail);
  const extra = sizes.slice(1).filter((z) => z > Math.max(30, sizes[0] * 0.015) && z < sizes[0] * 0.25).length;
  if (extra > (many ? 4 : 0)) reasons.push('more than the item in the picture (text, a hanger or a prop?)');
  if (!WARM.test(it.colors.join(' ')) && n && skin / n > 0.12) reasons.push('looks like skin (a person or mannequin?)');
  return { ok: !reasons.length, reasons };
}

/** The normal pipeline on a white-background product photo: checked, background off (no tap needed), cropped, colours read. */
export async function process(blob, it) {
  const { img, url } = await loadImage(blob); URL.revokeObjectURL(url);
  const check = checkPicture(img, it);
  const cut = removeBackground(toCanvas(img, 1000), { tolerance: 18 }); // pure white studio background; kept tight so white and cream pieces keep their edges
  const pal = palette(cut).filter((c) => c.share > 0.04);
  const main = pal[0]?.hex || '#cccccc';
  return { check, canvas: cut, cutout: await canvasToBlob(cut, 'image/webp', 0.92), color: { hex: main, name: colorName(main) }, colors: pal.map((c) => c.hex) };
}

/** A closet item for an approved starter piece. */
export const toItem = (it, done, original) => ({
  id: uid(), starterId: it.id, source: 'starter', ready: !!done.ready, review: done.ready ? undefined : done.why, ...(it.acc && { acc: it.acc }), name: it.name, type: it.type, occasions: [...it.occasions], season: it.season, brand: '',
  color: done.color, colors: done.colors, tags: { colors: it.colors }, cutout: done.cutout, original, adj: { scale: 1, dx: 0, dy: 0 },
  createdAt: Date.now(), updatedAt: Date.now(),
});
