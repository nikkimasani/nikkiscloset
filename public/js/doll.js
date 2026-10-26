// The 2D paper doll. The art (SVG or PNG layers) lives in /dolls/<pack>/ together with a pack.json that says where each kind of
// clothing is anchored and in what order things are stacked. This file only knows about those rules, never about the artwork,
// so a different illustrated base can be dropped in by adding a folder.
import { slotOf } from './data.js';

export const DEFAULT_PACK = 'base';
const packs = new Map();
const num = (n) => Math.round(n * 10) / 10;

/** Fetch a pack's description and layer files (cached). Resolves to the pack, or null if it can't be loaded. */
export function loadPack(id = DEFAULT_PACK) {
  if (packs.has(id)) return packs.get(id).promise;
  const entry = { pack: null };
  entry.promise = (async () => {
    const base = '/assets/avatar/', meta = await (await fetch(base + 'config.json')).json(), files = {};
    const names = new Set(Object.values(meta.layers).flatMap((f) => (f.includes('{style}') ? (meta.hairStyles || []).map((s) => f.replace('{style}', s)) : [f])));
    await Promise.all([...names].map(async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f); files[f] = /\.(svg)$/i.test(f) ? await r.text() : base + f; }));
    return (entry.pack = withPoints({ ...meta, files, base }));
  })().catch(() => { packs.delete(id); return null; });
  packs.set(id, entry);
  return entry.promise;
}
export const getPack = (id = DEFAULT_PACK) => packs.get(id)?.pack || null;

