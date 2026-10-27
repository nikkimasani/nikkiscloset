// The starter closet, in the app: each piece on the list (starter/items.js) is generated on the server (/api/starter: Cloudflare Workers AI,
// fal only as a fallback), then goes
// through the normal pipeline here: white background removed, colours read, tags from the list. Landmarks are suggested the first time
// the piece is fitted, like any other. Nothing is saved until you approve the batch.
import { ITEMS, seedFor } from '../starter/items.js';
import { loadImage, toCanvas, removeBackground, canvasToBlob, trimTransparent } from './cutout.js';
import { palette, colorName, hexDist } from './color.js';
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
/** Take the server's count for today (kept in Supabase, shared by every device) when it sends one. */
export const setUsed = (n) => { if (Number.isFinite(n)) try { localStorage.setItem('starter_neurons', JSON.stringify({ day: today(), n })); } catch { /* private mode */ } };
/** Ask the server how many neurons today has used (no picture is made). */
export async function refreshUsage(pass) {
  try { const r = await fetch('/api/starter', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': pass }, body: JSON.stringify({ usage: true }) }); const j = await r.json(); if (r.ok && j.used !== null) setUsed(j.used); return j.used ?? null; } catch { return null; }
}
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
  if (r.status === 429 && j.limit) { setUsed(j.used ?? DAILY_FREE); throw new DailyLimit(j.resetAt || nextReset()); } // Cloudflare says so: nothing more today
  if (!r.ok || !j.image) throw Object.assign(new Error(j.error || `Generating failed (${r.status})`), { info: { attempt, seed, status: r.status } });
  if (Number.isFinite(j.used)) setUsed(j.used); else addUsed(j.neurons ?? NEURONS_EACH); // the server's count when it has one
  const blob = await (await fetch(j.image)).blob(); // this piece's own picture, decoded from its own response
  await saveDraft(it.id, blob);
  return { blob, info: { attempt, seed, status: r.status, engine: j.engine, bytes: blob.size, key: key(it.id), ms: Date.now() - t0, prompt: j.prompt || '' } };
}

/** The AI look (a Cloudflare vision model, about 12 neurons): { form, person, item, note } or null when it was skipped or couldn't run.
    It catches what the pixel checks can't tell apart, such as a white piece on a white dress form. */
export async function look(src, it, pass) {
  try {
    let c = src; if (!(src instanceof HTMLCanvasElement)) { const { img, url } = await loadImage(src); URL.revokeObjectURL(url); c = toCanvas(img, 512); }
    const k = Math.min(1, 512 / Math.max(c.width, c.height));
    const sm = document.createElement('canvas'); sm.width = Math.round(c.width * k); sm.height = Math.round(c.height * k);
    const g = sm.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, sm.width, sm.height); g.drawImage(c, 0, 0, sm.width, sm.height); // (a cutout goes on white, like the photo)
    const r = await fetch('/api/starter', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': pass }, body: JSON.stringify({ id: it.id, look: true, image: sm.toDataURL('image/jpeg', 0.85) }) });
    const j = await r.json().catch(() => ({}));
    if (Number.isFinite(j.used)) setUsed(j.used); else if (j.neurons) addUsed(j.neurons);
    return r.ok && j.look ? j.look : null;
  } catch { return null; }
}
/** What the AI look found wrong, as check reasons. */
export const lookReasons = (l) => (!l ? [] : [
  ...(l.form ? [`AI check: a mannequin or dress form in the picture${l.note ? ` (${l.note})` : ''}`] : []),
  ...(l.person ? [`AI check: a person in the picture${l.note ? ` (${l.note})` : ''}`] : []),
  ...(!l.item ? [`AI check: doesn’t look like this piece${l.note ? ` (${l.note})` : ''}`] : []),
]);

/* ── the automatic check: plain white background, the whole item in frame, nothing else in the picture ── */
const WARM = /nude|beige|camel|tan|brown|cognac|oatmeal|taupe|champagne|gold|butter|cream|ivory|chocolate|straw|tortoise/;
const LIGHT = /white|cream|ivory|oatmeal|beige|champagne|grey|clear|nude|butter|taupe/;
const isSkin = (r, g, b) => { const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b, cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b; return cr > 138 && cr < 175 && cb > 85 && cb < 125 && r > 90 && r > g && g > b; };
/** A dress-form body or stand: light, colourless (white, grey or putty), and not the item's own colour. */
const isForm = (r, g, b) => Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
/** Where a dress form is: light, colourless patches that touch the outside of the item (a form sticks out past the garment), as a 0/1 mask.
 *  The light parts of a print (the cream in leopard) are enclosed by the garment, so they stay. inItem(i): is pixel i part of the item. */
function formMask(d, w, h, inItem, itemArea, minFrac = 0.03) {
  const a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) if (inItem(i) && isForm(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) a[i] = 1;
  const lab = new Int32Array(w * h), q = new Int32Array(w * h), out = new Uint8Array(w * h), edgeMin = Math.max(6, Math.round(Math.min(w, h) * 0.03));
  for (let i = 0, k = 0; i < w * h; i++) { if (!a[i] || lab[i]) continue; k++; let hd = 0, tl = 0, edge = 0; q[tl++] = i; lab[i] = k;
    while (hd < tl) { const p = q[hd++], x = p % w; for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (j < 0 || j >= w * h) { edge++; continue; } if (!inItem(j)) edge++; else if (a[j] && !lab[j]) { lab[j] = k; q[tl++] = j; } } }
    if (tl > itemArea * minFrac && edge >= Math.max(edgeMin, 0.6 * Math.sqrt(tl))) for (let t = 0; t < tl; t++) out[q[t]] = 1; }
  return out;
}
/** Light, colourless patches touching the top or bottom of the item (a dress form's neck or stand, a strip of backdrop), as a 0/1 mask. */
function edgeLightMask(d, w, h, inItem, itemArea, minFrac = 0.004) {
  let y0 = h, y1 = -1; for (let i = 0; i < w * h; i++) if (inItem(i)) { const y = (i / w) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const band = Math.max(2, Math.round((y1 - y0) * 0.06)), a = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (inItem(i) && isForm(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) a[i] = 1;
  const lab = new Int32Array(w * h), q = new Int32Array(w * h);
  for (let i = 0, k = 0; i < w * h; i++) { if (!a[i] || lab[i]) continue; k++; let hd = 0, tl = 0, edge = false, outside = 0; q[tl++] = i; lab[i] = k;
    while (hd < tl) { const p = q[hd++], x = p % w, y = (p / w) | 0; if (y <= y0 + band || y >= y1 - band) edge = true;
      for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) { if (j < 0 || j >= w * h || !inItem(j)) { outside++; continue; } if (a[j] && !lab[j]) { lab[j] = k; q[tl++] = j; } } }
    // it has to stick out past the piece (open to the outside along a real stretch), not sit inside it like the light part of a print
    if (edge && tl > itemArea * minFrac && outside >= Math.max(4, 0.6 * Math.sqrt(tl))) for (let t = 0; t < tl; t++) out[q[t]] = 1; }
  return out;
}
/** Runs of item pixels in one row of a mask: [[x0, x1], ...]. */
const runs = (fg, w, y) => { const out = []; let st = -1; for (let x = 0; x <= w; x++) { const on = x < w && fg[y * w + x]; if (on && st < 0) st = x; if (!on && st >= 0) { out.push([st, x - 1]); st = -1; } } return out; };

/** The picture on white at check size: { w, h, d (RGBA), fg (item mask: everything not reached by white from the edges) }. */
function analyse(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, s = Math.min(1, 256 / Math.max(W, H)), w = Math.round(W * s), h = Math.round(H * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); // (a cutout's see-through background counts as white)
  const d = g.getImageData(0, 0, w, h).data, fg = new Uint8Array(w * h).fill(1);
  const white = (o) => Math.min(d[o], d[o + 1], d[o + 2]) >= 244 && Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]) <= 10;
  // the background is the white reached from the picture's edges, so a white or cream piece (outlined by its own seams and shading) stays whole
  const q = new Int32Array(w * h); let qh = 0, qt = 0;
  const seed = (i) => { if (fg[i] && white(i * 4)) { fg[i] = 0; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) { const p = q[qh++], x = p % w; for (const k of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (k >= 0 && k < w * h && fg[k] && white(k * 4)) { fg[k] = 0; q[qt++] = k; } }
  return { w, h, d, fg };
}

/** Look at a picture (a generated photo or a cleaned cutout): { ok, reasons[] }. Pixel checks only: white border, margin on every side,
 *  one main shape, no skin, no dress-form body, neck stand or pole. */
/** Roughly what each colour on the list looks like (for the colour check). Prints, metals and clear pieces aren't checked. */
const SWATCH = { black: '#1c1c1c', white: '#f2f2ee', cream: '#efe6d2', ivory: '#f1ead9', beige: '#d9c3a3', camel: '#b98a55', brown: '#6e4a2e', 'chocolate brown': '#4a2f1f',
  navy: '#1f2a44', olive: '#6b6b3a', oatmeal: '#d8ccb4', 'butter yellow': '#f1dfa0', champagne: '#e7d3b0', grey: '#8f8f8f', red: '#b3242c', 'emerald green': '#1f6b4a',
  taupe: '#9b8b7a', tan: '#c19a6b', cognac: '#8e4b22', nude: '#d9b39a', 'light denim': '#9db4cf', 'medium denim': '#5f7ea3', 'dark denim': '#2c3d5a', straw: '#d8c08a' };
const UNCHECKED = /leopard|plaid|print|tortoise|gold|clear|metallic|stripe/i;
/** Is one of the picture's main colours close to one the piece should be? */
function colourMatches(d, w, h, fg, it) {
  const want = it.colors.map((c) => SWATCH[c.trim()]).filter(Boolean); if (!want.length || UNCHECKED.test(`${it.name} ${it.detail}`)) return true;
  try { if (localStorage.getItem('starter_test_pictures') === '1') return true; } catch { /* private mode */ } // (the tests' stand-in pictures are other colours)
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), id = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (fg[i]) { id.data.set([d[i * 4], d[i * 4 + 1], d[i * 4 + 2], 255], i * 4); }
  g.putImageData(id, 0, 0);
  const main = palette(c, 4).filter((p) => p.share > 0.15);
  return main.some((p) => want.some((h2) => hexDist(p.hex, h2) < 38));
}

