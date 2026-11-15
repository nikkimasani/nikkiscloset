// "Make my model": the base figure redrawn to look like you (face, skin tone, tattoos) by FLUX.2 [klein] on Cloudflare.
// Her pose, outline and framing are kept, so every piece drawn on the standard model still lines up. Your photos are sent to
// Cloudflare to draw the picture and are not kept anywhere; the new model is stored on this device (and synced, like your other data).
export const OUT_W = 768, OUT_H = 1520; // what Cloudflare draws (the base picture is 896 x 1776; the same width-to-height, within 0.2%)

/** The flat background the figure is drawn on, keyed out afterwards (far from any skin, hair or nude-fabric colour). */
export const KEY = [255, 0, 255];

/** Is this pixel the magenta backdrop? 1 = backdrop, 0 = figure, in between at soft edges. */
export function keyAmount(r, g, b) {
  const m = Math.min(r, b) - g; // how much more red-and-blue than green
  if (m < 40 || Math.abs(r - b) > 110) return 0;
  return Math.min(1, (m - 40) / 70);
}

/** Make the backdrop see-through (in place) and take its pink cast off the edges; keep only the biggest piece (the figure). */
export function keyOut(img) {
  const { data, width: w, height: h } = img;
  for (let i = 0; i < data.length; i += 4) {
    const k = keyAmount(data[i], data[i + 1], data[i + 2]);
    if (k > 0) {
      data[i + 3] = Math.round(data[i + 3] * (1 - k));
      const cap = data[i + 1] + 30; data[i] = Math.min(data[i], Math.max(cap, data[i + 1])); data[i + 2] = Math.min(data[i + 2], cap); // de-spill
    }
  }
  // the largest connected solid region is the figure; stray specks of the backdrop's noise go
  const lab = new Int32Array(w * h), sizes = [0]; let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (lab[p] || data[p * 4 + 3] < 128) continue;
    n++; let size = 0; const st = [p]; lab[p] = n;
    while (st.length) {
      const q = st.pop(); size++; const x = q % w, y = (q - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx; if (!lab[r] && data[r * 4 + 3] >= 128) { lab[r] = n; st.push(r); }
      }
    }
    sizes.push(size);
  }
  const keep = sizes.indexOf(Math.max(...sizes));
  for (let p = 0; p < w * h; p++) if (lab[p] && lab[p] !== keep) data[p * 4 + 3] = 0;
  return img;
}

/** How much two figures overlap (intersection over union of their solid pixels): 1 = the same outline. */
export function overlap(a, b) {
  let both = 0, either = 0;
  for (let i = 3; i < a.data.length; i += 4) { const x = a.data[i] >= 128, y = b.data[i] >= 128; if (x && y) both++; if (x || y) either++; }
  return either ? both / either : 0;
}

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That picture could not be opened.')); i.src = src; });

/** The standard figure on the magenta backdrop, at the size Cloudflare draws (JPEG keeps the upload small). */
export async function figureInput(baseHref) {
  const im = await loadImg(baseHref), c = canvas(OUT_W, OUT_H), g = c.getContext('2d');
  g.fillStyle = `rgb(${KEY})`; g.fillRect(0, 0, OUT_W, OUT_H);
  g.drawImage(im, 0, 0, OUT_W, im.naturalHeight * (OUT_W / im.naturalWidth));
  return c.toDataURL('image/jpeg', 0.92);
}

/** One of your photos, made small enough to send (longest side 768). */
export async function photoInput(file) {
  const u = URL.createObjectURL(file);
  try {
    const im = await loadImg(u), s = Math.min(1, 768 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = canvas(Math.round(im.naturalWidth * s), Math.round(im.naturalHeight * s)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(u); }
}

/** Cloudflare's picture back at the base picture's size, backdrop removed: { blob, url, match } (match = outline overlap with the standard figure). */
export async function finishModel(drawn, baseHref) {
  const [im, base] = await Promise.all([loadImg(drawn), loadImg(baseHref)]);
  const W = base.naturalWidth, H = base.naturalHeight, c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, W, im.naturalHeight * (W / im.naturalWidth));
  const mine = keyOut(g.getImageData(0, 0, W, H)); g.putImageData(mine, 0, 0);
  const b = canvas(W, H), bg = b.getContext('2d', { willReadFrequently: true }); bg.drawImage(base, 0, 0);
  const match = overlap(mine, bg.getImageData(0, 0, W, H));
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  return { blob, url: URL.createObjectURL(blob), match };
}

/** A new model whose outline wanders this far from the standard one would leave clothes misaligned. */
export const GOOD_MATCH = 0.9;
