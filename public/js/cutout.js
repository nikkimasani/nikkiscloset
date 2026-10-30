// In-browser "cutout": removes a plain background by flood-filling from the photo's edges,
// then crops to the garment so it can be layered on the mannequin. No upload, no API key.
export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not read that image')); img.src = url; });
  return { img, url };
}

function median(arr) { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; }

export function toCanvas(img, maxSize = 900) {
  const s = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** @param {HTMLCanvasElement} src @param {{tolerance:number}} opts @returns {HTMLCanvasElement} */
export function removeBackground(src, { tolerance = 42, holes = 0 } = {}) {
  const { width: w, height: h } = src;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Already a transparent PNG? Keep as is.
  let clear = 0, edge = 0;
  const edgeIdx = [];
  for (let x = 0; x < w; x++) edgeIdx.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) edgeIdx.push(y * w, y * w + w - 1);
  for (const i of edgeIdx) { edge++; if (d[i * 4 + 3] < 10) clear++; }
  if (clear / edge > 0.6) return crop(src, img, new Uint8Array(w * h));

  const rs = [], gs = [], bs = [];
  for (const i of edgeIdx) { rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]); }
  const bg = [median(rs), median(gs), median(bs)];
  const near = (p) => {
    const o = p * 4;
    return Math.hypot(d[o] - bg[0], d[o + 1] - bg[1], d[o + 2] - bg[2]) <= tolerance;
  };

  const isBg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (p) => { if (!isBg[p] && near(p)) { isBg[p] = 1; queue[tail++] = p; } };
  for (const p of edgeIdx) push(p);
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  // holes: background-coloured patches the flood can't reach (between a sleeve and the body, inside a strap) go too, if they're at least
  // `holes` of the picture (smaller ones are buttons, eyelets or the light part of the fabric)
  if (holes) {
    const lab = new Uint8Array(w * h), q = new Int32Array(w * h), min = holes * w * h;
    for (let i = 0; i < w * h; i++) {
      if (isBg[i] || lab[i] || !near(i)) continue;
      let hd = 0, tl = 0; q[tl++] = i; lab[i] = 1;
      while (hd < tl) { const p = q[hd++], x = p % w; for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (j >= 0 && j < w * h && !isBg[j] && !lab[j] && near(j)) { lab[j] = 1; q[tl++] = j; } }
      if (tl >= min) for (let t = 0; t < tl; t++) isBg[q[t]] = 1;
    }
  }
  return crop(src, img, isBg);
}

function crop(src, img, isBg) {
  const { width: w, height: h } = src;
  const d = img.data;
  // Soften the edge: garment pixels touching background get partial alpha.
  const out = new Uint8ClampedArray(d);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let a = d[p * 4 + 3];
      if (isBg[p]) a = 0;
      else if (x && y && x < w - 1 && y < h - 1 && (isBg[p - 1] || isBg[p + 1] || isBg[p - w] || isBg[p + w])) a = Math.min(a, 150);
      out[p * 4 + 3] = a;
      if (a > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; } // nothing left: keep whole photo
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const full = document.createElement('canvas');
  full.width = w; full.height = h;
  full.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  const res = document.createElement('canvas');
  res.width = x1 - x0 + 1; res.height = y1 - y0 + 1;
  res.getContext('2d').drawImage(full, x0, y0, res.width, res.height, 0, 0, res.width, res.height);
  full.width = full.height = 0; // (iPhones cap the memory all canvases share: let it go now)
  return res;
}

/** Crop away fully transparent margins (with a little padding). */
export function trimTransparent(src, pad = 4) {
  const g = src.getContext('2d', { willReadFrequently: true }), { width: w, height: h } = src, d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return src;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

export const canvasToBlob = (c, type = 'image/png', q) => new Promise((r) => c.toBlob(r, type, q));
