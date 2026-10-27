#!/usr/bin/env node
// Generate starter-closet product photos, one batch (category) at a time, and write a review page.
// Engine: Cloudflare Workers AI, FLUX.1 schnell at 4 steps (free tier: 10,000 neurons a day, about 58 a picture). fal is an optional fallback.
// The list and the shared prompt live in public/starter/items.js; add a row there to add a piece.
//
//   node scripts/starter.mjs --batch tops --dry                       prompts and the neuron estimate, nothing is generated
//   CF_ACCOUNT_ID=... CF_API_TOKEN=... node scripts/starter.mjs --batch tops
//   node scripts/starter.mjs --batch tops --via https://nikkiscloset.vercel.app --pass <passcode>   through the app's server and its keys
//   ... --only starter-black-fitted-tee,starter-gold-watch            make just these again (others already made are skipped)
//   ... --engine fal   (needs FAL_KEY)      ... --no-wait   stop at the daily limit instead of waiting for 00:00 UTC
//
// Pictures land in starter-out/<batch>/<id>.jpg with review.html next to them; pieces already there are skipped, so a run stopped by the
// daily limit carries on where it left off. Neurons used per UTC day are kept in starter-out/usage.json.
// To put the pieces in the closet, use the app: Closet > Starter closet makes the same pictures and adds a batch once you approve it.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ITEMS, BATCHES, promptFor, sizeFor } from '../public/starter/items.js';

const NEURONS_EACH = 57.6, BUDGET = 9800, CF_MODEL = '@cf/black-forest-labs/flux-1-schnell', FAL_MODEL = process.env.FAL_STARTER_MODEL || 'fal-ai/flux-pro/v1.1';
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i < 0 ? undefined : !process.argv[i + 1] || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]; };
const batch = arg('batch'), only = typeof arg('only') === 'string' ? arg('only').split(',') : null, via = arg('via'), pass = arg('pass'), engine = arg('engine') === 'fal' ? 'fal' : 'cloudflare';
if (!BATCHES.some(([k]) => k === batch)) { console.error(`--batch must be one of: ${BATCHES.map(([k]) => k).join(', ')}`); process.exit(1); }
const dir = join('starter-out', batch), usageFile = join('starter-out', 'usage.json'); mkdirSync(dir, { recursive: true });
const file = (it) => join(dir, it.id + '.jpg');
const list = ITEMS.filter((i) => i.batch === batch && (only ? only.includes(i.id) : !existsSync(file(i))));

const day = () => new Date().toISOString().slice(0, 10);
const usage = () => { try { const u = JSON.parse(readFileSync(usageFile, 'utf8')); return u.day === day() ? u.neurons : 0; } catch { return 0; } };
const addUsage = (n) => writeFileSync(usageFile, JSON.stringify({ day: day(), neurons: Math.round((usage() + n) * 10) / 10 }));
const nextReset = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
console.log(`${list.length} ${batch} to make · ${engine === 'fal' ? FAL_MODEL : `${CF_MODEL}, 4 steps · ~${Math.round(list.length * NEURONS_EACH)} neurons (used today: ${Math.round(usage())} of 10,000)`}`);
if (arg('dry')) { for (const it of list) console.log(`\n${it.id}\n  ${promptFor(it)}`); process.exit(0); }
if (!via && (engine === 'fal' ? !process.env.FAL_KEY : !(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN))) { console.error(`Set ${engine === 'fal' ? 'FAL_KEY' : 'CF_ACCOUNT_ID and CF_API_TOKEN'}, or use --via <app url> --pass <passcode>.`); process.exit(1); }

class Limit extends Error {}
async function one(it) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  if (via) {
    const r = await fetch(new URL('/api/starter', via), { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': String(pass || '') }, body: JSON.stringify({ id: it.id, seed, ...(engine === 'fal' && { engine }) }) });
    const j = await r.json(); if (r.status === 429 && j.limit) throw new Limit(); if (!r.ok) throw new Error(j.error);
    return Buffer.from(j.image.split(',')[1], 'base64');
  }
  if (engine === 'fal') {
    const r = await fetch(`https://fal.run/${FAL_MODEL}`, { method: 'POST', headers: { authorization: `Key ${process.env.FAL_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: promptFor(it), image_size: sizeFor(it), num_images: 1, output_format: 'jpeg', safety_tolerance: '2', seed }) });
    if (!r.ok) throw new Error(`fal said ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const u = (await r.json()).images?.[0]?.url; if (!u) throw new Error('no picture');
    return Buffer.from(await (await fetch(u)).arrayBuffer());
  }
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: promptFor(it), steps: 4 }) }); // (no seed: Cloudflare's FLUX.1 schnell refuses one)
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
  if (r.status === 429 || /neuron|daily free allocation|4006/i.test(t)) throw new Limit();
  if (!r.ok || !j?.success || !j.result?.image) throw new Error(`Cloudflare said ${r.status}: ${t.slice(0, 200)}`);
  return Buffer.from(j.result.image, 'base64');
}

const done = [], failed = [];
for (let i = 0; i < list.length;) {
  const it = list[i];
  if (engine !== 'fal' && usage() + NEURONS_EACH > BUDGET) {
    if (arg('no-wait')) { console.log(`\nToday's free neurons are used up: run the same command after 00:00 UTC to carry on.`); break; }
    const wait = nextReset() - Date.now() + 60_000; console.log(`\n⏸ Daily free limit reached. Progress is saved; carrying on at 00:00 UTC (in ${Math.round(wait / 60000)} min)...`);
    await new Promise((r) => setTimeout(r, wait)); continue;
  }
  try { writeFileSync(file(it), await one(it)); if (engine !== 'fal') addUsage(NEURONS_EACH); done.push(it); console.log('✓', it.name); i++; }
  catch (e) {
    if (e instanceof Limit) { writeFileSync(usageFile, JSON.stringify({ day: day(), neurons: 10000 })); continue; } // Cloudflare says so: the loop waits for the reset
    failed.push(it); console.log('✗', it.name, '-', e.message); i++;
  }
}
const all = ITEMS.filter((i) => i.batch === batch);
writeFileSync(join(dir, 'review.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Starter ${batch}</title>
<style>body{font:14px system-ui;margin:16px;background:#f6f1ee}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}figure{margin:0;background:#fff;border-radius:12px;padding:8px}img{width:100%;aspect-ratio:1;object-fit:contain}figcaption{font-size:12px}code{font-size:10px;color:#777}</style>
<h1>Starter ${batch}</h1><p>To make one again: <code>node scripts/starter.mjs --batch ${batch} --only &lt;id&gt;</code></p>
<main>${all.map((it) => `<figure>${existsSync(file(it)) ? `<img src="${it.id}.jpg" alt="">` : '<p>not made yet</p>'}<figcaption>${it.name}<br><code>${it.id}</code></figcaption></figure>`).join('')}</main>`);
console.log(`\n${done.length} made, ${failed.length} failed · neurons used today: ${Math.round(usage())} → ${join(dir, 'review.html')}`);
