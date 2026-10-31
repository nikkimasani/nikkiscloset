// Pieces made for the model: Cloudflare's FLUX.2 [klein] draws the model herself wearing the piece, and only what changed (the piece) is
// kept, as a picture the size of base.png that lines up with her exactly. Worn pieces stack in Dress Up with no warping: they were drawn
// on her body, in her pose. Bags and accessories stay product photos that snap to a body point.
import { loadImage, canvasToBlob } from './cutout.js';
import { palette, colorName } from './color.js';

/** The kinds of pieces drawn on the model. */
/** Raised whenever the way pieces are drawn or cut out changes: the preload job remakes pieces made by an older version. */
export const WEAR_VERSION = 3;
export const WORN_TYPES = ['tops', 'tanks', 'bodysuits', 'bottoms', 'skirts', 'dresses', 'outerwear', 'shoes'];
export const isWornType = (type) => WORN_TYPES.includes(type);
export const WEAR_NEURONS = 57.5; // (FLUX.2 klein 4B: 5.37 per input tile + 26.05 per output tile; one input tile, two output tiles)
/** The model picture sent to Cloudflare (it takes inputs under 512 x 512) and the size it draws back (multiples of 16, about her shape). */
export const IN_W = 252, IN_H = 500, OUT_W = 512, OUT_H = 1008;
/** Keys, like a green screen: her body below the face is painted one flat colour (shading kept, so the piece still drapes) on a blue
 *  backdrop. Whatever Cloudflare draws that is neither is the piece, whatever its own colour (camel and beige would otherwise vanish
 *  against her skin). Green pieces get a magenta body instead. */
const BLUE = { name: 'blue', rgb: [30, 70, 220], hue: 225 }, MAGENTA_BG = { name: 'magenta', rgb: [225, 40, 215], hue: 305 };
/** The body's key colour and the backdrop for a piece: green on blue; magenta for green pieces; a magenta backdrop for blue ones (denim,
 *  navy), which is far from both denim and her skin. */
