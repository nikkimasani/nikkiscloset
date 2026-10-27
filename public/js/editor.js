// The cut-out editor, one step per screen: crop (screenshots are trimmed for you) + straighten + white balance, tap to select (➕ keep / ➖ remove,
// pinch to zoom), an optional brush touch-up, then the garment's landmarks (draggable) with a live preview on the model.
import { solve, warpMesh } from './warp.js';
import { loadPicture, selectByTaps, closeEngine, samProblem } from './segment.js';
import { upsampleMask, cutoutFrom, cleanMask, stackedPieces } from './cutmask.js';
import { trimTransparent } from './cutout.js';
import { suggestFor, namesFor, groupOf, sleevesFromName } from './landmarks.js';
import { loadPack } from './doll.js';
import { bodyOf } from './fitting.js';
import { fitGarment, isStrapless } from './garment.js';
import { TYPES } from './data.js';

export const MODES = {
  flat: { icon: '🛏️', label: 'Flat lay', rec: true, tip: ['Lay it flat on a plain, contrasting surface (a white sheet under dark clothes, a dark one under light clothes).', 'Daylight from a window, no flash.', 'Shoot straight down, with the whole piece in frame.', 'Spread the sleeves and smooth the hem.'] },
  hanger: { icon: '🪝', label: 'Hanger', tip: ['Hang it on a plain wall or door, away from clutter.', 'Daylight, no flash; stand straight in front of it.', 'Get the whole piece in frame, hanger included.', 'Tap the hanger as “not garment”. Drooping sleeves and sloping shoulders are straightened when it’s fitted.'] },
  worn: { icon: '🪞', label: 'Worn / mirror photo', tip: ['Stand against a plain wall in daylight, facing the camera straight on.', 'Arms slightly away from your sides so the sleeves show.', 'Tap the clothes as the garment, and your arms, hands, face and phone as “not garment” (or erase them with the brush).', 'Only the front view is used.'] },
};
const MAX = 1100;
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ── straighten (perspective) and white balance ── */
/** 3x3 homography taking quad q (4 points) to the rectangle (0,0)-(w,h). */
export function homography(q, w, h) {
  const dst = [[0, 0], [w, 0], [w, h], [0, h]], A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = q[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const s = solve(A, b);
  return (x, y) => { const d = s[6] * x + s[7] * y + 1; return [(s[0] * x + s[1] * y + s[2]) / d, (s[3] * x + s[4] * y + s[5]) / d]; };
}
/** The photo straightened to the quad (a plain crop when it's a rectangle). */
export function straighten(src, q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = (d(q[0], q[1]) + d(q[3], q[2])) / 2, h = (d(q[0], q[3]) + d(q[1], q[2])) / 2; const k = Math.min(1, MAX / Math.max(w, h)); w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k));
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const axis = Math.abs(q[0][1] - q[1][1]) < 1 && Math.abs(q[3][1] - q[2][1]) < 1 && Math.abs(q[0][0] - q[3][0]) < 1 && Math.abs(q[1][0] - q[2][0]) < 1;
  if (axis) { out.getContext('2d').drawImage(src, q[0][0], q[0][1], q[1][0] - q[0][0], q[3][1] - q[0][1], 0, 0, w, h); return out; }
  const f = homography(q, w, h), warped = warpMesh(src, f, w, h, { cols: 36, rows: 36 }); return warped;
}
/** Even out the light: the picture's edge (the surface it lay on) is made neutral, never brightened past white. */
export function whiteBalance(c) {
  const g = c.getContext('2d', { willReadFrequently: true }), { width: w, height: h } = c, im = g.getImageData(0, 0, w, h), d = im.data, edge = [[], [], []];
  const pick = (x, y) => { const o = (y * w + x) * 4; edge[0].push(d[o]); edge[1].push(d[o + 1]); edge[2].push(d[o + 2]); };
  const m = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  for (let x = 0; x < w; x += 3) { pick(x, m); pick(x, h - 1 - m); } for (let y = 0; y < h; y += 3) { pick(m, y); pick(w - 1 - m, y); }
  const med = edge.map((a) => a.sort((p, q) => p - q)[a.length >> 1]), lum = (med[0] + med[1] + med[2]) / 3;
  const gain = med.map((v) => Math.max(0.78, Math.min(1.3, lum / Math.max(20, v))));
  if (gain.every((v) => Math.abs(v - 1) < 0.02)) return c;
  for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * gain[0]); d[i + 1] = Math.min(255, d[i + 1] * gain[1]); d[i + 2] = Math.min(255, d[i + 2] * gain[2]); }
  g.putImageData(im, 0, 0); return c;
}
/** Pixels -> { bg colour, mask of pixels that differ from it }. bg is the colour most of the picture's border has. */
function fgOf(im) {
  const { data: d, width: w, height: h } = im, bg = [0, 1, 2].map((i) => { const a = []; for (let x = 0; x < w; x += 5) { a.push(d[x * 4 + i], d[((h - 1) * w + x) * 4 + i]); } for (let y = 0; y < h; y += 5) a.push(d[(y * w) * 4 + i], d[(y * w + w - 1) * 4 + i]); a.sort((p, q) => p - q); return a[a.length >> 1]; });
  const fg = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) fg[i] = Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) > 40 ? 1 : 0;
  return { bg, fg };
}
/**
 * A first guess at the crop. A phone screenshot (phone-shaped, a status bar at the top, the app's chrome around the photo) is cut down to its product photo: the tallest band of rows
 * with something in it, which leaves out the status bar, the app's buttons and the text under the photo. Anything else keeps the whole picture.
 * im: ImageData-like { data, width, height }. Returns four corners [[x, y] x4] (clockwise from top left).
 */
