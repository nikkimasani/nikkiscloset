// Closet insights: value, cost per wear, what to wear more / declutter, outfit streaks and wardrobe gaps. Pure functions.
import { TYPES, OCCASIONS, slotOf } from './data.js';

const DAY = 86_400_000;
export const parseDay = (iso) => new Date(iso + 'T12:00:00').getTime();

export const wearCountMap = (wears) => wears.reduce((m, w) => (w.itemIds.forEach((id) => (m[id] = (m[id] || 0) + 1)), m), {});
export function lastWornMap(wears) {
  const m = {};
  for (const w of wears) for (const id of w.itemIds) if (!m[id] || w.date > m[id]) m[id] = w.date;
  return m;
}

/** Price divided by times worn (null when there's no price, or it hasn't been worn yet). */
export const costPerWear = (item, counts) => (item.price > 0 && counts[item.id] ? item.price / counts[item.id] : null);

/** @param {object[]} items @param {object[]} wears @param {string} today ISO date */
export function closetInsights(items, wears, today) {
  const counts = wearCountMap(wears), last = lastWornMap(wears), now = parseDay(today);
  const priced = items.filter((i) => i.price > 0);
  const worn = priced.filter((i) => counts[i.id]);
  const cpw = (i) => costPerWear(i, counts);
  const daysSince = (i) => (last[i.id] ? Math.round((now - parseDay(last[i.id])) / DAY) : null);
  const age = (i) => Math.round((now - (i.bought ? parseDay(i.bought) : i.createdAt || now)) / DAY);
  return {
    pieces: items.length,
    value: priced.reduce((s, i) => s + i.price, 0),
    pricedCount: priced.length,
    avgCostPerWear: worn.length ? worn.reduce((s, i) => s + cpw(i), 0) / worn.length : null,
    bestValue: [...worn].sort((a, b) => cpw(a) - cpw(b)).slice(0, 3).map((i) => ({ item: i, cpw: cpw(i), wears: counts[i.id] })),
    // worth wearing more: you paid a lot and it's still expensive per wear
    wearMore: priced.filter((i) => (counts[i.id] || 0) < 3 && i.price >= 40).sort((a, b) => b.price - a.price).slice(0, 3),
    // declutter candidates: not worn in 90 days (or never, and owned for 30+ days)
    dormant: items.filter((i) => (daysSince(i) === null ? age(i) >= 30 : daysSince(i) >= 90) && i.type !== 'accessories')
      .map((i) => ({ item: i, days: daysSince(i), never: daysSince(i) === null })).sort((a, b) => (b.days ?? 1e6) - (a.days ?? 1e6)).slice(0, 6),
    neverWorn: items.filter((i) => !counts[i.id]).length,
  };
}

/** Consecutive days with a logged outfit, ending today (or yesterday, so an unlogged morning doesn't zero your streak). */
export function streak(wears, today) {
  const days = new Set(wears.map((w) => w.date));
  const prev = (iso) => { const d = new Date(parseDay(iso) - DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let d = days.has(today) ? today : prev(today), n = 0;
  while (days.has(d)) { n++; d = prev(d); }
  return n;
}

const GROUPS = { top: 'tops', bottom: 'bottoms', dress: 'dresses', outer: 'outerwear', shoes: 'shoes' };
/** For each occasion: how many tops/bottoms/dresses/outerwear/shoes you own for it, plus what's missing to build a full outfit. */
export function gapAnalysis(items) {
  return OCCASIONS.map((occasion) => {
    const have = { tops: 0, bottoms: 0, dresses: 0, outerwear: 0, shoes: 0 };
    for (const i of items) if (i.occasions?.includes(occasion) && GROUPS[slotOf(i.type)]) have[GROUPS[slotOf(i.type)]]++;
    const missing = [];
    if (!have.dresses && !(have.tops && have.bottoms)) { if (!have.tops) missing.push('a top'); if (!have.bottoms) missing.push('a bottom'); }
    if (!have.shoes) missing.push('shoes');
    const total = Object.values(have).reduce((a, b) => a + b, 0);
    return { occasion, have, missing, total, outfits: have.dresses + have.tops * have.bottoms };
  });
}

export const typeLabel = (t) => TYPES[t]?.label || t;