export const keyFor = (piece) => {
  const words = `${(piece.colors || []).join(' ')} ${piece.name || ''} ${piece.detail || ''}`;
  const body = /green|olive|emerald|sage|mint|khaki|lime|teal/i.test(words) ? { name: 'magenta', rgb: [225, 40, 215], hues: [258, 352] }
    : { name: 'green', rgb: [40, 200, 70], hues: [54, 200], warm: /beige|taupe|oatmeal|camel|tan|cream|ivory|gold|butter|mustard|champagne|nude|straw/i.test(words) };
  return { ...body, bg: body.name === 'green' && /blue|navy|denim|wash|indigo|cobalt|chambray/i.test(words) ? MAGENTA_BG : BLUE }; // (a piece both green and blue keeps the blue backdrop)
};
export const BACKDROP = BLUE.rgb; // (the usual one)
/** Hue (0-360), saturation and value (0-1) of a pixel. */
export function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** Is this pixel the backdrop? (also its blur at a piece's edge) */
export const isBackdrop = (r, g, b, key) => { const [h, s, v] = hsv(r, g, b); return s > 0.3 && v > 0.08 && hueGap(h, key.bg.hue) < 32; };
/** Is this pixel the painted body or the backdrop (so not the piece)? FLUX often draws the painted green body dull olive (hue about
 *  57-70, faintly coloured), so the range runs from just above yellow (butter yellow and gold fabric stay below 54) to cyan; green
 *  pieces are drawn on magenta, so they never fall in it. */
export const isKeyed = (r, g, b, key) => {
  const [h, s, v] = hsv(r, g, b);
  if (isBackdrop(r, g, b, key)) return true;
  if (v <= 0.2) return false; // (very dark pixels are fabric: black has no hue to trust)
  if (h >= key.hues[0] && h <= key.hues[1] && s > 0.12 && (s >= 0.2 || v < 0.72 || h >= 70)) return true; // (bright, nearly white pixels with a green cast are cream fabric lit by the body)
  // FLUX sometimes draws the bare body dull khaki (hue 38-60, middling colour, darkish): beige, camel and gold fabric are warmer or brighter
  return key.name === 'green' && h >= (key.warm ? 42 : 36) && h < key.hues[0] && s >= 0.22 && s <= 0.6 && v < 0.74;
};

/** Where each kind of piece may be (in base.png pixels, from config.json's points): never her face, hair or hands. */
export function regionFor(type, pack) {
  const P = pack.points, top = P.nape[1] - 20, ankle = Math.min(P.ankleL[1], P.ankleR[1]);
  if (type === 'shoes') return { y0: ankle - 50, y1: pack.size[1] }; // (from just above the ankle: no socks or leggings)
  if (type === 'bottoms' || type === 'skirts') return { y0: Math.min(P.waistL[1], P.waistR[1]) - 40, y1: ankle + 110 };
  if (type === 'dresses' || type === 'outerwear') return { y0: top, y1: ankle + 110 };
  if (type === 'bodysuits') return { y0: top, y1: P.crotch[1] + 30 };
  return { y0: top, y1: P.crotch[1] + 160 }; // tops and tanks (a long shirt reaches the thighs)
}

/** base.png with her body (below the jaw) painted in the key colour, on the backdrop, small enough for Cloudflare: a PNG data URI. */
export async function modelInput(pack, key = keyFor({})) {
  const BG = key.bg.rgb;
  const img = new Image(); img.src = pack.files[pack.layers.body]; await img.decode();
  const c = document.createElement('canvas'); c.width = IN_W; c.height = IN_H; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, IN_W, IN_H);
  const id = g.getImageData(0, 0, IN_W, IN_H), d = id.data, from = Math.round(((pack.points.jawL[1] + pack.points.neck[1]) / 2 / pack.size[1]) * IN_H);
  for (let y = 0; y < IN_H; y++) for (let x = 0; x < IN_W; x++) {
    const o = (y * IN_W + x) * 4, a = d[o + 3] / 255;
    const lum = (0.3 * d[o] + 0.59 * d[o + 1] + 0.11 * d[o + 2]) / 150, paint = y >= from; // (her face and hair stay as they are)
    const src = paint ? key.rgb.map((v) => Math.min(255, v * (0.55 + 0.45 * lum))) : [d[o], d[o + 1], d[o + 2]];
    for (let k = 0; k < 3; k++) d[o + k] = Math.round(src[k] * a + BG[k] * (1 - a));
    d[o + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

/** Ask the server to draw the model wearing a piece: { blob (the picture it drew), info }. */
export async function drawWorn(piece, pass, pack, { onLimit } = {}) {
  const t0 = Date.now(), key = keyFor(piece), body = { wear: true, key: key.name, bg: key.bg.name, image: await modelInput(pack, key), ...(piece.id?.startsWith('starter-') ? { id: piece.id } : { piece: { name: piece.name, type: piece.type, colors: piece.colors, detail: piece.detail } }) };
  const r = await fetch('/api/starter', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': pass }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429 && j.limit) { onLimit?.(j); throw Object.assign(new Error('Today’s free Cloudflare allowance is used up.'), { limit: true, resetAt: j.resetAt, used: j.used }); }
  if (!r.ok || !j.image) throw Object.assign(new Error(j.error || `Drawing failed (${r.status})`), { info: { status: r.status } });
  const blob = await (await fetch(j.image)).blob();
  return { blob, info: { status: r.status, engine: 'cloudflare', bytes: blob.size, ms: Date.now() - t0, prompt: j.prompt || '', used: j.used, neurons: j.neurons } };
}

/* ── finding the piece in the picture Cloudflare drew ── */
/** The person in a picture on a plain backdrop: top row, bottom row and the head's centre column (null if there's no one). */
function figureOf(d, w, h, isBg) {
  let top = -1, bot = -1; const rows = new Int32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (!isBg(y * w + x)) n++; rows[y] = n; if (n >= Math.max(3, w * 0.01)) { if (top < 0) top = y; bot = y; } }
  if (top < 0 || bot - top < h * 0.4) return null;
  let sx = 0, n = 0; for (let y = top; y < top + (bot - top) * 0.08; y++) for (let x = 0; x < w; x++) if (!isBg(y * w + x)) { sx += x; n++; }
  return { top, bot, cx: n ? sx / n : w / 2 };
}

/**
 * The piece, cut out of the picture of the model wearing it. Resolves to { worn (a PNG the size of base.png), cutout (the piece cropped,
 * for the closet), color, colors, check: { ok, reasons } }.
 *  - lines the drawn picture up with base.png (from her head and her height; FLUX can shift or zoom her a little),
 *  - keeps what differs from base.png inside the piece's region (never her face, hair or hands),
 *  - tidies it: specks dropped, small holes filled, edges softened.
 */
export async function extractWorn(blob, piece, pack) {
  const type = piece.type, key = keyFor(piece);
  const { img, url } = await loadImage(blob); URL.revokeObjectURL(url);
  const [BW, BH] = pack.size, k = 2, w = Math.round(BW / k), h = Math.round(BH / k); // (worked out at half size, then drawn at full size)
  const bimg = new Image(); bimg.src = pack.files[pack.layers.body]; await bimg.decode();
  const ba = document.createElement('canvas'); ba.width = w; ba.height = h; const bag = ba.getContext('2d', { willReadFrequently: true }); bag.drawImage(bimg, 0, 0, w, h);
  const BA = bag.getImageData(0, 0, w, h).data; ba.width = 0;
  const baseFig = figureOf(BA, w, h, (i) => BA[i * 4 + 3] < 128);
  // the drawn picture: her figure is everything that isn't the blue backdrop
  const ow = img.naturalWidth, oh = img.naturalHeight, oc = document.createElement('canvas'); oc.width = ow; oc.height = oh;
  const og = oc.getContext('2d', { willReadFrequently: true }); og.drawImage(img, 0, 0); const O = og.getImageData(0, 0, ow, oh).data;
  const isBgPx = (i) => isBackdrop(O[i * 4], O[i * 4 + 1], O[i * 4 + 2], key);
  const oFig = figureOf(O, ow, oh, isBgPx), reasons = [];
  if (!oFig || !baseFig) { oc.width = 0; return { check: { ok: false, reasons: ['she isn’t in the picture it drew'] } }; }
  // line up: same head top and centre; same height unless the piece is shoes (soles change it), within reason of the expected zoom
  const expect = h / oh, measured = (baseFig.bot - baseFig.top) / Math.max(1, oFig.bot - oFig.top);
  const s = Math.abs(measured / expect - 1) < 0.12 ? measured : expect; // (shoes add a little height, well within this)
  const tx = baseFig.cx - oFig.cx * s, ty = baseFig.top - oFig.top * s;
  const al = document.createElement('canvas'); al.width = w; al.height = h; const ag = al.getContext('2d', { willReadFrequently: true });
  ag.fillStyle = `rgb(${key.bg.rgb})`; ag.fillRect(0, 0, w, h); ag.setTransform(s, 0, 0, s, tx, ty); ag.drawImage(oc, 0, 0); ag.setTransform(1, 0, 0, 1, 0, 0);
  const A = ag.getImageData(0, 0, w, h).data;
  // did she stay put? the lined-up figure should cover base.png's figure (a piece only adds to it)
  let both = 0, baseN = 0; for (let i = 0; i < w * h; i++) if (BA[i * 4 + 3] >= 128) { baseN++; if (!isBackdrop(A[i * 4], A[i * 4 + 1], A[i * 4 + 2], key)) both++; }
  if (baseN && both / baseN < 0.9) reasons.push('she moved or changed shape in the picture it drew (it couldn’t be lined up)');
  // the piece: inside its region, neither her painted body nor the backdrop
  const R = regionFor(type, pack), y0 = Math.max(0, Math.floor(R.y0 / k)), y1 = Math.min(h, Math.ceil(R.y1 / k)), m = new Uint8Array(w * h);
  // sometimes FLUX draws bits of her in her own skin instead of the key colour: where the piece isn't skin-coloured itself, a pixel that
  // matches base.png's own skin there is her, not the piece
  const skinish = /nude|camel|tan|beige|brown|cognac|taupe|chocolate|caramel|oatmeal|champagne|blush|peach/i.test(`${(piece.colors || []).join(' ')} ${piece.name || ''}`);
  const NB = skinish ? null : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g2 = c.getContext('2d', { willReadFrequently: true }); g2.drawImage(bimg, 0, 0, w, h); const d = g2.getImageData(0, 0, w, h).data; c.width = 0; return d; })();
  const raw = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4; if (isKeyed(A[o], A[o + 1], A[o + 2], key)) continue;
    if (NB && NB[o + 3] > 200 && Math.abs(A[o] - NB[o]) + Math.abs(A[o + 1] - NB[o + 1]) + Math.abs(A[o + 2] - NB[o + 2]) < 60) continue;
    raw[i] = 1;
  }
  { // majority vote over a 5 x 5 neighbourhood: speckles of skin among fabric (and of fabric among skin) go with what's around them
    const I = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += raw[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const r = 2, sum = (xa, ya, xb, yb) => I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) { const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1), ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1); m[y * w + x] = sum(xa, ya, xb, yb) * 2 > (xb - xa) * (yb - ya) ? 1 : 0; }
  }
  // tidy: keep the big connected parts, fill small holes, soften the edge
  const lab = new Int32Array(w * h), q = new Int32Array(w * h), comps = [];
  for (let i = 0; i < w * h; i++) { if (!m[i] || lab[i]) continue; const id = comps.length + 1; let hd = 0, tl = 0; q[tl++] = i; lab[i] = id;
    while (hd < tl) { const p = q[hd++], x = p % w; for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (j >= 0 && j < w * h && m[j] && !lab[j]) { lab[j] = id; q[tl++] = j; } }
    comps.push(tl); }
  const biggest = Math.max(0, ...comps), keepId = new Set(comps.map((n, c) => (n >= Math.max(40, biggest * (type === 'shoes' ? 0.25 : 0.12)) ? c + 1 : 0)).filter(Boolean)); // (marks drawn on her skin go; a shoe's pair stays)
  for (let i = 0; i < w * h; i++) m[i] = keepId.has(lab[i]) ? 1 : 0;
  if (type === 'tops' || type === 'tanks') { // shorts or trousers it added: below the crotch, two separate legs with nothing between them
    const P = pack.points, cx = Math.round(P.crotch[0] / k), from = Math.round(P.crotch[1] / k) + 6;
    for (let y = from; y < y1; y++) { let mid = 0, L = 0, Rr = 0; for (let x = cx - 6; x <= cx + 6; x++) mid += m[y * w + x]; for (let x = cx - 60; x < cx - 14; x++) L += m[y * w + x]; for (let x = cx + 14; x < cx + 60; x++) Rr += m[y * w + x];
      if (!mid && L > 10 && Rr > 10) { for (let yy = y; yy < y1; yy++) for (let x = 0; x < w; x++) m[yy * w + x] = 0; break; } }
  }
  const out = new Uint8Array(w * h); out.set(m); // holes: specks of key colour the piece closes around (a gap between arm and body is bigger, and stays)
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { if (m[i] || seen[i]) continue; let hd = 0, tl = 0, open = false; q[tl++] = i; seen[i] = 1;
    while (hd < tl) { const p = q[hd++], x = p % w, y = (p / w) | 0; if (x === 0 || x === w - 1 || y <= y0 || y >= y1 - 1) open = true;
      for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (j >= 0 && j < w * h && !m[j] && !seen[j]) { seen[j] = 1; q[tl++] = j; } }
    if (!open && tl < w * h * 0.0006) for (let t = 0; t < tl; t++) out[q[t]] = 1; }
  if (type === 'tops' || type === 'tanks') { // shorts or trousers it added that don't split into two legs (bike shorts): both thighs covered below the crotch
    const P = pack.points, cy = Math.round(P.crotch[1] / k), lx = [Math.round(P.kneeL[0] / k) - 30, Math.round(P.crotch[0] / k) - 4], rx = [Math.round(P.crotch[0] / k) + 4, Math.round(P.kneeR[0] / k) + 30];
    let L = 0, Rr = 0, nL = 0, nR = 0; // (FLUX's shorts end just below the crotch, so look right there)
    for (let y = cy + 3; y < Math.min(y1, cy + 14); y++) { for (let x = lx[0]; x < lx[1]; x++) { nL++; L += out[y * w + x]; } for (let x = rx[0]; x < rx[1]; x++) { nR++; Rr += out[y * w + x]; } }
    if (nL && L / nL > 0.5 && Rr / nR > 0.5 && !/tunic|longline|shirt dress|oversized|button-down|(?<!t-)shirt\b/i.test(`${piece.name} ${piece.detail || ''}`)) reasons.push('it added shorts or trousers to the top');
  }
  let area = 0; for (let i = 0; i < w * h; i++) area += out[i];
  const frac = area / (w * h), [lo, hi] = type === 'shoes' ? [0.004, 0.06] : type === 'dresses' || type === 'outerwear' ? [0.05, 0.5] : [0.02, 0.4];
  if (frac < lo) reasons.push('the piece barely shows (it may not have dressed her)');
  if (frac > hi) reasons.push('too much of the picture changed (not just the piece)');
  // the worn picture: the drawn pixels, lined up at full size, where the mask is (softened), with the key colour's spill taken off the edges
  const mc = document.createElement('canvas'); mc.width = w; mc.height = h; const mg = mc.getContext('2d'), md = mg.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (out[i]) md.data[i * 4 + 3] = 255;
  mg.putImageData(md, 0, 0);
  const full = document.createElement('canvas'); full.width = BW; full.height = BH; const fg = full.getContext('2d', { willReadFrequently: true });
  fg.setTransform(s * k, 0, 0, s * k, tx * k, ty * k); fg.drawImage(oc, 0, 0); fg.setTransform(1, 0, 0, 1, 0, 0);
  fg.globalCompositeOperation = 'destination-in'; fg.filter = 'blur(1px)'; fg.drawImage(mc, 0, 0, BW, BH); fg.filter = 'none'; fg.globalCompositeOperation = 'source-over';
  const fd = fg.getImageData(0, 0, BW, BH), F = fd.data;
  for (let i = 0; i < BW * BH; i++) { const o = i * 4; if (!F[o + 3]) continue;
    if (key.name === 'green') { const lim = Math.max(F[o], F[o + 2]); if (F[o + 1] > lim) F[o + 1] = lim; } // (green or magenta light from the painted body, off the edges)
    else { const lim = F[o + 1] + 12; if (F[o] > lim && F[o + 2] > lim) { const t = Math.min(F[o], F[o + 2]) - lim; F[o] -= t; F[o + 2] -= t; } } }
  fg.putImageData(fd, 0, 0);
  oc.width = al.width = mc.width = 0;
  // the closet picture: the piece cropped
  let x0 = w, yy0 = h, x1 = -1, yy1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < yy0) yy0 = y; if (y > yy1) yy1 = y; }
  if (x1 < 0) { full.width = 0; return { check: { ok: false, reasons: reasons.length ? reasons : ['the piece barely shows'] } }; }
  const pad = 6, cx0 = Math.max(0, x0 * k - pad), cy0 = Math.max(0, yy0 * k - pad), cw = Math.min(BW, x1 * k + k + pad) - cx0, ch = Math.min(BH, yy1 * k + k + pad) - cy0;
  const crop = document.createElement('canvas'); crop.width = cw; crop.height = ch; crop.getContext('2d').drawImage(full, cx0, cy0, cw, ch, 0, 0, cw, ch);
  const worn = await canvasToBlob(full, 'image/png'), cutout = (await canvasToBlob(crop, 'image/webp', 0.92)) || (await canvasToBlob(crop, 'image/png'));
  if (!worn?.size || !cutout?.size) throw new Error('The picture couldn’t be saved (the phone may be low on memory). Tap to try again.');
  const pal = palette(crop).filter((c) => c.share > 0.04), main = pal[0]?.hex || '#cccccc';
  full.width = 0;
  return { worn, cutout, canvas: crop, color: { hex: main, name: colorName(main) }, colors: pal.map((c) => c.hex), box: { x: cx0, y: cy0, w: cw, h: ch }, check: { ok: !reasons.length, reasons } };
}
