// The dress-up figure. The body is a picture (assets/avatar/base.png) shown exactly as it is; nothing here draws a body.
// config.json next to it holds coordinates laid over that picture (shoulders, waist, hips, feet...) and the rules that turn them into a
// box for each kind of clothing. Layer order: base picture -> clothing -> hair -> accessories.
import { slotOf } from './data.js';

export const DEFAULT_PACK = 'base';
const packs = new Map();
const num = (n) => Math.round(n * 10) / 10;

/** Fetch the base picture's config (cached). Resolves to the pack, or null if it can't be loaded. */
export function loadPack(id = DEFAULT_PACK) {
  if (packs.has(id)) return packs.get(id).promise;
  const entry = { pack: null };
  entry.promise = (async () => {
    const base = '/assets/avatar/', meta = await (await fetch(base + 'config.json')).json(), files = {};
    await Promise.all(Object.values(meta.layers).map(async (f) => { const r = await fetch(base + f, { method: 'HEAD' }); if (!r.ok) throw new Error(f); files[f] = base + f; }));
    return (entry.pack = withPoints({ ...meta, files, base }));
  })().catch(() => { packs.delete(id); return null; });
  packs.set(id, entry);
  return entry.promise;
}
export const getPack = (id = DEFAULT_PACK) => packs.get(id)?.pack || null;

/* ── body points -> a box for each kind of clothing ── */
const pairOf = (P, k) => (k === 'neck' || k === 'hairline' ? [P[k], P[k]] : [P[k + 'L'], P[k + 'R']]);
/** The distance between a body part's left and right point. */
export const bodyWidth = (P, k) => { const [a, b] = pairOf(P, k); return Math.abs(b[0] - a[0]); };
/** The height of a level on the body (the average of its left and right points). */
export const levelY = (P, k) => { const [a, b] = pairOf(P, k); return (a[1] + b[1]) / 2; };
const centreX = (P, c) => (Array.isArray(c) ? P[c[0]][0] + c[1] : (([a, b]) => (a[0] + b[0]) / 2)(pairOf(P, c)));
/**
 * Turn the picture's body points and the placement rules (both in config.json) into { type: {x, y, w, h, align} }.
 * Widths come from the body (shoulders for shirts and coats, hips for trousers, skirts and dresses...), so a different picture only needs new points.
 */
