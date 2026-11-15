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
const kindsIn = (text) => { const s = ` ${String(text || '').toLowerCase()} `; return KINDS.filter((ws) => ws.some((w) => new RegExp(`[^a-z]${w}s?[^a-z]`).test(s))).map((ws) => ws[0]); };

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
export function styleMe(items, occasion, wearCounts = {}, weather = {}) {
  const { band, rain = 0, avoid = new Set(), boost = {} } = weather;
  const pool = (slot) => items.filter((i) => slotOf(i.type) === slot && (!occasion || i.occasions?.includes(occasion)));
  const pick = (arr) => {
    if (!arr.length) return null;
    const w = arr.map((i) => (1 / (1 + (wearCounts[i.id] || 0))) * (suitsWeather(i, band) ? 3 : 1) * (avoid.has(i.id) ? 0.15 : 1) * (i.source === 'starter' ? STARTER_WEIGHT : 1) * (boost[i.id] ?? 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    return arr[w.findIndex((x) => (r -= x) < 0)] || arr[0];
  };
  const out = {};
  const dresses = pool('dress'), tops = pool('top'), bottoms = pool('bottom');
  const useDress = dresses.length && (!(tops.length && bottoms.length) || Math.random() < 0.35);
  if (useDress) out.dress = pick(dresses);
  else { out.top = pick(tops); out.bottom = pick(bottoms); }
  const wantOuter = band ? band === 'cold' || band === 'cool' || rain >= 50 : Math.random() < 0.5; // layers when it's chilly or wet
  for (const s of ['outer', 'shoes', 'bag']) {
    if (s === 'outer' && !wantOuter && band) continue;
    const p = pick(pool(s));
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
const detailsIn = (text) => { const s = String(text || '').toLowerCase().replace(/long sleeve/g, 'long-sleeve').replace(/wide leg/g, 'wide-leg'); return DETAILS.filter((d) => s.includes(d)); };

/** The kinds of garment named, where "denim" only means jeans when nothing else is named (a denim skirt is a skirt). */
const garmentKinds = (text) => { const k = kindsIn(text); return k.length > 1 && k.includes('jeans') && !/\bjeans?\b/i.test(text) ? k.filter((x) => x !== 'jeans') : k; };

/** 0-100: how well a closet piece stands in for one in a pin. The same colour and the same kind of garment are both needed; shared details count a little. */
export function recipeScore(item, piece) {
  const want = (piece.colors || []).map(hexOfName).filter(Boolean);
  const color = want.length && item.color ? Math.max(...want.map((h) => Math.max(0, 100 - hexDist(item.color.hex, h) * 2.2))) : 40;
  const pk = garmentKinds(`${piece.name} ${piece.detail || ''}`), ik = garmentKinds(item.name);
  const kind = pk.length && ik.length ? (ik.some((k) => pk.includes(k)) ? 1 : 0.5) : item.type === piece.type ? 0.85 : 0.7;
  const pd = detailsIn(`${piece.name} ${piece.detail || ''}`), id = new Set(detailsIn(`${item.name} ${item.detail || ''}`));
  const detail = pd.length ? 0.85 + 0.15 * pd.filter((d) => id.has(d)).length / pd.length : 1;
  const len = (set) => ['mini', 'midi', 'maxi'].find((l) => set.includes(l)), pl = len(pd), il = len([...id]);
  const length = pl && il && pl !== il && (pl === 'mini' || il === 'mini') ? 0.75 : 1; // a mini skirt is no stand-in for a long one
  return Math.round(color * kind * detail * length);
}

const CORE = ['top', 'dress', 'bottom'];
const NEUTRAL_SHOES = /black|white|nude|tan|beige|cream|brown|camel|taupe/i;
const wet = (item) => /suede|satin|silk|sandal|strappy|slide|flip|espadrille|canvas|mule/i.test(item.name);

/**
 * Today's looks, each one an outfit from a pin on her Pinterest boards made from her own wardrobe: { look, pin, score }[].
 * A pin only becomes a look when every main piece (top and bottom, or dress) has a close stand-in; weather, the occasion and her loves/passes weigh in.
 */
export function pinLooks(items, pins, { occasion = '', wearCounts = {}, band, rain = 0, prefs = {}, recent = new Set(), n = 3, random = Math.random } = {}) {
  const boost = prefBoost(prefs);
  const fits = (item, slot) => {
    let f = suitsWeather(item, band) ? 1 : CORE.includes(slot) || slot === 'outer' ? 0.6 : 0.85;
    if (rain >= 50 && (slot === 'shoes' || slot === 'outer') && wet(item)) f *= 0.6; // no suede or sandals in the rain
    if (occasion && !item.occasions?.includes(occasion)) f *= 0.8;
    return f * Math.min(1.25, boost[item.id] ?? 1) * (recent.has(item.id) ? 0.75 : 1) * (item.source === 'starter' ? 1 : 1.08) / (1 + 0.03 * (wearCounts[item.id] || 0));
  };
  const best = (piece, slot, taken) => items.filter((i) => slotOf(i.type) === slot && !taken.has(i.id))
    .map((item) => { const s = recipeScore(item, piece); return { item, s, r: s * fits(item, slot) }; }).sort((a, b) => b.r - a.r)[0];

  const options = [];
  for (const pin of pins) {
    const look = {}, scores = {}, taken = new Set();
    for (const piece of pin.pieces) {
      const slot = slotOf(piece.type);
      if (slot === 'outer' && (band === 'hot' || band === 'warm')) continue; // the pin's jacket stays home on a hot day
      if (look[slot] || (slot === 'dress' && (look.top || look.bottom)) || ((slot === 'top' || slot === 'bottom') && look.dress)) continue;
      const b = best(piece, slot, taken); if (!b) continue;
      if (!CORE.includes(slot) && b.s < 55) continue; // no close stand-in for the shoes or the bag: leave it to the fallback below
      look[slot] = b.item; scores[slot] = b.r; taken.add(b.item.id);
    }
    const core = CORE.filter((s) => look[s]);
    if (!(look.dress || (look.top && look.bottom))) continue;
    const coreMin = Math.min(...core.map((s) => scores[s]));
    if (coreMin < 62) continue; // a main piece isn't close enough to read as this pin
    options.push({ look, pin, scores, score: coreMin * 0.7 + (Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length) * 0.3 });
  }
  options.sort((a, b) => b.score - a.score);

  // pick from the best ones with a little chance, so each day differs; never the same main piece twice in one day
  const picked = [], used = new Set();
  let pool = options.slice();
  while (picked.length < n && pool.length) {
    const top = pool.slice(0, 8), w = top.map((o, i) => Math.pow(o.score / 100, 4) / (1 + i * 0.15));
    let r = random() * w.reduce((a, b) => a + b, 0), k = w.findIndex((x) => (r -= x) < 0); if (k < 0) k = 0;
    const o = top[k];
    pool = pool.filter((x) => x !== o && !CORE.some((s) => x.look[s] && o.look[s] && x.look[s].id === o.look[s].id) && x.pin.id !== o.pin.id);
    if (CORE.some((s) => o.look[s] && used.has(o.look[s].id))) continue;
    CORE.forEach((s) => o.look[s] && used.add(o.look[s].id));
    picked.push(o);
  }

  // finish each look: shoes if the pin had none to match, a layer when it's cold or wet
  const added = new Set(); // (a different pair of shoes or coat for each look, where there's a choice)
  for (const o of picked) {
    const look = o.look, base = Object.values(look);
    const pal = base.filter((i) => i.color).map((i) => i.color.hex);
    const nearest = (slot, extra = () => true) => items.filter((i) => slotOf(i.type) === slot && extra(i))
      .map((i) => ({ i, r: (pal.length && i.color ? Math.max(...pal.map((h) => 100 - hexDist(i.color.hex, h))) : 50) * fits(i, slot) * (added.has(i.id) ? 0.7 : 1) })).sort((a, b) => b.r - a.r)[0]?.i;
    if (!look.shoes) { const s = nearest('shoes', (i) => NEUTRAL_SHOES.test(i.name)) || nearest('shoes'); if (s) { look.shoes = s; added.add(s.id); } }
    if (!look.outer && (band === 'cold' || (band === 'cool' && rain >= 50))) { // a coat only when it's really needed; she can add or drop one
      const coat = nearest('outer', (i) => (rain >= 50 ? /trench|rain|coat|jacket/i : /coat|jacket|blazer|cardigan|trench/i).test(i.name) && (band === 'cold' || !/puffer|parka/i.test(i.name)) && suitsWeather(i, band));
      if (coat) { look.outer = coat; added.add(coat.id); }
    }
  }
  return picked;
}