export function checkPicture(img, it) {
  const { w, h, d, fg } = analyse(img), reasons = [];
  let ring = 0, ringWhite = 0, skin = 0, form = 0, n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  const m = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4, edge = x < m || y < m || x >= w - m || y >= h - m;
    if (edge) { ring++; if (!fg[i]) ringWhite++; }
    if (fg[i]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (isSkin(d[o], d[o + 1], d[o + 2])) skin++; }
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
  const colours = it.colors.join(' ');
  if (n && skin / n > (WARM.test(colours) ? 0.35 : 0.08)) reasons.push('skin-coloured areas (a person or a body form?)');
  let light = 0; for (let i = 0; i < w * h; i++) if (fg[i] && isForm(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) light++;
  const lightPiece = LIGHT.test(colours) || light / Math.max(1, n) > 0.65; // the piece itself is white, cream or grey: a form can't be told apart by colour
  if (n && !lightPiece) { const em = edgeLightMask(d, w, h, (i) => fg[i], n); let e = 0; for (let i = 0; i < w * h; i++) e += em[i]; if (e / n > 0.01) reasons.push('a white patch at the top or bottom edge (a form’s neck or stand?)'); }
  if (n && !lightPiece) { const fm = formMask(d, w, h, (i) => fg[i], n); for (let i = 0; i < w * h; i++) form += fm[i]; if (form / n > 0.03) reasons.push('a white or grey body shape (a dress form?)'); }
  if (n > 200 && !colourMatches(d, w, h, fg, it)) reasons.push(`colour doesn’t look ${it.colors.join(' / ')}`);
  // a neck stand on top or a pole underneath: the clothing's outline narrows to one thin, centred strip at its top or bottom
  if (n > 200 && !['shoes', 'bags', 'accessories'].includes(it.type)) {
    const bw = x1 - x0 + 1, cx = (x0 + x1) / 2, thin = (yy, f) => { const r = runs(fg, w, yy); return r.length === 1 && r[0][1] - r[0][0] + 1 < bw * f && Math.abs((r[0][0] + r[0][1]) / 2 - cx) < bw * 0.1; };
    const band = (a, b, f) => { let t = 0, all = 0; for (let yy = a; yy <= b; yy++) { all++; if (thin(yy, f)) t++; } return all && t / all > 0.7; };
    const bh = y1 - y0 + 1;
    if (!/halter|turtleneck|one-shoulder/i.test(`${it.name} ${it.detail}`) && band(y0, y0 + Math.round(bh * 0.07), 0.25)) reasons.push('a neck stand above the item (a dress form?)'); // (a halter's neck strap or a turtleneck's collar is the piece itself)
    // a stand's pole is very thin; a bodysuit's crotch, a skirt's hem or a dress's slit are not
    if (band(y1 - Math.round(bh * 0.1), y1, 0.06) && it.type !== 'bodysuits') reasons.push('a pole under the item (a dress form stand?)');
  }
  return { ok: !reasons.length, reasons };
}

/** Clean a cutout that failed the check: drop skin-coloured and dress-form-coloured areas (unless they're the item's own colour), a neck
 *  stand or pole, and anything not joined to the main piece. Returns a new trimmed canvas (to be checked again before it can be Ready). */
export function cleanUp(cut, it, { forms = true } = {}) {
  const w = cut.width, h = cut.height, g = cut.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, w, h), d = id.data;
  const colours = it.colors.join(' '), dropSkin = forms && !/nude|beige|camel|tan|clear/.test(colours); let dropForm = forms && !LIGHT.test(colours); // (forms: only when the check saw a form or skin)
  const keep = new Uint8Array(w * h); let area = 0, light = 0; for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] >= 40) { area++; if (isForm(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) light++; }
  if (light / Math.max(1, area) > 0.65) dropForm = false; // the piece itself is mostly white or cream: its light parts are the piece
  const fm = dropForm ? formMask(d, w, h, (i) => d[i * 4 + 3] >= 40, area) : null, em = dropForm ? edgeLightMask(d, w, h, (i) => d[i * 4 + 3] >= 40, area) : null;
  for (let i = 0; i < w * h; i++) { const o = i * 4; if (d[o + 3] < 40) continue; keep[i] = (dropSkin && isSkin(d[o], d[o + 1], d[o + 2])) || fm?.[i] || em?.[i] ? 0 : 1; }
  // thin centred strips at the top and bottom (neck stand, pole) go too
  let y0 = 0, y1 = h - 1; while (y0 < h && !runs(keep, w, y0).length) y0++; while (y1 > 0 && !runs(keep, w, y1).length) y1--;
  let bw = 0; for (let y = y0; y <= y1; y++) { const r = runs(keep, w, y); if (r.length) bw = Math.max(bw, r[r.length - 1][1] - r[0][0] + 1); }
  for (const dir of [1, -1]) for (let y = dir > 0 ? y0 : y1; y >= y0 && y <= y1; y += dir) { const r = runs(keep, w, y); if (r.length === 1 && r[0][1] - r[0][0] + 1 < bw * 0.2) { for (let x = r[0][0]; x <= r[0][1]; x++) keep[y * w + x] = 0; } else break; }
  // only the biggest connected piece (plus anything at least a quarter its size: a second trouser leg, the other shoe)
  const lab = new Int32Array(w * h), q = new Int32Array(w * h), sizes = [0]; let k = 0;
  for (let i = 0; i < w * h; i++) { if (!keep[i] || lab[i]) continue; k++; let hd = 0, tl = 0; q[tl++] = i; lab[i] = k;
    while (hd < tl) { const p = q[hd++], x = p % w; for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (j >= 0 && j < w * h && keep[j] && !lab[j]) { lab[j] = k; q[tl++] = j; } }
    sizes.push(tl); }
  const big = Math.max(0, ...sizes);
  for (let i = 0; i < w * h; i++) if (!lab[i] || sizes[lab[i]] < big * 0.25) d[i * 4 + 3] = 0;
  g.putImageData(id, 0, 0);
  return trimTransparent(cut, 2);
}