export function productBox(im) {
  const { width: w, height: h } = im, whole = [[0, 0], [w, 0], [w, h], [0, h]], { fg } = fgOf(im);
  const busy = new Array(h); for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += fg[y * w + x]; busy[y] = n / w > 0.02; }
  const gap = Math.max(3, Math.round(h * 0.005)), blocks = []; let s = -1, last = -1;
  for (let y = 0; y <= h; y++) { if (y < h && busy[y]) { if (s < 0) s = y; else if (y - last > gap) { blocks.push([s, last + 1]); s = y; } last = y; } }
  if (s >= 0) blocks.push([s, last + 1]);
  // only a phone screenshot gets this treatment: phone-shaped, with a thin status bar at the very top
  const shot = h / w > 1.85 && h / w < 2.4 && blocks.length >= 3 && blocks[0][0] < h * 0.06 && blocks[0][1] - blocks[0][0] < h * 0.04;
  if (!shot) return whole;
  const big = blocks.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  if (!big || big[1] - big[0] > h * 0.85 || big[1] - big[0] < h * 0.15) return whole; // a plain photo (or nothing found): keep it all
  let x0 = w, x1 = -1; for (let y = big[0]; y < big[1]; y++) for (let x = 0; x < w; x++) if (fg[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  if (x1 < x0 || x1 - x0 < w * 0.3) { x0 = 0; x1 = w - 1; }
  return [[x0, big[0]], [x1 + 1, big[0]], [x1 + 1, big[1]], [x0, big[1]]];
}
export function suggestQuad(c) { return productBox(c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)); }
/**
 * Spots to leave out, guessed: a dress form shows as a narrow stem in the middle above the garment (its neck) or below it (its pole).
 * Returns up to two [u, v] points (fractions of the picture).
 */
export function formDots(im) {
  const { width: w, height: h } = im, { fg } = fgOf(im), out = [];
  const runAt = (y) => { const rs = []; let s = -1; for (let x = 0; x <= w; x++) { const on = x < w && fg[y * w + x]; if (on && s < 0) s = x; if (!on && s >= 0) { if (x - s > 2) rs.push([s, x]); s = -1; } } return rs; };
  const stem = (ys) => { // a narrow run near the middle on most of these rows
    let hit = 0, sx = 0, sy = 0;
    for (const y of ys) { const rs = runAt(y), r = rs.find((q) => q[1] - q[0] < w * 0.22 && Math.abs((q[0] + q[1]) / 2 - w / 2) < w * 0.15); if (r && rs.length <= 2) { hit++; sx += (r[0] + r[1]) / 2; sy += y; } }
    return hit >= ys.length * 0.6 ? [sx / hit / w, sy / hit / h] : null;
  };
  const rows = (a, b) => { const r = []; for (let y = Math.round(h * a); y < Math.round(h * b); y += Math.max(1, Math.round(h * 0.01))) r.push(y); return r; };
  let top = -1; for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += fg[y * w + x]; if (n > 3) { top = y; break; } }
  if (top >= 0) { const t = top / h, p = stem(rows(t + 0.005, t + 0.06)); if (p) out.push(p); }
  let bot = -1; for (let y = h - 1; y >= 0; y--) { let n = 0; for (let x = 0; x < w; x++) n += fg[y * w + x]; if (n > 3) { bot = y; break; } }
  if (bot >= 0) { const b = bot / h, p = stem(rows(b - 0.06, b - 0.005)); if (p) out.push(p); }
  return out;
}

