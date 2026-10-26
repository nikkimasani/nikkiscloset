// The walk-in closet: five photographed backgrounds (assets/closet/*.jpg) laid side by side, with your real cutouts hung on the rails and
// set on the shelves. No character: you swipe along the walls, tap a section (or the strip at the bottom) to glide there, pinch to zoom a little.
const BG = { overview: [1680, 944], rails: [944, 1680], shelves: [944, 1680], vanity: [944, 1680], mirror: [944, 1680] };

/** Sections, in the order they sit along the walls. types: which pieces live there. */
export const SECTIONS = [
  { k: 'overview', label: 'Overview', emoji: '✨', bg: 'overview' },
  { k: 'tops', label: 'Tops', emoji: '👚', bg: 'rails', kind: 'rail', types: ['tops', 'tanks', 'bodysuits'] },
  { k: 'bottoms', label: 'Bottoms', emoji: '👖', bg: 'rails', kind: 'rail', types: ['bottoms', 'skirts'] },
  { k: 'dresses', label: 'Dresses', emoji: '👗', bg: 'rails', kind: 'rail', types: ['dresses'] },
  { k: 'outerwear', label: 'Coats', emoji: '🧥', bg: 'rails', kind: 'rail', types: ['outerwear'] },
  { k: 'shoes', label: 'Shoes', emoji: '👠', bg: 'shelves', kind: 'shelf', types: ['shoes'] },
  { k: 'bags', label: 'Bags', emoji: '👜', bg: 'shelves', kind: 'bagshelf', types: ['bags'] },
  { k: 'jewelry', label: 'Jewelry', emoji: '💍', bg: 'vanity', kind: 'island', types: ['accessories'], zoom: 1.7, focus: [0.86, 0.72] },
  { k: 'vanity', label: 'Vanity', emoji: '💄', bg: 'vanity', kind: 'vanity' },
  { k: 'mirror', label: 'Mirror', emoji: '🪞', bg: 'mirror', kind: 'mirror' },
];
export const sectionOf = (k) => SECTIONS.find((s) => s.k === k);
/** Where each section's label sits on the overview panorama (its own pixels). */
export const HOTSPOTS = { tops: [120, 300], dresses: [380, 300], bottoms: [120, 470], outerwear: [380, 470], shoes: [690, 420], bags: [1060, 300], jewelry: [640, 640], vanity: [1310, 480], mirror: [1530, 560] };

// rails (rails.jpg): two compartments up, two down; a piece hangs from the rail and is scaled to the compartment's height
const RAILS = [{ x0: 110, x1: 445, y: 280, h: 470 }, { x0: 500, x1: 835, y: 280, h: 470 }, { x0: 110, x1: 445, y: 870, h: 400 }, { x0: 500, x1: 835, y: 870, h: 400 }];
// shelves (shelves.jpg): three bays of glass shelves, each shelf's top surface
const BAYS = [[110, 318], [368, 578], [625, 835]], SHELVES = [457, 565, 673, 780, 884, 987, 1090, 1198];
// the jewelry island's velvet trays (vanity.jpg)
const TRAYS = [[555, 985], [700, 985], [850, 1010], [610, 1095], [760, 1100], [880, 1140], [700, 1215], [850, 1250], [560, 1200]];

/**
 * Where a section's pieces go, in its background's pixels: [{ id, x, y, w, h, hanger }] (x, y = top left).
 * items: [{ id, ar }] where ar = the cutout's width / height (1 if unknown).
 */
