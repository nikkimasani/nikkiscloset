#!/usr/bin/env node
// Make the preloaded wardrobe: every starter piece, made once, saved into the app (public/starter/made/), so every device opens with the
// whole closet and nothing is generated on a phone. Run by .github/workflows/preload.yml with the Cloudflare secrets kept in GitHub.
//
//   CF_ACCOUNT_ID=... CF_API_TOKEN=... node scripts/preload.mjs                 make what isn't made yet (stops at the day's free allowance)
//   ... --redo starter-black-fitted-tee,starter-camel-ribbed-turtleneck          make these again
//   ... --batch tops                                                            just one category
//
// It runs the app's own code in a headless browser (the same drawing, cutting-out and checks as the app): clothes and shoes are drawn on
// the model and only the piece is kept; bags and accessories are product photos. Each piece is tried up to 3 times; one that still fails
// is listed under "failed" in the index with the reasons, to be redone. review/<batch>.jpg shows every piece on the model, for checking.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ITEMS, BATCHES } from '../public/starter/items.js';

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i < 0 ? undefined : process.argv[i + 1]; };
const redo = (arg('redo') || '').split(',').map((s) => s.trim()).filter(Boolean), onlyBatch = arg('batch');
const DIR = 'public/starter/made', INDEX = `${DIR}/index.json`, PORT = 5480 + Math.floor(Math.random() * 100), PASS = randomBytes(12).toString('hex');
if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) { console.error('Set CF_ACCOUNT_ID and CF_API_TOKEN (GitHub: Settings > Secrets and variables > Actions).'); process.exit(1); }
mkdirSync(DIR, { recursive: true }); mkdirSync('review', { recursive: true });
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : { version: 0, pieces: {}, failed: {} };
for (const id of redo) { delete index.pieces[id]; rmSync(`${DIR}/${id}.webp`, { force: true }); }
const todo = ITEMS.filter((i) => (!onlyBatch || i.batch === onlyBatch) && (!index.pieces[i.id] || redo.includes(i.id)));
console.log(`${Object.keys(index.pieces).length} of ${ITEMS.length} made; ${todo.length} to make this run`);
if (!todo.length) process.exit(0);

const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT), APP_PASSCODE: PASS }, stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(), page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${PORT}/`); await page.evaluate(() => localStorage.setItem('aipass', ''));
const save = () => { index.version = Date.now(); writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n'); };

let made = 0, stopped = '';
for (const it of todo) {
  const r = await page.evaluate(async ([id, pass]) => {
    const { starterItem } = await import('/starter/items.js'), W = await import('/js/wear.js'), st = await import('/js/starter.js'), { loadPack } = await import('/js/doll.js');
    const it = starterItem(id), pack = await loadPack(), toData = (b) => new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
    let reasons = [];
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (W.isWornType(it.type)) { // drawn on the model; the piece is kept with where it sits on her
          const { blob } = await W.drawWorn(it, pass, pack), done = await W.extractWorn(blob, it, pack);
          if (done.check.ok && done.worn) return { ok: true, kind: 'worn', data: await toData(done.cutout), box: done.box, color: done.color, colors: done.colors, tries: attempt + 1 };
          reasons = done.check.reasons;
        } else { // a product photo, checked (pixels and an AI look) like in the app
          const { blob } = await st.generate(it, pass, { attempt });
          let done = await st.process(blob, it);
          if (done.check.ok) { const why = st.lookReasons(await st.look(blob, it, pass)); if (why.length) done.check = { ok: false, reasons: why }; }
          if (!done.check.ok && attempt === 2) done = await st.processCleaned(blob, it, done.check);
          if (done.check.ok) return { ok: true, kind: 'photo', data: await toData(done.cutout), color: done.color, colors: done.colors, tries: attempt + 1 };
          reasons = done.check.reasons;
        }
      }
      return { ok: false, reasons };
    } catch (e) { return { ok: false, limit: !!(e.limit || e instanceof st.DailyLimit), reasons: [e.message] }; }
  }, [it.id, PASS]);
  if (r.limit) { stopped = 'the day’s free Cloudflare allowance is used up'; break; }
  if (r.ok) {
    writeFileSync(`${DIR}/${it.id}.webp`, Buffer.from(r.data.split(',')[1], 'base64'));
    index.pieces[it.id] = { kind: r.kind, ...(r.box && { box: r.box }), color: r.color, colors: r.colors }; delete index.failed[it.id]; made++;
    console.log(`✓ ${it.id} (${r.kind}, try ${r.tries})`);
  } else { index.failed[it.id] = r.reasons; console.log(`✗ ${it.id}: ${r.reasons.join('; ')}`); }
  save();
}

// contact sheets: every made piece of each batch touched this run, on the model (worn) or on its own (photos)
for (const [batch] of BATCHES.filter(([b]) => todo.some((i) => i.batch === b))) {
  const ids = ITEMS.filter((i) => i.batch === batch && index.pieces[i.id]).map((i) => [i.id, i.name, index.pieces[i.id]]);
  if (!ids.length) continue;
  const jpg = await page.evaluate(async (list) => {
    const { loadPack } = await import('/js/doll.js'), pack = await loadPack(), [BW, BH] = pack.size, tw = 224, th = Math.round(tw * BH / BW) + 26, cols = 5;
    const c = document.createElement('canvas'); c.width = cols * tw; c.height = Math.ceil(list.length / cols) * th; const g = c.getContext('2d');
    g.fillStyle = '#f3eee8'; g.fillRect(0, 0, c.width, c.height); g.font = '13px sans-serif'; g.fillStyle = '#222';
    const base = new Image(); base.src = pack.files[pack.layers.body]; await base.decode();
    for (const [k, [id, name, p]] of list.entries()) {
      const x = (k % cols) * tw, y = Math.floor(k / cols) * th, s = tw / BW, pic = new Image(); pic.src = `/starter/made/${id}.webp?${Date.now()}`; await pic.decode();
      if (p.kind === 'worn') { g.drawImage(base, x, y, tw, tw * BH / BW); g.drawImage(pic, x + p.box.x * s, y + p.box.y * s, p.box.w * s, p.box.h * s); }
      else { const f = Math.min((tw - 20) / pic.width, (th - 46) / pic.height); g.drawImage(pic, x + (tw - pic.width * f) / 2, y + 10, pic.width * f, pic.height * f); }
      g.fillStyle = '#222'; g.fillText(name.slice(0, 30), x + 6, y + th - 8);
    }
    return c.toDataURL('image/jpeg', 0.82);
  }, ids);
  writeFileSync(`review/${batch}.jpg`, Buffer.from(jpg.split(',')[1], 'base64'));
}
await browser.close(); server.kill();
const total = Object.keys(index.pieces).length, failed = Object.keys(index.failed).length;
const summary = `${made} made this run · ${total} of ${ITEMS.length} in the wardrobe · ${failed} failed${stopped ? ` · stopped: ${stopped} (the next run carries on)` : ''}`;
console.log(summary); writeFileSync('review/summary.txt', summary + '\n' + Object.entries(index.failed).map(([id, r]) => `${id}: ${r.join('; ')}`).join('\n') + '\n');
