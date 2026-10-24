// The "stylist": colour-aware outfit matching against Pinterest-style inspo, plus a random OOTD picker.
import { hexDist, palette } from './color.js';
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
      return { item, color, score: color + occ + fresh };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * @param {object[]} items closet
 * @param {{hex:string}[]} pal inspo palette
 * @param {string[]} wanted slots seen in the inspo (dress|top|bottom|outer|shoes|bag)
 * @returns {{picks: Record<string,{item,color}>, gaps: {slot,hex}[]}}
 */
export function matchInspo(items, pal, { wanted, occasion, wearCounts = {} }) {
  const slots = wanted.includes('dress') ? wanted.filter((s) => s !== 'top' && s !== 'bottom') : wanted;
  const picks = {}, gaps = [];
  for (const slot of slots) {
    const best = rank(items, slot, pal, occasion, wearCounts)[0];
    if (best && best.color >= 35) picks[slot] = best;
    else gaps.push({ slot, hex: pal[Math.min(gaps.length + 1, pal.length - 1)]?.hex || pal[0].hex, closest: best });
  }
  return { picks, gaps };
}

/** "Style me": a random, balanced outfit for an occasion that favours pieces you rarely wear. */
export function styleMe(items, occasion, wearCounts = {}) {
  const pool = (slot) => items.filter((i) => slotOf(i.type) === slot && (!occasion || i.occasions?.includes(occasion)));
  const pick = (arr) => {
    if (!arr.length) return null;
    const w = arr.map((i) => 1 / (1 + (wearCounts[i.id] || 0)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    return arr[w.findIndex((x) => (r -= x) < 0)] || arr[0];
  };
  const out = {};
  const dresses = pool('dress'), tops = pool('top'), bottoms = pool('bottom');
  const useDress = dresses.length && (!(tops.length && bottoms.length) || Math.random() < 0.35);
  if (useDress) out.dress = pick(dresses);
  else { out.top = pick(tops); out.bottom = pick(bottoms); }
  for (const s of ['outer', 'shoes', 'bag']) { const p = pick(pool(s)); if (p && (s === 'shoes' || Math.random() < 0.5)) out[s] = p; }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

export const suggestionLabel = (slot, hexName) => `${hexName} ${TYPES[Object.keys(TYPES).find((t) => TYPES[t].slot === slot)].label.toLowerCase()}`;
export { palette };
