// End-to-end smoke test in headless Chromium. Run: npm start (other terminal) then npm test,
// or let this script start its own server.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axeSource = (await import('node:fs')).readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 5199, FAL = 5198;
// Mock of fal's queue API so the whole AI try-on path runs offline (field names per fal's public docs).
const { readFileSync } = await import('node:fs');
const falCalls = [], aiCalls = [], starterCalls = [], cf = { calls: [], limitAt: Infinity, sent: {}, tries: {}, used: 0 };
// The fake Cloudflare answers each piece with its own picture (one of seven real cutouts on white, by its place in the list), so the
// review grid can be checked tile by tile. Two pieces come back bad at first: one passes on its 3rd try, one never does.
const { ITEMS: SITEMS, promptFor: sPrompt } = await import('../public/starter/items.js');
// (tie.png is a blouse on a dress form: the check rightly fails it, so it isn't a stand-in for a good picture)
// (no stripes: white stripes reaching the edge read like a form's scraps)
const WHITE = ['blazer', 'blazer', 'snake', 'flare', 'banana', 'snake', 'bodysuit'].map((n) => readFileSync(new URL(`./fixtures/white/${n}.png`, import.meta.url)));
const BAD = { 'starter-cream-crochet-cami': 2, 'starter-navy-halter-top': 99 };
const RED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const { createServer } = await import('node:http');
const polls = {};
const mock = createServer((req, res) => {
  const base = `http://localhost:${FAL}`, send = (o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'POST' && req.url === '/fal-ai/fashn/tryon/v1.5') {
    let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
      const body = JSON.parse(b); falCalls.push({ auth: req.headers.authorization, ...body });
      const id = 'r' + falCalls.length; send({ request_id: id, status_url: `${base}/fal-ai/fashn/requests/${id}/status`, response_url: `${base}/fal-ai/fashn/requests/${id}` });
    });
  } else if (req.url.endsWith('/status')) { polls[req.url] = (polls[req.url] || 0) + 1; send({ status: polls[req.url] < 2 ? 'IN_PROGRESS' : 'COMPLETED' }); }
  else if (req.url.startsWith('/fal-ai/fashn/requests/')) send({ images: [{ url: `${base}/media/out.png`, content_type: 'image/png' }] });
  else if (req.method === 'POST' && (req.url === '/fal-ai/sam2/image' || req.url === '/fal-ai/any-llm/vision')) {
    let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
      const body = JSON.parse(b); aiCalls.push({ path: req.url, auth: req.headers.authorization, hasImage: !!(body.image_url || body.image_urls?.[0])?.startsWith?.('data:image') || !!body.image_urls?.[0]?.startsWith('data:image') });
      if (req.url.includes('sam2')) send(body.prompts?.some((q) => q.label === 1) && body.apply_mask === false ? { image: { url: `${base}/media/mask.png` } } : { detail: 'bad prompts' }, body.prompts ? 200 : 422);
      else send({ output: 'Here you go: {"name":"Satin cami","type":"tanks","season":"light","occasions":["GNO","Date Night"],"brand":""}' });
    });
  }
  else if (req.method === 'POST' && req.url === '/fal-ai/flux-pro/v1.1') {
    let b = ''; req.on('data', (d) => (b += d)).on('end', () => { const body = JSON.parse(b); starterCalls.push(body); send({ images: [{ url: `${base}/media/starter.png` }], seed: body.seed }); });
  }
  else if (req.method === 'POST' && req.url === '/rest/v1/rpc/starter_usage_today') send(cf.used);
  else if (req.method === 'POST' && req.url === '/rest/v1/rpc/starter_usage_add') { let b = ''; req.on('data', (d) => (b += d)).on('end', () => { cf.used = Math.round((cf.used + JSON.parse(b).n) * 10) / 10; send(cf.used); }); }
  else if (req.method === 'POST' && req.url === '/client/v4/accounts/acct1/ai/run/@cf/black-forest-labs/flux-1-schnell') {
    let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
      const body = JSON.parse(b); cf.calls.push({ auth: req.headers.authorization, ...body });
      if (cf.calls.length > cf.limitAt) return send({ success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] }, 429);
      const it = SITEMS.find((i) => sPrompt(i) === body.prompt), n = (cf.tries[it.id] = (cf.tries[it.id] || 0) + 1);
      const pic = n <= (BAD[it.id] || 0) ? readFileSync(new URL('./fixtures/shot_dress.png', import.meta.url)) : WHITE[SITEMS.filter((i) => i.batch === it.batch).indexOf(it) % WHITE.length];
      cf.sent[it.id] = pic.length; send({ success: true, result: { image: pic.toString('base64') } });
    });
  }
  else if (req.url === '/media/starter.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(WHITE[0]); }
  else if (req.url === '/pin/1') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><head><meta property="og:image" content="${base}/media/pin.png"></head></html>`); }
  else if (req.url === '/shop/1') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><head><title>x</title><meta property="og:title" content="Satin Cami Top | ZARA United States"><script type="application/ld+json">{"@type":"Product","name":"Satin Cami Top | ZARA","brand":{"name":"Zara"},"image":"${base}/media/shop.jpg","offers":{"price":"29.90"}}</script></head></html>`); }
  else if (req.url === '/media/shop.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(readFileSync(join(out, 'photo.jpg'))); }
  else if (req.url === '/media/mask.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(readFileSync(join(out, 'mask.png'))); }
  else if (req.url === '/media/cut.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(readFileSync(join(out, 'photo.jpg'))); } // a real picture, so colour suggestions have something to work with
  else if (req.url === '/media/pin.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(RED_PNG); }
  else if (req.url === '/media/out.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(RED_PNG); }
  else send({ detail: 'nope' }, 404);
}).listen(FAL);
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, FAL_KEY: 'test-key', APP_PASSCODE: 'letmein', FAL_QUEUE_BASE: `http://localhost:${FAL}`, FAL_RUN_BASE: `http://localhost:${FAL}`, PIN_ALLOW_HOSTS: `localhost:${FAL}`, PRODUCT_ALLOW_HOSTS: `localhost:${FAL}`, CF_ACCOUNT_ID: 'acct1', CF_API_TOKEN: 'cf-token', CF_API_BASE: `http://localhost:${FAL}`, USAGE_SUPABASE_URL: `http://localhost:${FAL}` }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const out = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'closet-'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const _newContext = browser.newContext.bind(browser); // (kept as an alias: some sections below start from a fresh, raw context on purpose)
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.addInitScript(() => localStorage.setItem('flat', '1')); // existing flows exercise the 2D fallback; 3D has its own section below
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failed = 0;
// A closet to test with: your own photo cutouts (tests/fixtures are real garment cutouts), put straight into the browser's database.
const FIX = [['White tee', 'tops', 'snake'], ['Silk blouse', 'tops', 'tie'], ['Black tank', 'tanks', 'bodysuit'], ['Blue jeans', 'bottoms', 'banana'], ['Black trousers', 'bottoms', 'flare'], ['Satin midi skirt', 'skirts', 'dress:skirt'],
  ['Emerald wrap dress', 'dresses', 'dress'], ['Camel blazer', 'outerwear', 'blazer'], ['Nude heels', 'shoes', 'flare:shoe'], ['Black mini bag', 'bags', 'blazer:bag']];
const FIXOCC = {"White tee": ["Casual Outing", "Brunch", "Travel"], "Silk blouse": ["Work / Office", "Dinner", "Date Night"], "Black tank": ["GNO", "Date Night", "Casual Outing"], "Blue jeans": ["Casual Outing", "Brunch", "GNO"], "Black trousers": ["Work / Office", "Dinner"], "Satin midi skirt": ["Date Night", "Dinner", "Brunch"], "Emerald wrap dress": ["Date Night", "Formal / Event", "Dinner"], "Camel blazer": ["Work / Office", "Dinner"], "Nude heels": ["Work / Office", "Date Night", "GNO", "Dinner"], "Black mini bag": ["Date Night", "GNO", "Dinner"]};
const FIXB64 = Object.fromEntries(['dress', 'blazer', 'snake', 'flare', 'banana', 'tie', 'bodysuit'].map((n) => [n, readFileSync(new URL(`./fixtures/${n}.png`, import.meta.url)).toString('base64')]));
async function loadFixtures(page) {
  const view = await page.evaluate(() => window.__closet?.view);
  await page.evaluate(async ({ FIX, FIXB64, FIXOCC }) => {
    const { put, uid } = await import('/js/db.js');
    const img = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
    for (const [name, type, src] of FIX) {
      const [file, part] = src.split(':'), im = await img(FIXB64[file]);
      const c = document.createElement('canvas'), sy = part === 'skirt' ? 0.45 : part === 'shoe' ? 0.9 : part === 'bag' ? 0.35 : 0, hy = part === 'skirt' ? 0.55 : part === 'shoe' ? 0.1 : part === 'bag' ? 0.3 : 1;
      c.width = im.width; c.height = Math.max(8, Math.round(im.height * hy)); c.getContext('2d').drawImage(im, 0, im.height * sy, im.width, im.height * hy, 0, 0, c.width, c.height);
      const cutout = await new Promise((r) => c.toBlob(r, 'image/png'));
      await put('items', { id: uid(), name, type, occasions: FIXOCC[name], brand: '', sample: true, season: ['Black tank', 'Satin midi skirt'].includes(name) ? 'light' : name === 'Camel blazer' ? 'warm' : 'all', color: { hex: '#888888', name: 'grey' }, cutout, adj: { scale: 1, dx: 0, dy: 0 }, createdAt: Date.now() + Math.random() });
    }
  }, { FIX, FIXB64, FIXOCC });
  await page.reload(); await page.waitForFunction(() => window.__closet?.items.length === 10);
  if (view && view !== 'tryon') await page.click(`[data-view=${view}]`);
}
/** Go through the cut-out editor (crop, tap to select, touch up, fit) with taps on the middle of the picture; ends back in the add dialog. */
async function throughEditor(page, taps = [[0.5, 0.45], [0.5, 0.65]], neg = []) {
  await page.waitForSelector('.cuted #autoq'); await page.click('.cuted #cutnext');
  await page.waitForSelector('.cuted [data-tool=pos]');
  const cb = await page.locator('.cuted #cvs').boundingBox(), tap = async ([u, v]) => { await page.mouse.click(cb.x + u * cb.width, cb.y + v * cb.height); await page.waitForTimeout(150); };
  for (const t of taps) await tap(t);
  if (neg.length) { await page.click('.cuted [data-tool=neg]'); for (const t of neg) await tap(t); }
  await page.waitForFunction(() => /Selected/.test(document.querySelector('#selmsg')?.textContent || ''), null, { timeout: 120000 });
  await page.click('.cuted #cutnext'); await page.waitForSelector('.cuted #brush'); await page.click('.cuted #cutnext');
  if (await page.locator('.cuted #cutdone').count() || await page.waitForSelector('.cuted #cutdone, #cutimg').then((e) => e.evaluate((x) => x.id === 'cutdone'))) await page.click('.cuted #cutdone');
  await page.waitForSelector('#cutimg');
}
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failed++; };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.empty'); ok(await page.locator('.empty').isVisible(), 'empty state shows');

  // A fake "photo": a red dress-ish blob on a beige wall with noise-free background.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 800;
    const x = c.getContext('2d'); x.fillStyle = '#e8dfd0'; x.fillRect(0, 0, 600, 800);
    x.fillStyle = '#b3202c'; x.beginPath(); x.moveTo(220, 100); x.lineTo(380, 100); x.lineTo(470, 700); x.lineTo(130, 700); x.fill();
    return c.toDataURL('image/jpeg', 0.9);
  });
  const photo = join(out, 'photo.jpg');
  const maskUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 300, 400); x.fillStyle = '#fff'; x.fillRect(80, 60, 140, 280); return c.toDataURL('image/png'); });
  (await import('node:fs')).writeFileSync(join(out, 'mask.png'), Buffer.from(maskUrl.split(',')[1], 'base64')); // what the stand-in SAM 2 answers
  const { writeFileSync } = await import('node:fs');
  writeFileSync(photo, Buffer.from(dataUrl.split(',')[1], 'base64'));

  await page.click('header [data-act=add]');
  ok(await page.locator('.modechips [data-mode]').count() === 3 && /Recommended/.test(await page.locator('.modechips .on').innerText()), 'step 1: how it was taken (Flat lay recommended) and where the photo comes from');
  ok(await page.locator('#tol').count() === 0, 'no background-removal strength slider any more');
  await page.setInputFiles('#file', photo);
  await throughEditor(page);
  const cut = await page.evaluate(async () => {
    const img = document.querySelector('#cutimg'); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, corner: x.getImageData(1, 1, 1, 1).data[3], mid: x.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] };
  });
  ok(cut.corner === 0 && cut.mid === 255, `the tapped selection is cut out (corner alpha ${cut.corner}, centre alpha ${cut.mid})`);
  ok(cut.w < 600 && cut.h < 800, `cropped to garment (${cut.w}x${cut.h})`);
  await page.screenshot({ path: join(out, '1-add-modal.png') });
  await page.selectOption('#type', 'dresses');
  await page.click('#occs [data-o="Date Night"]');
  await page.fill('#name', 'Red party dress');
  await page.click('#save');
  await page.click('[data-view=closet]');
  await page.waitForSelector('.piece');
  ok((await page.locator('.piece').count()) === 1, 'uploaded piece appears in closet');
  const colorName = await page.locator('.piece .meta').innerText();
  ok(/red/i.test(colorName), `colour auto-detected (${colorName.trim()})`);

  await page.reload();
  await page.click('[data-view=closet]');
  ok((await page.locator('.piece').count()) === 1, 'piece persists after reload (IndexedDB)');

  await page.click('[data-view=closet]');

  // Try on
  await page.click('.piece .img');
  ok(await page.locator('#stage .gar image').count() === 1, 'tapping a piece puts it on the model');
  await page.click('[data-act=tab][data-v=shoes]');
  await page.screenshot({ path: join(out, '2-tryon.png') });

  // Log + planner
  await page.click('[data-act=drawer][data-v=looks]');
  await page.fill('#lookname', 'Test look');
  await page.click('.drawer [data-act=savelook]');
  await page.waitForSelector('[data-act=loadlook]');
  ok(await page.locator('[data-act=loadlook]').count() === 1, 'look saved');
  await page.click('.tools [data-act=wearToday]');
  await page.waitForSelector('#toast.show');
  await page.click('[data-view=planner]');
  ok(await page.locator('.day svg.doll').count() === 1, 'OOTD appears on calendar');
  await page.screenshot({ path: join(out, '3-planner.png') });

  // Inspo: a pink/blue "pin" should match against the closet and surface a gap for shoes
  const pin = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 400;
    const x = c.getContext('2d'); x.fillStyle = '#b3202c'; x.fillRect(0, 0, 300, 400); x.fillStyle = '#e8dfd0'; x.fillRect(0, 300, 300, 100);
    return c.toDataURL('image/png');
  });
  const pinFile = join(out, 'pin.png'); writeFileSync(pinFile, Buffer.from(pin.split(',')[1], 'base64'));
  await page.click('[data-view=inspo]');
  await page.setInputFiles('#ifile', pinFile);
  await page.click('#iwant [data-s=dress]');
  await page.click('#iwant [data-s=top]');
  await page.click('#iwant [data-s=bottom]');
  await page.waitForSelector('.match');
  ok(/Red party dress/.test(await page.locator('.match').first().innerText()), 'inspo matches the red dress from the closet');
  ok(await page.locator('.gap').count() >= 1, 'inspo reports a missing piece (shoes)');
  await page.screenshot({ path: join(out, '4-inspo.png') });
  await page.click('[data-act=saveinspo]');
  await page.waitForSelector('.inspo-saved img');
  ok(await page.locator('.inspo-saved img').count() === 1, 'inspo saved');
} catch (e) { console.error(e); failed++; }

