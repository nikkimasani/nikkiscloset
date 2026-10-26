// Turning a selection mask into the garment's transparent picture: the engine's small 0/255 mask is scaled up smoothly to the photo's size,
// your brush touch-ups (erase / restore) are laid on top, and the result is cropped to the garment.
import { trimTransparent } from './cutout.js';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A mask { w, h, data (0/255) } scaled to W x H as a Uint8ClampedArray of alpha values with soft, anti-aliased edges. */
export function upsampleMask(mask, W, H) {
  const small = document.createElement('canvas'); small.width = mask.w; small.height = mask.h;
  const sg = small.getContext('2d'), id = sg.createImageData(mask.w, mask.h);
  for (let i = 0; i < mask.w * mask.h; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = mask.data[i]; }
  sg.putImageData(id, 0, 0);
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const bg = big.getContext('2d', { willReadFrequently: true }); bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = 'high'; bg.drawImage(small, 0, 0, W, H);
  const d = bg.getImageData(0, 0, W, H).data, a = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) a[i] = Math.round(255 * smoothstep(0.3, 0.7, d[i * 4 + 3] / 255));
  return a;
}

/**
 * The cutout: the photo (a canvas) with `alpha` as its transparency, then your brush edits, then trimmed to the garment.
 * edits: optional Int8Array (W*H) of -1 (erased by you), +1 (restored by you) or 0 (leave it to the selection).
 */
export function cutoutFrom(photo, alpha, edits = null) {
  const W = photo.width, H = photo.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(photo, 0, 0);
  const id = g.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) { let a = alpha[i]; if (edits && edits[i]) a = edits[i] > 0 ? 255 : 0; id.data[i * 4 + 3] = a; }
  g.putImageData(id, 0, 0);
  return trimTransparent(c, 2);
}

/** Square erode (op = min) or dilate (max) of a 0/1 mask by r pixels, done as two 1D passes. */
function morph(a, w, h, r, dilate) {
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h), want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1 - want; for (let k = -r; k <= r && v !== want; k++) { const xx = x + k; const s = xx < 0 || xx >= w ? 0 : a[y * w + xx]; if (s === want) v = want; } t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1 - want; for (let k = -r; k <= r && v !== want; k++) { const yy = y + k; const s = yy < 0 || yy >= h ? 0 : t[yy * w + x]; if (s === want) v = want; } o[y * w + x] = v; }
  return o;
}
/** Connected parts (4-neighbour) of a 0/1 mask: { lab: Int32Array (0 = none), sizes: [0, n1, n2, ...] }. */
export function parts(a, w, h) {
  const lab = new Int32Array(w * h), sizes = [0], q = new Int32Array(w * h); let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!a[i] || lab[i]) continue; n++; let hd = 0, tl = 0; q[tl++] = i; lab[i] = n;
    while (hd < tl) { const p = q[hd++], x = p % w; for (const k of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]) if (k >= 0 && a[k] && !lab[k]) { lab[k] = n; q[tl++] = k; } }
    sizes.push(tl);
  }
  return { lab, sizes };
}
/**
 * Tidy a selection mask { w, h, data (0/255) }: thin strands and specks that only touch the garment by a thread (a divider line in a
 * screenshot, a hanger wire, dust) are dropped, and only the parts you tapped ➕ on (or the biggest) are kept. Returns a new mask.
 */
export function cleanMask(m, pos = []) {
  const { w, h } = m, a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) a[i] = m.data[i] > 127 ? 1 : 0;
  const r = Math.max(1, Math.round(Math.min(w, h) * 0.005)), open = morph(morph(a, w, h, r, false), w, h, r, true), { lab, sizes } = parts(open, w, h);
  if (sizes.length <= 1) return m;
  const keep = new Set();
  for (const [u, v] of pos) { const x = Math.round(u * (w - 1)), y = Math.round(v * (h - 1)); let best = 0, bd = 1e9; for (let dy = -3 * r; dy <= 3 * r; dy++) for (let dx = -3 * r; dx <= 3 * r; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const l = lab[yy * w + xx], d = dx * dx + dy * dy; if (l && d < bd) { bd = d; best = l; } } if (best) keep.add(best); }
  if (!keep.size) { let b = 1; for (let k = 2; k < sizes.length; k++) if (sizes[k] > sizes[b]) b = k; keep.add(b); }
  const kept = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) kept[i] = lab[i] && keep.has(lab[i]) ? 1 : 0;
  const near = morph(kept, w, h, 2 * r, true), data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = a[i] && near[i] ? 255 : 0; // the garment's own edge, as it was selected
  return { ...m, w, h, data };
}

/**
 * A photo of a set (a top and shorts, say) gives two pieces stacked one above the other with a clear gap between them.
 * Returns the rows [y0, y1) of the upper and lower piece in a cutout canvas, or null when it's a single piece.
 */
export function stackedPieces(canvas) {
  const w = canvas.width, h = canvas.height, d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, rows = new Float32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 64) n++; rows[y] = n / w; }
  let best = null;
  for (let y = Math.round(h * 0.2); y < h * 0.8; y++) {
    if (rows[y] > 0.01) continue; let e = y; while (e < h && rows[e] <= 0.01) e++;
    if (e - y >= Math.max(3, h * 0.015) && (!best || e - y > best[1] - best[0])) best = [y, e]; y = e;
  }
  return best ? { upper: [0, best[0]], lower: [best[1], h] } : null;
}
