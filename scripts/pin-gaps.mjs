#!/usr/bin/env node
// The pieces in Nikki's pins that the wardrobe has nothing close to (a pink blazer, clear heels...), written as catalogue rows to
// public/starter/pin-pieces.js so the nightly run makes them and Today's looks can follow the pins more closely.
//
//   node scripts/pin-gaps.mjs            (after pins.js or the catalogue changes; rows already there stay, so ids don't move)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { PINS } from '../public/js/pins.js';
import { recipeScore } from '../public/js/stylist.js';
import { hexOfName } from '../public/js/color.js';
import { slotOf } from '../public/js/data.js';

const OUT = new URL('../public/starter/pin-pieces.js', import.meta.url);
const kept = existsSync(OUT) ? (await import(OUT.href)).PIN_ROWS : {};
const { ITEMS } = await import('../public/starter/items.js'); // (the catalogue as it is, these rows included)
const items = ITEMS.map((i) => ({ ...i, color: { hex: hexOfName(i.colors[0]) || '#888888', name: i.colors[0] } }));
const BATCH = { tops: 'tops', tanks: 'tops', bodysuits: 'tops', bottoms: 'bottoms', skirts: 'bottoms', dresses: 'dresses', outerwear: 'outerwear', shoes: 'shoes', bags: 'bags' };
const OCC = { statement: 'CDB', outfits: 'CB', 'stylish-corporate-outfit': 'W' };
const season = (t) => (/sweater|knit|wool|coat|boots|turtleneck|cardigan/.test(t) ? 'warm' : /sandal|linen|shorts|tank|cami|sleeveless|strapless/.test(t) ? 'light' : 'all');
const key = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // (the id is made from this: "Clear strap heels" and "Clear-strap heels" are one piece)
const rows = structuredClone(kept), names = new Set(ITEMS.map((i) => key(i.name))), firstNames = new Set();
let added = 0;
for (const pin of PINS) for (const piece of pin.pieces) {
  const batch = BATCH[piece.type]; if (!batch) continue;
  const best = Math.max(0, ...items.filter((i) => slotOf(i.type) === slotOf(piece.type)).map((i) => recipeScore(i, piece)));
  if (best >= 70) continue; // (something close enough already)
  const name = piece.name.replace(/\s+/g, ' ').trim();
  if (names.has(key(name))) { firstNames.add(key(name)); continue; } // (the catalogue has one by that name, in another shade or left out on review: it comes first)
  names.add(key(name));
  const text = `${piece.name} ${piece.detail || ''}`.toLowerCase();
  (rows[batch] ||= []).push([name, piece.type, (piece.colors || []).join(','), season(text), OCC[pin.board] || 'C', piece.detail || '']);
  added++;
}
// pieces already in the catalogue that a pin needs and the wardrobe doesn't have yet (not made, or left out on review) come first too
const made = JSON.parse(readFileSync(new URL('../public/starter/made/index.json', import.meta.url), 'utf8')).pieces;
const first = new Set([...((await import(OUT.href)).PIN_FIRST || []), ...ITEMS.filter((i) => firstNames.has(key(i.name)) && !made[i.id]).map((i) => i.id)]);
for (const pin of PINS) for (const piece of pin.pieces) {
  const cand = items.filter((i) => slotOf(i.type) === slotOf(piece.type)).map((i) => ({ i, s: recipeScore(i, piece) })).sort((a, b) => b.s - a.s)[0];
  if (cand && cand.s >= 70 && !Object.keys(made).some((id) => slotOf(ITEMS.find((x) => x.id === id)?.type || 'tops') === slotOf(piece.type) && recipeScore(items.find((x) => x.id === id) || cand.i, piece) >= 70)) first.add(cand.i.id);
}
writeFileSync(OUT, `// Pieces from Nikki's Pinterest pins that the wardrobe had nothing close to (made by scripts/pin-gaps.mjs; the nightly run makes them first).\n// Each row: [name, type, colours, warmth, occasions, extra detail for the prompt], as in items.js.\nexport const PIN_ROWS = ${JSON.stringify(rows, null, 1)};\n// Catalogue pieces a pin needs that the wardrobe doesn't have yet: made first each night, and remade even if they were left out before.\nexport const PIN_FIRST = ${JSON.stringify([...first].sort(), null, 1)};\n`);
console.log(`${added} new pin pieces; ${Object.values(rows).flat().length} in all`);
