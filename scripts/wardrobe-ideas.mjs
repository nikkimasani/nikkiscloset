#!/usr/bin/env node
// Wardrobe ideas from Pinterest: reads the boards in wardrobe/boards.txt, and for each pin asks the AI (Gemma 4 on Cloudflare, about 12
// neurons a pin) which pieces are in it. Writes wardrobe/ideas.json (every pin with its pieces) and wardrobe/ideas.txt (the pieces,
// grouped by kind and counted, for choosing the catalog). The pins' pictures are only looked at, never used as pieces.
//
//   CF_ACCOUNT_ID=... CF_API_TOKEN=... node scripts/wardrobe-ideas.mjs          pins already looked at are skipped
//
// Boards are read from Pinterest's public widget feed (up to 50 pins a board) with the board's RSS feed as a fallback, so boards must
// be public. Run by .github/workflows/wardrobe-ideas.yml.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { handleStarter } from '../lib/ai.js';

const OUT = 'wardrobe/ideas.json', UA = { 'user-agent': 'Mozilla/5.0 (compatible; nikkis-closet-wardrobe-ideas)' };
const links = readFileSync('wardrobe/boards.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const ideas = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { boards: {}, pins: {} };
const env = { ...process.env, APP_PASSCODE: 'local-' + Math.random().toString(36).slice(2) };

/** A board link (pin.it short link or pinterest.com address) as { user, board }, following redirects. */
async function boardOf(link) {
  let url = link;
  if (/pin\.it\//.test(link)) { const r = await fetch(link, { headers: UA, redirect: 'follow' }); url = r.url; }
  const m = new URL(url).pathname.match(/^\/([^/]+)\/([^/]+)\/?/);
  if (!m || ['pin', 'search', 'ideas'].includes(m[1])) throw new Error(`not a board: ${url}`);
  return { user: m[1], board: m[2], url };
}
/** The board's pins: [{ id, image, text }]. */
async function pinsOf({ user, board }) {
  const out = new Map();
  try {
    const r = await fetch(`https://widgets.pinterest.com/v3/pidgets/boards/${user}/${board}/pins/`, { headers: UA });
    const j = await r.json();
    for (const p of j?.data?.pins || []) {
      const img = p.images?.['564x']?.url || p.images?.['474x']?.url || p.images?.['237x']?.url?.replace('/237x/', '/564x/');
      if (img) out.set(String(p.id), { id: String(p.id), image: img, text: p.description || '' });
    }
  } catch (e) { console.log(`widget feed failed for ${user}/${board}: ${e.message}`); }
  if (!out.size) { // RSS: about the latest 25
    const xml = await (await fetch(`https://www.pinterest.com/${user}/${board}.rss`, { headers: UA })).text();
    for (const it of xml.split('<item>').slice(1)) {
      const link = it.match(/<link>([^<]+)<\/link>/)?.[1] || '', id = link.match(/\/pin\/(\d+)/)?.[1], img = it.match(/src="([^"]+\.(?:jpg|jpeg|png|webp))"/)?.[1];
      if (id && img) out.set(id, { id, image: img.replace(/\/(236|237)x\//, '/564x/'), text: (it.match(/<title>([^<]*)<\/title>/)?.[1] || '') });
    }
  }
  return [...out.values()];
}
const describe = async (image) => {
  const res = await handleStarter(new Request('http://local/api/starter', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': env.APP_PASSCODE }, body: JSON.stringify({ describe: true, kinds: 'all', image }) }), env);
  const j = await res.json(); if (!res.ok) throw Object.assign(new Error(j.error || `failed (${res.status})`), { limit: res.status === 429 }); return j.pieces || [];
};

let looked = 0, stopped = '';
outer: for (const link of links) {
  let b; try { b = await boardOf(link); } catch (e) { console.log(`✗ ${link}: ${e.message}`); continue; }
  const pins = await pinsOf(b); ideas.boards[link] = { ...b, pins: pins.length }; console.log(`${b.user}/${b.board}: ${pins.length} pins`);
  for (const p of pins) {
    if (ideas.pins[p.id]?.pieces) continue;
    try {
      const r = await fetch(p.image, { headers: UA }); if (!r.ok) throw new Error(`picture ${r.status}`);
      const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0], buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 500000) throw new Error('picture too large');
      const pieces = await describe(`data:${type};base64,${buf.toString('base64')}`);
      ideas.pins[p.id] = { board: `${b.user}/${b.board}`, image: p.image, text: p.text, pieces }; looked++;
      console.log(`  ${p.id}: ${pieces.map((x) => x.name).join(' · ') || '(none)'}`);
    } catch (e) { if (e.limit) { stopped = e.message; break outer; } console.log(`  ✗ ${p.id}: ${e.message}`); ideas.pins[p.id] = { board: `${b.user}/${b.board}`, image: p.image, text: p.text, error: e.message }; }
    writeFileSync(OUT, JSON.stringify(ideas, null, 1) + '\n');
  }
}
writeFileSync(OUT, JSON.stringify(ideas, null, 1) + '\n');
// the pieces, grouped by kind, with how many pins each shows up in
const by = {};
for (const p of Object.values(ideas.pins)) for (const x of p.pieces || []) { const k = `${x.type}|${x.name.toLowerCase()}`; (by[k] ||= { ...x, n: 0 }).n++; }
const lines = []; for (const t of [...new Set(Object.values(by).map((x) => x.type))].sort()) {
  const list = Object.values(by).filter((x) => x.type === t).sort((a, b) => b.n - a.n);
  lines.push(`## ${t} (${list.length})`, ...list.map((x) => `${x.n}× ${x.name} — ${x.detail}`), '');
}
mkdirSync('wardrobe', { recursive: true });
writeFileSync('wardrobe/ideas.txt', `${Object.keys(ideas.pins).length} pins looked at (${looked} this run)${stopped ? ` · stopped: ${stopped}` : ''}\n\n` + lines.join('\n'));
console.log(`${looked} pins looked at this run${stopped ? `; stopped: ${stopped}` : ''}`);
