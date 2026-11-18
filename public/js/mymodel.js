// "Make my model": the base figure given your face by FLUX.2 [klein] on Cloudflare. Only her head and shoulders are sent and redrawn (a whole
// figure in a nude sports set with a real face is stopped by Cloudflare's safety filter); the new head is put back on her body with a soft edge
// and her skin is shifted to its tone. Her pose and outline never change, so every piece drawn on the standard model still lines up. Your photo
// is sent to Cloudflare to draw the picture and is not kept anywhere; the new model is stored on this device (and synced, like your other data).

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

/** One of your photos, made small enough to send (longest side 768). */
export async function photoInput(file) {
  const u = URL.createObjectURL(file);
  try {
    const im = await loadImg(u), s = Math.min(1, 768 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = canvas(Math.round(im.naturalWidth * s), Math.round(im.naturalHeight * s)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(u); }
}

/** A new model whose outline wanders this far from the standard one would leave clothes misaligned. */
export const GOOD_MATCH = 0.9;

/* ───────── head only ───────── */

/** The part of the base picture (896 x 1776) sent to be redrawn: crown to the base of her neck, square. */
export const HEAD = { x: 278, y: 0, w: 340, h: 340, out: 768 }; // (stops above the sports bra: nothing for the safety filter to object to)
/** Where the new head replaces the old one: an ellipse around the head and neck (base picture pixels), with a soft edge. */
export const HEAD_MASK = { cx: 448, cy: 172, rx: 98, ry: 152, soft: 22 };
/** Her face (brows to chin): where the skin tone is read, from skin-coloured pixels only. */
export const FACE = { x: 392, y: 118, w: 112, h: 112 };
export const CHEEKS = FACE; // (the old name)
/** Where her crown and eyes are in the base picture: the new head is lined up on these so earrings and sunglasses still sit right. */
export const CROWN_Y = 41, EYES_Y = 153;

/** 0..1: how much of the new head shows at this point (1 well inside the ellipse, fading to 0 across its soft edge). */
export function headMask(x, y, m = HEAD_MASK) {
  const d = Math.hypot((x - m.cx) / m.rx, (y - m.cy) / m.ry); // 1 on the ellipse
  const inner = 1 - m.soft / Math.min(m.rx, m.ry);
  return d <= inner ? 1 : d >= 1 ? 0 : (1 - d) / (1 - inner);
}

/** The average colour of the solid pixels in a box of an ImageData (at the given offset into the full picture). */
export function meanColor(img, box, ox = 0, oy = 0) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = ((y - oy) * img.width + (x - ox)) * 4; if (img.data[i + 3] < 200) continue;
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** Per-channel factors that turn one skin tone into another (kept within reason, so a shadow can't paint her grey or green). */
export function toneRatio(from, to) { return from && to ? from.map((c, k) => Math.min(1.3, Math.max(0.75, to[k] / Math.max(1, c)))) : [1, 1, 1]; }

/** Is this pixel skin-coloured? (warm: red over green over blue, neither shadow-dark nor highlight-white; hair, brows, eyes and lips fail) */
export const isSkin = (r, g, b) => r > g && g > b && r - b >= 25 && r - b <= 140 && r >= 70 && r <= 250 && g >= 40;
/** The median colour of the skin-coloured solid pixels in a box (robust to hair, shadow or a highlight falling in it), or null if too few. */
export function skinTone(img, box, ox = 0, oy = 0) {
  const R = [], G = [], B = [];
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const hx = x - ox, hy = y - oy; if (hx < 0 || hy < 0 || hx >= img.width || hy >= img.height) continue;
    const i = (hy * img.width + hx) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (img.data[i + 3] < 200 || !isSkin(r, g, b)) continue; R.push(r); G.push(g); B.push(b);
  }
  if (R.length < 40) return null;
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(R), med(G), med(B)];
}

/** Where a head sits in a picture (ImageData, solid where the figure is): its crown row, and the middle and width of the head at its widest
 *  (going down from the crown until the neck narrows it, so the reading holds whatever size the head is drawn). */
export function headFrame(img, cx0 = img.width / 2) {
  const solid = (x, y) => img.data[(y * img.width + x) * 4 + 3] >= 128;
  let crown = -1;
  for (let y = 0; y < img.height && crown < 0; y++) { let n = 0; for (let x = 0; x < img.width; x++) if (solid(x, y)) n++; if (n >= 6) crown = y; }
  if (crown < 0) return null;
  let best = null; const c = Math.round(cx0);
  for (let y = crown; y < img.height; y++) {
    if (!solid(c, y)) { if (best) break; continue; }
    let l = c, r = c; while (l > 0 && solid(l - 1, y)) l--; while (r < img.width - 1 && solid(r + 1, y)) r++;
    const w = r - l + 1;
    if (!best || w > best.w) best = { w, cx: (l + r) / 2 };
    else if (y - crown > 40 && w < best.w * 0.7) break; // the neck: the head ends here
  }
  return best && { crown, cx: best.cx, w: best.w };
}

/** How to move and scale the new head so it sits where hers was: { s, dx, dy } for x' = (x - n.cx) * s + b.cx, y' = (y - n.crown) * s + b.crown; null when it can't be read or is too far off to trust. */
export function alignHead(b, n) {
  if (!b || !n || n.w < 20) return null;
  const s = b.w / n.w; if (s < 0.8 || s > 1.25 || Math.abs(b.cx - n.cx) > 50 || Math.abs(b.crown - n.crown) > 50) return null;
  return { s, dx: b.cx - n.cx * s, dy: b.crown - n.crown * s };
}

/** The standard figure's head and shoulders on the magenta backdrop, at the size Cloudflare draws. */
export async function headInput(baseHref) {
  const im = await loadImg(baseHref), c = canvas(HEAD.out, HEAD.out), g = c.getContext('2d');
  g.fillStyle = `rgb(${KEY})`; g.fillRect(0, 0, HEAD.out, HEAD.out);
  g.drawImage(im, HEAD.x, HEAD.y, HEAD.w, HEAD.h, 0, 0, HEAD.out, HEAD.out);
  return c.toDataURL('image/jpeg', 0.92);
}

/** The standard figure with Cloudflare's new head on it and her skin shifted to its tone: { blob, url, match } (match = outline kept, 0..1). */
export async function finishHead(drawn, baseHref) {
  const [im, base] = await Promise.all([loadImg(drawn), loadImg(baseHref)]);
  const W = base.naturalWidth, H = base.naturalHeight;
  const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(base, 0, 0);
  const out = g.getImageData(0, 0, W, H), orig = new Uint8ClampedArray(out.data);
  const hc = canvas(HEAD.w, HEAD.h), hg = hc.getContext('2d', { willReadFrequently: true }); hg.drawImage(im, 0, 0, HEAD.w, HEAD.h);
  let head = keyOut(hg.getImageData(0, 0, HEAD.w, HEAD.h));
  // line the new head up with hers (crown and width at eye level), so the anchors for earrings, sunglasses and hair still match
  const bc = canvas(HEAD.w, HEAD.h), bg = bc.getContext('2d', { willReadFrequently: true }); bg.drawImage(base, HEAD.x, HEAD.y, HEAD.w, HEAD.h, 0, 0, HEAD.w, HEAD.h);
  const fit = alignHead(headFrame(bg.getImageData(0, 0, HEAD.w, HEAD.h)), headFrame(head));
  if (fit && (Math.abs(fit.s - 1) > 0.01 || Math.abs(fit.dx) > 1 || Math.abs(fit.dy) > 1)) {
    hg.putImageData(head, 0, 0); const ac = canvas(HEAD.w, HEAD.h), ag = ac.getContext('2d', { willReadFrequently: true });
    ag.setTransform(fit.s, 0, 0, fit.s, fit.dx, fit.dy); ag.drawImage(hc, 0, 0); head = ag.getImageData(0, 0, HEAD.w, HEAD.h);
  }
  const ratio = toneRatio(skinTone(out, FACE), skinTone(head, FACE, HEAD.x, HEAD.y));
  for (let p = 0; p < W * H; p++) {
    const i = p * 4; if (!out.data[i + 3]) continue;
    for (let k = 0; k < 3; k++) out.data[i + k] = out.data[i + k] * ratio[k]; // her skin (and the nude set) in your tone
    const x = p % W, y = (p - x) / W, hx = x - HEAD.x, hy = y - HEAD.y;
    if (hx < 0 || hy < 0 || hx >= HEAD.w || hy >= HEAD.h) continue;
    const j = (hy * HEAD.w + hx) * 4, a = headMask(x, y) * head.data[j + 3] / 255;
    if (a > 0) for (let k = 0; k < 3; k++) out.data[i + k] = out.data[i + k] * (1 - a) + head.data[j + k] * a; // the new head, blended in
  }
  g.putImageData(out, 0, 0);
  let same = 0, any = 0; for (let i = 3; i < orig.length; i += 4) { const a = orig[i] >= 128, b = out.data[i] >= 128; if (a && b) same++; if (a || b) any++; }
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  return { blob, url: URL.createObjectURL(blob), match: any ? same / any : 0 };
}