export function deriveAnchors(points, rules) {
  const out = {};
  for (const [type, r] of Object.entries(rules)) {
    const w = bodyWidth(points, r.w[0]) * r.w[1], y0 = levelY(points, r.y0[0]) + r.y0[1], y1 = levelY(points, r.y1[0]) + r.y1[1];
    out[type] = { x: num(centreX(points, r.cx) - w / 2), y: num(y0), w: num(w), h: num(y1 - y0), align: r.align || 'xMidYMin' };
  }
  return out;
}
/** A pack gets its clothing boxes (and the tuck line) worked out from its points. */
export function withPoints(pack) {
  if (!pack.points || !pack.rules) return pack;
  return { ...pack, anchors: deriveAnchors(pack.points, pack.rules), waistY: pack.waistY ?? levelY(pack.points, 'waist') };
}
/** Where a whole cutout picture lands inside its box (it is scaled to fit and aligned): { x, y, w, h } in box units. */
export function imageRect(a, m) {
  const s = Math.min(a.w / m.iw, a.h / m.ih), w = m.iw * s, h = m.ih * s;
  return { x: /xMin/.test(a.align) ? 0 : /xMax/.test(a.align) ? a.w - w : (a.w - w) / 2, y: /YMin/.test(a.align) ? 0 : /YMax/.test(a.align) ? a.h - h : (a.h - h) / 2, w, h };
}
/** Where the visible part of a cutout sits inside its box: meta = { iw, ih, bx, by, bw, bh } (picture size and the opaque area as fractions of it). */
export function contentBox(a, m) {
  if (!m?.iw || !m?.ih) return { x: 0, y: 0, w: a.w, h: a.h };
  const r = imageRect(a, m);
  return { x: num(r.x + m.bx * r.w), y: num(r.y + m.by * r.h), w: num(m.bw * r.w), h: num(m.bh * r.h) };
}
const POINT_COLOR = { neck: '#ff3d8b', hairline: '#a855f7', shoulder: '#ff9f1c', bust: '#e11d48', waist: '#16a34a', hip: '#2563eb', knee: '#7c3aed', ankle: '#0891b2', foot: '#ca8a04' };
/** The debug picture: every body point, the width lines they give, and the box of each piece being worn. */
export function pointsOverlay(pack, items = {}) {
  const P = pack.points; if (!P) return '';
  const vw = pack.view[2], r = vw / 150, fs = vw / 38, sw = vw / 450;
  const lines = ['shoulder', 'bust', 'waist', 'hip', 'knee', 'ankle', 'foot'].map((k) => { const [a, b] = pairOf(P, k); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${POINT_COLOR[k]}" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>`; }).join('');
  const dots = Object.entries(P).map(([name, [x, y]]) => {
    const k = name.replace(/[LR]$/, ''), side = /R$/.test(name) ? 1 : /L$/.test(name) ? -1 : 0, c = POINT_COLOR[k] || '#000';
    const tx = x + (side ? side * (r + sw * 2) : r * 2), anchor = side < 0 ? 'end' : 'start';
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#fff" stroke-width="${sw}"/><text x="${tx}" y="${y + fs * 0.35}" font-size="${fs}" font-family="system-ui,sans-serif" font-weight="700" text-anchor="${anchor}" fill="${c}" stroke="#fff" stroke-width="${sw * 2.2}" paint-order="stroke">${name}</text>`;
  }).join('');
  const boxes = Object.values(items).map((it) => { const a = pack.anchors[it.type]; return a ? `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="none" stroke="#0ea5e9" stroke-width="${sw}" stroke-dasharray="${sw * 4} ${sw * 3}"/>` : ''; }).join('');
  const cx = (P.shoulderL[0] + P.shoulderR[0]) / 2;
  return `<g class="pointsdbg" aria-hidden="true"><line x1="${cx}" y1="${P.hairline[1] - 20}" x2="${cx}" y2="${P.footL[1]}" stroke="#94a3b8" stroke-width="${sw}"/>${boxes}${lines}${dots}</g>`;
}

/* ── fitting: each piece remembers a small nudge on top of where the points put it ── */
export const NO_FIT = { scale: 1, dx: 0, dy: 0, rot: 0, tuck: false };
/** The remembered fit of an item for this picture (a different base picture keeps its own, because proportions differ). */
export const fitOf = (item, pack) => ({ ...NO_FIT, ...(item?.fit?.[pack.id] || {}) });
export const isTuckable = (item, pack) => !!item && pack.tuckable.includes(item.type);

/** The SVG transform that puts an item's picture on its box, then applies the remembered nudge. */
export function garmentTransform(anchor, fit) {
  const cx = anchor.x + anchor.w / 2 + fit.dx, cy = anchor.y + anchor.h / 2 + fit.dy;
  return `translate(${num(cx)} ${num(cy)}) rotate(${num(fit.rot)}) scale(${num(fit.scale * 1000) / 1000}) translate(${-anchor.w / 2} ${-anchor.h / 2})`;
}

let uidN = 0;
/**
 * @param {{pack:object, items:Record<string,object>, urls:Map<string,string>, meta?:Map<string,object>, selected?:string, cls?:string, label?:string, debug?:boolean}} o
 *   items: slot -> item. meta: id -> { iw, ih, bx, by, bw, bh } for the dashed selection box.
 */
export function dollSVG({ pack, items, urls, meta = null, selected = '', cls = '', label = '', debug = false }) {
  const n = ++uidN;
  const top = items.top, bottom = items.bottom;
  const tucked = !!(top && bottom && isTuckable(top, pack) && fitOf(top, pack).tuck);
  const order = tucked ? pack.tuckedOrder : pack.clothesOrder;
  const garment = (slot) => {
    const it = items[slot]; if (!it) return '';
    const a = pack.anchors[it.type]; if (!a) return '';
    const f = fitOf(it, pack), href = urls.get(it.id) || '', box = contentBox(a, meta?.get(it.id));
    const g = `<g class="gar${selected === it.id ? ' sel' : ''}" data-id="${it.id}" data-slot="${slot}" transform="${garmentTransform(a, f)}">
      <image href="${href}" width="${a.w}" height="${a.h}" preserveAspectRatio="${a.align} meet" filter="url(#gfx-${n})"/>${selected === it.id ? `<rect class="selbox" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="6" fill="none"/>` : ''}</g>`;
    return slot === 'top' && tucked ? `<g clip-path="url(#tuckclip-${n})">${g}</g>` : g;
  };
  const clothes = order.map(garment).join('');
  const body = pack.files[pack.layers.body] ? `<image class="basepic" href="${pack.files[pack.layers.body]}" x="0" y="0" width="${pack.size[0]}" height="${pack.size[1]}"/>` : '';
  const parts = { body, clothes, hair: '', acc: garment('acc') };
  const [x, y, w, h] = pack.view;
  const names = Object.values(items).map((i) => i.name).filter(Boolean);
  const desc = label || (names.length ? `Model wearing ${names.join(', ')}` : 'Model with no clothes selected');
  // Clothes sit on the body: a feathered edge (so cutouts don't look pasted on) and a soft shadow underneath.
  const fx = `<filter id="gfx-${n}" x="-8%" y="-6%" width="116%" height="116%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="erode" radius="0.8" result="er"/><feGaussianBlur in="er" stdDeviation="1.1" result="soft"/>
      <feComposite in="SourceGraphic" in2="soft" operator="in" result="edge"/>
      <feGaussianBlur in="soft" stdDeviation="6" result="blur"/><feOffset in="blur" dy="5" result="off"/>
      <feFlood flood-color="#2b1a22" flood-opacity=".32"/><feComposite in2="off" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="edge"/></feMerge></filter>`;
  return `<svg class="doll ${cls}" viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${desc.replace(/"/g, '&quot;')}" data-pack="${pack.id}">
    <defs>${fx}<clipPath id="tuckclip-${n}"><rect x="0" y="0" width="${pack.size[0]}" height="${pack.waistY + 12}"/></clipPath></defs>
    ${pack.stack.map((k) => parts[k] || '').join('')}${debug ? pointsOverlay(pack, items) : ''}</svg>`;
}

/** Slot of the item an element belongs to (used when you tap or drag a garment on the figure). */
export const slotFor = (item) => slotOf(item.type);
