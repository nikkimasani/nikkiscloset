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
