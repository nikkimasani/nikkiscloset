// The 2D paper doll. The art (SVG or PNG layers) lives in /dolls/<pack>/ together with a pack.json that says where each kind of
// clothing is anchored and in what order things are stacked. This file only knows about those rules, never about the artwork,
// so a different illustrated base can be dropped in by adding a folder.
import { slotOf } from './data.js';

export const DEFAULT_PACK = 'studio';
const packs = new Map();
const num = (n) => Math.round(n * 10) / 10;

/** Fetch a pack's description and layer files (cached). Resolves to the pack, or null if it can't be loaded. */
export function loadPack(id = DEFAULT_PACK) {
  if (packs.has(id)) return packs.get(id).promise;
  const entry = { pack: null };
  entry.promise = (async () => {
    const base = `/dolls/${id}/`, meta = await (await fetch(base + 'pack.json')).json(), files = {};
    const names = new Set(Object.values(meta.layers).flatMap((f) => (f.includes('{style}') ? meta.hairStyles.map((s) => f.replace('{style}', s)) : [f])));
    await Promise.all([...names].map(async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f); files[f] = /\.(svg)$/i.test(f) ? await r.text() : base + f; }));
    return (entry.pack = { ...meta, files, base });
  })().catch(() => { packs.delete(id); return null; });
  packs.set(id, entry);
  return entry.promise;
}
export const getPack = (id = DEFAULT_PACK) => packs.get(id)?.pack || null;

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
  const n = ++uidN, tok = tokens(look), style = pack.hairStyles.includes(look.hairStyle) ? look.hairStyle : pack.hairStyles[0];
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