/** The normal pipeline on a white-background product photo: checked, background off (no tap needed), cropped, colours read. */
export async function process(blob, it) {
  const { img, url } = await loadImage(blob); URL.revokeObjectURL(url);
  const first = checkPicture(img, it);
  // every cutout is tidied (stray fragments, skin, form scraps at the edges), and the tidy cutout is checked again: Ready needs both to pass
  const formish = first.reasons.some((r) => /form|neck|pole|skin|white patch/.test(r)); // light parts of a print (leopard) are only touched when a form was seen
  const cut = cleanUp(removeBackground(toCanvas(img, 1000), { tolerance: 18 }), it, { forms: formish }), after = checkPicture(padded(cut), it); // (a pure white studio background; kept tight so white and cream pieces keep their edges)
  return finish(cut, { ok: first.ok && after.ok, reasons: [...new Set([...first.reasons, ...after.reasons.map((r) => `after clean-up: ${r}`)])] });
}
/** A cutout on white with a margin, so it's checked like a photo. */
function padded(cut) {
  const pad = document.createElement('canvas'); pad.width = Math.round(cut.width * 1.2) + 4; pad.height = Math.round(cut.height * 1.2) + 4;
  const pg = pad.getContext('2d'); pg.fillStyle = '#fff'; pg.fillRect(0, 0, pad.width, pad.height); pg.drawImage(cut, (pad.width - cut.width) / 2, (pad.height - cut.height) / 2);
  return pad;
}
/** The last resort for a picture that failed its check after the automatic remakes: clean the cutout, then check the clean cutout. */
export async function processCleaned(blob, it, firstCheck) {
  const { img, url } = await loadImage(blob); URL.revokeObjectURL(url);
  const cut = cleanUp(removeBackground(toCanvas(img, 1000), { tolerance: 18 }), it);
  const check = checkPicture(padded(cut), it);
  if (LIGHT.test(it.colors.join(' ')) && firstCheck?.reasons.some((r) => /dress form|neck stand|pole|body form/.test(r))) // a white or cream piece on a white form: the two can't be told apart by colour
    check.ok = false, check.reasons = [...check.reasons, 'a light piece on a form: the form could not be removed automatically'];
  return { ...(await finish(cut, check)), cleaned: true };
}
async function finish(cut, check) {
  const pal = palette(cut).filter((c) => c.share > 0.04);
  const main = pal[0]?.hex || '#cccccc';
  return { check, canvas: cut, cutout: await canvasToBlob(cut, 'image/webp', 0.92), color: { hex: main, name: colorName(main) }, colors: pal.map((c) => c.hex) };
}

