// The dress-up figure. The body is a picture (assets/avatar/base.png) shown exactly as it is; nothing here draws a body.
// config.json next to it holds coordinates laid over that picture (shoulders, waist, hips, feet...) and the rules that turn them into a
// box for each kind of clothing. Layer order: base picture -> clothing -> hair -> accessories.
import { slotOf } from './data.js';
import { pivotOf } from './garment.js';

export const DEFAULT_PACK = 'base';
const packs = new Map();
const num = (n) => Math.round(n * 10) / 10;

/** Fetch the base picture's config (cached). Resolves to the pack, or null if it can't be loaded. */
export function loadPack(id = DEFAULT_PACK) {
  if (packs.has(id)) return packs.get(id).promise;
  const entry = { pack: null };
  entry.promise = (async () => {
    const base = '/assets/avatar/', meta = await (await fetch(base + 'config.json')).json(), files = {};
    await Promise.all(Object.values(meta.layers).map(async (f) => { const r = await fetch(base + f, { method: 'HEAD' }); if (!r.ok) throw new Error(f); files[f] = base + f + (meta.version ? `?v=${meta.version}` : ''); })); // (the version makes a phone fetch a replaced picture instead of its cached copy)
    return (entry.pack = withPoints({ ...meta, files, base }));
  })().catch(() => { packs.delete(id); return null; });
  packs.set(id, entry);
  return entry.promise;
}
export const getPack = (id = DEFAULT_PACK) => packs.get(id)?.pack || null;

/** The hairstyle to draw: { href, size, marks, m, tone } (its picture, landmarks in its own pixels and an optional colour matrix), or null for
 *  the base picture's own slicked-back hair. overrides: { styleId: marks } saved from "Adjust fit". */
export function hairOf(pack, style, color, overrides = {}) {
  const h = pack?.hair, st = h?.styles.find((s) => s.id === style);
  if (!st || st.id === 'none' || !st.size) return null;
  const v = pack.version ? `?v=${pack.version}` : '';
  return { id: st.id, href: `${pack.base}hair/${st.id}.png${v}`, fill: st.fill ? `${pack.base}hair/${st.id}-fill.png${v}` : '', size: st.size, marks: { ...st.marks, ...(overrides[st.id] || {}) }, m: h.colors.find((c) => c.id === color)?.m || null, tone: st.tone || '#2a1c12' };
}
/** Where a hairstyle goes: scaled so its temples span her temples, placed so its hairline sits on hers, and stretched up or down (a little)
 *  so its crown sits on her crown. Returns [sx, sy, tx, ty] for matrix(sx 0 0 sy tx ty). */
export function hairPlacement(pack, marks) {
  const P = pack.points, M = marks;
  const sx = (P.templeR[0] - P.templeL[0]) / Math.max(4, M.templeR[0] - M.templeL[0]);
  const syRaw = (P.hairline[1] - P.crown[1]) / Math.max(4, M.hairline[1] - M.crown[1]), sy = Math.min(sx * 1.2, Math.max(sx * 0.85, syRaw));
  const mx = (M.templeL[0] + M.templeR[0]) / 2, px = (P.templeL[0] + P.templeR[0]) / 2;
  return [sx, sy, px - mx * sx, P.hairline[1] - M.hairline[1] * sy];
}