export function layoutSection(sec, items) {
  const out = [];
  if (sec.kind === 'rail') {
    const per = Math.max(1, Math.ceil(items.length / RAILS.length)); // spread over all four rails before crowding one
    items.forEach((it, i) => {
      const r = RAILS[Math.floor(i / per) % RAILS.length], n = Math.min(per, items.length - Math.floor(i / per) * per), j = i % per;
      let h = r.h - 30, w = h * (it.ar || 1); const maxW = (r.x1 - r.x0) * (n > 1 ? 0.62 : 0.9); if (w > maxW) { h *= maxW / w; w = maxW; }
      const cx = n > 1 ? r.x0 + w / 2 + ((r.x1 - r.x0 - w) * j) / (n - 1) : (r.x0 + r.x1) / 2;
      out.push({ id: it.id, x: cx - w / 2, y: r.y + 30, w, h, hanger: [cx, r.y] });
    });
  } else if (sec.kind === 'shelf' || sec.kind === 'bagshelf') {
    const tall = sec.kind === 'bagshelf', rows = tall ? [1, 3, 5, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
    items.forEach((it, i) => {
      const bay = BAYS[i % 3], row = rows[Math.floor(i / 3) % rows.length], floor = SHELVES[row] - 6, room = tall ? 190 : 92;
      let h = room, w = h * (it.ar || 1); const maxW = (bay[1] - bay[0]) * 0.86; if (w > maxW) { h *= maxW / w; w = maxW; }
      out.push({ id: it.id, x: (bay[0] + bay[1]) / 2 - w / 2, y: floor - h, w, h });
    });
  } else if (sec.kind === 'island') {
    items.forEach((it, i) => {
      const [cx, cy] = TRAYS[i % TRAYS.length]; let h = 88, w = h * (it.ar || 1); if (w > 120) { h *= 120 / w; w = 120; }
      out.push({ id: it.id, x: cx - w / 2, y: cy - h / 2, w, h });
    });
  }
  return out;
}

/** How a background is drawn in a panel of height H: the art box (its own pixels scaled by s), a section's zoom applied. */
export function artBox(sec, W, H) {
  const [iw, ih] = BG[sec.bg], z = sec.zoom || 1, s = Math.max(sec.k === 'overview' ? 0 : W / iw, H / ih) * z, aw = iw * s, ah = ih * s;
  const pw = sec.k === 'overview' ? aw : W, [fx, fy] = sec.focus || [0.5, 0.5];
  return { s, w: aw, h: ah, pw, x: Math.min(0, Math.max(pw - aw, pw / 2 - aw * fx)), y: Math.min(0, Math.max(H - ah, H / 2 - ah * fy)) };
}

/** The x offset of each panel along the track, and the track's width. */
export function trackLayout(W, H) {
  let x = 0; const at = {};
  for (const s of SECTIONS) { const b = artBox(s, W, H); at[s.k] = { x, w: b.pw }; x += b.pw; }
  return { at, total: x };
}
/** The scroll position that shows a section (an overview hotspot is centred; any other section fills the screen). */
export function targetFor(k, W, H, hotspot = false) {
  const { at, total } = trackLayout(W, H), p = at[k] || at.overview;
  if (hotspot && k !== 'overview') { const b = artBox(SECTIONS[0], W, H), [hx] = HOTSPOTS[k] || [0]; return clamp(hx * b.s - W / 2, 0, at.overview.w - W); }
  return clamp(p.x + p.w / 2 - W / 2, 0, total - W);
}
/** Which section is in view at scroll x. */
export function sectionAt(x, W, H) {
  const { at } = trackLayout(W, H), mid = x + W / 2;
  return SECTIONS.find((s) => mid >= at[s.k].x && mid < at[s.k].x + at[s.k].w)?.k || 'mirror';
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Bind swiping, gliding and pinching to a rendered closet.
 * @param {HTMLElement} view  the .wic-view element (holds .wic-track)
 * @param {{start?:string, onSection:(k:string)=>void}} o
 * @returns {{ glide:(k:string, hotspot?:boolean)=>void, current:()=>string, x:()=>number }}
 */
export function bindCloset(view, { start = 'overview', startX = null, onSection }) {
  const track = view.querySelector('.wic-track'), zoomer = view.querySelector('.wic-zoom');
  const W = () => view.clientWidth, H = () => view.clientHeight;
  let x = startX ?? targetFor(start, W(), H()), cur = '', k = 1;
  const total = () => trackLayout(W(), H()).total;
  const set = (nx, anim) => {
    x = clamp(nx, 0, Math.max(0, total() - W()));
    track.style.transition = anim ? 'transform .6s cubic-bezier(.22,.61,.36,1)' : 'none';
    track.style.transform = `translate3d(${-x}px,0,0)`;
    const s = sectionAt(x, W(), H()); if (s !== cur) { cur = s; onSection?.(s); }
  };
  const glide = (key, hotspot = false) => { k = 1; zoomer.style.transform = ''; set(targetFor(key, W(), H(), hotspot), !matchMedia('(prefers-reduced-motion: reduce)').matches); };
  const settle = (vx, from0) => { // in the overview you can stop anywhere; past it, every section snaps to fill the screen
    const ov = trackLayout(W(), H()).at.overview, nx = x - vx * 220;
    if (nx + W() <= ov.w + 40) return set(nx, true);
    // one swipe moves at most one section (a flick doesn't fly past the one you wanted)
    const all = SECTIONS.map((s) => s.k), from = all.indexOf(from0), keys = all.filter((kk, i) => kk !== 'overview' && Math.abs(i - from) <= 1);
    let best = keys[0], bd = 1e9; for (const kk of keys) { const t = targetFor(kk, W(), H()), d = Math.abs(t - nx); if (d < bd) { bd = d; best = kk; } }
    const ovEnd = clamp(ov.w - W(), 0, 1e9); set(Math.abs(nx - ovEnd) < bd ? ovEnd : targetFor(best, W(), H()), true);
  };
  const pts = new Map(); let drag = null, pinch = null;
  view.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(b.x - a.x, b.y - a.y), k }; drag = null; }
    else if (pts.size === 1) drag = { from: cur, x0: e.clientX, y0: e.clientY, sx: x, moved: false, lx: e.clientX, lt: performance.now(), vx: 0 };
  });
  view.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; k = clamp(pinch.k * Math.hypot(b.x - a.x, b.y - a.y) / pinch.d, 1, 1.4); zoomer.style.transform = `scale(${k})`; return; }
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - drag.y0)) { drag.moved = true; try { view.setPointerCapture(e.pointerId); } catch { /* already gone */ } }
    if (!drag.moved) return;
    const now = performance.now(); drag.vx = (e.clientX - drag.lx) / Math.max(1, now - drag.lt); drag.lx = e.clientX; drag.lt = now;
    set(drag.sx - dx / k, false);
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (drag?.moved) { view.dataset.swiped = String(performance.now()); settle(drag.vx, drag.from); }
    if (!pts.size) { drag = null; pinch = null; }
  };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  // a tap right after a swipe is not a tap
  view.addEventListener('click', (e) => { if (performance.now() - Number(view.dataset.swiped || 0) < 250) { e.stopPropagation(); e.preventDefault(); } }, true);
  view.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = SECTIONS.findIndex((s) => s.k === cur), n = SECTIONS[clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, SECTIONS.length - 1)];
    glide(n.k); e.preventDefault();
  });
  set(x, false);
  return { glide, current: () => cur, x: () => x };
}
