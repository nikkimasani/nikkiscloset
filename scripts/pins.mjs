#!/usr/bin/env node
// The outfits in Nikki's Pinterest pins, as recipes for the Today tab: reads wardrobe/ideas.json (from scripts/wardrobe-ideas.mjs, kept on
// the wardrobe-ideas branch) and writes public/js/pins.js with each pin's wearable pieces (no pictures: those stay on Pinterest).
//
//   git show origin/wardrobe-ideas:wardrobe/ideas.json > /tmp/ideas.json && node scripts/pins.mjs /tmp/ideas.json
import { readFileSync, writeFileSync } from 'node:fs';
import { slotOf } from '../public/js/data.js';

const WEAR = new Set(['outer', 'top', 'dress', 'bottom', 'shoes', 'bag']);
const pins = JSON.parse(readFileSync(process.argv[2] || 'wardrobe/ideas.json', 'utf8')).pins;
const out = [], seen = new Set();
for (const [id, p] of Object.entries(pins)) {
  const pieces = (p.pieces || []).filter((x) => WEAR.has(slotOf(x.type))).map(({ name, type, colors, detail }) => ({ name, type, colors, detail }));
  const slots = pieces.map((x) => slotOf(x.type));
  if (!(slots.includes('dress') || (slots.includes('top') && slots.includes('bottom')))) continue; // not a whole outfit (a close-up of one piece)
  const key = pieces.map((x) => x.name.toLowerCase()).sort().join('|');
  if (seen.has(key)) continue; // the same pin saved twice
  seen.add(key);
  out.push({ id, board: p.board.split('/')[1], pieces });
}
writeFileSync('public/js/pins.js', `// Outfits from Nikki's Pinterest boards (made by scripts/pins.mjs from wardrobe/ideas.json; edit that, not this).\nexport const PINS = ${JSON.stringify(out)};\n`);
console.log(`${out.length} outfits from ${Object.keys(pins).length} pins`);
