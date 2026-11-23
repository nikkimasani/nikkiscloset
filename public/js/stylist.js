// The "stylist": colour-aware outfit matching against Pinterest-style inspo, plus a random OOTD picker.
import { hexDist, hexOfName, palette } from './color.js';
import { TYPES, slotOf } from './data.js';

/** 0-100: how close an item's colour is to the nearest colour in the inspo palette. */
export function colorScore(item, pal) {
  if (!item.color) return 0;
  const d = Math.min(...pal.map((p) => hexDist(item.color.hex, p.hex)));
  return Math.max(0, Math.round(100 - d * 1.4));
}

function rank(items, slot, pal, occasion, wearCounts) {
  return items
    .filter((i) => slotOf(i.type) === slot)
    .map((item) => {
      const color = colorScore(item, pal);
      const occ = occasion && item.occasions?.includes(occasion) ? 12 : 0;
      const fresh = Math.max(0, 5 - (wearCounts[item.id] || 0)); // gentle nudge toward under-worn pieces
      const own = item.source === 'starter' ? 0 : 10; // your own piece wins a close call against a starter one
      return { item, color, score: color + occ + fresh + own };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * @param {object[]} items closet
 * @param {{hex:string}[]} pal inspo palette
 * @param {string[]} wanted slots seen in the inspo (dress|top|bottom|outer|shoes|bag)
 * @returns {{picks: Record<string,{item,color}>, gaps: {slot,hex}[]}}
 */
export function matchInspo(items, pal, { wanted, occasion, wearCounts = {}, regions = {} }) {
  if (!pal.length) return { picks: {}, gaps: [] }; // no usable colours in the picture (e.g. fully transparent)
  const slots = wanted.includes('dress') ? wanted.filter((s) => s !== 'top' && s !== 'bottom') : wanted;
  const picks = {}, gaps = [];
  for (const slot of slots) {
    const best = rank(items, slot, regions[slot]?.length ? regions[slot] : pal, occasion, wearCounts)[0]; // (each slot against the colours where that piece is in the photo, when known)
    if (best && best.color >= 35) picks[slot] = best;
    else gaps.push({ slot, hex: pal[Math.min(gaps.length + 1, pal.length - 1)]?.hex || pal[0]?.hex, closest: best });
  }
  return { picks, gaps };
}

// Words that name a kind of garment: a closet piece sharing one with a piece in the photo is the same kind of thing (a cardigan for a cardigan).
const KINDS = [['cardigan'], ['blazer', 'suit jacket'], ['trench'], ['coat', 'overcoat'], ['jacket', 'bomber', 'shacket'], ['sweater', 'jumper', 'knit', 'pullover'], ['hoodie', 'sweatshirt'], ['turtleneck', 'mock neck'], ['shirt', 'button-down', 'button down', 'blouse'],
  ['tee', 't-shirt', 't shirt'], ['cami', 'camisole', 'tank', 'strappy top'], ['corset', 'bustier'], ['bodysuit'], ['crop top', 'cropped top'], ['jeans', 'denim'], ['trousers', 'pants', 'slacks', 'chinos'], ['leggings'], ['shorts'], ['skirt'], ['dress', 'gown'],
  ['heels', 'pumps', 'stilettos', 'slingbacks', 'mules'], ['flats', 'ballet', 'loafers'], ['sneakers', 'trainers'], ['boots', 'booties'], ['sandals']];
const KIND_RES = KINDS.map((ws) => [ws[0], ws.map((w) => new RegExp(`[^a-z]${w}s?[^a-z]`))]);
/** Remember what a bit of text works out to: the same names are scored against hundreds of pieces (a phone took seconds without this). */
const memo = (fn, cache = new Map()) => (text) => { const k = String(text || ''); let v = cache.get(k); if (v === undefined) { if (cache.size > 20000) cache.clear(); cache.set(k, (v = fn(k))); } return v; };
const kindsIn = memo((text) => { const s = ` ${text.toLowerCase()} `; return KIND_RES.filter(([, res]) => res.some((re) => re.test(s))).map(([k]) => k); });
const hexOf = memo(hexOfName);

/** 0-100: how close a closet piece is to one seen in a photo, by colour (most of it) and by being the same kind of garment. */
export function pieceScore(item, piece) {
  const want = (piece.colors || []).map(hexOfName).filter(Boolean);
  const color = want.length && item.color ? Math.max(...want.map((h) => Math.max(0, 100 - hexDist(item.color.hex, h) * 2.2))) : 40;
  const pk = kindsIn(`${piece.name} ${piece.detail || ''}`), ik = kindsIn(item.name);
  const kind = pk.length && ik.some((k) => pk.includes(k)) ? 100 : item.type === piece.type ? 55 : 25;
  return Math.round(color * (0.55 + 0.45 * kind / 100)); // (the wrong colour is never a close match, however alike the cut)
}

/**
 * The closest closet piece to each piece an AI saw in the photo (same slot only).
 * @returns {{piece, best: {item, score}|null}[]}
 */
export function matchPieces(items, pieces, { occasion, wearCounts = {} } = {}) {
  return pieces.map((piece) => {
    const slot = slotOf(piece.type);
    const best = items.filter((i) => slotOf(i.type) === slot).map((item) => {
      const score = pieceScore(item, piece);
      const nudge = (occasion && item.occasions?.includes(occasion) ? 3 : 0) + (item.source === 'starter' ? 0 : 2) + Math.max(0, 1 - (wearCounts[item.id] || 0)); // (tie-breakers only)
      return { item, score, rank: score + nudge };
    }).sort((a, b) => b.rank - a.rank)[0] || null;
    return { piece, best };
  });
}

/** Does a piece suit this weather band? (pieces with no season count as all-season) */
export function suitsWeather(item, band) {
  const s = item.season || 'all';
  if (!band || s === 'all') return true;
  if (band === 'cold') return s === 'warm';
  if (band === 'cool') return s !== 'light';
  if (band === 'warm' || band === 'hot') return s === 'light';
  return true; // mild: anything goes
}

/**
 * "Style me": a random, balanced outfit for an occasion that favours pieces you rarely wear.
 * @param {{band?:string, rain?:number, avoid?:Set<string>}} weather band picks suitable layers; avoid = ids to steer away from (e.g. already used this week)
 */
/** Starter pieces can be picked, but your own are about five times as likely when both fit. */
export const STARTER_WEIGHT = 0.2;

/** Neutrals go with anything; two colours go together when they're close (tonal), and two loud, different colours rarely do. */
const NEUTRAL = /black|white|cream|ivory|beige|camel|tan|brown|chocolate|grey|gray|charcoal|navy|denim|taupe|oatmeal|champagne|nude|khaki|espresso|mocha|stone|sand|ecru|off-white|silver|gold/i;
const isNeutral = (i) => NEUTRAL.test(i.color?.name || (i.tags?.colors || i.colors || [])[0] || String(i.name).split(' ')[0]) || /jeans|denim/i.test(i.name);
export function goesWith(a, b) {
  const colour = isNeutral(a) || isNeutral(b) ? 1 : a.color && b.color ? (hexDist(a.color.hex, b.color.hex) < 25 ? 0.85 : 0.25) : 0.6;
  const oa = a.occasions || [], ob = b.occasions || [];
  const shared = oa.length && ob.length ? oa.filter((x) => ob.includes(x)).length / Math.min(oa.length, ob.length) : 0.5; // (as dressed-up as each other: a gym top doesn't go with satin)
  return colour * (0.25 + 0.75 * shared);
}

/** The closest kinds of occasion, for a slot with nothing tagged for the one she picked (joggers for the gym, if she has no gym tops: a casual tee). */
const NEAR_OCC = { Workout: ['Lounge', 'Casual Outing'], Lounge: ['Casual Outing'], GNO: ['Date Night', 'Dinner'], Dinner: ['Date Night', 'Brunch'], Travel: ['Casual Outing', 'Lounge'], Brunch: ['Casual Outing'], 'Date Night': ['Dinner', 'GNO'], 'Formal / Event': ['Date Night'], 'Work / Office': [], 'Casual Outing': ['Brunch'] };
export function styleMe(items, occasion, wearCounts = {}, weather = {}) {
  const { band, rain = 0, avoid = new Set(), boost = {} } = weather;
  const pool = (slot) => {
    const all = items.filter((i) => slotOf(i.type) === slot);
    if (!occasion) return all;
    for (const occ of [occasion, ...(NEAR_OCC[occasion] || [])]) { const p = all.filter((i) => i.occasions?.includes(occ)); if (p.length) return p; } // (nothing tagged for it in this slot: the nearest kind of occasion)
    return slot === 'shoes' || slot === 'bag' || slot === 'outer' ? all : [];
  };
  const pick = (arr) => {
    if (!arr.length) return null;
    const chosen = Object.values(out).filter(Boolean);
    const w = arr.map((i) => (1 / (1 + (wearCounts[i.id] || 0))) * (suitsWeather(i, band) ? 3 : 1) * (avoid.has(i.id) ? 0.15 : 1) * (i.source === 'starter' ? STARTER_WEIGHT : 1) * (boost[i.id] ?? 1)
      * chosen.reduce((m, c) => m * goesWith(i, c) ** 2, 1)); // (each piece picked to go with what's already in the look)
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    return arr[w.findIndex((x) => (r -= x) < 0)] || arr[0];
  };
  const out = {};
  const dresses = pool('dress'), tops = pool('top'), bottoms = pool('bottom');
  const active = occasion === 'Workout' || occasion === 'Lounge'; // (the gym or a day at home: separates, comfy shoes, no bag)
  const useDress = dresses.length && (!(tops.length && bottoms.length) || (!active && Math.random() < 0.35));
  if (useDress) out.dress = pick(dresses);
  else { out.top = pick(tops); out.bottom = pick(bottoms); }
  const wantOuter = band ? band === 'cold' || band === 'cool' || rain >= 50 : Math.random() < 0.5; // layers when it's chilly or wet
  for (const s of ['outer', 'shoes', 'bag']) {
    if (s === 'outer' && !wantOuter && band) continue;
    if (s === 'bag' && active) continue;
    const comfy = s === 'shoes' && active && pool(s).filter((i) => (occasion === 'Workout' ? /sneaker|trainer/i : /slipper|slide|sneaker|loafer/i).test(i.name));
    const p = pick(comfy?.length ? comfy : pool(s));
    if (p && (s === 'shoes' || s === 'outer' && band || Math.random() < 0.5)) out[s] = p;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

/* ───────────── Vesti, the daily stylist ───────────── */

/** What she said she's dressing for, in the stylist's terms: "brunch saturday, it's hot" → {occasion:'Brunch', band:'hot'}. */
const ASK = [ // most specific first: "brunch with the girls" is brunch
  ['Brunch', /\bbrunch\b/],
  ['Dinner', /\b(dinner|restaurant)\b/],
  ['Formal / Event', /\b(wedding|gala|formal|event|cocktail|black tie|ceremony|graduation)\b/],
  ['Workout', /\b(gym|workout|yoga|run|running|pilates|hike|hiking)\b/],
  ['Travel', /\b(travel|flight|fly|flying|airport|trip|road ?trip|vacation)\b/],
  ['Work / Office', /\b(work|office|meeting|interview|presentation|client|conference)\b/],
  ['Date Night', /\b(date|anniversary|romantic)\b/],
  ['GNO', /\b(gno|girls|night out|club|clubbing|party|bar|drinks)\b/],
  ['Lounge', /\b(home|lounge|lounging|cozy|relax|wfh|chill)\b/],
  ['Casual Outing', /\b(casual|errands|shopping|coffee|park|weekend|museum|lunch|school|church)\b/],
];
export function parseAsk(text = '') {
  const t = ` ${String(text).toLowerCase()} `;
  const occasion = (ASK.find(([, re]) => re.test(t)) || [''])[0];
  const band = /\b(hot|heat|beach|pool|summer|humid)\b/.test(t) ? 'hot' : /\b(warm|sunny)\b/.test(t) ? 'warm'
    : /\b(freezing|snow|winter|cold)\b/.test(t) ? 'cold' : /\b(cool|chilly|fall|autumn|breezy)\b/.test(t) ? 'cool' : '';
  const rain = /\b(rain|rainy|storm|wet|showers)\b/.test(t) ? 80 : 0;
  return { occasion, band, rain };
}

/** How much the stylist leans towards a piece: up for looks you loved, down for ones you passed on. */
export function prefBoost(prefs = {}) {
  const out = {}, like = prefs.like || {}, nope = prefs.nope || {};
  for (const id of new Set([...Object.keys(like), ...Object.keys(nope)])) out[id] = (1 + 0.6 * (like[id] || 0)) / (1 + 0.8 * (nope[id] || 0));
  return out;
}

/** A few different looks for one day, from your wardrobe, for the weather and the occasion (relaxed when nothing is tagged for it). */
export function dailyLooks(items, { occasion = '', wearCounts = {}, band, rain = 0, prefs = {}, recent = new Set(), n = 3 } = {}) {
  const boost = prefBoost(prefs), seen = new Set(), looks = [], used = new Set(recent);
  for (let tries = 0; looks.length < n && tries < n * 12; tries++) {
    let o = styleMe(items, occasion, wearCounts, { band, rain, avoid: used, boost });
    if (!o.top && !o.dress && occasion) o = styleMe(items, '', wearCounts, { band, rain, avoid: used, boost });
    if (!o.top && !o.dress) break; // nothing to wear yet
    const key = Object.values(o).map((i) => i.id).sort().join();
    if (seen.has(key)) continue;
    seen.add(key); looks.push(o);
    Object.values(o).forEach((i) => { if (!['shoes', 'bag'].includes(slotOf(i.type))) used.add(i.id); }); // the next look tries other clothes (shoes and bags may repeat)
  }
  return looks;
}

/** Swap one piece of a look for another that suits the same slot (never the same piece). */
export function swapPiece(items, look, slot, { occasion = '', wearCounts = {}, band, prefs = {} } = {}) {
  const cur = look[slot]?.id, boost = prefBoost(prefs);
  const pool = items.filter((i) => slotOf(i.type) === slot && i.id !== cur);
  const fit = pool.filter((i) => !occasion || i.occasions?.includes(occasion));
  const arr = (fit.length ? fit : pool);
  if (!arr.length) return look;
  const w = arr.map((i) => (1 / (1 + (wearCounts[i.id] || 0))) * (suitsWeather(i, band) ? 3 : 1) * (i.source === 'starter' ? STARTER_WEIGHT : 1) * (boost[i.id] ?? 1));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  return { ...look, [slot]: arr[w.findIndex((x) => (r -= x) < 0)] || arr[0] };
}

/** Remember a reaction to a look: every piece in it counts. */
export function learn(prefs = {}, ids = [], liked = true) {
  const k = liked ? 'like' : 'nope', next = { like: { ...(prefs.like || {}) }, nope: { ...(prefs.nope || {}) } };
  for (const id of ids) next[k][id] = (next[k][id] || 0) + 1;
  return next;
}

export const suggestionLabel = (slot, hexName) => `${hexName} ${TYPES[Object.keys(TYPES).find((t) => TYPES[t].slot === slot)].label.toLowerCase()}`;
export { palette };

/* ───────────── Looks from her Pinterest pins ───────────── */

// Details that make two pieces the same piece, beyond colour and kind: a satin midi skirt for a satin midi skirt, not any skirt.
const DETAILS = ['satin', 'silk', 'linen', 'leather', 'suede', 'denim', 'knit', 'ribbed', 'cable', 'sheer', 'lace', 'sequin', 'tweed', 'midi', 'mini', 'maxi',
  'cropped', 'oversized', 'strapless', 'sleeveless', 'long-sleeve', 'short sleeve', 'halter', 'wide-leg', 'straight-leg', 'skinny', 'flared', 'pleated', 'tailored',
  'puff', 'wrap', 'square-neck', 'v-neck', 'scoop', 'pointed', 'strappy', 'block', 'platform', 'quilted', 'woven', 'chain', 'tote', 'clutch', 'shoulder bag'];
const detailsIn = memo((text) => { const s = text.toLowerCase().replace(/long sleeve/g, 'long-sleeve').replace(/wide leg/g, 'wide-leg'); return DETAILS.filter((d) => s.includes(d)); });

/** The kinds of garment named, where "denim" only means jeans when nothing else is named (a denim skirt is a skirt). */
const garmentKinds = memo((text) => { const k = kindsIn(text); return k.length > 1 && k.includes('jeans') && !/\bjeans?\b/i.test(text) ? k.filter((x) => x !== 'jeans') : k; });

/** 0-100: how well a closet piece stands in for one in a pin. The same colour and the same kind of garment are both needed; shared details count a little. */
const DENIM = /\b(jeans?|denim)\b/i, WASH = { light: /light|pale|bleach|baby/, dark: /dark|indigo|raw|deep/ };
const washOf = (t) => (WASH.light.test(t) ? 'light' : WASH.dark.test(t) ? 'dark' : 'mid');
export function recipeScore(item, piece) {
  const want = (piece.colors || []).map(hexOf).filter(Boolean);
  let color = want.length && item.color ? Math.max(...want.map((h) => Math.max(0, 100 - hexDist(item.color.hex, h) * 2.2))) : 40;
  // "blue jeans" in a pin means denim, not bright blue: denim of the same wash (light, mid, dark) is the same colour, another wash close to it
  const ptext0 = `${piece.name} ${(piece.colors || []).join(' ')} ${piece.detail || ''}`.toLowerCase(), itext0 = `${item.name} ${item.color?.name || ''} ${(item.colors || item.tags?.colors || []).join(' ')}`.toLowerCase();
  if (DENIM.test(ptext0) && /blue|denim|wash/.test(ptext0) && DENIM.test(itext0)) color = Math.max(color, washOf(ptext0) === washOf(itext0) ? 95 : 75);
  const pk = garmentKinds(`${piece.name} ${piece.detail || ''}`), ik = garmentKinds(item.name);
  const kind = pk.length && ik.length ? (ik.some((k) => pk.includes(k)) ? 1 : 0.5) : item.type === piece.type ? 0.85 : 0.7;
  const pd = detailsIn(`${piece.name} ${piece.detail || ''}`), id = new Set(detailsIn(`${item.name} ${item.detail || ''}`));
  const detail = pd.length ? 0.85 + 0.15 * pd.filter((d) => id.has(d)).length / pd.length : 1;
  const len = (set) => ['mini', 'midi', 'maxi'].find((l) => set.includes(l)), pl = len(pd), il = len([...id]);
  const length = pl && il && pl !== il && (pl === 'mini' || il === 'mini') ? 0.75 : 1; // a mini skirt is no stand-in for a long one
  const ptext = `${piece.name} ${piece.detail || ''}`.toLowerCase(), itext = `${item.name} ${item.detail || ''}`.toLowerCase();
  const cut = (t) => (NARROW.test(t) ? 'narrow' : WIDE.test(t) ? 'wide' : ''), pc = cut(ptext), ic = cut(itext);
  const shape = pc && ic && pc !== ic ? 0.75 : 1; // skinny trousers are no stand-in for wide-leg ones (nor a pencil skirt for a full one)
  const fabric = STRONG.filter((f) => itext.includes(f) && !ptext.includes(f)).length ? 0.88 : 1; // a satin cami stands in for a plain tank only if nothing plainer fits
  return Math.round(color * kind * detail * length * shape * fabric);
}
const NARROW = /\b(skinny|slim|cigarette|pencil|bodycon|leggings)\b/, WIDE = /\b(wide[- ]leg|flared?|palazzo|barrel|baggy|bootcut|a-line|full)\b/;
const STRONG = ['satin', 'silk', 'sequin', 'leather', 'lace', 'velvet', 'sheer', 'metallic', 'crochet', 'mesh'];
/** Does a closet piece name the same kind of thing as the pin's piece (heels for heels, a blazer for a blazer)? True when the pin names no kind. */
const sameKind = (item, piece) => { const pk = garmentKinds(`${piece.name} ${piece.detail || ''}`); return !pk.length || garmentKinds(item.name).some((k) => pk.includes(k)); };

const CORE = ['top', 'dress', 'bottom'];
const NEUTRAL_SHOES = /black|white|nude|tan|beige|cream|brown|camel|taupe/i;
const wet = (item) => /suede|satin|silk|sandal|strappy|slide|flip|espadrille|canvas|mule/i.test(item.name);

/** Tucked in or worn loose: what the pin says, else what the top is (a shirt or tee goes in with high-waisted bottoms; a sweater, an
 *  oversized or cropped top, a corset or a vest is worn out). Only tops and tanks over bottoms can be tucked. */
const LOOSE = /oversized|sweater|jumper|hoodie|sweatshirt|cardigan|crop|tunic|vest|corset|bustier|tube|peplum|boxy|knit|pullover|off-shoulder|off-the-shoulder/i;
export function tuckFor(look, piece = null) {
  const top = look.top;
  if (!top || !look.bottom || !['tops', 'tanks'].includes(top.type)) return false;
  const said = `${piece?.name || ''} ${piece?.detail || ''}`;
  if (/\buntucked\b|\bloose\b|\boversized\b|\bboxy\b/i.test(said)) return false; // ("relaxed fit" shirts are usually tucked in, front or all round)
  if (/\btucked\b/i.test(said)) return true;
  return !LOOSE.test(top.name);
}

/**
 * Today's looks, each one an outfit from a pin on her Pinterest boards made from her own wardrobe: { look, pin, score, tuck }[].
 * A pin only becomes a look when every main piece (top and bottom, or dress) has a close stand-in; weather, the occasion and her loves/passes weigh in.
 * shown: { pinId: days since she last saw it } and seenItems (pieces in looks she saw lately), so each day brings different pins and pieces.
 */
export function pinLooks(items, pins, { occasion = '', wearCounts = {}, band, rain = 0, prefs = {}, recent = new Set(), shown = {}, seenItems = new Set(), n = 3, random = Math.random } = {}) {
  const boost = prefBoost(prefs), bySlot = {};
  for (const i of items) (bySlot[slotOf(i.type)] ||= []).push(i);
  const fits = (item, slot) => {
    let f = suitsWeather(item, band) ? 1 : CORE.includes(slot) || slot === 'outer' ? 0.6 : 0.85;
    if (rain >= 50 && (slot === 'shoes' || slot === 'outer') && wet(item)) f *= 0.6; // no suede or sandals in the rain
    if (occasion && !item.occasions?.includes(occasion)) f *= 0.8;
    return f * Math.min(1.25, boost[item.id] ?? 1) * (recent.has(item.id) ? 0.75 : 1) * (seenItems.has(item.id) ? (slot === 'shoes' || slot === 'bag' ? 0.82 : 0.93) : 1) * (item.source === 'starter' ? 1 : 1.08) / (1 + 0.03 * (wearCounts[item.id] || 0));
  };
  // the closest stand-in, or one of the few that are just as close (so the same pin isn't always the same pieces, nor every beige heel the same pair)
  const best = (piece, slot, taken) => {
    // (shoes, a bag or a coat must be the same kind as the pin's: flats are no stand-in for heeled sandals)
    const all = (bySlot[slot] || []).filter((i) => !taken.has(i.id) && (CORE.includes(slot) || sameKind(i, piece))).map((item) => { const s = recipeScore(item, piece); return { item, s, r: s * fits(item, slot) }; }).sort((a, b) => b.r - a.r);
    if (!all.length) return null;
    const near = all.filter((x, k) => k < 5 && x.r >= all[0].r - (slot === 'shoes' || slot === 'bag' ? 9 : 5)); // (any of a few pairs of black heels will do)
    return near[Math.min(near.length - 1, Math.floor(random() * near.length))];
  };
  const outerOk = (piece) => band !== 'hot' && (band !== 'warm' || /blazer|cardigan|shacket|denim jacket|vest/i.test(piece.name)); // the pin's coat stays home on a warm day (a blazer can come)

  const options = [];
  for (const pin of pins) {
    const look = {}, scores = {}, taken = new Set(), from = {}, missing = [];
    for (const piece of pin.pieces) {
      const slot = slotOf(piece.type);
      if (slot === 'outer' && !outerOk(piece)) continue;
      if (look[slot] || (slot === 'dress' && (look.top || look.bottom)) || ((slot === 'top' || slot === 'bottom') && look.dress)) continue;
      const b = best(piece, slot, taken);
      if (!b || (!CORE.includes(slot) && b.s < 55)) { if (!CORE.includes(slot)) { missing.push(piece.name); from[slot] = piece; } continue; } // no close stand-in for the shoes, bag or coat: said on the look (shoes come from the fallback below)
      look[slot] = b.item; scores[slot] = b.r; taken.add(b.item.id); from[slot] = piece;
    }
    const core = CORE.filter((s) => look[s]);
    if (!(look.dress || (look.top && look.bottom))) continue;
    const coreMin = Math.min(...core.map((s) => scores[s]));
    if (coreMin < 62) continue; // a main piece isn't close enough to read as this pin
    const age = shown[pin.id], fresh = age === undefined ? 1 : age < 1 ? 0.04 : age < 3 ? 0.15 : age < 7 ? 0.45 : 0.8; // pins she saw lately wait their turn
    const score = coreMin * 0.7 + (Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length) * 0.3;
    options.push({ look, pin, scores, score, w: Math.pow(score / 100, 6) * fresh * (missing.length ? 0.85 : 1), tuck: tuckFor(look, from.top), missing, from });
  }

  // pick by chance among every pin that works (closer ones and ones she hasn't seen lately more likely); never the same main piece twice in one day
  const picked = [], used = new Set();
  let pool = options.slice();
  while (picked.length < n && pool.length) {
    let r = random() * pool.reduce((a, o) => a + o.w, 0), k = pool.findIndex((o) => (r -= o.w) < 0); if (k < 0) k = 0;
    const o = pool[k];
    pool = pool.filter((x) => x !== o && x.pin.id !== o.pin.id && !CORE.some((s) => x.look[s] && o.look[s] && x.look[s].id === o.look[s].id));
    if (CORE.some((s) => o.look[s] && used.has(o.look[s].id))) continue;
    CORE.forEach((s) => o.look[s] && used.add(o.look[s].id));
    picked.push(o);
  }

  // finish each look: shoes if the pin had none to match (ones that go with how dressed-up it is), a layer when it's cold or wet
  const added = new Set(); // (a different pair of shoes or coat for each look, where there's a choice)
  for (const o of picked) {
    const look = o.look, base = Object.values(look);
    const pal = base.filter((i) => i.color).map((i) => i.color.hex), occ = new Set(base.flatMap((i) => i.occasions || []));
    const nearest = (slot, extra = () => true) => {
      const all = (bySlot[slot] || []).filter(extra).map((i) => ({ i, r: (pal.length && i.color ? Math.max(...pal.map((h) => 100 - hexDist(i.color.hex, h))) : 50) * fits(i, slot) * (added.has(i.id) ? 0.7 : 1)
        * (occ.size ? 0.7 + 0.3 * (i.occasions || []).filter((x) => occ.has(x)).length / occ.size : 1) })).sort((a, b) => b.r - a.r);
      const near = all.filter((x, k) => k < 4 && x.r >= (all[0]?.r || 0) - 6);
      return near[Math.min(near.length - 1, Math.floor(random() * near.length))]?.i;
    };
    if (!look.shoes) { // the pin's kind of shoe in another colour, else a neutral pair
      const want = o.from?.shoes, s = (want && nearest('shoes', (i) => sameKind(i, want) && garmentKinds(`${want.name} ${want.detail || ''}`).length > 0)) || nearest('shoes', (i) => NEUTRAL_SHOES.test(i.name)) || nearest('shoes');
      if (s) { look.shoes = s; added.add(s.id); if (want && sameKind(s, want)) o.missing = o.missing.filter((m) => m !== want.name); }
    }
    if (!look.outer && (band === 'cold' || (band === 'cool' && rain >= 50))) { // a coat only when it's really needed; she can add or drop one
      const coat = nearest('outer', (i) => (rain >= 50 ? /trench|rain|coat|jacket/i : /coat|jacket|blazer|cardigan|trench/i).test(i.name) && (band === 'cold' || !/puffer|parka/i.test(i.name)) && suitsWeather(i, band));
      if (coat) { look.outer = coat; added.add(coat.id); }
    }
    if (look.shoes && rain >= 50 && wet(look.shoes)) { const s = nearest('shoes', (i) => !wet(i)); if (s) look.shoes = s; } // (the pin's sandals swapped for something that copes with rain)
  }
  return picked;
}