/* ── body points -> a box for each kind of clothing ── */
const pairOf = (P, k) => (k === 'neck' || k === 'hairline' || k === 'crotch' ? [P[k], P[k]] : [P[k + 'L'], P[k + 'R']]);
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
const POINT_COLOR = { crown: '#7c3aed', temple: '#0891b2', jaw: '#b45309', nape: '#64748b', ear: '#db2777', eyes: '#0d9488', head: '#7c3aed', hand: '#65a30d', belt: '#15803d', neck: '#ff3d8b', hairline: '#a855f7', shoulder: '#ff9f1c', bust: '#e11d48', waist: '#16a34a', hip: '#2563eb', armpit: '#db2777', elbow: '#0d9488', wrist: '#65a30d', crotch: '#dc2626', waistband: '#15803d', knee: '#7c3aed', ankle: '#0891b2', foot: '#ca8a04' };
/** The debug picture: every body point, the width lines they give, and the box of each piece being worn. */
export function pointsOverlay(pack, items = {}) {
  const P = pack.points; if (!P) return '';
  const vw = pack.view[2], r = vw / 150, fs = vw / 38, sw = vw / 450;
  const lines = ['shoulder', 'armpit', 'bust', 'waist', 'waistband', 'hip', 'knee', 'ankle', 'foot'].map((k) => { const [a, b] = pairOf(P, k); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${POINT_COLOR[k]}" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>`; }).join('');
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
export function dollSVG({ pack, items, urls, hair = null, meta = null, fits = null, fitBoxes = null, base = '', selected = '', cls = '', label = '', debug = false }) {
  const n = ++uidN;
  const top = items.top, bottom = items.bottom;
  const tucked = !!(top && bottom && isTuckable(top, pack) && fitOf(top, pack).tuck);
  const order = tucked ? pack.tuckedOrder : pack.clothesOrder;
  const garment = (slot) => {
    const it = items[slot]; if (!it) return '';
    const a = pack.anchors[it.type]; if (!a) return '';
    const f = fitOf(it, pack), href = urls.get(it.id) || '', box = contentBox(a, meta?.get(it.id)), fitted = fits?.get(it.id);
    const ar = it.acc && pack.accRules?.[it.acc];
    if (ar && !fitted) return accPiece(it, ar, f, selected === it.id); // a bag or accessory snaps to its body point (accRules in config.json)
    if (fitted) { // warped onto the body (garment.js): a picture the size of the base picture, nudged about its pivot
      const [px, py] = pivotOf(it.type, pack), tf = `translate(${num(f.dx)} ${num(f.dy)}) rotate(${num(f.rot)} ${num(px)} ${num(py)}) translate(${num(px)} ${num(py)}) scale(${num(f.scale * 1000) / 1000}) translate(${-num(px)} ${-num(py)})`;
      const g = `<g class="gar${selected === it.id ? ' sel' : ''}" data-id="${it.id}" data-slot="${slot}" transform="${tf}"><image href="${fitted}" x="0" y="0" width="${pack.size[0]}" height="${pack.size[1]}" filter="url(#gfx-${n})"/>${selected === it.id && fitBoxes?.get(it.id) ? `<rect class="selbox" x="${fitBoxes.get(it.id).x}" y="${fitBoxes.get(it.id).y}" width="${fitBoxes.get(it.id).w}" height="${fitBoxes.get(it.id).h}" rx="6" fill="none"/>` : ''}</g>`;
      return slot === 'top' && tucked ? `<g clip-path="url(#tuckclip-${n})">${g}</g>` : g;
    }
    const g = `<g class="gar${selected === it.id ? ' sel' : ''}" data-id="${it.id}" data-slot="${slot}" transform="${garmentTransform(a, f)}">
      <image href="${href}" width="${a.w}" height="${a.h}" preserveAspectRatio="${a.align} meet" filter="url(#gfx-${n})"/>${selected === it.id ? `<rect class="selbox" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="6" fill="none"/>` : ''}</g>`;
    return slot === 'top' && tucked ? `<g clip-path="url(#tuckclip-${n})">${g}</g>` : g;
  };
  const accPiece = (it, r, f, sel) => {
    const m = meta?.get(it.id), iw = m?.iw || 1, ih = m?.ih || 1, pts = [].concat(r.at).map((k) => pack.points[k]).filter(Boolean), pair = pts.length === 2;
    const cw = pair ? iw / 2 : iw, w = r.w ?? (r.h * cw) / ih, h = r.h ?? (r.w * ih) / cw, href = urls.get(it.id) || '';
    const pic = pts.map(([px, py], k) => `<svg x="${num(px - r.anchor[0] * w)}" y="${num(py - r.anchor[1] * h)}" width="${num(w)}" height="${num(h)}" viewBox="${pair ? num(k * cw) : 0} 0 ${num(cw)} ${ih}" preserveAspectRatio="none" overflow="hidden"><image href="${href}" width="${iw}" height="${ih}"/></svg>`).join('');
    const [cx, cy] = pts[0];
    return `<g class="gar acc${sel ? ' sel' : ''}" data-id="${it.id}" data-slot="${slotFor(it)}" filter="url(#gfx-${n})" transform="translate(${num(f.dx)} ${num(f.dy)}) rotate(${num(f.rot)} ${num(cx)} ${num(cy)}) translate(${num(cx)} ${num(cy)}) scale(${num(f.scale * 1000) / 1000}) translate(${-num(cx)} ${-num(cy)})">${pic}</g>`;
  };
  const clothes = order.map(garment).join('');
  const body = pack.files[pack.layers.body] ? `<image class="basepic" href="${base || pack.files[pack.layers.body]}" x="0" y="0" width="${pack.size[0]}" height="${pack.size[1]}"/>` : '';
  let hairBack = '', hairFront = '', hairDefs = '';
  if (hair && pack.points.crown) { // behind the body: the hair inside the neck column below the jaw, and a soft fill between her skull and the hair's crown
    const P = pack.points, [sx, sy, tx, ty] = hairPlacement(pack, hair.marks), img = `<image class="hairpic" href="${hair.href}" width="${hair.size[0]}" height="${hair.size[1]}" transform="matrix(${num(sx)} 0 0 ${num(sy)} ${num(tx)} ${num(ty)})"/>`;
    // hair below the jaw in a column as wide as her neck goes behind the body (her neck and chest hide it); the edges are feathered so no line shows
    const ny = (P.jawL[1] + P.jawR[1]) / 2, [nx0, nx1] = pack.hair.neck || [P.jawL[0] + 8, P.jawR[0] - 8], big = 4000, tw = (P.templeR[0] - P.templeL[0]) / 2;
    const col = `<rect x="${nx0}" y="${ny}" width="${nx1 - nx0}" height="${big}" fill="#fff" filter="url(#hairsoft-${n})"/>`;
    hairDefs = `<filter id="hairsoft-${n}" x="-50%" y="-5%" width="200%" height="110%"><feGaussianBlur stdDeviation="9"/></filter>
      <mask id="hairback-${n}" maskUnits="userSpaceOnUse" x="${-big}" y="${-big}" width="${2 * big}" height="${2 * big}">${col}</mask>
      <mask id="hairfront-${n}" maskUnits="userSpaceOnUse" x="${-big}" y="${-big}" width="${2 * big}" height="${2 * big}"><rect x="${-big}" y="${-big}" width="${2 * big}" height="${2 * big}" fill="#fff"/>${col.replace('#fff', '#000')}</mask>
      <filter id="hairfx-${n}" x="-10%" y="-10%" width="120%" height="125%" color-interpolation-filters="sRGB">${hair.m ? `<feColorMatrix type="matrix" values="${hair.m.join(' ')} 0 0 0 1 0" result="c"/>` : '<feOffset dx="0" dy="0" result="c"/>'}
        <feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dy="2" result="b"/><feFlood flood-color="#1a0d06" flood-opacity=".22"/><feComposite in2="b" operator="in" result="sh"/>
        <feMerge><feMergeNode in="sh"/><feMergeNode in="c"/></feMerge></filter>
 <filter id="hairgap-${n}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="erode" radius="4" result="e"/><feGaussianBlur in="e" stdDeviation="1.5" result="b"/><feFlood flood-color="${hair.tone}"/><feComposite in2="b" operator="in"/>${hair.m ? `<feColorMatrix type="matrix" values="${hair.m.join(' ')} 0 0 0 1 0"/>` : ''}</filter>`;
    // the back of her head, in the hair's colour: the style with its face opening filled in down to her jaw, so nothing shows between face and hair
    // (a little inside the hair's own edge, and never below her jaw, where it would show beside her neck)
    hairDefs += `<linearGradient id="hairjawg-${n}" gradientUnits="userSpaceOnUse" x1="0" y1="${ny - 45}" x2="0" y2="${ny + 5}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
      <mask id="hairjaw-${n}" maskUnits="userSpaceOnUse" x="${-big}" y="${-big}" width="${2 * big}" height="${2 * big}"><rect x="${-big}" y="${-big}" width="${2 * big}" height="${2 * big}" fill="url(#hairjawg-${n})"/></mask>`;
    const fillPic = hair.fill ? `<g mask="url(#hairjaw-${n})"><image href="${hair.fill}" width="${hair.size[0]}" height="${hair.size[1]}" transform="matrix(${num(sx)} 0 0 ${num(sy)} ${num(tx)} ${num(ty)})" filter="url(#hairgap-${n})"/></g>` : '';
    hairBack = `<g class="hairback">${fillPic}
      <g mask="url(#hairback-${n})"><g filter="url(#hairfx-${n})">${img}</g></g></g>`;
    hairFront = `<g class="hairfront" mask="url(#hairfront-${n})"><g filter="url(#hairfx-${n})">${img}</g></g>`;
  }
  const parts = { hairBack, body, clothes, hair: hairFront, acc: garment('acc') };
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
    <defs>${fx}${hairDefs}<clipPath id="tuckclip-${n}"><rect x="0" y="0" width="${pack.size[0]}" height="${pack.waistY + 12}"/></clipPath></defs>
    ${pack.stack.map((k) => parts[k] || '').join('')}${debug ? pointsOverlay(pack, items) : ''}</svg>`;
}

/** Slot of the item an element belongs to (used when you tap or drag a garment on the figure). */
export const slotFor = (item) => slotOf(item.type);