/**
 * A pinch-to-zoom viewport around a canvas. One finger: onTap(u, v) for a short tap, onDrag(u, v, first) while dragging (if given).
 * Two fingers: zoom (up to 4x) and pan. Returns { reset }.
 */
function zoomable(wrap, cv, { onTap, onDrag }) {
  let k = 1, tx = 0, ty = 0; const pts = new Map(); let g = null, tap = null;
  const apply = () => { cv.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`; };
  const clamp = () => { const mx = (k - 1) * cv.offsetWidth / 2, my = (k - 1) * cv.offsetHeight / 2; tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty)); }; // (scaled about its centre)
  const uv = (e) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  wrap.onpointerdown = (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); wrap.setPointerCapture(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; g = { d: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, k, tx, ty }; tap = null; }
    else if (pts.size === 1) { tap = { x: e.clientX, y: e.clientY, moved: false }; if (onDrag) onDrag(...uv(e), true); }
  };
  wrap.onpointermove = (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && g) { const [a, b] = [...pts.values()]; k = Math.max(1, Math.min(4, g.k * Math.hypot(b.x - a.x, b.y - a.y) / g.d)); tx = g.tx + (a.x + b.x) / 2 - g.cx; ty = g.ty + (a.y + b.y) / 2 - g.cy; clamp(); apply(); return; }
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
    if (tap && onDrag) onDrag(...uv(e), false);
  };
  const up = (e) => { const was = pts.size; pts.delete(e.pointerId); if (was === 1 && tap && !tap.moved && onTap) onTap(...uv(e)); if (!pts.size) { g = null; tap = null; } };
  wrap.onpointerup = up; wrap.onpointercancel = (e) => { pts.delete(e.pointerId); tap = null; g = null; };
  return { reset: () => { k = 1; tx = ty = 0; apply(); } };
}

/** Fit a canvas into the space left on screen (whole picture visible). */
const fitCanvas = (cv, srcW, srcH, maxW, maxH) => { const k = Math.min(maxW / srcW, maxH / srcH); cv.style.width = `${Math.floor(srcW * k)}px`; cv.style.height = `${Math.floor(srcH * k)}px`; };

/**
 * @param {{blob?:Blob, cutout?:Blob, name?:string, type:string, sleeves?:boolean, marks?:object, capture?:string, start?:'crop'|'marks'}} o
 * @returns {Promise<null|{cutout:Blob, marks:object|null, sleeves:boolean, type:string, capture:string, original:Blob|null, engine:string}>}
 */
export function openCutEditor(o) {
  return new Promise((resolve) => {
    const S = { step: o.start || 'crop', mode: o.capture || 'flat', type: o.type || 'tops', sleeves: o.sleeves, marks: o.marks || null, photo: null, quad: null, prepped: null, pos: [], neg: [], auto: 0, tool: 'pos', brushTool: 'erase', brush: 24, alpha: null, edits: null, cutCanvas: null, busy: '', engine: '' };
    const root = el('<div class="cuted" role="dialog" aria-modal="true" aria-labelledby="cuttitle"></div>');
    document.body.append(root); document.querySelectorAll('header, main, #modal').forEach((e) => (e.inert = true));
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const finish = (r) => { closeEngine(); root.remove(); document.querySelectorAll('header, main, #modal').forEach((e) => (e.inert = false)); document.querySelectorAll('header, main').forEach((e) => (e.inert = !document.querySelector('#modal')?.hidden)); document.body.style.overflow = prevOverflow; resolve(r); };
    const STEPS = ['crop', 'select', 'touch', 'marks'], NAMES = ['Crop', 'Select', 'Touch up', 'Fit'];
    const head = (title) => { const i = STEPS.indexOf(S.step), back = S.step === 'crop' || (S.step === 'marks' && o.start === 'marks'); return `<div class="cuthead"><button type="button" class="ghost cutback" id="cutback">${back ? '✕ Close' : '← Back'}</button><h2 id="cuttitle" tabindex="-1">${title}</h2></div>
      ${o.start === 'marks' ? '' : `<ol class="cutsteps" aria-label="Step ${i + 1} of 4">${NAMES.map((t, j) => `<li class="${j === i ? 'on' : j < i ? 'done' : ''}"${j === i ? ' aria-current="step"' : ''}>${t}</li>`).join('')}</ol>`}`; };
    const goto = (step) => { S.step = step; draw(); };
    const space = () => { const r = root.querySelector('.cutstage')?.getBoundingClientRect(); return [Math.max(120, (r?.width || innerWidth) - 4), Math.max(160, (r?.height || innerHeight * 0.55) - 4)]; };
    const saveOut = async () => {
      const cut = S.cutCanvas, blob = await new Promise((r) => cut.toBlob(r, 'image/webp', 0.92)).then((b) => (b?.type === 'image/webp' ? b : new Promise((r) => cut.toBlob(r, 'image/png'))));
      const orig = S.prepped ? await new Promise((r) => S.prepped.toBlob(r, 'image/webp', 0.8)) : null;
      finish({ cutout: blob, marks: groupOf(S.type) ? S.marks : null, sleeves: !!S.sleeves, type: S.type, capture: S.mode, original: orig, engine: S.engine, recut: o.start !== 'marks' });
    };

    /* ── 1. crop (and straighten, white balance) ── */
    const drawCrop = () => {
      root.innerHTML = `${head('Crop to the piece')}
        <div class="cutbody"><p class="muted cuthint">${S.auto ? 'Screenshot found: the app’s bars and text are cropped off. ' : ''}Drag the corners to the edges of the piece. If it was photographed at an angle, put the corners on its corners and it’s straightened.</p>
        <div class="cutstage"><canvas id="cvs" aria-label="Photo with four corner handles"></canvas></div>
        <div class="cutrow"><button type="button" class="ghost" id="autoq">Auto crop</button><button type="button" class="ghost" id="fullq">Whole photo</button></div>
        <label class="chk"><input type="checkbox" id="wb" ${S.wb === false ? '' : 'checked'}> Fix the colour cast (white balance)</label></div>
        <div class="cutfoot"><button type="button" class="primary" id="cutnext">Next: select the piece</button></div>`;
      const cv = root.querySelector('#cvs'), g = cv.getContext('2d'), P = S.photo, k = Math.min(1, 900 / Math.max(P.width, P.height));
      cv.width = Math.round(P.width * k); cv.height = Math.round(P.height * k); fitCanvas(cv, cv.width, cv.height, ...space());
      const paint = () => {
        g.clearRect(0, 0, cv.width, cv.height); g.drawImage(P, 0, 0, cv.width, cv.height);
        const q = S.quad.map(([x, y]) => [x * k, y * k]), sc = cv.width / cv.getBoundingClientRect().width;
        g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.moveTo(...q[0]); for (const i of [3, 2, 1]) g.lineTo(...q[i]); g.closePath(); g.fill('evenodd');
        g.strokeStyle = '#f7c8d8'; g.lineWidth = 3 * sc; g.beginPath(); g.moveTo(...q[0]); q.slice(1).forEach((p) => g.lineTo(...p)); g.closePath(); g.stroke();
        q.forEach(([x, y]) => { g.fillStyle = '#fff'; g.strokeStyle = '#b5517a'; g.lineWidth = 3 * sc; g.beginPath(); g.arc(x, y, 13 * sc, 0, 7); g.fill(); g.stroke(); });
      };
      let drag = -1;
      const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * P.width, (e.clientY - r.top) / r.height * P.height, P.width / r.width]; };
      cv.onpointerdown = (e) => { const [x, y, s] = at(e); let b = 0, bd = 1e9; S.quad.forEach(([qx, qy], i) => { const d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; b = i; } }); if (bd < 44 * s) { drag = b; cv.setPointerCapture(e.pointerId); } };
      cv.onpointermove = (e) => { if (drag < 0) return; const [x, y] = at(e); S.quad[drag] = [Math.max(0, Math.min(P.width, x)), Math.max(0, Math.min(P.height, y))]; paint(); };
      cv.onpointerup = cv.onpointercancel = () => { drag = -1; };
      root.querySelector('#autoq').onclick = () => { S.quad = suggestQuad(P); paint(); };
      root.querySelector('#fullq').onclick = () => { S.quad = [[0, 0], [P.width, 0], [P.width, P.height], [0, P.height]]; paint(); };
      root.querySelector('#wb').onchange = (e) => (S.wb = e.target.checked);
      root.querySelector('#cutnext').onclick = () => {
        let c = straighten(P, S.quad); if (S.wb !== false) c = whiteBalance(c);
        S.prepped = c; S.pos = []; S.neg = formDots(c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)); S.auto = S.neg.length;
        S.alpha = null; S.edits = new Int8Array(c.width * c.height); S.picReady = null; S.tool = 'pos'; goto('select');
      };
      paint();
    };

    /* the cropped photo with the selection shown (shared by Select and Touch up) */
    const finalAlpha = () => { const C = S.prepped, a = S.alpha ? new Uint8ClampedArray(S.alpha) : new Uint8ClampedArray(C.width * C.height); for (let i = 0; i < a.length; i++) if (S.edits[i]) a[i] = S.edits[i] > 0 ? 255 : 0; return a; };
    const paintSel = (cv, dots) => {
      const C = S.prepped, g = cv.getContext('2d'), W = C.width, H = C.height, k = cv.width / W, sc = cv.width / cv.getBoundingClientRect().width;
      g.clearRect(0, 0, cv.width, cv.height); g.drawImage(C, 0, 0, cv.width, cv.height);
      if (S.alpha || S.edits.some((v) => v)) {
        const a = finalAlpha(), ov = g.getImageData(0, 0, cv.width, cv.height), d = ov.data;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const out = 1 - a[Math.min(H - 1, Math.floor(y / k)) * W + Math.min(W - 1, Math.floor(x / k))] / 255, o = (y * cv.width + x) * 4; d[o] += (40 - d[o]) * out * 0.7; d[o + 1] += (20 - d[o + 1]) * out * 0.7; d[o + 2] += (40 - d[o + 2]) * out * 0.7; }
        g.putImageData(ov, 0, 0);
      }
      if (dots) {
        const dot = (u, v, col, sign) => { const x = u * cv.width, y = v * cv.height, r = 12 * sc; g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 3 * sc; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(x - r * 0.5, y); g.lineTo(x + r * 0.5, y); if (sign) { g.moveTo(x, y - r * 0.5); g.lineTo(x, y + r * 0.5); } g.stroke(); };
        for (const [u, v] of S.pos) dot(u, v, '#16a34a', true); for (const [u, v] of S.neg) dot(u, v, '#dc2626', false);
      }
    };

    /* ── 2. select: ➕ keep / ➖ remove ── */
    const drawSelect = () => {
      const C = S.prepped, hint = S.mode === 'worn' ? 'Tap ➕ on the clothes. Then ➖ on your arms, hands, face and phone.' : S.mode === 'hanger' ? 'Tap ➕ on the garment 3–5 times, then ➖ on the hanger and the wall.' : 'Tap ➕ on the garment 3–5 times, then ➖ on anything that must go.';
      root.innerHTML = `${head('Select the piece')}
        <div class="cutbody"><p class="muted cuthint">${hint}${S.auto ? ` <b>${S.auto === 1 ? 'A red dot was' : 'Red dots were'} placed on the dress form.</b>` : ''} Pinch to zoom.</p>
        <div class="seg2" role="radiogroup" aria-label="What a tap does"><button type="button" role="radio" class="keep ${S.tool === 'pos' ? 'on' : ''}" aria-checked="${S.tool === 'pos'}" data-tool="pos">➕ Keep</button><button type="button" role="radio" class="rem ${S.tool === 'neg' ? 'on' : ''}" aria-checked="${S.tool === 'neg'}" data-tool="neg">➖ Remove</button></div>
        <div class="cutstage zoomwrap"><canvas id="cvs" aria-label="Your photo. Tap to add a dot."></canvas></div>
        <div class="cutrow"><button type="button" class="ghost" id="undo">↶ Undo</button><button type="button" class="ghost" id="clear">Clear</button></div>
        <p class="muted cutstatus" id="selmsg" role="status" aria-live="polite">${esc(S.busy)}</p></div>
        <div class="cutfoot"><button type="button" class="primary" id="cutnext">Next: touch up</button></div>`;
      const cv = root.querySelector('#cvs'), W = C.width, H = C.height, k = Math.min(1, 900 / Math.max(W, H));
      cv.width = Math.round(W * k); cv.height = Math.round(H * k); fitCanvas(cv, cv.width, cv.height, ...space());
      const msg = (m) => { S.busy = m; const e = root.querySelector('#selmsg'); if (e) e.textContent = m; };
      const paint = () => paintSel(cv, true);
      let timer = 0, token = 0;
      const run = async () => {
        if (!S.pos.length) { S.alpha = null; paint(); return msg(S.neg.length ? 'Now tap ➕ on the garment.' : ''); }
        const my = ++token; msg('Finding the outline…');
        try {
          if (!S.picReady) S.picReady = loadPicture(await new Promise((r) => C.toBlob(r, 'image/png'))); await S.picReady;
          const m = await selectByTaps({ pos: S.pos, neg: S.neg, rect: [0, 0, 1, 1] }); if (my !== token || !m) return;
          S.alpha = upsampleMask(cleanMask(m, S.pos), W, H); S.engine = m.engine;
          const p = samProblem(); msg(m.engine === 'sam2' ? 'Selected with SAM 2.' : `Selected on this device${p ? ` (SAM 2 unavailable: ${p})` : ''}.`); paint();
        } catch (err) { if (my === token) { S.picReady = null; msg(err.message || 'Could not select that.'); } }
      };
      const queue = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
      zoomable(root.querySelector('.zoomwrap'), cv, { onTap: (u, v) => { (S.tool === 'pos' ? S.pos : S.neg).push([u, v]); S.history = [...(S.history || []), S.tool]; paint(); queue(); } });
      root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { S.tool = b.dataset.tool; root.querySelectorAll('[data-tool]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); }));
      root.querySelector('#undo').onclick = () => { const t = (S.history || []).pop(); const list = t === 'neg' ? S.neg : t === 'pos' ? S.pos : S.neg.length ? S.neg : S.pos; list.pop(); paint(); queue(); };
      root.querySelector('#clear').onclick = () => { S.pos = []; S.neg = []; S.history = []; S.alpha = null; S.edits.fill(0); msg(''); paint(); };
      root.querySelector('#cutnext').onclick = () => { if (!S.alpha) return msg('Tap ➕ on the garment first.'); goto('touch'); };
      paint(); if (S.pos.length && !S.alpha) queue();
    };

    /* ── 3. touch up (optional brush) ── */
    const drawTouch = () => {
      const C = S.prepped;
      root.innerHTML = `${head('Touch up')}
        <div class="cutbody"><p class="muted cuthint">Optional. Paint with 🧽 Erase over anything left over, or 🖌️ Restore over a bit of the piece that was missed. Pinch to zoom.</p>
        <div class="seg2" role="radiogroup" aria-label="Brush"><button type="button" role="radio" class="rem ${S.brushTool === 'erase' ? 'on' : ''}" aria-checked="${S.brushTool === 'erase'}" data-tool="erase">🧽 Erase</button><button type="button" role="radio" class="keep ${S.brushTool === 'restore' ? 'on' : ''}" aria-checked="${S.brushTool === 'restore'}" data-tool="restore">🖌️ Restore</button></div>
        <div class="cutstage zoomwrap"><canvas id="cvs" aria-label="The selection. Drag to paint."></canvas></div>
        <div class="cutrow"><label class="f" for="brush">Brush</label><input type="range" id="brush" min="8" max="70" value="${S.brush}"><button type="button" class="ghost" id="undoall">Undo brush</button></div></div>
        <div class="cutfoot"><button type="button" class="primary" id="cutnext">${groupOf(S.type) ? 'Next: fit it' : 'Save this piece'}</button></div>`;
      const cv = root.querySelector('#cvs'), W = C.width, H = C.height, k = Math.min(1, 900 / Math.max(W, H));
      cv.width = Math.round(W * k); cv.height = Math.round(H * k); fitCanvas(cv, cv.width, cv.height, ...space());
      let raf = 0; const paint = () => paintSel(cv, false), soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
      const brush = (u, v) => { const cx = u * W, cy = v * H, r = S.brush / 2 * (W / cv.getBoundingClientRect().width), val = S.brushTool === 'erase' ? -1 : 1; for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) S.edits[y * W + x] = val; soon(); };
      zoomable(root.querySelector('.zoomwrap'), cv, { onDrag: brush, onTap: brush });
      root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { S.brushTool = b.dataset.tool; root.querySelectorAll('[data-tool]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); }));
      root.querySelector('#brush').oninput = (e) => (S.brush = +e.target.value);
      root.querySelector('#undoall').onclick = () => { S.edits.fill(0); paint(); };
      root.querySelector('#cutnext').onclick = () => { S.cutCanvas = S.fullCut = cutoutFrom(C, finalAlpha()); S.marks = null; if (!groupOf(S.type)) return saveOut(); goto('marks'); };
      paint();
    };

    /* ── 4. fit: landmarks ── */
    const drawMarks = async () => {
      const ids = Object.keys(TYPES).filter((t) => groupOf(t));
      // a set photographed together (top + shorts): fit only the piece this item is; the other can be added as its own piece
      const stack = S.fullCut ? stackedPieces(S.fullCut) : null, half = stack && (groupOf(S.type) === 'bottom' ? 'lower' : groupOf(S.type) === 'top' ? 'upper' : null);
      if (half && !S.wholeSet) { const [y0, y1] = stack[half], c = document.createElement('canvas'); c.width = S.fullCut.width; c.height = y1 - y0; c.getContext('2d').drawImage(S.fullCut, 0, -y0); S.cutCanvas = trimTransparent(c, 2); }
      else S.cutCanvas = S.fullCut || S.cutCanvas;
      const cut = S.cutCanvas;
      if (!S.type || !groupOf(S.type)) S.type = 'tops';
      const sugg = () => { S.marks = suggestFor(S.type, cut, { sleeves: S.sleeves }); };
      if (!S.marks) { if (S.sleeves === undefined) S.sleeves = sleevesFromName(S.type, o.name) ?? (S.type === 'tops' || S.type === 'outerwear' || S.type === 'dresses'); sugg(); }
      const hasSleeves = S.type !== 'bottoms' && S.type !== 'skirts';
      root.innerHTML = `${head('Fit it to the model')}
        <div class="cutbody"><p class="muted cuthint">The pink dots are the piece’s landmarks (neckline, shoulders, hems…). Drag any that are off; the model updates.</p>
        <div class="cutrow"><select id="mtype" aria-label="What it is">${ids.map((t) => `<option value="${t}" ${t === S.type ? 'selected' : ''}>${esc(TYPES[t].label)}</option>`).join('')}</select>
        ${hasSleeves ? `<label class="chk"><input type="checkbox" id="slv" ${S.sleeves ? 'checked' : ''}> Sleeves</label>` : ''}<button type="button" class="ghost" id="resug">Re-guess</button></div>
        <div class="marksplit"><div class="cutstage"><canvas id="cvs" aria-label="The piece with its landmarks"></canvas></div><div class="cutstage"><canvas id="prev" aria-label="The piece on the model"></canvas></div></div>
        <p class="muted" id="fitmsg" role="status" aria-live="polite"></p>
        ${half ? `<p class="muted" role="status">This photo has two pieces; only the ${half === 'upper' ? 'top' : 'bottom'} one is used for ${esc(TYPES[S.type].label.toLowerCase())}. Add the other as its own piece. <button type="button" class="ghost" id="wholeset">${S.wholeSet ? 'Use one piece' : 'Use both'}</button></p>` : ''}
        ${S.mode === 'hanger' ? '<p class="muted">Hanger photo: sloping shoulders are levelled and drooping sleeves are laid along the arms.</p>' : ''}</div>
        <div class="cutfoot"><button type="button" class="primary" id="cutdone">Save this piece</button></div>`;
      root.querySelector('#cutdone').onclick = saveOut; // (ready straight away: the preview below loads in the background)
      const cv = root.querySelector('#cvs'), g = cv.getContext('2d'), k = Math.min(1, 600 / Math.max(cut.width, cut.height));
      cv.width = Math.round(cut.width * k); cv.height = Math.round(cut.height * k);
      const [sw, sh] = space(); fitCanvas(cv, cv.width, cv.height, sw, sh);
      const prev = root.querySelector('#prev'), pg = prev.getContext('2d');
      prev.width = 300; prev.height = Math.round(300 * 1776 / 896); fitCanvas(prev, prev.width, prev.height, sw, sh);
      let pack = null, body = null, baseImg = null; // loaded in the background; the controls work straight away
      const names = () => namesFor(S.type, S.marks);
      const paint = () => {
        const sc = cv.width / cv.getBoundingClientRect().width;
        g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#f3e6ea'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(cut, 0, 0, cv.width, cv.height);
        for (const n of names()) { const m = S.marks[n]; if (!m) continue; g.fillStyle = '#e0115f'; g.strokeStyle = '#fff'; g.lineWidth = 3 * sc; g.beginPath(); g.arc(m[0] * cv.width, m[1] * cv.height, 10 * sc, 0, 7); g.fill(); g.stroke(); }
      };
      let ftimer = 0, ftoken = 0;
      const refit = () => {
        clearTimeout(ftimer); ftimer = setTimeout(() => {
          if (!pack || !body || !baseImg) return; const my = ++ftoken, msg = root.querySelector('#fitmsg');
          try {
            const res = fitGarment(cut, S.type, S.marks, pack, body, { strapless: isStrapless(o.name), sleeveless: (S.sleeves ?? sleevesFromName(S.type, o.name)) === false }); if (my !== ftoken) return;
            pg.clearRect(0, 0, prev.width, prev.height); pg.fillStyle = '#f6e9ee'; pg.fillRect(0, 0, prev.width, prev.height); pg.drawImage(baseImg, 0, 0, prev.width, prev.height);
            if (res) { pg.drawImage(res.canvas, 0, 0, prev.width, prev.height); msg.textContent = ''; } else msg.textContent = 'Some landmarks are missing, so it can’t be fitted yet.';
          } catch { msg.textContent = 'Couldn’t fit it with these landmarks.'; }
        }, 120);
      };
      let drag = null;
      const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
      cv.onpointerdown = (e) => { const [u, v] = at(e), r = cv.getBoundingClientRect(); let b = null, bd = 1e9; for (const n of names()) { const m = S.marks[n]; if (!m) continue; const d = Math.hypot((m[0] - u) * r.width, (m[1] - v) * r.height); if (d < bd) { bd = d; b = n; } } if (b && bd < 30) { drag = b; cv.setPointerCapture(e.pointerId); } };
      cv.onpointermove = (e) => { if (!drag) return; const [u, v] = at(e); S.marks[drag] = [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))]; paint(); refit(); };
      cv.onpointerup = cv.onpointercancel = () => { drag = null; };
      root.querySelector('#mtype').onchange = (e) => { S.type = e.target.value; S.sleeves = S.type === 'tops' || S.type === 'outerwear' || S.type === 'dresses' ? S.sleeves ?? true : false; S.marks = null; drawMarks(); };
      const slv = root.querySelector('#slv'); if (slv) slv.onchange = () => { S.sleeves = slv.checked; sugg(); paint(); refit(); };
      root.querySelector('#resug').onclick = () => { sugg(); paint(); refit(); };
      const ws = root.querySelector('#wholeset'); if (ws) ws.onclick = () => { S.wholeSet = !S.wholeSet; S.marks = null; drawMarks(); };
      paint();
      const mine = S.step; pack = await loadPack(); body = pack && await bodyOf(pack).catch(() => null);
      if (pack) { const im = new Image(); im.src = pack.files[pack.layers.body]; await im.decode().catch(() => {}); baseImg = im; }
      if (S.step === mine && root.contains(prev)) refit();
    };

    const draw = () => {
      ({ crop: drawCrop, select: drawSelect, touch: drawTouch, marks: drawMarks })[S.step]();
      root.querySelector('#cutback').onclick = () => { const p = { select: 'crop', touch: 'select', marks: o.start === 'marks' ? null : 'touch' }[S.step]; if (!p) return finish(null); goto(p); };
      root.querySelector('#cuttitle')?.focus?.();
    };
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); });
    if (o.start === 'marks') { createImageBitmap(o.cutout).then((b) => { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; c.getContext('2d').drawImage(b, 0, 0); S.cutCanvas = c; draw(); }); return; }
    createImageBitmap(o.blob).then((b) => {
      const k = Math.min(1, 2000 / Math.max(b.width, b.height)), c = document.createElement('canvas'); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
      S.photo = c; S.quad = suggestQuad(c); S.auto = !(S.quad[0][0] === 0 && S.quad[0][1] === 0 && S.quad[2][0] === c.width && S.quad[2][1] === c.height); draw();
    }).catch(() => finish(null));
  });
}