/** A closet item for an approved starter piece. */
/** Whether a starter piece has sleeves, from its name and description (a flat lay's sleeves lie close to the body, so guessing from the shape fails). */
export const sleevesOf = (it) => (/sleeveless|strapless|tube|cami|tank|halter|corset|vest|one-shoulder|thin straps/i.test(`${it.name} ${it.detail}`) ? false
  : /sleeve|sweater|turtleneck|button-down|blouse|tee|t-shirt|cardigan|blazer|coat|jacket|duster|puffer|shirt/i.test(`${it.name} ${it.detail}`) ? true : undefined);
/** Starter pieces checked by an older version are checked again (the check keeps getting stricter). */
export const CHECK_VERSION = 4;
export const toItem = (it, done, original) => ({
  checkVersion: CHECK_VERSION, ...(sleevesOf(it) !== undefined && ['tops', 'tanks', 'bodysuits', 'outerwear', 'dresses'].includes(it.type) && { sleeves: sleevesOf(it) }),
  id: uid(), starterId: it.id, source: 'starter', ready: !!done.ready, review: done.ready ? undefined : done.why, ...(it.acc && { acc: it.acc }), name: it.name, type: it.type, occasions: [...it.occasions], season: it.season, brand: '',
  color: done.color, colors: done.colors, tags: { colors: it.colors }, cutout: done.cutout, original, adj: { scale: 1, dx: 0, dy: 0 },
  createdAt: Date.now(), updatedAt: Date.now(),
});