/* ── body points -> a box for each kind of clothing ── */
const pairOf = (P, k) => (k === 'neck' ? [P.neck, P.neck] : [P[k + 'L'], P[k + 'R']]);
/** The distance between a body part's left and right point. */
export const bodyWidth = (P, k) => { const [a, b] = pairOf(P, k); return Math.abs(b[0] - a[0]); };
/** The height of a level on the body (the average of its left and right points). */
export const levelY = (P, k) => { const [a, b] = pairOf(P, k); return (a[1] + b[1]) / 2; };
const centreX = (P, c) => (Array.isArray(c) ? P[c[0]][0] + c[1] : (([a, b]) => (a[0] + b[0]) / 2)(pairOf(P, c)));
/**
 * Turn the picture's body points and the placement rules (both in pack.json) into { type: {x, y, w, h, align} }.
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
/** A pack that describes itself with body points gets its clothing boxes (and the tuck line) worked out from them. */
export function withPoints(pack) {
  if (!pack.points || !pack.rules) return pack;
  return { ...pack, anchors: deriveAnchors(pack.points, pack.rules), waistY: pack.waistY ?? levelY(pack.points, 'waist') };
}
/** Where the visible part of a cutout sits inside its box: meta = { iw, ih, bx, by, bw, bh } (picture size and the opaque area as fractions of it). */
export function contentBox(a, m) {
  if (!m?.iw || !m?.ih) return { x: 0, y: 0, w: a.w, h: a.h };
  const s = Math.min(a.w / m.iw, a.h / m.ih), dw = m.iw * s, dh = m.ih * s;
  const ox = /xMin/.test(a.align) ? 0 : /xMax/.test(a.align) ? a.w - dw : (a.w - dw) / 2, oy = /YMin/.test(a.align) ? 0 : /YMax/.test(a.align) ? a.h - dh : (a.h - dh) / 2;
  return { x: num(ox + m.bx * dw), y: num(oy + m.by * dh), w: num(m.bw * dw), h: num(m.bh * dh) };
}
const POINT_COLOR = { neck: '#ff3d8b', shoulder: '#ff9f1c', bust: '#e11d48', waist: '#16a34a', hip: '#2563eb', knee: '#7c3aed', ankle: '#0891b2', foot: '#ca8a04' };
/** The debug picture: every body point, the width lines they give, and the box of each piece being worn. */
export function pointsOverlay(pack, items = {}) {
  const P = pack.points; if (!P) return '';
  const [, , vw] = pack.view, r = vw / 150, fs = vw / 38, sw = vw / 450;
  const lines = ['shoulder', 'bust', 'waist', 'hip', 'knee', 'ankle', 'foot'].map((k) => { const [a, b] = pairOf(P, k); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${POINT_COLOR[k]}" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>`; }).join('');
  const dots = Object.entries(P).map(([name, [x, y]]) => { const k = name.replace(/[LR]$/, ''), left = /R$/.test(name) ? 1 : /L$/.test(name) ? -1 : 0; return `<circle cx="${x}" cy="${y}" r="${r}" fill="${POINT_COLOR[k] || '#000'}" stroke="#fff" stroke-width="${sw}"/><text x="${x + left * (r + sw * 2) + (left ? 0 : r * 2)}" y="${y + fs * 0.35}" font-size="${fs}" font-family="system-ui,sans-serif" font-weight="700" text-anchor="${left > 0 ? 'start' : left < 0 ? 'end' : 'start'}" fill="${POINT_COLOR[k] || '#000'}" stroke="#fff" stroke-width="${sw * 2.2}" paint-order="stroke">${name}</text>`; }).join('');
  const boxes = Object.values(items).map((it) => { const a = pack.anchors[it.type]; return a ? `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="none" stroke="#0ea5e9" stroke-width="${sw}" stroke-dasharray="${sw * 4} ${sw * 3}"/>` : ''; }).join('');
  const cx = (P.shoulderL[0] + P.shoulderR[0]) / 2;
  return `<g class="pointsdbg" aria-hidden="true"><line x1="${cx}" y1="${P.neck[1] - 60}" x2="${cx}" y2="${P.footL[1]}" stroke="#94a3b8" stroke-width="${sw}"/>${boxes}${lines}${dots}</g>`;
}

/* ── colours: the customizer gives skin / hair / eyes / lips; the rest are shades derived from them ── */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
export function tokens({ skin = '#eec3a0', hair = '#4a2e1e', eyes = '#2b1d17', lips = '#c4505f' } = {}) {
  return {
    skin, skinLight: mix(skin, '#ffffff', 0.2), skinShade: mix(skin, '#8a3d3a', 0.34),
    hair, hairLight: mix(hair, '#ffffff', 0.34), hairShade: mix(hair, '#000000', 0.38), browC: mix(hair, '#000000', 0.5),
    eyes, eyesLight: mix(eyes, '#ffffff', 0.5), lips, lipsShade: mix(lips, '#000000', 0.35),
    blush: mix(skin, '#ff4f7e', 0.55), under: '#f8eef7', underLine: '#d9bfd6',
  };
}
const fill = (svg, tok) => svg.replace(/\{\{(\w+)\}\}/g, (m, k) => tok[k] ?? m);
let uidN = 0;
/** Gradient ids in the art are made unique per drawing, so two dolls on one page never borrow each other's colours. */
const uniq = (svg, ids, n) => ids.reduce((s, id) => s.split(`"${id}"`).join(`"${id}-${n}"`).split(`url(#${id})`).join(`url(#${id}-${n})`), svg);

/* ── fitting ── */
export const NO_FIT = { scale: 1, dx: 0, dy: 0, rot: 0, tuck: false };
/** The remembered fit of an item for this pack (each art pack keeps its own, because proportions differ). */
export const fitOf = (item, pack) => ({ ...NO_FIT, ...(item?.fit?.[pack.id] || {}) });
export const isTuckable = (item, pack) => !!item && pack.tuckable.includes(item.type);

/** The SVG transform that puts an item's picture on its anchor, then applies the remembered nudge. */
export function garmentTransform(anchor, fit) {
  const cx = anchor.x + anchor.w / 2 + fit.dx, cy = anchor.y + anchor.h / 2 + fit.dy;
  return `translate(${num(cx)} ${num(cy)}) rotate(${num(fit.rot)}) scale(${num(fit.scale * 1000) / 1000}) translate(${-anchor.w / 2} ${-anchor.h / 2})`;
}

/**
 * @param {{pack:object, look:{skin:string,hair:string,hairStyle:string,eyes:string,lips:string}, items:Record<string,object>, urls:Map<string,string>,
 *          selected?:string, cls?:string, label?:string}} o   items: slot -> item
 */
export function dollSVG({ pack, look, items, urls, selected = '', cls = '', label = '' }) {
  const n = ++uidN, tok = tokens(look), hs = pack.hairStyles || [], style = hs.includes(look.hairStyle) ? look.hairStyle : hs[0];
  const ids = [...(pack.files[pack.layers.defs] || '').matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  const layer = (key) => {
    const f = pack.layers[key]?.replace('{style}', style), src = f && pack.files[f];
    if (!src) return '';
    return /^<|^\s*</.test(src) ? uniq(fill(src, tok), ids, n) : `<image href="${src}" width="${pack.view[2]}" height="${pack.view[3]}"/>`;
  };
  const top = items.top, bottom = items.bottom;
  const tucked = !!(top && bottom && isTuckable(top, pack) && fitOf(top, pack).tuck);
  const order = tucked ? pack.tuckedOrder : pack.clothesOrder;
  const garment = (slot) => {
    const it = items[slot]; if (!it) return '';
    const a = pack.anchors[it.type]; if (!a) return '';
    const f = fitOf(it, pack), href = urls.get(it.id) || '';
    const g = `<g class="gar${selected === it.id ? ' sel' : ''}" data-id="${it.id}" data-slot="${slot}" transform="${garmentTransform(a, f)}">
      <image href="${href}" width="${a.w}" height="${a.h}" preserveAspectRatio="${a.align} meet"/>${selected === it.id ? `<rect class="selbox" x="0" y="0" width="${a.w}" height="${a.h}" rx="8" fill="none"/>` : ''}</g>`;
    return slot === 'top' && tucked ? `<g clip-path="url(#tuckclip-${n})">${g}</g>` : g;
  };
  const clothes = order.map(garment).join('');
  const acc = garment('acc');
  const parts = { shadow: layer('shadow'), hairBack: layer('hairBack'), body: layer('body'), face: layer('face'), clothes, hairFront: layer('hairFront'), acc };
  const [x, y, w, h] = pack.view;
  const names = Object.values(items).map((i) => i.name).filter(Boolean);
  const desc = label || (names.length ? `Doll wearing ${names.join(', ')}` : 'Doll with no clothes selected');
  return `<svg class="doll ${cls}" viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${desc.replace(/"/g, '&quot;')}" data-pack="${pack.id}">
    <defs>${pack.files[pack.layers.defs] ? uniq(fill(pack.files[pack.layers.defs], tok), ids, n) : ''}<clipPath id="tuckclip-${n}"><rect x="0" y="0" width="${w}" height="${pack.waistY + 12}"/></clipPath></defs>
    ${pack.stack.map((k) => parts[k] || '').join('')}</svg>`;
}

/** Slot of the item an element belongs to (used when you tap or drag a garment on the doll). */
export const slotFor = (item) => slotOf(item.type);