// sample closet on a fresh profile
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('flat', '1'));
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(`http://localhost:${PORT}/`);
  await loadFixtures(p2);
  await p2.waitForFunction(() => window.__closet?.items.length === 10);
  await p2.click('[data-view=closet]');
  await p2.waitForSelector('.piece');
  ok((await p2.locator('.piece').count()) === 10, 'sample closet loads 10 pieces');
  await p2.screenshot({ path: join(out, '5-closet.png'), fullPage: true });
  await p2.click('[data-view=tryon]');
  await p2.click('[data-act=mood][data-v="Date Night"]');
  await p2.click('[data-act=styleme]');
  ok(await p2.locator('#stage image').count() >= 2, 'Style me builds an outfit');
  await p2.screenshot({ path: join(out, '6-styleme.png') });

  // ── my photo (used by the photoreal try-on) ──
  await p2.click('[data-view=tryon]');
  await p2.click('[data-act=drawer][data-v=me]');
  await p2.click('[data-act=setup]');
  ok(await p2.locator('[role=dialog][aria-modal=true]').isVisible(), 'photo dialog opens');
  ok(await p2.evaluate(() => document.querySelector('main').inert), 'background inert while dialog is open');
  await p2.click('#mcancel'); await p2.waitForSelector('#modal', { state: 'hidden' });
  const fig = await p2.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 800; const x = c.getContext('2d');
    x.fillStyle = '#eee'; x.fillRect(0, 0, 500, 800); x.fillStyle = '#c99'; x.beginPath(); x.arc(250, 90, 45, 0, 7); x.fill();
    x.fillRect(190, 140, 120, 230); x.fillRect(195, 370, 45, 380); x.fillRect(260, 370, 45, 380);
    return c.toDataURL('image/jpeg', 0.9);
  });
  const figFile = join(out, 'fig.jpg'); writeFileSync(figFile, Buffer.from(fig.split(',')[1], 'base64'));
  await p2.click('[data-act=drawer][data-v=me]');
  await p2.click('[data-act=setup]');
  await p2.setInputFiles('#mfile', figFile);
  await p2.waitForSelector('#modal img.myphoto');
  await p2.click('#msave');
  await p2.waitForSelector('[data-act=display][data-v=photo]:not([disabled])');
  await p2.click('[data-act=styleme]');
  ok(await p2.locator('#stage img.myphoto').count() === 1 && await p2.locator('#stage svg.doll').count() === 0, 'with a saved photo shown, the stage shows the photo');
  await p2.screenshot({ path: join(out, '8-photo-model.png') });
  await p2.click('[data-act=drawer][data-v=me]'); await p2.click('[data-act=display][data-v=model]'); await p2.waitForSelector('#stage svg.doll');
  ok(await p2.locator('#stage svg.doll').count() === 1, 'switching back shows the model');
  await p2.click('[data-act=drawer][data-v=me]'); await p2.click('[data-act=display][data-v=photo]'); await p2.waitForSelector('#stage img.myphoto');


  // ── AI try-on (fal.ai via serverless function; mocked here) ──
  const api = (path, init) => p2.evaluate(async ([path, init]) => { const r = await fetch(path, init); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
  ok((await api('/api/tryon', { method: 'POST', body: '{}' })).status === 401, 'API rejects a missing passcode');
  ok((await api('/api/tryon', { method: 'POST', headers: { 'x-app-passcode': 'wrong' }, body: '{}' })).status === 401, 'API rejects a wrong passcode');
  ok((await api('/api/tryon', { method: 'POST', headers: { 'x-app-passcode': 'letmein' }, body: JSON.stringify({ person: 'http://evil', garment: 'x', category: 'tops' }) })).status === 400, 'API rejects non-image inputs');
  const evil = await api(`/api/tryon?status=${encodeURIComponent('http://169.254.169.254/latest')}&response=${encodeURIComponent('http://localhost:5198/fal-ai/fashn/x')}`, { headers: { 'x-app-passcode': 'letmein' } });
  ok(evil.status === 400, 'API will not fetch URLs outside fal (SSRF guard)');
  const { handleTryOn } = await import('../lib/tryon.js');
  ok((await handleTryOn(new Request('http://x/api/tryon'), {})).status === 503, 'API refuses to run unconfigured (fail closed)');

  p2.on('dialog', (dlg) => dlg.accept());
  await p2.click('[data-act=drawer][data-v=ai]');
  await p2.fill('#aipass', 'letmein');
  await p2.click('[data-act=airender]');
  await p2.waitForSelector('#stage img.myphoto[src^="data:image/png"]', { timeout: 30000 });
  ok(falCalls.length >= 1 && falCalls.every((c) => c.auth === 'Key test-key'), `fal called with the server-side key (${falCalls.length} calls)`);
  ok(falCalls.length < 2 || falCalls[1].model_image.startsWith('data:image/png'), 'multi-piece outfit chains each result into the next piece');
  ok(falCalls.every((c) => c.garment_image.startsWith('data:image/jpeg') && ['tops', 'bottoms', 'one-pieces'].includes(c.category)), 'garments sent as white-background JPEGs with a valid category');
  ok(await p2.locator('#stage img.myphoto[src^="data:image/png"]').count() === 1, 'AI render replaces the photo as the base');
  await p2.screenshot({ path: join(out, '9-ai-render.png') });
  await p2.click('[data-act=aiclear]');
  ok(await p2.locator('#stage img.myphoto:not([src^="data:image/png"])').count() === 1, 'can go back to the plain photo');
  const callsAfterFirst = falCalls.length;
  ok(await p2.evaluate(() => JSON.parse(localStorage.getItem('spend')).n) === callsAfterFirst, 'the budget tracker counts the pieces rendered');
  await p2.click('[data-act=airender]');
  await p2.waitForSelector('#stage img.myphoto[src^="data:image/png"]');
  ok(falCalls.length === callsAfterFirst && /saved render/.test(await p2.locator('.drawer-body').innerText()), 'the same outfit shows its saved render for free (no new fal call)');
  // a $0 budget blocks a brand-new render before any money is spent
  await p2.evaluate(() => localStorage.setItem('budget', '0'));
  await p2.evaluate(() => { const S = window.__closet; Object.values(S.outfit).forEach((id) => { S.items.find((i) => i.id === id).updatedAt = Date.now() + 1; }); S.ai = null; }); // editing a piece invalidates its saved render
  await p2.click('[data-act=drawer][data-v=fit]'); await p2.click('[data-act=drawer][data-v=ai]'); await p2.fill('#aipass', 'letmein');
  const blocked = falCalls.length;
  await p2.click('[data-act=airender]');
  await p2.waitForFunction(() => /monthly budget/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
  ok(falCalls.length === blocked, 'a $0 budget stops a new render before any money is spent');


  // ── dress-up: the doll and its customizer ──
  const c3 = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p3 = await c3.newPage(); p3.setDefaultTimeout(90000); p3.on('pageerror', (e) => errors.push(e.message)); p3.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p3.goto(`http://localhost:${PORT}/`);
  await p3.waitForFunction(() => window.__closet);
  {
    await loadFixtures(p3); await p3.waitForFunction(() => window.__closet.items.length === 10);
    await p3.click('[data-act=styleme]');
    await p3.waitForFunction(() => document.querySelectorAll('#stage .gar').length >= 2);
    ok(await p3.locator('#stage svg.doll').count() === 1 && await p3.locator('#stage canvas').count() === 0, 'Style me dresses the 2D doll');
    const types0 = await p3.evaluate(() => [...document.querySelectorAll('#stage .gar')].map((g) => g.dataset.slot));
    await p3.click('[data-act=mood][data-v="Dinner"]'); await p3.click('[data-act=styleme]'); await p3.waitForTimeout(400);
    ok((await p3.locator('#stage .gar').count()) >= 2, `outfit changes update the doll (was ${types0.join('+')})`);
    await p3.evaluate(axeSource);
    const r3 = await p3.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad3 = r3.violations.filter((v) => v.impact !== 'minor');
    ok(bad3.length === 0, `axe (dress-up): ${bad3.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await p3.screenshot({ path: join(out, '10-doll.png') });
    // the base picture is fixed art: the doll's customizer only offers the room and the anchor points
    await p3.click('[data-act=drawer][data-v=look]');
    ok(JSON.stringify(await p3.locator('.cas-tabs [data-act=cas]').evaluateAll((b) => b.map((x) => x.dataset.v))) === '["hair","anchors"]', 'Customize on the doll offers your hairstyles and the anchor points (no dead face, body or room options)');
    ok(await p3.locator('.hairchip').count() === 8 && await p3.locator('#stage .hairpic').count() === 0, 'eight hairstyle choices; the base picture\'s own hair until you pick one');
    await p3.click('.hairchip[data-v=ponytail]'); await p3.click('.hairsw[data-v=auburn]');
    ok(await p3.locator('#stage .hairback .hairpic').count() === 1 && await p3.locator('#stage .hairfront .hairpic').count() === 1 && await p3.locator('#stage feColorMatrix').count() >= 1, 'a ponytail is drawn in front, with what hangs behind the neck behind the body, tinted auburn');
    // Adjust fit: drag a landmark and the hair moves; it's saved for that style
    const t0 = await p3.locator('#stage .hairfront .hairpic').getAttribute('transform');
    await p3.click('.hairadjust'); await p3.waitForSelector('.hfdot.templeR');
    const db = await p3.locator('.hfdot.templeR').boundingBox(); await p3.mouse.move(db.x + db.width / 2, db.y + db.height / 2); await p3.mouse.down(); await p3.mouse.move(db.x + db.width / 2 + 30, db.y + db.height / 2, { steps: 4 }); await p3.mouse.up();
    await p3.click('#hfsave');
    ok(JSON.parse(await p3.evaluate(() => localStorage.getItem('hairmarks'))).ponytail?.templeR && (await p3.locator('#stage .hairfront .hairpic').getAttribute('transform')) !== t0, 'dragging a landmark in Adjust fit refits the hair and is saved for that style');
    await p3.evaluate(() => localStorage.removeItem('hairmarks'));
    ok(await p3.evaluate(() => Promise.all([...document.querySelectorAll('#stage .hairpic')].map((i) => fetch(i.getAttribute('href')).then((r) => r.ok)))).then((r) => r.every(Boolean)), 'the hair pictures load');
    await p3.screenshot({ path: join(out, '10a-hair.png') });
    ok(await p3.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => /hair(style|color)$/.test(k)).map((k) => localStorage[k]).sort())) === '["auburn","ponytail"]', 'the hairstyle and colour are remembered');
    await p3.click('.hairchip[data-v=none]');
    await p3.click('.cas-tabs [data-v=anchors]');
    await p3.click('.anchors summary');
    ok(await p3.locator('.ptlist li').count() >= 15, 'the anchor points are listed with their coordinates');
    ok(await p3.locator('#stage .pointsdbg').count() === 0, 'the debug overlay is off by default');
    await p3.locator('.cas [data-act=dbgpts]').evaluate((e) => e.click());
    ok(await p3.locator('.cas').count() === 0 && await p3.locator('.dbgchip').count() === 1, 'turning the points on closes the panel so they can be seen, with a chip to hide them');
    ok(await p3.locator('#stage .pointsdbg circle').count() >= 15 && await p3.locator('#stage .pointsdbg rect').count() >= 2, 'the debug overlay draws every point and the box of each piece worn');
    await p3.screenshot({ path: join(out, '10b-anchors.png') });
    // clothes snap to the points: shirt centred on the shoulders and sized by them, trousers by the hips
    const snap = await p3.evaluate(() => {
      const d = document.querySelector('#stage svg.doll'), box = (slot) => { const g = d.querySelector(`.gar[data-slot="${slot}"]`); if (!g) return null; const r = g.querySelector('image').getBoundingClientRect(); return r; };
      const ctm = d.getScreenCTM(), k = ctm.a, X = (px) => (px - ctm.e) / k;
      return { top: box('top') && { x0: X(box('top').left), x1: X(box('top').right) }, bottom: box('bottom') && { x0: X(box('bottom').left), x1: X(box('bottom').right) } };
    });
    const cfg = await p3.evaluate(async () => (await (await fetch('/assets/avatar/config.json')).json()).points);
    if (snap.top) ok(Math.abs((snap.top.x0 + snap.top.x1) / 2 - (cfg.shoulderL[0] + cfg.shoulderR[0]) / 2) < 25, 'the top is centred on the shoulders');
    if (snap.bottom) ok(Math.abs((snap.bottom.x0 + snap.bottom.x1) / 2 - (cfg.hipL[0] + cfg.hipR[0]) / 2) < 25, 'the bottom is centred on the hips');
    await p3.click('.dbgchip');
    ok(await p3.locator('#stage .pointsdbg').count() === 0, 'the chip turns the overlay off again');
    await p3.click('[data-act=drawer][data-v=look]');
    ok(/mirror\.jpg/.test(await p3.evaluate(() => getComputedStyle(document.querySelector('.room.dollroom')).backgroundImage)), 'the mannequin stands in front of the closet mirror');
    await p3.evaluate(axeSource);
    const r4 = await p3.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad4 = r4.violations.filter((v) => v.impact !== 'minor');
    ok(bad4.length === 0, `axe (customize tab): ${bad4.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await p3.click('[data-act=casclose]');
    // ── the daily challenge: theme, rating with reasons, coins, streak ──
    ok(/Theme:/.test(await p3.locator('.gamebar .gb-theme').innerText()), 'the day starts with a themed challenge banner');
    const coins0 = await p3.evaluate(() => window.__closet.game.coins), energy0 = await p3.evaluate(() => window.__closet.game.day.energy);
    ok(energy0 < 100, `changing the outfit costs a little energy (${energy0}/100)`);
    await p3.click('[data-act=rate] >> visible=true'); await p3.waitForSelector('.reveal .star.on');
    const rv = await p3.evaluate(() => ({ stars: document.querySelectorAll('.reveal .star.on').length, parts: document.querySelectorAll('.reveal .parts li').length, coins: window.__closet.game.coins, notes: [...document.querySelectorAll('.reveal .parts small')].every((n) => n.textContent.length > 5) }));
    ok(rv.stars >= 1 && rv.parts === 5 && rv.notes && rv.coins > coins0, `rating shows stars (${rv.stars}), five reasons from your tags, and pays coins (${coins0} -> ${rv.coins})`);
    await p3.evaluate(axeSource);
    const rr = await p3.evaluate(() => window.axe.run(document.querySelector('#modal'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    ok(rr.violations.filter((v) => v.impact !== 'minor').length === 0, `axe (rating reveal): ${rr.violations.map((v) => v.id).join(', ') || 'no violations'}`);
    await p3.screenshot({ path: join(out, '11-reveal.png') });
    await p3.click('#rwclose');
    await p3.click('[data-act=rate] >> visible=true'); await p3.waitForSelector('.reveal .star.on');
    ok((await p3.evaluate(() => window.__closet.game.coins)) === rv.coins, 'rating the same look again pays nothing more');
    await p3.click('#rwclose');
    await p3.reload(); await p3.waitForFunction(() => window.__closet?.game.coins > 0);
    ok((await p3.evaluate(() => window.__closet.game.coins)) === rv.coins, 'coins are kept after a reload');
    // the day is closed from the banner
    await p3.waitForSelector('.gamebar .gb-end', { state: 'attached' });
    await p3.click('[data-act=styleme]'); await p3.waitForFunction(() => document.querySelector('.gamebar [data-act=rate]:not([disabled])'));
    if (await p3.locator('.gb-pill').isVisible()) await p3.click('.gb-pill'); // (on a phone the challenge is a pill: open it)
    await p3.click('.gamebar .gb-end');
    await p3.waitForFunction(() => window.__closet.game.day.phase === 'done');
    ok(true, 'the day can be ended from the banner');
    // picking a mood re-themes a day that hasn't been rated yet
  }
  {
    const cM = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const pM = await cM.newPage(); pM.on('pageerror', (e) => errors.push(e.message));
    await pM.goto(`http://localhost:${PORT}/`); await pM.waitForFunction(() => window.__closet && window.__closet.game.day);
    await pM.click('[data-act=mood][data-v=Dinner]');
    await pM.waitForFunction(() => window.__closet.game.day.theme.source === 'mood');
    ok(await pM.evaluate(() => window.__closet.game.day.theme.occasion) === 'Dinner', 'picking a mood re-themes the unrated day');
  }
  // an event on today's date becomes the day's challenge
  {
    const cE = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await cE.addInitScript(() => localStorage.setItem('flat', '1'));
    const pE = await cE.newPage(); pE.on('pageerror', (e) => errors.push(e.message));
    await pE.goto(`http://localhost:${PORT}/`); await pE.waitForFunction(() => window.__closet);
    await pE.click('[data-view=plan]'); await pE.fill('#evtitle', 'Sam’s dinner'); await pE.selectOption('#evocc', 'Dinner'); await pE.click('[data-act=evadd]');
    await pE.click('[data-view=tryon]'); await pE.waitForSelector('.gamebar');
    ok(/Sam’s dinner/.test(await pE.locator('.gamebar .gb-theme').textContent()) && /from your plan/.test(await pE.locator('.gamebar').textContent()), 'an event added in Plan becomes today’s challenge');
  }


  // ── audit regressions ──
  const mk = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true }); await c.addInitScript(() => localStorage.setItem('flat', '1')); const pg = await c.newPage(); pg.on('pageerror', (e) => errors.push(e.message)); pg.on('dialog', (d) => d.accept()); await pg.goto(`http://localhost:${PORT}/`); await pg.waitForFunction(() => window.__closet); return pg; };
  const p4 = await mk();
  ok(!(await p4.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('three.module')))), 'flat mode never downloads the 3D engine');
  await loadFixtures(p4); await p4.waitForFunction(() => window.__closet.items.length === 10);
  await p4.click('[data-view=closet]'); await p4.evaluate(() => window.scrollTo(0, 900)); await p4.click('[data-view=tryon]');
  ok(await p4.evaluate(() => Math.round(scrollY)) === 0, 'opening a screen starts at the top (scroll is not carried over)');
  await p4.click('[data-view=closet]');
  await p4.locator('.piece:has-text("Silk blouse") .edit').click();
  ok(await p4.locator('[role=dialog]').isVisible(), 'the ✎ Edit button on a piece opens the editor (not covered by the picture)');
  await p4.keyboard.press('Escape');
  await p4.evaluate(() => { window.__closet.items[0].name = '<img src=x onerror="window.__xss=1">"\'&'; });
  for (const v of ['tryon', 'planner', 'closet', 'tryon']) await p4.click(`[data-view=${v}]`);
  ok(!(await p4.evaluate(() => window.__xss)), 'hostile item names are escaped everywhere (no script runs)');
  // delete a piece that is in the outfit, a saved look and the diary
  await p4.click('[data-act=tab][data-v=tops]'); await p4.click('.pick:has-text("Silk blouse")');
  await p4.click('[data-act=drawer][data-v=looks]'); await p4.fill('#lookname', 'Blouse look'); await p4.click('.drawer [data-act=savelook]'); await p4.click('.tools [data-act=wearToday]');
  await p4.click('[data-view=closet]'); await p4.locator('.piece:has-text("Silk blouse") .edit').click(); await p4.click('#rm');
  await p4.waitForFunction(() => window.__closet.items.length === 9);
  const gone = await p4.evaluate(() => { const S = window.__closet; return { looks: S.outfits.length, outfit: Object.keys(S.outfit).length, wears: S.wears.length, urls: [...S.urls.keys()].filter((k) => !k.includes(':') && k !== 'profile').length }; });
  ok(gone.looks === 0 && gone.outfit === 0, 'deleting a piece removes it from the current outfit and saved looks (no ghosts)');
  ok(gone.wears === 1 && gone.urls === 9, 'diary history is kept and the deleted piece’s image is released');
  // installable app
  const pwa = await p4.evaluate(async () => ({ sw: (await navigator.serviceWorker.ready).active?.state, manifest: (await fetch('/manifest.webmanifest')).status, icon: (await fetch('/icon-192.png')).status, link: !!document.querySelector('link[rel=manifest]') }));
  ok(pwa.sw === 'activated' && pwa.manifest === 200 && pwa.icon === 200 && pwa.link, 'installable: manifest, icons and service worker are live');
  // wrong passcodes are slowed down
  const t0 = Date.now(); await p4.evaluate(() => fetch('/api/tryon', { method: 'POST', headers: { 'x-app-passcode': 'nope' }, body: '{}' }));
  ok(Date.now() - t0 >= 350, 'wrong passcode attempts are delayed');
  // backup -> restore on a brand-new device -> remove samples
  await p4.click('[data-view=closet]');
  const [dl] = await Promise.all([p4.waitForEvent('download'), p4.click('[data-act=export]')]);
  const bak = join(out, 'backup.json'); await dl.saveAs(bak);
  const backup = JSON.parse((await import('node:fs')).readFileSync(bak, 'utf8'));
  ok(backup.app === 'nikkis-closet' && backup.stores.items.length === 9 && backup.stores.items[0].cutout?.__blob?.match(/^data:image\/(png|webp)/), 'backup file contains every piece with its image');
  const p5 = await mk(); await p5.click('[data-view=closet]');
  ok((await p5.locator('.piece').count()) === 0, 'a fresh device starts empty');
  await p5.setInputFiles('#restore', bak);
  await p5.waitForFunction(() => window.__closet?.items.length === 9, null, { timeout: 15000 });
  await p5.click('[data-view=closet]');
  ok((await p5.locator('.piece').count()) === 9 && (await p5.locator('.piece img').first().evaluate((i) => i.complete && i.naturalWidth > 0)), 'restore brings back all pieces and their images');
  await p5.click('[data-act=rmsamples]');
  await p5.waitForFunction(() => window.__closet.items.length === 0);
  ok(true, 'sample pieces can be removed in one tap');


  // review follow-ups: offline-ready on the first visit; appearance defaults survive reset + backup
  const fsx = await import('node:fs');
  const swSrc = fsx.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const missing = fsx.readdirSync(new URL('../public/js/', import.meta.url)).filter((f) => f.endsWith('.js') && !swSrc.includes(`/js/${f}`));
  ok(missing.length === 0, `service worker precaches every module (${missing.join(', ') || 'none missing'})`);
  const p6 = await mk();
  await p6.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p6.context().setOffline(true);
  await p6.reload();
  await p6.waitForSelector('#main .view-title', { state: 'attached', timeout: 15000 });
  ok(await p6.locator('nav#nav').isVisible() && (await p6.title()) === "Nikki's Closet", 'first visit is enough: the app reopens with no network');
  await p6.context().setOffline(false);

  // ── batch A: price/cost-per-wear, weather, week plan, packing, gaps, wishlist, insights, streak ──
  const p8 = await mk();
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days7 = Array.from({ length: 7 }, (_, n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); });
  await p8.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'Houston', admin1: 'Texas', latitude: 29.76, longitude: -95.37 }] } }));
  await p8.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: days7, temperature_2m_max: [5, 12, 20, 26, 31, 18, 9], temperature_2m_min: [1, 6, 13, 19, 24, 12, 3], precipitation_probability_max: [80, 0, 10, 0, 0, 60, 0], weathercode: [61, 0, 1, 0, 0, 63, 3] } } }));
  await loadFixtures(p8); await p8.waitForFunction(() => window.__closet.items.length === 10);
  await p8.click('[data-view=plan]'); await p8.fill('#locq', 'Houston'); await p8.click('[data-act=wxcity]');
  await p8.waitForSelector('.wx-day');
  ok((await p8.locator('.wx-day').count()) === 7, 'weather: 7-day forecast loads (and the strict security policy allows the weather service)');
  await p8.click('[data-view=tryon]');
  ok(/41°F today in Houston/.test(await p8.locator('.wxline').innerText()), 'Dress Up shows today’s weather');
  let layered = 0;
  for (let n = 0; n < 6; n++) { await p8.click('[data-act=styleme]'); if (await p8.evaluate(() => !!window.__closet.outfit.outer)) layered++; }
  ok(layered === 6, 'Style me adds a coat on a cold, rainy day (6/6)');
  await p8.click('[data-view=plan]'); await p8.click('[data-act=planweek]');
  await p8.waitForFunction(() => window.__closet.plans.length === 7);
  ok((await p8.locator('.plan-day .plan-items img').count()) >= 14, 'week plan fills all 7 days');
  const firstPlan = await p8.evaluate(() => { const S = window.__closet, p = S.plans.find((x) => x.date === S.forecast[0].date); return p.itemIds.map((id) => S.items.find((i) => i.id === id).type); });
  ok(firstPlan.includes('outerwear'), `the cold day is planned with a coat (${firstPlan.join(', ')})`);
  await p8.locator('[data-act=planreroll]').first().click();
  ok((await p8.evaluate(() => window.__closet.plans.length)) === 7, 're-rolling a day keeps the plan intact');
  const wearsBefore = await p8.evaluate(() => window.__closet.wears.length);
  await p8.locator('[data-act=planwear]').first().click();
  await p8.waitForFunction((n) => window.__closet.wears.length === n + 1, wearsBefore);
  await p8.locator('[data-act=plantry]').first().click();
  ok((await p8.evaluate(() => Object.keys(window.__closet.outfit).length)) >= 2 && (await p8.locator('#stage').count()) === 1, 'a planned outfit opens on the model');
  await p8.click('[data-view=plan]');
  await p8.fill('#packdays', '5'); await p8.selectOption('#packband', 'cold'); await p8.click('[data-act=packmood][data-v="Work / Office"]');
  await p8.click('[data-act=packbuild]'); await p8.waitForSelector('.pack-result');
  const pack = await p8.evaluate(() => ({ boxes: document.querySelectorAll('.pack-item input').length, text: document.querySelector('.pack-result').innerText }));
  ok(pack.boxes >= 4 && /different outfit/.test(pack.text), `packing list builds (${pack.boxes} pieces)`);
  await p8.locator('.pack-item input').first().check();
  ok((await p8.evaluate(() => window.__closet.pack.checked.size)) === 1, 'packing checkboxes tick');
  const gaps = await p8.locator('.gap-row').count();
  ok(gaps > 0, `wardrobe gaps found for under-stocked occasions (${gaps})`);
  await p8.locator('[data-act=wishgapadd]').first().click();
  await p8.waitForFunction(() => window.__closet.wishlist.length === 1);
  await p8.locator('.plan details summary').click(); await p8.fill('#wnote2', 'sage linen shirt'); await p8.fill('#wbudget', '60'); await p8.fill('#wlink', 'javascript:alert(1)');
  await p8.click('[data-act=wishadd]');
  await p8.waitForFunction(() => window.__closet.wishlist.length === 2);
  const wl = await p8.evaluate(() => window.__closet.wishlist);
  ok(wl.length === 2 && wl[1].link === '', 'wishlist: add from a gap and by hand; unsafe links are dropped');
  await p8.locator('[data-act=wishgot]').first().click();
  await p8.waitForSelector('[role=dialog]');
  ok(await p8.locator('[role=dialog]').isVisible() && /Adding:/.test(await p8.locator('#addingtype').innerText()), '“Got it” opens Add piece with the type filled in');
  await p8.keyboard.press('Escape');
  await p8.evaluate(axeSource);
  const rp = await p8.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
  const badp = rp.violations.filter((v) => v.impact !== 'minor');
  ok(badp.length === 0, `axe (Plan tab): ${badp.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
  await p8.screenshot({ path: join(out, '11-plan.png'), fullPage: true });
  // price -> cost per wear -> insights + streak (fresh closet, so no earlier wears interfere)
  const p9 = await mk(); await loadFixtures(p9); await p9.waitForFunction(() => window.__closet.items.length === 10);
  await p9.click('[data-view=closet]'); await p9.locator('.piece:has-text("White tee") .edit').click();
  await p9.fill('#price', '50'); await p9.selectOption('#season', 'light'); await p9.click('#save');
  await p9.waitForSelector('.piece:has-text("White tee") .price');
  ok(/\$50\.00 · not worn yet/.test(await p9.locator('.piece:has-text("White tee") .price').innerText()), 'price shows on the piece card');
  await p9.evaluate(async () => { const S = window.__closet, t = S.items.find((i) => i.name === 'White tee'); const d = new Date(); const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; const y = new Date(d); y.setDate(d.getDate() - 1); S.wears.push({ id: 'w1', date: iso(d), itemIds: [t.id], occasion: '', note: '', createdAt: 1 }, { id: 'w2', date: iso(y), itemIds: [t.id], occasion: '', note: '', createdAt: 2 }); });
  await p9.click('[data-view=planner]'); await p9.waitForSelector('.streak');
  ok(/2-day outfit streak/.test(await p9.locator('.streak').innerText()), 'Diary shows the outfit streak');
  ok(/\$25\.00\/wear/.test(await p9.locator('.panel:has-text("Closet insights")').innerText()), 'insights: cost per wear ($50 over 2 wears = $25)');
  await p9.click('[data-view=closet]');
  ok(/\$25\.00\/wear/.test(await p9.locator('.piece:has-text("White tee") .price').innerText()), 'card switches to cost per wear once worn');


  // ── batch A2: look card, room themes + face options, saved renders + budget ──
  {
    await p3.click('[data-act=styleme]'); await p3.waitForFunction(() => document.querySelectorAll('#stage .gar').length >= 2);
    await p3.click('[data-act=drawer][data-v=looks]');
    const [shot] = await Promise.all([p3.waitForEvent('download'), p3.click('[data-act=sharecard]')]);
    const cardPath = join(out, 'look-card.png'); await shot.saveAs(cardPath);
    const png = fsx.readFileSync(cardPath), dims = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
    ok(png.subarray(1, 4).toString() === 'PNG' && dims.w === 1080 && dims.h === 1350, `look card is a 1080x1350 PNG (${(png.length / 1024).toFixed(0)} KB)`);
  }

  // ── batch B: AI helpers (auto-fill, Pinterest import) ──
  const p11 = await mk();
  await p11.click('header [data-act=add]'); await p11.setInputFiles('#file', join(out, 'photo.jpg')); await throughEditor(p11);
  await p11.fill('#mpass', 'wrong'); await p11.click('#aitag');
  await p11.waitForFunction(() => /Wrong passcode/.test(document.querySelector('#aimsg').textContent));
  ok(aiCalls.length === 0, 'a wrong passcode never reaches fal');
  await p11.fill('#mpass', 'letmein'); await p11.click('#aitag');
  await p11.waitForFunction(() => /Filled in/.test(document.querySelector('#aimsg').textContent));
  ok((await p11.inputValue('#name')) === 'Satin cami' && (await p11.inputValue('#season')) === 'light', 'Auto-fill sets name and warmth from the photo');
  ok((await p11.locator('#occs [aria-pressed=true]').allInnerTexts()).sort().join() === 'Date Night,GNO', 'Auto-fill ticks the suggested occasions');
  ok(aiCalls.length === 1 && aiCalls.every((c) => c.auth === 'Key test-key' && c.hasImage), 'auto-fill called fal with the server-side key and an image');
  await p11.click('#save'); await p11.waitForFunction(() => window.__closet.items.length === 1);
  ok(true, 'the auto-filled piece is saved');
  await p11.click('[data-view=inspo]'); await p11.locator('summary:has-text("Fetch the picture")').click();
  await p11.fill('#plink', 'https://evil.example.com/pin/1'); await p11.fill('#ipass', 'letmein'); await p11.click('[data-act=pinfetch]');
  await p11.waitForFunction(() => /Pinterest link/.test(document.querySelector('#pinmsg').textContent));
  ok(true, 'non-Pinterest links are refused');
  await p11.fill('#plink', `http://localhost:${FAL}/pin/1`); await p11.click('[data-act=pinfetch]');
  await p11.waitForSelector('.drop img');
  ok((await p11.inputValue('#plink')).endsWith('/pin/1') && (await p11.locator('.pal span').count()) > 0, 'a pin link fetches the picture into Inspo and keeps the link');

  // ── phase 1: adding pieces (link, paste, auto cutout, shared files, deep links) ──
  const prod = (url, pass = 'letmein') => api('/api/product', { method: 'POST', headers: { 'x-app-passcode': pass, 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  ok((await prod('http://localhost:5198/shop/1', 'nope')).status === 401, 'product import demands the passcode');
  ok((await prod('https://127.0.0.1/x')).status === 400 && (await prod('https://169.254.169.254/latest')).status === 400, 'product import refuses internal addresses');
  const pr = await prod('http://localhost:5198/shop/1');
  ok(pr.status === 200 && pr.body.brand === 'Zara' && pr.body.price === 29.9 && pr.body.image.startsWith('data:image/jpeg'), 'product import returns title, brand, price and the picture');
  const pI = await mk();
  await pI.click('header [data-act=add]');
  await pI.click('#srclink'); await pI.fill('#plink2', 'http://localhost:5198/shop/1'); await pI.fill('#lpass', 'letmein'); await pI.click('#linkgo');
  await pI.waitForSelector('.cuted'); ok(true, 'a product link goes straight to cropping');
  await throughEditor(pI);
  ok((await pI.inputValue('#name')) === 'Satin Cami Top' && (await pI.inputValue('#brand')) === 'Zara' && (await pI.inputValue('#price')) === '29.9', 'a product link fills in the name, brand and price');
  ok((await pI.locator('.cswatch').count()) > 0 && (await pI.locator('#cutimg').count()) === 1, 'colours are suggested from the cutout');
  await pI.click('#saveadd'); await pI.waitForFunction(() => window.__closet.items.length === 1);
  await pI.waitForSelector('#srcpick');
  ok((await pI.locator('#name').count()) === 0 && (await pI.evaluate(() => window.__closet.items[0].colors.length)) > 0, 'Save & add another keeps the first piece and starts again at step 1');
  const calls0 = aiCalls.length;
  await pI.evaluate(() => localStorage.setItem('aipass', 'letmein'));
  await pI.click('#cancel'); await pI.click('header [data-act=add]'); await pI.setInputFiles('#file', join(out, 'photo.jpg'));
  await throughEditor(pI);
  const samCalls = aiCalls.slice(calls0).filter((c) => c.path.includes('sam2'));
  ok(samCalls.length >= 1 && samCalls.every((c) => c.auth === 'Key test-key' && c.hasImage), `with the passcode saved, SAM 2 on fal does the tap-to-select (${samCalls.length} calls)`);
  ok(/SAM 2/.test(await pI.locator('.cutprev').innerText()), 'the piece says which engine selected it');
  await pI.waitForFunction(() => /Filled in/.test(document.querySelector('#aimsg').textContent));
  ok((await pI.inputValue('#name')) === 'Satin cami', 'and the AI describes the new piece by itself');
  await pI.click('#cancel'); await pI.click('header [data-act=add]');
  await pI.evaluate(() => localStorage.removeItem('aipass'));
  await pI.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 100; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 80, 100); x.fillStyle = '#2a8c8c'; x.fillRect(20, 10, 40, 80);
    const b = await new Promise((r) => c.toBlob(r, 'image/png')), dt = new DataTransfer(); dt.items.add(new File([b], 'p.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await throughEditor(pI); ok((await pI.locator('.cswatch').count()) > 0, 'pasting a picture (⌘/Ctrl+V) brings it into the add flow');
  await pI.click('#cancel');
  await pI.evaluate(() => localStorage.setItem('aipass', 'letmein'));
  await pI.goto(`http://localhost:${PORT}/?add=link&u=${encodeURIComponent('http://localhost:5198/shop/1')}`);
  await throughEditor(pI);
  ok((await pI.inputValue('#name')) === 'Satin Cami Top' && (await pI.evaluate(() => location.search)) === '', 'a Shortcut link (?add=link&u=…) opens the flow, fetches the product and tidies the address bar');
  await pI.evaluate(async () => { localStorage.removeItem('aipass'); const c = document.createElement('canvas'); c.width = 60; c.height = 60; c.getContext('2d').fillRect(10, 10, 40, 40); const b = await new Promise((r) => c.toBlob(r, 'image/png')); await (await caches.open('closet-share')).put('/shared/photo', new Response(b, { headers: { 'content-type': 'image/png' } })); });
  await pI.goto(`http://localhost:${PORT}/?add=shared`); await pI.waitForSelector('.cuted #autoq');
  ok(true, 'a picture shared into the installed app opens the add flow');
  await pI.click('.cuted #cutback');
  await pI.goto(`http://localhost:${PORT}/?add=paste`); await pI.waitForSelector('#srcpaste:focus');
  ok(/Tap Paste/.test(await pI.locator('#intakemsg').innerText()), '?add=paste opens the dialog ready for the Paste button');

  // ── phase 2: the 2D paper doll ──
  const cdl = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await cdl.addInitScript(() => localStorage.setItem('flat', '1'));
  const pdl = await cdl.newPage(); pdl.on('pageerror', (e) => errors.push(e.message)); pdl.on('dialog', (d) => d.accept());
  await pdl.goto(`http://localhost:${PORT}/`); await pdl.waitForSelector('svg.doll');
  ok((await pdl.locator('.dollmode').count()) === 1 && (await pdl.getAttribute('svg.doll', 'data-pack')) === 'base', 'Dress up opens on the base picture by default');
  await loadFixtures(pdl); await pdl.waitForFunction(() => window.__closet.items.length === 10);
  const wearOne = async (tab, name) => { await pdl.click(`[data-act=tab][data-v=${tab}]`); await pdl.click(`.pick:has-text("${name}")`); };
  await wearOne('tops', 'White tee'); await wearOne('bottoms', 'Blue jeans'); await wearOne('outerwear', 'Camel blazer'); await wearOne('shoes', 'Nude heels');
  const slots = () => pdl.evaluate(() => [...document.querySelectorAll('#stage .gar')].map((g) => g.dataset.slot));
  ok(JSON.stringify(await slots()) === JSON.stringify(['shoes', 'bottom', 'top', 'outer']), 'layers stack correctly: shoes, bottom, top, jacket over top');
  ok((await pdl.locator('#stage .gar image').first().getAttribute('href')).startsWith('blob:'), 'the real photo cutouts are what is drawn on the doll');
  // fit: select the top, nudge, and it is remembered
  const fitPiece = async (label) => { // on a wide screen the worn pieces are chips under the model; on a phone they're in the Fit sheet
    if (await pdl.locator(`.dfpieces [data-act=fit]:has-text("${label}")`).isVisible()) return pdl.click(`.dfpieces [data-act=fit]:has-text("${label}")`);
    if (!(await pdl.locator('.dbpieces').count())) await pdl.click('[data-act=dfit]');
    return pdl.click(`.dbpieces [data-act=fit]:has-text("${label}")`);
  };
  await fitPiece('Top');
  const tfm = () => pdl.getAttribute('#stage .gar[data-slot=top]', 'transform');
  const tf0 = await tfm();
  await pdl.dispatchEvent('[data-act=dnudge][data-v="x:3"]', 'pointerdown'); await pdl.dispatchEvent('[data-act=dnudge][data-v="x:3"]', 'pointerup');
  ok((await tfm()) !== tf0, 'a nudge button moves the piece');
  await pdl.dispatchEvent('[data-act=dsize][data-v="0.03"]', 'pointerdown'); await pdl.dispatchEvent('[data-act=dsize][data-v="0.03"]', 'pointerup');
  await pdl.dispatchEvent('[data-act=drot][data-v="2"]', 'pointerdown'); await pdl.dispatchEvent('[data-act=drot][data-v="2"]', 'pointerup');
  const saved = () => pdl.evaluate(() => window.__closet.items.find((i) => i.name === 'White tee').fit?.base);
  await pdl.waitForFunction(() => window.__closet.items.find((i) => i.name === 'White tee').fit?.base?.dx > 0);
  const f1 = await saved(); ok(f1.dx > 0 && f1.scale > 1 && f1.rot > 0, `size, turn and position are all kept (${JSON.stringify(f1)})`);
  // drag the piece on the doll
  const box = await pdl.locator('#stage svg.doll').boundingBox(), dx0 = f1.dx;
  const bx = box.x + box.width * 0.36, by = box.y + box.height * 0.3; // on the jacket's own panel (its front is open)
  await pdl.mouse.move(bx, by); await pdl.mouse.down(); await pdl.mouse.move(bx + 40, by + 20, { steps: 4 }); await pdl.mouse.up();
  const f2 = await pdl.evaluate(() => window.__closet.items.find((i) => i.name === 'Camel blazer').fit?.base || {});
  ok(f2.dx > 10 && f2.dy > 5 && (await saved()).dx === dx0, `touching a piece selects it and dragging moves just that piece (jacket moved ${Math.round(f2.dx)}, ${Math.round(f2.dy)}; tee stayed)`);
  await fitPiece('Top');
  // tucked in: the top goes under the bottoms and is cut at the waist
  await pdl.click('[data-act=dtuck]'); await pdl.waitForFunction(() => document.querySelector('#stage .gar').dataset.slot === 'shoes' && document.querySelectorAll('#stage .gar')[1].dataset.slot === 'top');
  ok(JSON.stringify(await slots()) === JSON.stringify(['shoes', 'top', 'bottom', 'outer']) && (await pdl.locator('#stage [clip-path] .gar[data-slot=top]').count()) === 1, 'tucking in puts the top under the bottoms');
  await pdl.click('[data-act=dtuck]'); await pdl.waitForFunction(() => document.querySelectorAll('#stage .gar')[1].dataset.slot === 'bottom');
  ok(JSON.stringify(await slots()) === JSON.stringify(['shoes', 'bottom', 'top', 'outer']), 'and untucking puts it back over them');
  await pdl.reload(); await pdl.waitForSelector('svg.doll'); await pdl.waitForFunction(() => window.__closet.items.find((i) => i.name === 'White tee').fit?.base?.dx > 0);
  ok(true, 'fit survives a reload');
  // the fit panel names the piece it is fitting, and tapping picks the piece you touched (not just a box that covers the spot)
  const bar = async () => (await pdl.locator('#dollbar .dbname').innerText());
  await wearOne('tops', 'White tee'); await wearOne('bottoms', 'Blue jeans'); // (the outfit isn't kept across a reload)
  await fitPiece('Top');
  ok(/White tee/.test(await bar()) && /Top/.test(await bar()), 'the fit panel says which piece: "Top: White tee"');
  ok((await pdl.locator('#dollbar .dbthumb').getAttribute('src')) === (await pdl.evaluate(() => window.__closet.urls.get(window.__closet.items.find((i) => i.name === 'White tee').id))), 'and shows that piece’s own picture');
  const sel = await pdl.evaluate(() => { const g = document.querySelector('#stage .gar.sel'), a = g.querySelector('image').getBoundingClientRect(), b = g.querySelector('.selbox').getBoundingClientRect(); return { sel: g.dataset.slot, inside: b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1 }; });
  ok(sel.sel === 'top' && sel.inside, 'the dashed box belongs to the selected piece and sits inside its picture');
  await pdl.waitForFunction(() => window.__closet.fitPending.size === 0); await pdl.waitForTimeout(300);
  const box2 = await pdl.locator('#stage svg.doll').boundingBox();
  await pdl.mouse.click(box2.x + box2.width * 0.36, box2.y + box2.height * 0.68); // the left leg at knee height: only the jeans are there
  ok(/Blue jeans/.test(await bar()), 'tapping the legs selects the jeans, and the label follows ("Bottom: Blue jeans")');
  await pdl.mouse.click(box2.x + box2.width * 0.02, box2.y + box2.height * 0.5); // empty background, far from every piece
  ok(/Blue jeans/.test(await bar()), 'tapping empty space does not switch to a piece that merely has a box there');
  await pdl.evaluate(axeSource);
  const axeD = await pdl.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
  ok(axeD.violations.filter((v) => v.impact !== 'minor').length === 0, `axe (2D doll): ${axeD.violations.map((v) => v.id + '[' + v.nodes.map((n) => n.target).join(' ') + ']').join('; ') || 'no violations'}`);
  await pdl.screenshot({ path: join(out, 'doll.png') });

  // cloud sync: two devices against an in-memory stand-in for the Supabase REST API
  const cloud = { records: new Map(), blobs: new Map() }, SYNC_KEY = 'amber-apple-arrow';
  const cloudRoute = (r) => {
    const req = r.request(), u = new URL(req.url()), t = u.pathname.split('/').pop(), h = req.headers();
    const json = (o, status = 200) => r.fulfill({ status, json: o, headers: { 'access-control-allow-origin': '*' } });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (h['x-sync-key'] !== SYNC_KEY || !h.apikey) return json([], 401);
    const rows = req.method() === 'POST' ? JSON.parse(req.postData()) : [];
    if (t === 'sync_records') {
      if (req.method() === 'POST') { for (const x of rows) cloud.records.set(`${x.store}/${x.id}`, x); return r.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } }); }
      const gt = Number((u.searchParams.get('updated_at') || 'gt.0').slice(3));
      return json([...cloud.records.values()].filter((x) => x.updated_at > gt).sort((a, b) => a.updated_at - b.updated_at));
    }
    if (req.method() === 'POST') { for (const x of rows) cloud.blobs.set(x.key, x); return r.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } }); }
    const b = cloud.blobs.get((u.searchParams.get('key') || '').slice(3));
    return json(b ? [b] : []);
  };
  const devA = await mk(), devB = await mk();
  for (const d of [devA, devB]) await d.context().route('https://kyswqvjgbgztkqamkmac.supabase.co/**', cloudRoute);
  await devA.click('[data-view=closet]'); await loadFixtures(devA); await devA.waitForFunction(() => window.__closet.items.length === 10);
  await devA.fill('#synckey', 'wrong-key'); await devA.click('[data-act=syncconnect]');
  await devA.waitForFunction(() => /rejected/.test(document.querySelector('#syncmsg')?.textContent || ''));
  ok(cloud.records.size === 0, 'a wrong sync key is refused and nothing is uploaded');
  await devA.fill('#synckey', 'Amber Apple Arrow'); await devA.click('[data-act=syncconnect]');
  await devA.waitForFunction(() => /Synced/.test(document.querySelector('#syncmsg')?.textContent || ''));
  ok([...cloud.records.keys()].filter((k) => k.startsWith('items/')).length === 10 && cloud.blobs.size >= 10, 'device A uploads its pieces and their photos');
  await devB.click('[data-view=closet]'); await devB.fill('#synckey', SYNC_KEY); await devB.click('[data-act=syncconnect]');
  await devB.waitForFunction(() => window.__closet?.items?.length === 10);
  ok(await devB.evaluate(() => window.__closet.items.every((i) => i.cutout instanceof Blob && i.cutout.size > 0)), 'device B receives the pieces with working photos');
  await devB.waitForLoadState('load'); await devB.waitForTimeout(2000); await devB.waitForFunction(() => window.__closet?.items?.length === 10); // the app reloads itself after a sync that pulled data; let that settle
  await devA.evaluate(() => { const i = window.__closet.items[0]; return import('/js/db.js').then((m) => m.put('items', { ...i, name: 'Renamed on A' })); });
  await devA.click('[data-act=syncnow]'); await devA.waitForFunction(() => /Synced/.test(document.querySelector('#syncmsg')?.textContent || ''));
  await devB.click('[data-view=closet]'); await devB.click('[data-act=syncnow]'); await devB.waitForFunction(() => window.__closet?.items?.some((i) => i.name === 'Renamed on A'));
  ok(true, 'an edit on one device reaches the other (newest edit wins)');
  await devB.click('[data-view=closet]'); await devB.click('[data-act=rmsamples]'); await devB.waitForFunction(() => window.__closet.items.length === 0);
  await devB.click('[data-act=syncnow]'); await devB.waitForFunction(() => /Synced/.test(document.querySelector('#syncmsg')?.textContent || ''));
  await devA.click('[data-view=closet]'); await devA.click('[data-act=syncnow]'); await devA.waitForFunction(() => window.__closet?.items?.length === 0);
  ok(true, 'a delete on one device removes the piece on the other');

  // front + back photos: the back photo is kept with the piece
  const pB = await mk(); await pB.click('[data-view=closet]'); await loadFixtures(pB); await pB.waitForFunction(() => window.__closet.items.length === 10);
  await pB.locator('.piece:has-text("White tee") .edit').click();
  const backPhoto = join(out, 'back.jpg'); writeFileSync(backPhoto, Buffer.from((await pB.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#e8dfd0'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#2a4d9b'; x.beginPath(); x.moveTo(220, 100); x.lineTo(380, 100); x.lineTo(470, 700); x.lineTo(130, 700); x.fill(); return c.toDataURL('image/jpeg', 0.9); })).split(',')[1], 'base64'));
  await pB.setInputFiles('#backfile', backPhoto); await pB.waitForSelector('.backthumb');
  await pB.click('#save'); await pB.waitForFunction(() => window.__closet.items.some((i) => i.name === 'White tee' && i.backCutout instanceof Blob && i.backCutout.size > 0));
  ok(true, 'a back photo is saved with the piece');
  await pB.click('[data-view=closet]'); await pB.locator('.piece:has-text("White tee") .edit').click(); await pB.click('#backrm'); await pB.click('#save');
  await pB.waitForFunction(() => !window.__closet.items.find((i) => i.name === 'White tee').backCutout);
  ok(true, 'the back photo can be removed');

  // ── the walk-in closet: no character, swipe / tap to move, your pieces on the rails and shelves ──
  {
    const cw = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await cw.addInitScript(() => localStorage.setItem('flat', '1'));
    const pw = await cw.newPage(); pw.setDefaultTimeout(60000); pw.on('pageerror', (e) => errors.push(e.message)); pw.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await pw.goto(`http://localhost:${PORT}/`); await pw.waitForFunction(() => window.__closet); await loadFixtures(pw);
    ok(await pw.evaluate(() => !('__apt' in window) && !document.querySelector('#joy, .camrot, .world-jump')), 'the 3D apartment, the walking avatar, the stick and the rotate buttons are gone');
    await pw.click('[data-act=scene][data-v=closet] >> visible=true'); // (the scene switch, or the ✨ button in the challenge row on a phone) await pw.waitForSelector('.wic-panel[data-k=dresses] .wic-art');
    ok(await pw.evaluate(() => getComputedStyle(document.querySelector('header.top')).display === 'none' && getComputedStyle(document.querySelector('#nav')).display === 'none'), 'the closet fills the screen: no app header or tabs, just a thin bar');
    ok(await pw.locator('.wic-top [data-act=wicmirror]').count() === 1 && /\d/.test(await pw.locator('.wic-coins').innerText()) && await pw.locator('.wic-top [data-act=shop]').count() === 1, 'the top bar has back, coins and Shop');
    const geo = await pw.evaluate(() => { const v = document.querySelector('.wic-view').getBoundingClientRect(), st = document.querySelector('.wic-strip').getBoundingClientRect(), parts = [...document.querySelectorAll('.wic-top, .wic-pillbox, .wic-tip')].map((e) => e.getBoundingClientRect()); return { over: parts.some((r) => r.bottom > st.top), share: parts.reduce((a, r) => a + r.width * r.height, 0) / (v.width * v.height), sw: document.documentElement.scrollWidth }; });
    ok(!geo.over && geo.share < 0.15 && geo.sw === 390, `nothing covers the strip, the chrome covers ${(geo.share * 100).toFixed(1)}% of the scene, no sideways page scroll`);
    ok(JSON.stringify(await pw.locator('.wic-strip button').evaluateAll((b) => b.map((x) => x.dataset.v))) === '["overview","tops","bottoms","dresses","outerwear","shoes","bags","jewelry","vanity","mirror"]', 'the strip lists every section');
    await pw.screenshot({ path: join(out, '20-closet-overview.png') });
    const nTops = await pw.locator('.wic-panel[data-k=tops] .wic-item').count(), nDress = await pw.locator('.wic-panel[data-k=dresses] .wic-item').count();
    ok(nTops === 3 && nDress === 1 && await pw.locator('.wic-panel[data-k=shoes] .wic-item').count() === 1 && await pw.locator('.wic-panel[data-k=bags] .wic-item').count() === 1, `your real cutouts hang on the rails and sit on the shelves (tops ${nTops}, dresses ${nDress})`);
    ok(/3 pieces/.test(await pw.locator('.wic-panel[data-k=tops] .wic-label').innerText()) && /Add pieces/.test(await pw.locator('.wic-panel[data-k=jewelry] .wic-empty').innerText()), 'each section has a count; an empty one offers Add pieces');
    await pw.click('.wic-strip [data-v=dresses]'); await pw.waitForTimeout(800);
    ok(await pw.evaluate(() => window.__closet.wicAt === 'dresses') && await pw.locator('.wic-strip [data-v=dresses].on').count() === 1, 'tapping a section glides there and the strip follows');
    await pw.screenshot({ path: join(out, '21-closet-dresses.png') });
    const box = await pw.locator('.wic-view').boundingBox();
    await pw.mouse.move(box.x + 330, box.y + 400); await pw.mouse.down(); await pw.mouse.move(box.x + 80, box.y + 400, { steps: 8 }); await pw.mouse.up(); await pw.waitForTimeout(900);
    ok(await pw.evaluate(() => window.__closet.wicAt === 'outerwear'), 'a swipe moves one section along the wall');
    await pw.keyboard.press('Escape'); await pw.focus('.wic-view'); await pw.keyboard.press('ArrowRight'); await pw.waitForTimeout(900);
    ok(await pw.evaluate(() => window.__closet.wicAt === 'shoes'), 'the arrow keys move along the walls too');
    await pw.screenshot({ path: join(out, '22-closet-shoes.png') });
    await pw.click('.wic-strip [data-v=dresses]'); await pw.waitForTimeout(800);
    await pw.click('.wic-panel[data-k=dresses] .wic-item'); await pw.waitForSelector('.wic-card');
    ok(/Dinner/.test(await pw.locator('.wic-card').innerText()), 'tapping a piece opens its card with its tags');
    await pw.evaluate(axeSource);
    const rc = await pw.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    ok(rc.violations.filter((v) => v.impact !== 'minor').length === 0, `axe (walk-in closet + card): ${rc.violations.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await pw.click('#wcadd');
    ok(await pw.evaluate(() => Object.keys(window.__closet.outfit).includes('dress')), 'Add to outfit dresses the mannequin');
    await pw.click('.wic-pill'); ok(await pw.locator('.wic-pillcard').count() === 1, 'the challenge pill opens'); await pw.click('.wic-pill');
    await pw.click('.wic-strip [data-v=mirror]'); await pw.waitForTimeout(800);
    ok(await pw.locator('.wic-panel[data-k=mirror] svg.doll').count() === 1, 'the mirror shows your mannequin');
    await pw.click('.wic-empty [data-act=wicmirror]'); await pw.waitForSelector('.dollmode svg.doll');
    ok(await pw.evaluate(() => getComputedStyle(document.querySelector('header.top')).display !== 'none'), 'the Mirror opens dress-up with your mannequin (the app header is back)');
    await pw.screenshot({ path: join(out, '23-mirror-dressup.png') });
    await cw.close();
  }

  // ── phase 4b-2: photo mode and the lookbook ──
  {
    const cp = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await cp.addInitScript(() => { if (!localStorage.getItem('game')) localStorage.setItem('game', JSON.stringify({ coins: 300 })); });
    const pp = await cp.newPage(); pp.setDefaultTimeout(60000); pp.on('pageerror', (e) => errors.push(e.message)); pp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await pp.goto(`http://localhost:${PORT}/`); await pp.waitForFunction(() => window.__closet);
    await loadFixtures(pp); await pp.waitForFunction(() => window.__closet.items.length === 10);
    await pp.waitForSelector('svg.doll'); await pp.click('[data-act=styleme]'); await pp.waitForFunction(() => Object.keys(window.__closet.outfit).length > 0);
    await pp.click('[data-act=photo]'); await pp.waitForSelector('#phcanvas');
    const px = await pp.evaluate(() => { const c = document.querySelector('#phcanvas'), g = c.getContext('2d'), a = g.getImageData(60, 300, 1, 1).data, b = g.getImageData(c.width / 2, c.height * 0.5, 1, 1).data; return [[...a], [...b]]; });
    ok(JSON.stringify(px[0]) !== JSON.stringify(px[1]), 'the photo preview is drawn (the backdrop and the doll differ)');
    await pp.evaluate(axeSource);
    const ra = await pp.evaluate(() => window.axe.run(document.querySelector('#modal'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    ok(ra.violations.filter((v) => v.impact !== 'minor').length === 0, `axe (photo mode): ${ra.violations.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await pp.screenshot({ path: join(out, '40-photo.png') });
    await pp.click('[data-act=phbg][data-v=sunset]'); await pp.waitForSelector('#modal .shoplist');
    ok(await pp.evaluate(() => window.__closet.game.photo.bg === 'blush'), 'a backdrop you haven’t bought opens the shop');
    await pp.click('[data-act=shopbuy][data-v="bg:sunset"]'); await pp.click('[data-act=shopuse][data-v="bg:sunset"]'); await pp.click('#shopclose');
    await pp.waitForSelector('#phcanvas');
    ok(await pp.evaluate(() => window.__closet.game.photo.bg === 'sunset' && window.__closet.game.coins === 270), 'after buying, the shop returns to the photo with the backdrop chosen');
    await pp.click('[data-act=phpose][data-v=stand]');
    await pp.screenshot({ path: join(out, '41-photo-sunset.png') });
    await pp.click('[data-act=phtake]'); await pp.waitForFunction(() => window.__closet.wears.some((w) => w.photo && w.photo.size > 2000));
    ok(true, 'Save to my lookbook attaches a photo to today’s diary entry');
    await pp.click('#phclose'); await pp.click('[data-view=planner]'); await pp.waitForSelector('.lookbook .lb');
    ok(await pp.locator('.lookbook .lb').count() === 1, 'the Diary’s lookbook shows the photo');
    await pp.screenshot({ path: join(out, '42-lookbook.png') });
    await pp.reload(); await pp.waitForFunction(() => window.__closet); await pp.click('[data-view=planner]'); await pp.waitForSelector('.lookbook .lb');
    ok(await pp.locator('.lookbook .lb').count() === 1, 'the lookbook photo is kept after a reload');
    await pp.click('.lookbook .lb'); await pp.waitForSelector('.lbbig'); await pp.click('[data-act=lbdel]');
    await pp.waitForFunction(() => !window.__closet.wears.some((w) => w.photo) && !document.querySelector('.lookbook .lb')); // state changes first, the Diary redraws a moment later
    ok(true, 'a photo can be removed from the lookbook');
    await cp.close();
  }

  // ── adding a piece, one step per screen: photo → crop → select → touch up → fit, then worn on the model ──
  {
    const cE = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await cE.addInitScript(() => localStorage.setItem('flat', '1'));
    const pe = await cE.newPage(); pe.setDefaultTimeout(120000); pe.on('pageerror', (e) => errors.push(e.message)); pe.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await pe.goto(`http://localhost:${PORT}/`); await pe.waitForSelector('svg.doll');
    await pe.click('header [data-act=add]'); await pe.click('[data-mode=worn]');
    ok(/arms, hands, face and phone/.test(await pe.locator('.tipbox').innerText()), 'the Worn tip says to mark arms, hands and the phone as not garment');
    await pe.click('[data-mode=flat]');
    await pe.setInputFiles('#file', new URL('./fixtures/shot_dress.png', import.meta.url).pathname);
    await pe.waitForSelector('.cuted #autoq');
    ok(/Screenshot found/.test(await pe.locator('.cuthint').innerText()), 'a shop screenshot is noticed and cropped to its product photo (status bar, buttons and text left out)');
    const q = await pe.evaluate(() => 1); ok(await pe.locator('#wb').isChecked(), 'white balance and straighten come with the crop');
    const fits = async () => pe.evaluate(() => { const c = document.querySelector('.cuted #cvs').getBoundingClientRect(), f = document.querySelector('.cutfoot').getBoundingClientRect(); return c.top >= 0 && c.bottom <= f.top + 1 && c.left >= 0 && c.right <= innerWidth && document.documentElement.scrollWidth === innerWidth; });
    ok(await fits(), 'crop: the whole picture fits on screen, nothing to scroll sideways');
    await pe.screenshot({ path: join(out, '50-crop.png') });
    await pe.click('#cutnext'); await pe.waitForSelector('[data-tool=pos]');
    ok(await fits(), 'select: the whole cropped picture fits on screen');
    ok(/dress form/.test(await pe.locator('.cuthint').innerText()), 'a red ➖ dot is placed on the dress form for you');
    const small = await pe.evaluate(() => [...document.querySelectorAll('.cuted button')].filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).map((b) => b.textContent.trim()));
    ok(small.length === 0, `every button is at least 44px (${small.join(', ') || 'all are'})`);
    const cb = await pe.locator('#cvs').boundingBox(), tap = async (u, v) => { await pe.mouse.click(cb.x + u * cb.width, cb.y + v * cb.height); await pe.waitForTimeout(250); };
    await tap(0.5, 0.35); await tap(0.5, 0.62); await tap(0.3, 0.5);
    await pe.click('[data-tool=neg]'); await tap(0.25, 0.97); await pe.click('#undo');
    await pe.waitForFunction(() => /Selected/.test(document.querySelector('#selmsg')?.textContent || ''), null, { timeout: 120000 });
    ok(await pe.evaluate(() => document.querySelector('[data-tool=neg]').getAttribute('aria-checked') === 'true'), 'Keep / Remove is a clear toggle; Undo takes back the last dot');
    await pe.screenshot({ path: join(out, '51-select.png') });
    await pe.click('#cutnext'); await pe.waitForSelector('#brush');
    await pe.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.97); await pe.mouse.down(); await pe.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.97, { steps: 4 }); await pe.mouse.up();
    ok(true, 'touch up: the brush erases (optional)');
    await pe.screenshot({ path: join(out, '52-touchup.png') });
    await pe.click('#cutnext'); await pe.waitForSelector('#prev'); await pe.waitForTimeout(800);
    ok(await pe.locator('.marksplit').count() === 1, 'fit: landmarks are suggested, with a live preview on the model');
    await pe.screenshot({ path: join(out, '53-fit.png') });
    await pe.click('#cutdone'); await pe.waitForSelector('#cutimg'); await pe.fill('#name', 'Striped test dress'); await pe.waitForTimeout(200);
    await pe.click('#save');
    await pe.waitForFunction(() => window.__closet.items.some((i) => i.name === 'Striped test dress'));
    const it = await pe.evaluate(() => { const i = window.__closet.items.find((x) => x.name === 'Striped test dress'); return { type: i.type, marks: Object.keys(i.marks || {}), cap: i.capture, orig: !!i.original }; });
    ok(it.marks.length >= 9 && it.cap === 'flat' && it.orig, `the piece is saved with its landmarks (${it.marks.length}), how it was taken, and your original photo`);
    await pe.click('[data-view=tryon]'); await pe.click(`[data-act=tab][data-v=${it.type}]`); await pe.click('.pick:has-text("Striped test dress")');
    await pe.waitForFunction(() => window.__closet.fitPending.size === 0 && document.querySelector('#stage .gar image[width="896"]'));
    ok(true, 'worn on the model, the cutout is warped to the body (not scaled as a rectangle)');
    await pe.screenshot({ path: join(out, '60-fitted.png') });
    const hd = await pe.evaluate(async () => { const r = await fetch('/lab/segment-worker.js'); return r.headers.get('content-security-policy'); });
    ok(/unsafe-eval/.test(hd) && /connect-src 'self' blob: data:;/.test(hd) && !/https:/.test(hd), 'the tap-select worker has its own policy and can reach no network');
    await cE.close();
  }

  // the starter closet: a batch is generated (mock Cloudflare), reviewed, approved, then marked, filtered, owned and hidden
  {
    const pS = await mk(); await pS.evaluate(() => { localStorage.setItem('aipass', 'letmein'); localStorage.setItem('starter_test_pictures', '1'); }); // (stand-in pictures: the colour check is skipped)
    await pS.click('[data-view=closet]').catch(() => {}); await pS.waitForSelector('[data-act=starterbatch][data-v=tops]');
    ok(/57\.6 neurons a picture, 1,152 a batch of 20, 8,064 for all 140 \(free: 10,000 a day\)/.test(await pS.locator('[aria-label="Starter closet"]').innerText()), 'the neuron estimate and the free daily allowance are shown before anything runs');
    await pS.click('[data-act=starterbatch][data-v=tops]');
    await pS.waitForFunction(() => document.querySelectorAll('.startertile.ok').length === 20, null, { timeout: 90000 });
    ok(cf.calls.length === 24 && cf.calls.every((c) => c.auth === 'Bearer cf-token' && c.steps === 4 && /^Flat lay product photo of .*laid flat and neatly arranged, viewed from directly above/.test(c.prompt) && /plain pure white background, soft even lighting/.test(c.prompt) && !/mannequin|\bmodel\b|person|dress form/i.test(c.prompt)) && !starterCalls.length, `tops made on Cloudflare (FLUX.1 schnell, 4 steps) as flat lays, never naming a mannequin, model, person or dress form; fal not used (${cf.calls.length} calls: 20 + 2 automatic remakes for each of the two bad pictures)`);
    const tops = SITEMS.filter((i) => i.batch === 'tops');
    ok(tops.every((it, k) => cf.calls.find((c) => c.prompt === sPrompt(it)).seed === 110000 + k), 'each piece starts from a stable seed for its category (tops 110000 + its place)');
    ok(cf.tries['starter-cream-crochet-cami'] === 3 && await pS.locator('.startertile.ready[data-id=starter-cream-crochet-cami]').count() === 1, 'a picture that fails the check (not a white background) is remade automatically and passes on its 3rd try');
    ok(cf.tries['starter-navy-halter-top'] === 3 && /Needs review\s+\S/.test(await pS.locator('.startertile[data-id=starter-navy-halter-top]').innerText()), 'after 2 automatic remakes and an automatic clean-up a failing picture is shown as Needs review, with the reason');
    ok(await pS.evaluate(() => window.__closet.items.length) === 0, 'nothing is added before you approve');
    ok(/Neurons used today: 1,382 of 10,000/.test(await pS.locator('.sheet').innerText()), 'neurons used today are tracked');
    const srcs = await pS.locator('.startertile img').evaluateAll((im) => im.map((i) => i.src));
    ok(srcs.length === 20 && new Set(srcs).size === 20, 'twenty tiles, twenty different pictures');
    const nReady = await pS.locator('.startertile.ready').count();
    ok(nReady >= 15 && /\d+ ready/.test(await pS.locator('.sheet .muted').first().innerText()), `${nReady} of 20 pass the check and fit the mannequin`);
    await pS.click('.starterlog summary');
    const logText = await pS.locator('.starterlog').innerText();
    ok((logText.match(/HTTP 200/g) || []).length === 24 && /saved as \/starter-draft\/starter-black-strapless-tube-top/.test(logText) && /Flat lay product photo/.test(logText) && /navy-halter-top try 3 · seed \d+ · cutout cleaned/.test(logText), 'the log lists every call (prompt, HTTP status, size, where it was saved) and the clean-up');
    writeFileSync(join(out, '40-starter-log.txt'), logText);
    await pS.screenshot({ path: join(out, '40-starter-review.png') });
    await pS.click('.startertile >> nth=3'); await pS.waitForFunction(() => document.querySelectorAll('.startertile.ok').length === 20);
    ok(cf.calls.length === 25 && cf.calls[24].seed !== cf.calls[3].seed, 'tapping a picture makes it again, with the next seed');
    await pS.click('#sbok'); await pS.waitForFunction((n) => window.__closet.items.length === n, nReady);
    ok(cf.used === 1440, `the day's neurons are counted on the server (${cf.used})`);
    const its = await pS.evaluate(() => Promise.all(window.__closet.items.map(async (i) => ({ s: i.source, t: i.type, o: i.occasions, c: i.color, w: !!i.cutout, id: i.starterId, bytes: i.original?.size, ready: i.ready }))));
    ok(its.every((i) => i.s === 'starter' && i.w && i.c?.hex && i.o.length && i.id) && its.some((i) => i.t === 'bodysuits') && its.some((i) => i.t === 'tanks'), 'approved pieces are saved with type, colours, occasions and source Starter');
    ok(its.every((i) => i.bytes === cf.sent[i.id]), 'every piece keeps the very picture Cloudflare sent for it (no mix-ups between pieces)');
    ok(its.length === nReady && its.every((i) => i.ready) && !its.some((i) => i.id === 'starter-navy-halter-top'), 'only Ready pieces are added: one that needs review never reaches the closet or the model');
    ok(new RegExp(`${nReady} of 140 ready · 0 need review .* · ${140 - nReady} not made yet`).test(await pS.locator('.starterready').innerText()), 'the closet reports ready vs need review');
    ok(await pS.locator('.piece .starterbadge').count() === nReady, 'each one carries a Starter badge');
    ok(/1 to make/.test(await pS.locator('[data-act=starterbatch][data-v=tops]').innerText()), 'the tops batch has only the piece that needed review left to make');
    await pS.screenshot({ path: join(out, '41-starter-closet.png') });
    // the daily limit: Cloudflare stops after 8 more; progress is kept and the rest carry on after the reset
    cf.limitAt = cf.calls.length + 8;
    await pS.click('[data-act=starterbatch][data-v=bottoms]'); await pS.waitForSelector('.limitnote');
    await pS.waitForFunction(() => !document.querySelector('.startertile.run'));
    const okN = await pS.locator('.startertile.ok').count();
    ok(okN === 8 && /carry on after 00:00 UTC \(in (\d+h )?\d+m\)/.test(await pS.locator('.limitnote').innerText()), `at the daily limit the batch pauses with ${okN} made and says when it resumes`);
    await pS.screenshot({ path: join(out, '42-starter-limit.png') });
    await pS.click('#sbcancel');
    ok(cf.used === 10000, 'at the limit the server records the day as used up');
    cf.limitAt = Infinity; cf.used = 0; const before = cf.calls.length; await pS.evaluate(() => localStorage.removeItem('starter_neurons')); // a new day
    await pS.click('[data-act=starterbatch][data-v=bottoms]'); await pS.waitForFunction(() => document.querySelectorAll('.startertile.ok').length === 20, null, { timeout: 90000 });
    ok(cf.calls.length - before === 12, `after the reset only the missing 12 are made; the 8 saved earlier are reused (made ${cf.calls.length - before})`);
    await pS.click('#sbcancel');
    await pS.click('.piece.is-starter .edit >> nth=0'); await pS.click('#ownit');
    await pS.click('[data-act=fsrc][data-v=mine]'); ok(await pS.locator('.piece').count() === 1, 'I own this makes it yours: the Mine filter shows it');
    await pS.click('[data-act=fsrc][data-v=starter]'); ok(await pS.locator('.piece').count() === nReady - 1, 'the Starter filter shows the rest');
    await pS.click('.piece.is-starter .edit >> nth=0'); await pS.click('#rm'); await pS.waitForFunction((n) => window.__closet.items.length === n, nReady - 1);
    ok(true, 'Remove takes a starter piece out');
    await pS.click('[data-act=hidestarter]'); await pS.waitForFunction(() => window.__closet && window.__closet.items.length === 1);
    ok(await pS.evaluate(() => window.__closet.items.every((i) => i.source !== 'starter')), 'hiding starter pieces leaves only yours everywhere');
    await pS.context().close();
  }

  // a starter piece approved by the older check is checked again on load: one with dress-form scraps or the wrong colour leaves the closet
  {
    const pR = await mk();
    await pR.evaluate(async ([bad, good]) => {
      const { put } = await import('/js/db.js'), blob = (b64) => fetch('data:image/png;base64,' + b64).then((r) => r.blob());
      const mkIt = async (id, sid, name, b64) => ({ id, starterId: sid, source: 'starter', ready: true, name, type: 'tops', occasions: ['Brunch'], season: 'all', cutout: await blob(b64), original: await blob(b64), createdAt: 1, updatedAt: 1 });
      await put('items', await mkIt('old1', 'starter-navy-halter-top', 'Navy halter top', bad));
      await put('items', await mkIt('old2', 'starter-black-fitted-tee', 'Black fitted tee', good));
    }, [readFileSync(new URL('./fixtures/shot_dress.png', import.meta.url)).toString('base64'), readFileSync(new URL('./fixtures/white/dress.png', import.meta.url)).toString('base64')]);
    await pR.reload(); await pR.waitForFunction(() => window.__closet && (window.__closet.starterReview || []).length >= 1, null, { timeout: 30000 });
    const st = await pR.evaluate(() => ({ items: window.__closet.items.map((i) => i.name), review: window.__closet.starterReview.map((i) => i.name) }));
    ok(st.review.includes('Navy halter top') && !st.items.includes('Navy halter top'), `an older starter piece that fails today's check is taken off the closet and the model (${JSON.stringify(st)})`);
    await pR.context().close();
  }

  // accessibility: axe on each view + dialog
  const axe = async (name) => {
    await p2.evaluate(axeSource);
    const r = await p2.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad = r.violations.filter((v) => v.impact !== 'minor');
    ok(bad.length === 0, `axe (${name}): ${bad.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
  };
  for (const v of ['closet', 'tryon', 'plan', 'planner', 'inspo']) { await p2.click(`[data-view=${v}]`); await axe(v); }
  await p2.click('[data-view=closet]'); await p2.click('header [data-act=add]'); await axe('add dialog'); await p2.keyboard.press('Escape');
  ok(await p2.evaluate(() => !document.querySelector('main').inert), 'Esc closes dialog and restores the page');
} catch (e) { console.error(e); failed++; }

ok(errors.length === 0, `no console/page errors ${errors.join(' | ')}`);
console.log('screenshots in', out);
await browser.close(); server.kill(); mock.close();
process.exit(failed ? 1 : 0);
