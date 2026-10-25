// Week planning and packing lists. Pure functions over the closet.
import { styleMe, suitsWeather } from './stylist.js';
import { slotOf } from './data.js';
import { toLab, unhex } from './color.js';

/**
 * One outfit per forecast day, weather-appropriate, steering away from pieces already used earlier in the week.
 * @param {object[]} items @param {{date:string, band:string, rain:number}[]} days @returns {{date:string, outfit:Record<string,object>}[]}
 */
export function planWeek(items, days, wearCounts = {}, mood = '') {
  const used = new Set();
  return days.map((d) => {
    let outfit = styleMe(items, mood, wearCounts, { band: d.band, rain: d.rain, avoid: used });
    if (!Object.keys(outfit).length && mood) outfit = styleMe(items, '', wearCounts, { band: d.band, rain: d.rain, avoid: used }); // nothing tagged for that mood: relax
    Object.values(outfit).forEach((i) => used.add(i.id));
    return { date: d.date, outfit };
  });
}

const chroma = (hex) => { const [, a, b] = toLab(unhex(hex || '#808080')); return Math.hypot(a, b); };
const hue = (hex) => { const [, a, b] = toLab(unhex(hex || '#808080')); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };

/** Choose pieces for a trip: neutrals first (they mix with everything), a spread of colours, right layers for the weather. */
export function packingList(items, { days = 3, moods = [], band = 'mild', rain = 0 } = {}) {
  const ok = (i) => (!moods.length || i.occasions?.some((o) => moods.includes(o))) && suitsWeather(i, band);
  const by = (slot) => items.filter((i) => slotOf(i.type) === slot && ok(i));
  const want = {
    top: Math.max(2, Math.ceil(days * 0.7)), bottom: Math.max(1, Math.ceil(days / 3)),
    dress: days >= 3 ? 1 : 0, outer: band === 'cold' || band === 'cool' || rain >= 50 ? 1 : 0,
    shoes: Math.min(3, Math.max(1, Math.ceil(days / 4))), bag: 1,
  };
  // pick neutrals first, then colours whose hues are far apart from what's already chosen
  const choose = (pool, n) => {
    const picked = [];
    const neutral = pool.filter((i) => chroma(i.color?.hex) < 20), colour = pool.filter((i) => chroma(i.color?.hex) >= 20);
    for (const i of neutral) if (picked.length < Math.ceil(n * 0.6)) picked.push(i);
    const gap = (i) => Math.min(...picked.filter((p) => chroma(p.color?.hex) >= 20).map((p) => { const d = Math.abs(hue(i.color?.hex) - hue(p.color?.hex)); return Math.min(d, 360 - d); }), 180);
    while (picked.length < n && colour.length) { colour.sort((a, b) => gap(b) - gap(a)); picked.push(colour.shift()); }
    for (const i of pool) if (picked.length < n && !picked.includes(i)) picked.push(i);
    return picked.slice(0, n);
  };
  const list = { top: choose(by('top'), want.top), bottom: choose(by('bottom'), want.bottom), dress: choose(by('dress'), want.dress), outer: choose(by('outer'), want.outer), shoes: choose(by('shoes'), want.shoes), bag: choose(by('bag'), want.bag) };
  const missing = Object.entries(want).filter(([k, n]) => list[k].length < n).map(([k, n]) => ({ slot: k, wanted: n, found: list[k].length }));
  return { list, want, missing, outfits: list.top.length * list.bottom.length + list.dress.length };
}
