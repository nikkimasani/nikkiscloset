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
