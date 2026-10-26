// The cut-out editor: how the photo was taken (with a short tip), straighten + white balance, tap-to-select with brush touch-ups,
// then the garment's landmarks (draggable) with a live preview on the model. Everything happens on the device.
import { solve, warpMesh } from './warp.js';
import { loadPicture, selectByTaps, closeEngine } from './segment.js';
import { upsampleMask, cutoutFrom } from './cutmask.js';
import { suggestFor, namesFor, LABELS, groupOf } from './landmarks.js';
import { loadPack } from './doll.js';
import { bodyOf } from './fitting.js';
import { fitGarment } from './garment.js';
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
/** A first guess at the product: the box around everything that differs from the picture's own edge colour (screenshots lose their app bars). */
export function suggestQuad(c) {
  const g = c.getContext('2d', { willReadFrequently: true }), { width: w, height: h } = c, d = g.getImageData(0, 0, w, h).data, bg = [0, 0, 0];
  for (let i = 0; i < 3; i++) { const a = []; for (let x = 0; x < w; x += 7) { a.push(d[(Math.round(h * 0.2) * w + x) * 4 + i]); } a.sort((p, q) => p - q); bg[i] = a[a.length >> 1]; }
  let x0 = w, x1 = 0, y0 = h, y1 = 0; const ya = Math.round(h * 0.1), yb = Math.round(h * 0.62);
  for (let y = ya; y < yb; y += 2) for (let x = Math.round(w * 0.04); x < w * 0.96; x += 2) { const o = (y * w + x) * 4; if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 <= x0 || y1 <= y0) return [[0, 0], [w, 0], [w, h], [0, h]];
  const pad = Math.round(Math.min(w, h) * 0.03); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * @param {{blob?:Blob, cutout?:Blob, type:string, sleeves?:boolean, marks?:object, capture?:string, start?:'mode'|'marks'}} o
 * @returns {Promise<null|{cutout:Blob, marks:object, sleeves:boolean, type:string, capture:string, original:Blob|null}>}
 */
export function openCutEditor(o) {
  return new Promise((resolve) => {
    const S = { step: o.start || 'mode', mode: o.capture || 'flat', type: o.type || 'tops', sleeves: o.sleeves, marks: o.marks || null, photo: null, quad: null, prepped: null, pos: [], neg: [], tool: 'pos', brush: 26, mask: null, alpha: null, edits: null, cutCanvas: null, busy: '', note: '' };
    const root = el('<div class="cuted" role="dialog" aria-modal="true" aria-label="Cut out a piece"></div>');
    document.body.append(root); document.querySelectorAll('header, main').forEach((e) => (e.inert = true));
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const finish = (r) => { closeEngine(); root.remove(); document.querySelectorAll('header, main').forEach((e) => (e.inert = false)); document.body.style.overflow = prevOverflow; resolve(r); };
    const header = (title, back) => `<div class="cuthead"><button type="button" class="ghost" id="cutback">${back || '✕ Close'}</button><h2 id="cuttitle">${title}</h2></div>`;
    const stepNav = (n) => `<ol class="cutsteps" aria-label="Steps">${['How', 'Crop', 'Select', 'Fit'].map((t, i) => `<li class="${i === n ? 'on' : i < n ? 'done' : ''}"${i === n ? ' aria-current="step"' : ''}>${t}</li>`).join('')}</ol>`;
    const saveOut = async () => {
      const cut = S.cutCanvas, blob = await new Promise((r) => cut.toBlob(r, 'image/webp', 0.92)).then((b) => (b?.type === 'image/webp' ? b : new Promise((r) => cut.toBlob(r, 'image/png'))));
      const orig = S.prepped ? await new Promise((r) => S.prepped.toBlob(r, 'image/webp', 0.8)) : null;
      finish({ cutout: blob, marks: groupOf(S.type) ? S.marks : null, sleeves: !!S.sleeves, type: S.type, capture: S.mode, original: orig, recut: o.start !== 'marks' });
    };
    const goto = (step) => { S.step = step; draw(); };

    /* ── step 1: how was it taken ── */
    const drawMode = () => {
      const m = MODES[S.mode];
      root.innerHTML = `${header('Add a piece')}${stepNav(0)}
        <div class="cutbody"><p class="muted">How did you take the photo?</p>
        <div class="modes" role="radiogroup" aria-label="Photo type">${Object.entries(MODES).map(([k, v]) => `<button type="button" role="radio" aria-checked="${S.mode === k}" class="modecard ${S.mode === k ? 'on' : ''}" data-mode="${k}"><span aria-hidden="true">${v.icon}</span><b>${v.label}</b>${v.rec ? '<small>Recommended</small>' : ''}</button>`).join('')}</div>
        <div class="tipbox"><h3>Photo tips: ${m.label.toLowerCase()}</h3><ul>${m.tip.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></div>
        <div class="cutfoot"><button type="button" class="primary" id="cutnext">Continue</button></div>`;
      root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; drawMode(); root.querySelector(`[data-mode="${S.mode}"]`).focus(); }));
      root.querySelector('#cutnext').onclick = () => goto('prep');
    };

    /* ── step 2: crop, straighten, white balance ── */
    const drawPrep = () => {
      root.innerHTML = `${header('Crop and straighten')}${stepNav(1)}
        <div class="cutbody"><p class="muted">Drag the four corners around the piece. If the photo was taken at an angle, line the corners up with the item’s edges and it will be straightened.</p>
        <div class="cutstage"><canvas id="cvs" aria-label="Photo with four corner handles"></canvas></div>
        <label class="chk"><input type="checkbox" id="wb" ${S.wb === false ? '' : 'checked'}> Fix the colour cast (auto white balance)</label>
        <div class="row"><button type="button" class="ghost" id="autoq">Find the product</button><button type="button" class="ghost" id="fullq">Whole picture</button></div></div>
        <div class="cutfoot"><button type="button" class="primary" id="cutnext">Continue</button></div>`;
      const cv = root.querySelector('#cvs'), g = cv.getContext('2d'), P = S.photo, k = Math.min(1, 360 / P.width, 520 / P.height);
      cv.width = Math.round(P.width * k); cv.height = Math.round(P.height * k);
      const paint = () => {
        g.clearRect(0, 0, cv.width, cv.height); g.drawImage(P, 0, 0, cv.width, cv.height);
        const q = S.quad.map(([x, y]) => [x * k, y * k]);
        g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.moveTo(...q[0]); for (const i of [3, 2, 1]) g.lineTo(...q[i]); g.closePath(); g.fill('evenodd');
        g.strokeStyle = '#5ad1ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(...q[0]); q.slice(1).forEach((p) => g.lineTo(...p)); g.closePath(); g.stroke();
        q.forEach(([x, y]) => { g.fillStyle = '#fff'; g.strokeStyle = '#0b2540'; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill(); g.stroke(); });
      };
      let drag = -1;
      const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * P.width, (e.clientY - r.top) / r.height * P.height]; };
      cv.onpointerdown = (e) => { const [x, y] = at(e); let b = 0, bd = 1e9; S.quad.forEach(([qx, qy], i) => { const d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; b = i; } }); if (bd < 60 / k) { drag = b; cv.setPointerCapture(e.pointerId); } };
      cv.onpointermove = (e) => { if (drag < 0) return; const [x, y] = at(e); S.quad[drag] = [Math.max(0, Math.min(P.width, x)), Math.max(0, Math.min(P.height, y))]; paint(); };
      cv.onpointerup = cv.onpointercancel = () => { drag = -1; };
      root.querySelector('#autoq').onclick = () => { S.quad = suggestQuad(P); paint(); };
      root.querySelector('#fullq').onclick = () => { S.quad = [[0, 0], [P.width, 0], [P.width, P.height], [0, P.height]]; paint(); };
      root.querySelector('#wb').onchange = (e) => (S.wb = e.target.checked);
      root.querySelector('#cutnext').onclick = async () => {
        let c = straighten(P, S.quad); if (S.wb !== false) c = whiteBalance(c);
        S.prepped = c; S.pos = []; S.neg = []; S.mask = null; S.alpha = null; S.edits = new Int8Array(c.width * c.height); S.picReady = null; goto('select');
      };
      paint();
    };

    /* ── step 3: tap to select, brush to touch up ── */
    const drawSelect = () => {
      const C = S.prepped, hint = S.mode === 'worn' ? 'Tap the clothes (➕), then your arms, hands, face and phone as “not garment” (➖). Erase what’s left with the brush.' : S.mode === 'hanger' ? 'Tap the garment (➕) 3–5 times, then the hanger and wall (➖).' : 'Tap the garment (➕) 3–5 times, then once or twice on anything that must go: the dress form, the surface under it (➖).';
      root.innerHTML = `${header('Select the piece')}${stepNav(2)}
        <div class="cutbody"><p class="muted" id="selhint">${hint}</p>
        <div class="tools" role="radiogroup" aria-label="Tool">${[['pos', '➕ Garment'], ['neg', '➖ Not garment'], ['erase', '🧽 Erase'], ['restore', '🖌️ Restore']].map(([k, t]) => `<button type="button" role="radio" aria-checked="${S.tool === k}" class="tool ${S.tool === k ? 'on' : ''}" data-tool="${k}">${t}</button>`).join('')}</div>
        <div class="cutstage"><canvas id="cvs" aria-label="Photo with the selection shown"></canvas></div>
        <label class="f" for="brush">Brush size</label><input type="range" id="brush" min="6" max="80" value="${S.brush}">
        <div class="row"><button type="button" class="ghost" id="undo">Undo last tap</button><button type="button" class="ghost" id="reset">Start over</button><button type="button" class="ghost" id="showorig">Hold to see original</button></div>
        <p class="muted" id="selmsg" role="status" aria-live="polite">${esc(S.busy || S.note)}</p></div>
        <div class="cutfoot"><button type="button" class="primary" id="cutnext">${groupOf(S.type) ? 'Next: fit it' : 'Save this piece'}</button></div>`;
      const cv = root.querySelector('#cvs'), g = cv.getContext('2d'), k = Math.min(1, 360 / C.width, 540 / C.height);
      cv.width = Math.round(C.width * k); cv.height = Math.round(C.height * k);
      const W = C.width, H = C.height, msg = (m) => { S.busy = m; const e = root.querySelector('#selmsg'); if (e) e.textContent = m; };
      const finalAlpha = () => { const a = S.alpha ? new Uint8ClampedArray(S.alpha) : new Uint8ClampedArray(W * H); for (let i = 0; i < a.length; i++) if (S.edits[i]) a[i] = S.edits[i] > 0 ? 255 : 0; return a; };
      let showOrig = false;
      const paint = () => {
        g.clearRect(0, 0, cv.width, cv.height); g.drawImage(C, 0, 0, cv.width, cv.height);
        if (!showOrig) {
          const a = finalAlpha(), ov = g.getImageData(0, 0, cv.width, cv.height), d = ov.data;
          const t = S.alpha ? 0.6 : 0;
          for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const out = (1 - a[Math.min(H - 1, Math.floor(y / k)) * W + Math.min(W - 1, Math.floor(x / k))] / 255) * t, o = (y * cv.width + x) * 4; d[o] += (255 - d[o]) * out * 0.8; d[o + 1] += (90 - d[o + 1]) * out * 0.8; d[o + 2] += (160 - d[o + 2]) * out * 0.8; }
          g.putImageData(ov, 0, 0);
        }
        for (const [u, v] of S.pos) { g.fillStyle = '#22c55e'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(u * cv.width, v * cv.height, 9, 0, 7); g.fill(); g.stroke(); }
        for (const [u, v] of S.neg) { g.fillStyle = '#ef4444'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(u * cv.width, v * cv.height, 9, 0, 7); g.fill(); g.stroke(); }
      };
      let timer = 0, token = 0;
      const run = async () => {
        const my = ++token; msg('Finding the outline…');
        try {
          if (!S.picReady) { S.picReady = loadPicture(await new Promise((r) => C.toBlob(r, 'image/png'))); } await S.picReady;
          const m = await selectByTaps({ pos: S.pos, neg: S.neg, rect: [0, 0, 1, 1] }); if (my !== token || !m) return;
          S.mask = m; S.alpha = upsampleMask(m, W, H); msg(''); paint();
        } catch (err) { if (my === token) { S.picReady = null; msg(err.message || 'Could not select that.'); } }
      };
      const queue = () => { clearTimeout(timer); timer = setTimeout(run, 220); };
      const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
      let stroke = false;
      const paintBrush = (u, v) => { const cx = u * W, cy = v * H, r = S.brush / k / 2 * (cv.width / cv.getBoundingClientRect().width), val = S.tool === 'erase' ? -1 : 1; for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) S.edits[y * W + x] = val; };
      let raf = 0; const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
      cv.onpointerdown = (e) => {
        const [u, v] = at(e);
        if (S.tool === 'pos') { S.pos.push([u, v]); paint(); queue(); }
        else if (S.tool === 'neg') { S.neg.push([u, v]); paint(); queue(); }
        else { stroke = true; cv.setPointerCapture(e.pointerId); if (!S.alpha) S.alpha = new Uint8ClampedArray(W * H).fill(S.tool === 'erase' ? 255 : 0); paintBrush(u, v); soon(); }
      };
      cv.onpointermove = (e) => { if (stroke) { const [u, v] = at(e); paintBrush(u, v); soon(); } };
      cv.onpointerup = cv.onpointercancel = () => { stroke = false; };
      root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { S.tool = b.dataset.tool; root.querySelectorAll('[data-tool]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); }));
      root.querySelector('#brush').oninput = (e) => (S.brush = +e.target.value);
      root.querySelector('#undo').onclick = () => { const last = S.tool === 'neg' && S.neg.length ? S.neg : S.pos.length ? S.pos : S.neg; last.pop(); if (S.pos.length || S.neg.length) queue(); else { S.alpha = null; S.mask = null; paint(); } paint(); };
      root.querySelector('#reset').onclick = () => { S.pos = []; S.neg = []; S.alpha = null; S.mask = null; S.edits.fill(0); paint(); };
      const so = root.querySelector('#showorig'); so.onpointerdown = () => { showOrig = true; paint(); }; so.onpointerup = so.onpointerleave = () => { showOrig = false; paint(); };
      root.querySelector('#cutnext').onclick = () => {
        if (!S.alpha && !S.edits.some((v) => v)) return msg('Tap the garment first.');
        S.cutCanvas = cutoutFrom(C, finalAlpha()); S.marks = null; if (!groupOf(S.type)) return saveOut(); goto('marks');
      };
      paint(); if (!S.alpha) { /* wait for the first tap */ }
    };

    /* ── step 4: landmarks ── */
    const drawMarks = async () => {
      const cut = S.cutCanvas, ids = Object.keys(TYPES).filter((t) => groupOf(t));
      if (!S.type || !groupOf(S.type)) S.type = 'tops';
      const sugg = () => { S.marks = suggestFor(S.type, cut, { sleeves: S.sleeves }); };
      if (!S.marks) { if (S.sleeves === undefined) S.sleeves = S.type === 'tops' || S.type === 'outerwear' || S.type === 'dresses'; sugg(); }
      const hasSleeves = S.type !== 'bottoms' && S.type !== 'skirts';
      root.innerHTML = `${header('Fit it to the model', o.start === 'marks' ? '✕ Close' : '← Back')}${stepNav(3)}
        <div class="cutbody"><p class="muted">The dots are the garment’s landmarks, guessed from its outline. Drag any that are off; the model on the right updates.</p>
        <div class="row"><label class="f" for="mtype">This is a</label><select id="mtype">${ids.map((t) => `<option value="${t}" ${t === S.type ? 'selected' : ''}>${esc(TYPES[t].label)}</option>`).join('')}</select>
        ${hasSleeves ? `<label class="chk"><input type="checkbox" id="slv" ${S.sleeves ? 'checked' : ''}> It has sleeves</label>` : ''}<button type="button" class="ghost" id="resug">Re-guess</button></div>
        <div class="marksplit"><div class="cutstage"><canvas id="cvs" aria-label="The garment with its landmarks"></canvas></div><div class="cutstage"><canvas id="prev" aria-label="The garment on the model"></canvas></div></div>
        <p class="muted" id="fitmsg" role="status" aria-live="polite"></p>
        ${S.mode === 'hanger' ? '<p class="muted">Hanger photo: sloping shoulders are levelled and drooping sleeves are laid along the arms.</p>' : ''}</div>
        <div class="cutfoot"><button type="button" class="primary" id="cutdone">Save this piece</button></div>`;
      const cv = root.querySelector('#cvs'), g = cv.getContext('2d'), k = Math.min(1, 300 / cut.width, 420 / cut.height);
      cv.width = Math.round(cut.width * k); cv.height = Math.round(cut.height * k);
      const prev = root.querySelector('#prev'), pg = prev.getContext('2d'), pack = await loadPack(), body = pack && await bodyOf(pack).catch(() => null);
      prev.width = 200; prev.height = Math.round(200 * 1776 / 896);
      let baseImg = null; if (pack) { baseImg = new Image(); baseImg.src = pack.files[pack.layers.body]; await baseImg.decode().catch(() => {}); }
      const names = () => namesFor(S.type, S.marks);
      const paint = () => {
        g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#dfe9f5'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(cut, 0, 0, cv.width, cv.height);
        for (const n of names()) { const m = S.marks[n]; if (!m) continue; g.fillStyle = '#e0115f'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(m[0] * cv.width, m[1] * cv.height, 9, 0, 7); g.fill(); g.stroke(); }
      };
      let ftimer = 0, ftoken = 0;
      const refit = () => {
        clearTimeout(ftimer); ftimer = setTimeout(() => {
          if (!pack || !body || !baseImg) return; const my = ++ftoken, msg = root.querySelector('#fitmsg');
          try {
            const res = fitGarment(cut, S.type, S.marks, pack, body); if (my !== ftoken) return;
            pg.clearRect(0, 0, prev.width, prev.height); pg.fillStyle = '#f6e9ee'; pg.fillRect(0, 0, prev.width, prev.height); pg.drawImage(baseImg, 0, 0, prev.width, prev.height);
            if (res) { pg.drawImage(res.canvas, 0, 0, prev.width, prev.height); msg.textContent = ''; } else msg.textContent = 'Some landmarks are missing, so it can’t be fitted yet.';
          } catch { msg.textContent = 'Couldn’t fit it with these landmarks.'; }
        }, 120);
      };
      let drag = null;
      const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
      cv.onpointerdown = (e) => { const [u, v] = at(e), r = cv.getBoundingClientRect(); let b = null, bd = 1e9; for (const n of names()) { const m = S.marks[n]; if (!m) continue; const d = Math.hypot((m[0] - u) * r.width, (m[1] - v) * r.height); if (d < bd) { bd = d; b = n; } } if (b && bd < 28) { drag = b; cv.setPointerCapture(e.pointerId); } };
      cv.onpointermove = (e) => { if (!drag) return; const [u, v] = at(e); S.marks[drag] = [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))]; paint(); refit(); };
      cv.onpointerup = cv.onpointercancel = () => { drag = null; };
      root.querySelector('#mtype').onchange = (e) => { S.type = e.target.value; S.sleeves = S.type === 'tops' || S.type === 'outerwear' || S.type === 'dresses' ? S.sleeves ?? true : false; drawMarks(); };
      const slv = root.querySelector('#slv'); if (slv) slv.onchange = () => { S.sleeves = slv.checked; sugg(); paint(); refit(); };
      root.querySelector('#resug').onclick = () => { sugg(); paint(); refit(); };
      root.querySelector('#cutdone').onclick = saveOut;
      paint(); refit();
    };

    const draw = () => {
      root.querySelector?.('#cutback');
      ({ mode: drawMode, prep: drawPrep, select: drawSelect, marks: drawMarks })[S.step]();
      const back = root.querySelector('#cutback');
      if (back) back.onclick = () => { const prevStep = { prep: 'mode', select: 'prep', marks: o.start === 'marks' ? null : 'select' }[S.step]; if (!prevStep) return finish(null); goto(prevStep); };
      root.querySelector('#cuttitle')?.focus?.();
    };
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); });
    if (o.start === 'marks') { createImageBitmap(o.cutout).then((b) => { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; c.getContext('2d').drawImage(b, 0, 0); S.cutCanvas = c; draw(); }); return; }
    createImageBitmap(o.blob).then((b) => {
      const k = Math.min(1, 2000 / Math.max(b.width, b.height)), c = document.createElement('canvas'); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
      S.photo = c; S.quad = suggestQuad(c); draw();
    }).catch(() => finish(null));
  });
}
