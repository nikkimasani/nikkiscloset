// Tap-to-select: you tap the garment (positive points) and what to leave out (negative points: the dress form, the wall); GrabCut (OpenCV) finds the
// outline from those taps and the colours they point at. This is a Web Worker (so the app stays responsive while it thinks) with its own
// security policy (OpenCV needs eval; this file can't reach the network). Messages in: load {blob}, cut {pos, neg, rect}. Out: ready, loaded {w, h}, mask {w, h, data}, error.
const post = (m, t) => postMessage(m, t);
const MAX = 640;
let busy = false, latest = null, cv = null, loading = null, src = null, W = 0, H = 0, rgba = null;

// (A promise is never resolved with cv itself: its `then` hands itself back forever.)
const loadCV = () => {
  if (cv) return Promise.resolve(true);
  return (loading ||= new Promise((res, rej) => {
    try { importScripts('../vendor/opencv/opencv.js'); } catch (e) { return rej(new Error('Could not load the selection tool')); }
    const t0 = Date.now(), poll = () => { if (self.cv?.Mat && self.cv?.grabCut) { cv = self.cv; res(true); } else if (Date.now() - t0 > 90000) rej(new Error('The selection tool did not start')); else setTimeout(poll, 50); }; poll();
  }));
};

/** Pixels (as indexes into the working image) of a disc. */
function disc(cx, cy, r, f) { const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r)); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) f(y * W + x); }

/** Keep the pieces touching a positive tap (or the biggest piece), and close small holes that don't open to the outside. */
function tidy(fg, pos) {
  const lab = new Int32Array(W * H), sizes = [0]; let n = 0; const q = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) { if (!fg[i] || lab[i]) continue; n++; let h = 0, t = 0; q[t++] = i; lab[i] = n; let sz = 0; while (h < t) { const p = q[h++], x = p % W; sz++; for (const k of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p >= W ? p - W : -1, p < W * (H - 1) ? p + W : -1]) if (k >= 0 && fg[k] && !lab[k]) { lab[k] = n; q[t++] = k; } } sizes.push(sz); }
  const keep = new Set(); for (const [x, y] of pos) { const l = lab[Math.round(y) * W + Math.round(x)]; if (l) keep.add(l); }
  if (!keep.size && n) { let b = 1; for (let k = 2; k <= n; k++) if (sizes[k] > sizes[b]) b = k; keep.add(b); }
  const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (lab[i] && keep.has(lab[i])) out[i] = 255;
  // holes: background regions not connected to the border and smaller than 0.4% of the picture
  const seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { if (out[i] || seen[i]) continue; let h = 0, t = 0, border = false; q[t++] = i; seen[i] = 1; while (h < t) { const p = q[h++], x = p % W, y = (p / W) | 0; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true; for (const k of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p >= W ? p - W : -1, p < W * (H - 1) ? p + W : -1]) if (k >= 0 && !out[k] && !seen[k]) { seen[k] = 1; q[t++] = k; } } if (!border && t < W * H * 0.004) for (let k = 0; k < t; k++) out[q[k]] = 255; }
  return out;
}

async function cut({ pos = [], neg = [], rect = [0, 0, 1, 1] }) {
  await loadCV();
  const diag = Math.hypot(W, H), px = pos.map(([u, v]) => [u * W, v * H]), nx = neg.map(([u, v]) => [u * W, v * H]);
  const st = new Uint8Array(W * H).fill(0); // 0 sure background, 1 sure garment, 2 probably background, 3 probably garment
  const rx0 = Math.round(rect[0] * W), ry0 = Math.round(rect[1] * H), rx1 = Math.round(rect[2] * W), ry1 = Math.round(rect[3] * H), edge = Math.max(2, Math.round(diag * 0.012));
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) st[y * W + x] = x - rx0 < edge || rx1 - x <= edge || y - ry0 < edge || ry1 - y <= edge ? 0 : 2;
  if (!px.length) { const cx0 = rx0 + (rx1 - rx0) * 0.3, cx1 = rx0 + (rx1 - rx0) * 0.7, cy0 = ry0 + (ry1 - ry0) * 0.25, cy1 = ry0 + (ry1 - ry0) * 0.75; for (let y = Math.round(cy0); y < cy1; y++) for (let x = Math.round(cx0); x < cx1; x++) st[y * W + x] = 3; }
  for (const [x, y] of px) disc(x, y, diag * 0.07, (i) => { if (st[i] === 2) st[i] = 3; });
  for (const [x, y] of nx) disc(x, y, diag * 0.03, (i) => { if (st[i] === 3) st[i] = 2; });
  for (const [x, y] of px) disc(x, y, Math.max(3, diag * 0.012), (i) => { st[i] = 1; });
  for (const [x, y] of nx) disc(x, y, Math.max(4, diag * 0.02), (i) => { st[i] = 0; });
  const mask = new cv.Mat(H, W, cv.CV_8UC1), bgd = new cv.Mat(), fgd = new cv.Mat(); mask.data.set(st);
  try { cv.grabCut(src, mask, new cv.Rect(0, 0, W, H), bgd, fgd, 4, cv.GC_INIT_WITH_MASK); } finally { bgd.delete(); fgd.delete(); }
  const fg = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) fg[i] = mask.data[i] === 1 || mask.data[i] === 3 ? 1 : 0; mask.delete();
  return tidy(fg, px);
}

addEventListener('message', async (e) => {
  const m = e.data;
  try {
    if (m?.type === 'load' && m.blob instanceof Blob) {
      await loadCV();
      const bmp = await createImageBitmap(m.blob), s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      W = Math.max(1, Math.round(bmp.width * s)); H = Math.max(1, Math.round(bmp.height * s));
      const c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, W, H);
      rgba = g.getImageData(0, 0, W, H); src?.delete();
      const a = cv.matFromImageData(rgba); src = new cv.Mat(); cv.cvtColor(a, src, cv.COLOR_RGBA2RGB); a.delete();
      return post({ type: 'loaded', w: W, h: H, id: m.id });
    }
    if (m?.type === 'cut' && src) { // taps arrive faster than the outline is found: only the newest request is worked on, the others answer empty
      if (latest) post({ type: 'mask', w: 0, h: 0, data: null, id: latest.id });
      latest = m; if (busy) return;
      busy = true;
      while (latest) {
        await new Promise((r) => setTimeout(r, 0)); // let any newer tap arrive first
        const job = latest; latest = null;
        const data = await cut(job);
        if (latest) { post({ type: 'mask', w: 0, h: 0, data: null, id: job.id }); continue; }
        post({ type: 'mask', w: W, h: H, data, id: job.id }, [data.buffer]);
      }
      busy = false;
    }
  } catch (err) { busy = false; latest = null; post({ type: 'error', message: String(err?.message || err).slice(0, 200), id: m?.id }); }
});
post({ type: 'ready' });
