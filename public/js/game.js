// The little game around your real closet: a daily theme, an explainable outfit rating, coins, energy and mood.
// Pure functions (no DOM) so the rules are easy to test and to read. Everything is worked out from the tags you gave your pieces.
import { OCCASIONS, OCCASION_EMOJI, slotOf } from './data.js';
import { outfitMeters } from './meters.js';
import { suitsWeather } from './stylist.js';
import { BANDS } from './weather.js';

export const PHASES = { morning: ['🌅', 'Morning'], challenge: ['🎯', 'Challenge'], evening: ['🌙', 'Evening'], done: ['😴', 'Asleep'] };
const STAR_AT = [90, 75, 58, 40]; // score needed for 5, 4, 3, 2 stars (below that: 1)

/** The theme for a day, from (in order) an event you added, a mood you picked, today's weather, or luck. */
export function pickTheme({ date, events = [], mood = '', band = '', rand = Math.random }) {
  const ev = events.find((e) => e.date === date);
  if (ev) return { source: 'event', occasion: OCCASIONS.includes(ev.occasion) ? ev.occasion : '', title: ev.title || ev.occasion, emoji: OCCASION_EMOJI[ev.occasion] || '📌', band };
  if (mood && OCCASIONS.includes(mood)) return { source: 'mood', occasion: mood, title: mood, emoji: OCCASION_EMOJI[mood], band };
  if (band && ['cold', 'hot'].includes(band)) return { source: 'weather', occasion: '', title: band === 'cold' ? 'Bundle up' : 'Stay cool', emoji: band === 'cold' ? '🧣' : '🕶️', band };
  const occasion = OCCASIONS[Math.floor(rand() * OCCASIONS.length)];
  return { source: 'random', occasion, title: occasion, emoji: OCCASION_EMOJI[occasion], band };
}
export const themeLine = (t) => `${t.emoji} ${t.title}`;
export const SOURCE_NOTE = { event: 'from your plan', mood: 'from the mood you picked', weather: 'for today’s weather', random: 'a surprise' };

/**
 * Rate an outfit out of 100, with the reasons. worn: { slot: item }. Returns { score, stars, parts: [{ key, label, got, max, note }], tip }.
 * Every part comes from tags you set: occasion, season ("warmth"), colours, and how often you've worn the piece.
 */
export function rateOutfit({ worn, theme, band = '', counts = {} }) {
  const list = Object.values(worn);
  if (!list.length) return null;
  const meters = outfitMeters(worn, '', counts);
  const parts = [];
  // 1. theme (35)
  if (theme.occasion) {
    const hit = list.filter((i) => i.occasions?.includes(theme.occasion)).length;
    parts.push({ key: 'theme', label: `Fits “${theme.title}”`, max: 35, got: Math.round((35 * hit) / list.length), note: `${hit} of ${list.length} piece${list.length === 1 ? ' is' : 's are'} tagged ${theme.occasion}` });
  }
  // 2. weather (20, or 55 when the theme is the weather itself)
  const wMax = theme.occasion ? 20 : 55;
  if (band) {
    const ok = list.filter((i) => suitsWeather(i, band)).length;
    parts.push({ key: 'weather', label: 'Right for the weather', max: wMax, got: Math.round((wMax * ok) / list.length), note: `${ok} of ${list.length} suit a ${BANDS[band]?.label?.toLowerCase() || band} day` });
  } else parts.push({ key: 'weather', label: 'Right for the weather', max: wMax, got: Math.round(wMax * 0.6), note: 'set your city in Plan to be scored on the weather' });
  // 3. colours (25)
  parts.push({ key: 'colour', label: 'Colours work together', max: 25, got: Math.round((25 * meters.harmony) / 100), note: meters.harmony >= 90 ? 'neutrals and close or opposite colours' : meters.harmony >= 60 ? 'a bit of a clash' : 'quite a few competing colours' });
  // 4. complete (10)
  const slots = new Set(Object.keys(worn)), core = slots.has('dress') || (slots.has('top') && slots.has('bottom'));
  parts.push({ key: 'complete', label: 'A complete outfit', max: 10, got: (core ? 7 : slots.size > 1 ? 3 : 0) + (slots.has('shoes') ? 3 : 0), note: core ? (slots.has('shoes') ? 'top, bottom and shoes' : 'add shoes for the last 3') : 'add a top and bottom, or a dress' });
  // 5. fresh (10)
  parts.push({ key: 'fresh', label: 'Fresh pieces', max: 10, got: Math.round((10 * meters.fresh) / 100), note: meters.fresh >= 80 ? 'rarely worn' : 'some pieces are on repeat' });
  const maxTotal = parts.reduce((s, p) => s + p.max, 0), score = Math.round((100 * parts.reduce((s, p) => s + p.got, 0)) / maxTotal);
  const stars = score >= STAR_AT[0] ? 5 : score >= STAR_AT[1] ? 4 : score >= STAR_AT[2] ? 3 : score >= STAR_AT[3] ? 2 : 1;
  const worst = [...parts].sort((a, b) => a.got / a.max - b.got / b.max)[0];
  return { score, stars, parts, tip: stars === 5 ? 'Perfect. Nothing to change.' : `Biggest win: ${worst.label.toLowerCase()} (${worst.note}).` };
}

/** Coins for a rating: a base, more for stars, a little for a streak; tiredness trims it. */
export function coinsFor({ stars, streak = 0, energy = 100 }) {
  const raw = 10 + stars * 8 + Math.min(streak, 7) * 2;
  return Math.round(raw * (energy < 30 ? 0.7 : 1));
}

/* ───────── the saved state ───────── */
export const freshDay = (date, theme) => ({ date, phase: 'challenge', theme, energy: 100, mood: 50, tries: 0, paid: 0, stars: 0, score: 0, ended: false });
export function initial() { return { coins: 0, day: null, history: [] }; }

/** Make sure the saved game is on today's date. A new date starts a new day with a new theme; coins and history carry over. */
export function rollOver(game, date, makeTheme) {
  if (game.day?.date === date) return game;
  return { ...game, day: freshDay(date, makeTheme()) };
}

/** Rate the outfit for the day's challenge and pay the coins (only the difference if you improve on an earlier rating today). */
export function applyRating(game, rating, { streak = 0 } = {}) {
  const d = game.day, coins = coinsFor({ stars: rating.stars, streak, energy: d.energy }), pay = Math.max(0, coins - d.paid);
  const day = { ...d, stars: Math.max(d.stars, rating.stars), score: Math.max(d.score, rating.score), paid: Math.max(d.paid, coins), mood: Math.min(100, rating.stars * 20), phase: d.ended ? 'done' : 'evening' };
  return { game: { ...game, coins: game.coins + pay, day }, paid: pay };
}

/** Changing the outfit costs a little energy; Style me costs more. */
export const spendEnergy = (game, n) => (game.day ? { ...game, day: { ...game.day, energy: Math.max(0, game.day.energy - n), tries: game.day.tries + 1 } } : game);

/** Going to bed: the day is done; one more streak day is logged by the caller. */
export function endDay(game) {
  const d = game.day;
  return { ...game, day: { ...d, ended: true, phase: 'done' }, history: [...game.history.filter((h) => h.date !== d.date), { date: d.date, theme: d.theme.title, stars: d.stars }].slice(-60) };
}

/** Where the guide arrow should point. */
export function guideFor({ game, hasOutfit }) {
  const d = game.day; if (!d) return null;
  if (d.phase === 'done') return null;
  if (d.phase === 'evening') return 'bed';
  return hasOutfit ? 'mirror' : 'wardrobe';
}
export { slotOf };
