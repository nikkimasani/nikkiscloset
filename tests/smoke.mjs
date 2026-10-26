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
const falCalls = [], aiCalls = [];
const RED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const { createServer } = await import('node:http');
const { readFileSync } = await import('node:fs');
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
  else if (req.method === 'POST' && (req.url === '/fal-ai/imageutils/rembg' || req.url === '/fal-ai/any-llm/vision')) {
    let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
      const body = JSON.parse(b); aiCalls.push({ path: req.url, auth: req.headers.authorization, hasImage: !!(body.image_url || body.image_urls?.[0])?.startsWith?.('data:image') || !!body.image_urls?.[0]?.startsWith('data:image') });
      if (req.url.includes('rembg')) send({ image: { url: `${base}/media/cut.png` } });
      else send({ output: 'Here you go: {"name":"Satin cami","type":"tanks","season":"light","occasions":["GNO","Date Night"],"brand":""}' });
    });
  }
  else if (req.url === '/pin/1') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><head><meta property="og:image" content="${base}/media/pin.png"></head></html>`); }
  else if (req.url === '/shop/1') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><head><title>x</title><meta property="og:title" content="Satin Cami Top | ZARA United States"><script type="application/ld+json">{"@type":"Product","name":"Satin Cami Top | ZARA","brand":{"name":"Zara"},"image":"${base}/media/shop.jpg","offers":{"price":"29.90"}}</script></head></html>`); }
  else if (req.url === '/media/shop.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(readFileSync(join(out, 'photo.jpg'))); }
  else if (req.url === '/media/cut.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(readFileSync(join(out, 'photo.jpg'))); } // a real picture, so colour suggestions have something to work with
  else if (req.url === '/media/pin.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(RED_PNG); }
  else if (req.url === '/media/out.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(RED_PNG); }
  else send({ detail: 'nope' }, 404);
}).listen(FAL);
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, FAL_KEY: 'test-key', APP_PASSCODE: 'letmein', FAL_QUEUE_BASE: `http://localhost:${FAL}`, FAL_RUN_BASE: `http://localhost:${FAL}`, PIN_ALLOW_HOSTS: `localhost:${FAL}`, PRODUCT_ALLOW_HOSTS: `localhost:${FAL}` }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const out = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'closet-'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// The existing tests exercise the mirror scene; the walk-in closet tests below reset this on purpose.
const mirrorFirst = (c) => c.addInitScript(() => { if (localStorage.getItem('scene') === null) localStorage.setItem('scene', 'mirror'); });
const _newContext = browser.newContext.bind(browser);
browser.newContext = async (o) => { const c = await _newContext(o); await mirrorFirst(c); return c; };
browser.newPage = async (o) => { const c = await _newContext(o); await mirrorFirst(c); return c.newPage(); };
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.addInitScript(() => localStorage.setItem('flat', '1')); // existing flows exercise the 2D fallback; 3D has its own section below
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failed = 0;
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
  const { writeFileSync } = await import('node:fs');
  writeFileSync(photo, Buffer.from(dataUrl.split(',')[1], 'base64'));

  await page.click('header [data-act=add]');
  await page.setInputFiles('#file', photo);
  await page.waitForSelector('#cutimg');
  const cut = await page.evaluate(async () => {
    const img = document.querySelector('#cutimg'); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, corner: x.getImageData(1, 1, 1, 1).data[3], mid: x.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] };
  });
  ok(cut.corner === 0 && cut.mid === 255, `background removed (corner alpha ${cut.corner}, centre alpha ${cut.mid})`);
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
  ok(await page.locator('#stage image').count() === 1, 'tapping a piece puts it on the mannequin');
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
  ok(await page.locator('.day .mannequin').count() === 1, 'OOTD appears on calendar');
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
  await p2.click('.empty [data-act=samples]');
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

  // ── personalised model ──
  await p2.click('[data-view=tryon]');
  // geometry: synthetic landmarks of a 1000x1500 photo -> garments land on the right body parts
  const geo = await p2.evaluate(async () => {
    const { fromLandmarks, place, measures } = await import('/js/body.js');
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
    const set = (i, x, y) => (lm[i] = { x, y, visibility: 1 });
    set(0, .5, .12); set(11, .6, .24); set(12, .4, .24); set(15, .66, .5); set(16, .34, .5);
    set(23, .56, .5); set(24, .44, .5); set(25, .57, .73); set(26, .43, .73); set(27, .57, .94); set(28, .43, .94);
    const { body, warnings } = fromLandmarks(lm, 1000, 1500);
    const m = measures(body), b = (t) => place(t, body);
    return { warnings, sw: m.sw, top: b('tops'), bottom: b('bottoms'), shoes: b('shoes'), dress: b('dresses'), skirt: b('skirts'),
      shoulderY: m.sm[1], hipY: m.hm[1], ankleY: m.am[1], L: body.pts.shL[0], R: body.pts.shR[0] };
  });
  ok(geo.warnings.length === 0 && geo.L < geo.R, 'landmarks -> body (image-left/right normalised, no warnings)');
  ok(geo.top.y < geo.shoulderY + 1 && geo.top.y > geo.shoulderY - 80 && geo.top.w > geo.sw * 1.4, 'top sits on the shoulders and is wider than them');
  ok(geo.bottom.y > geo.shoulderY && geo.bottom.y < geo.hipY && Math.abs(geo.bottom.y + geo.bottom.h - geo.ankleY) < 0.1 * geo.ankleY, 'trousers span waist to ankle');
  ok(Math.abs(geo.shoes.y + geo.shoes.h - (geo.ankleY + 0.12 * (geo.ankleY - geo.hipY))) < 5 || geo.shoes.y > geo.ankleY - 0.15 * geo.ankleY, 'shoes sit at the ankles');
  ok(geo.dress.y < geo.skirt.y, 'dress starts at shoulders, skirt at waist');

  // on-device pose model loads (under the production CSP) and handles an image with no person
  const pose = await p2.evaluate(async () => {
    const { detectPose } = await import('/js/pose.js');
    const c = document.createElement('canvas'); c.width = 200; c.height = 300;
    c.getContext('2d').fillStyle = '#ddd'; c.getContext('2d').fillRect(0, 0, 200, 300);
    try { return { r: await detectPose(c) }; } catch (e) { return { err: String(e) }; }
  });
  ok(!pose.err && pose.r === null, `pose model loads and returns null for an empty image ${pose.err || ''}`);

  // UI: proportions by hand
  const vb0 = await p2.getAttribute('#stage svg', 'viewBox');
  await p2.click('[data-act=drawer][data-v=me]');
  await p2.click('[data-act=setup]');
  ok(await p2.locator('[role=dialog][aria-modal=true]').isVisible(), 'model dialog opens');
  ok(await p2.evaluate(() => document.querySelector('main').inert), 'background inert while dialog is open');
  await p2.locator('#p-legs').fill('1.25');
  await p2.locator('#p-shoulders').fill('0.85');
  await p2.click('#msave');
  await p2.waitForSelector('#modal', { state: 'hidden' });
  const vb1 = await p2.getAttribute('#stage svg', 'viewBox');
  ok(vb0 !== vb1, `mannequin re-shaped to my proportions (${vb0} -> ${vb1})`);
  ok(await p2.locator('#stage image').count() >= 2, 'garments still render on the re-shaped body');
  await p2.reload(); await p2.click('[data-view=tryon]');
  ok((await p2.getAttribute('#stage svg', 'viewBox')) === vb1, 'my proportions persist after reload');

  // UI: photo -> calibration handles (a drawn figure; detector may or may not accept it) -> photo mode
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
  await p2.waitForSelector('#cal .handle', { timeout: 60000 });
  ok((await p2.locator('#cal .handle').count()) === 11, '11 draggable body points shown');
  const h = p2.locator('#cal [data-k=shL]');
  const before = await h.getAttribute('cx');
  await h.focus(); await p2.keyboard.press('Shift+ArrowRight');
  const after = await p2.locator('#cal [data-k=shL]').getAttribute('cx');
  ok(+after > +before, `body point moves with the keyboard (${before} -> ${after})`);
  await p2.screenshot({ path: join(out, '7-calibrate.png') });
  await p2.click('#msave');
  await p2.waitForSelector('[data-act=display][data-v=photo]:not([disabled])');
  await p2.click('[data-act=styleme]');
  ok(await p2.locator('#stage svg > image').count() === 1, 'photo is the model base');
  ok(await p2.locator('#stage g[data-slot]').count() >= 2, 'garments are layered on the photo');
  await p2.screenshot({ path: join(out, '8-photo-model.png') });


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
  await p2.waitForSelector('#stage svg > image[href^="data:image/png"]', { timeout: 30000 });
  ok(falCalls.length >= 1 && falCalls.every((c) => c.auth === 'Key test-key'), `fal called with the server-side key (${falCalls.length} calls)`);
  ok(falCalls.length < 2 || falCalls[1].model_image.startsWith('data:image/png'), 'multi-piece outfit chains each result into the next piece');
  ok(falCalls.every((c) => c.garment_image.startsWith('data:image/jpeg') && ['tops', 'bottoms', 'one-pieces'].includes(c.category)), 'garments sent as white-background JPEGs with a valid category');
  ok(await p2.locator('#stage svg > image').count() === 1, 'AI render replaces the photo as the base');
  await p2.screenshot({ path: join(out, '9-ai-render.png') });
  await p2.click('[data-act=aiclear]');
  ok(await p2.locator('#stage svg > image:not([href^="data:image/png"])').count() === 1, 'can go back to the quick preview');
  const callsAfterFirst = falCalls.length;
  ok(await p2.evaluate(() => JSON.parse(localStorage.getItem('spend')).n) === callsAfterFirst, 'the budget tracker counts the pieces rendered');
  await p2.click('[data-act=airender]');
  await p2.waitForSelector('#stage svg > image[href^="data:image/png"]');
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
    await p3.click('[data-act=samples]'); await p3.waitForFunction(() => window.__closet.items.length === 10);
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
    // customization
    await p3.click('[data-act=drawer][data-v=look]');
    await p3.click('[data-act=cas][data-v=style]'); await p3.click('[data-act=hairstyle][data-v=pony]');
    await p3.click('[data-act=cas][data-v=hair]'); await p3.click('[data-act=hair][data-v="#e8639a"]');
    await p3.click('[data-act=cas][data-v=skin]'); await p3.click('[data-act=skin][data-v="#8a5636"]');
    const saved = await p3.evaluate(() => ({ style: localStorage.getItem('hairstyle'), hair: localStorage.getItem('hair'), skin: localStorage.getItem('skin') }));
    ok(saved.style === 'pony' && saved.hair === '#e8639a' && saved.skin === '#8a5636', 'appearance choices are saved on the device');
    const svgHtml = await p3.locator('#stage svg.doll').innerHTML();
    ok(svgHtml.includes('#8a5636') && svgHtml.includes('#e8639a'), 'skin and hair colours reach the doll');
    await p3.evaluate(axeSource);
    const r4 = await p3.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad4 = r4.violations.filter((v) => v.impact !== 'minor');
    ok(bad4.length === 0, `axe (customize tab): ${bad4.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await p3.click('[data-act=resetlook]');
    ok((await p3.evaluate(() => localStorage.getItem('shape'))) === '', 'Reset appearance clears customizations');
    // ── the daily challenge: theme, rating with reasons, coins, streak ──
    ok(/Theme:/.test(await p3.locator('.gamebar .gb-theme').innerText()), 'the day starts with a themed challenge banner');
    const coins0 = await p3.evaluate(() => window.__closet.game.coins), energy0 = await p3.evaluate(() => window.__closet.game.day.energy);
    ok(energy0 < 100, `changing the outfit costs a little energy (${energy0}/100)`);
    await p3.click('[data-act=rate]'); await p3.waitForSelector('.reveal .star.on');
    const rv = await p3.evaluate(() => ({ stars: document.querySelectorAll('.reveal .star.on').length, parts: document.querySelectorAll('.reveal .parts li').length, coins: window.__closet.game.coins, notes: [...document.querySelectorAll('.reveal .parts small')].every((n) => n.textContent.length > 5) }));
    ok(rv.stars >= 1 && rv.parts === 5 && rv.notes && rv.coins > coins0, `rating shows stars (${rv.stars}), five reasons from your tags, and pays coins (${coins0} -> ${rv.coins})`);
    await p3.evaluate(axeSource);
    const rr = await p3.evaluate(() => window.axe.run(document.querySelector('#modal'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    ok(rr.violations.filter((v) => v.impact !== 'minor').length === 0, `axe (rating reveal): ${rr.violations.map((v) => v.id).join(', ') || 'no violations'}`);
    await p3.screenshot({ path: join(out, '11-reveal.png') });
    await p3.click('#rwclose');
    await p3.click('[data-act=rate]'); await p3.waitForSelector('.reveal .star.on');
    ok((await p3.evaluate(() => window.__closet.game.coins)) === rv.coins, 'rating the same look again pays nothing more');
    await p3.click('#rwclose');
    await p3.reload(); await p3.waitForFunction(() => window.__closet.game.coins > 0);
    ok((await p3.evaluate(() => window.__closet.game.coins)) === rv.coins, 'coins are kept after a reload');
  }
  // an event on today's date becomes the day's challenge
  {
    const cE = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await cE.addInitScript(() => localStorage.setItem('flat', '1'));
    const pE = await cE.newPage(); pE.on('pageerror', (e) => errors.push(e.message));
    await pE.goto(`http://localhost:${PORT}/`); await pE.waitForFunction(() => window.__closet);
    await pE.click('[data-view=plan]'); await pE.fill('#evtitle', 'Sam’s dinner'); await pE.selectOption('#evocc', 'Dinner'); await pE.click('[data-act=evadd]');
    await pE.click('[data-view=tryon]'); await pE.waitForSelector('.gamebar');
    ok(/Sam’s dinner/.test(await pE.locator('.gamebar .gb-theme').innerText()) && /from your plan/.test(await pE.locator('.gamebar').innerText()), 'an event added in Plan becomes today’s challenge');
  }


  // ── audit regressions ──
  const mk = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true }); await c.addInitScript(() => localStorage.setItem('flat', '1')); const pg = await c.newPage(); pg.on('pageerror', (e) => errors.push(e.message)); pg.on('dialog', (d) => d.accept()); await pg.goto(`http://localhost:${PORT}/`); await pg.waitForFunction(() => window.__closet); return pg; };
  const p4 = await mk();
  ok(!(await p4.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('three.module')))), 'flat mode never downloads the 3D engine');
  await p4.click('[data-act=samples]'); await p4.waitForFunction(() => window.__closet.items.length === 10);
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
  // a new model replaces a body-type preset
  await p4.click('[data-view=tryon]'); await p4.click('[data-act=drawer][data-v=look]'); await p4.click('[data-act=cas][data-v=body]'); await p4.click('[data-act=bodytype][data-v=Petite]');
  ok(await p4.evaluate(() => !!localStorage.getItem('shape')), 'body type preset is saved');
  await p4.click('[data-act=drawer][data-v=me]'); await p4.click('[data-act=setup]'); await p4.locator('#p-legs').fill('1.2'); await p4.click('#msave');
  await p4.waitForFunction(() => localStorage.getItem('shape') === '');
  ok(true, 'saving a new model clears the old body-type override');
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
  await p6.click('[data-view=tryon]'); await p6.click('[data-act=drawer][data-v=look]'); await p6.click('[data-act=cas][data-v=style]'); await p6.click('[data-act=hairstyle][data-v=bob]'); await p6.click('[data-act=resetlook]');
  await p6.reload(); await p6.waitForFunction(() => window.__closet);
  const dflt = await p6.evaluate(() => ({ skin: window.__closet.skin, hair: window.__closet.hair, style: window.__closet.hairStyle }));
  ok(/^#[0-9a-f]{6}$/i.test(dflt.skin) && /^#[0-9a-f]{6}$/i.test(dflt.hair) && dflt.style === 'long', 'Reset appearance survives a reload (defaults, not blanks)');
  await p6.click('[data-view=closet]');
  const [dl2] = await Promise.all([p6.waitForEvent('download'), p6.click('[data-act=export]')]);
  const bak2 = join(out, 'backup-default.json'); await dl2.saveAs(bak2);
  const p7 = await mk(); await p7.click('[data-view=closet]'); await p7.setInputFiles('#restore', bak2); await p7.waitForSelector('#toast.show'); await p7.waitForFunction(() => window.__closet && window.__closet.skin);
  const rest = await p7.evaluate(() => ({ skin: window.__closet.skin, style: window.__closet.hairStyle }));
  ok(/^#[0-9a-f]{6}$/i.test(rest.skin) && rest.style === 'long', 'restoring a default-appearance backup keeps the defaults');


  // ── batch A: price/cost-per-wear, weather, week plan, packing, gaps, wishlist, insights, streak ──
  const p8 = await mk();
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days7 = Array.from({ length: 7 }, (_, n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); });
  await p8.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'Houston', admin1: 'Texas', latitude: 29.76, longitude: -95.37 }] } }));
  await p8.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: days7, temperature_2m_max: [5, 12, 20, 26, 31, 18, 9], temperature_2m_min: [1, 6, 13, 19, 24, 12, 3], precipitation_probability_max: [80, 0, 10, 0, 0, 60, 0], weathercode: [61, 0, 1, 0, 0, 63, 3] } } }));
  await p8.click('[data-act=samples]'); await p8.waitForFunction(() => window.__closet.items.length === 10);
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
  ok(await p8.locator('[role=dialog]').isVisible() && (await p8.inputValue('#type')) !== '', '“Got it” opens Add piece with the type filled in');
  await p8.keyboard.press('Escape');
  await p8.evaluate(axeSource);
  const rp = await p8.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
  const badp = rp.violations.filter((v) => v.impact !== 'minor');
  ok(badp.length === 0, `axe (Plan tab): ${badp.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
  await p8.screenshot({ path: join(out, '11-plan.png'), fullPage: true });
  // price -> cost per wear -> insights + streak (fresh closet, so no earlier wears interfere)
  const p9 = await mk(); await p9.click('[data-act=samples]'); await p9.waitForFunction(() => window.__closet.items.length === 10);
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
  const p10 = await mk();
  await p10.click('[data-act=samples]'); await p10.waitForFunction(() => window.__closet.items.length === 10);
  await p10.click('[data-act=drawer][data-v=look]');
  await p10.click('[data-act=cas][data-v=room]'); await p10.click('[data-act=room][data-v=night]'); await p10.click('[data-act=cas][data-v=eyes]'); await p10.click('[data-act=eyes]:nth-of-type(4)'); await p10.click('[data-act=cas][data-v=lips]'); await p10.click('[data-act=lips]:nth-of-type(2)');
  const look = await p10.evaluate(() => ({ cls: document.querySelector('.room').className, eyes: localStorage.getItem('eyes'), lips: localStorage.getItem('lips'), room: localStorage.getItem('room') }));
  ok(look.cls.includes('theme-night') && look.room === 'night' && look.eyes && look.lips, 'room theme, eye and lip colours apply and are saved');
  ok((await p10.locator('.mannequin').first().innerHTML()).includes(look.lips), 'the chosen lip colour is drawn on the model');
  await p10.click('[data-act=resetlook]');
  ok((await p10.evaluate(() => document.querySelector('.room').className)).match(/theme-(spring|pastel|autumn|winter)/) && (await p10.evaluate(() => localStorage.getItem('room'))) === '', 'Reset appearance returns the room to the seasonal default');


  // ── batch B: AI helpers (cutout, auto-fill, Pinterest import) ──
  const p11 = await mk();
  await p11.click('header [data-act=add]'); await p11.setInputFiles('#file', join(out, 'photo.jpg')); await p11.waitForSelector('#cutimg');
  await p11.fill('#mpass', 'wrong'); await p11.click('#aitag');
  await p11.waitForFunction(() => /Wrong passcode/.test(document.querySelector('#aimsg').textContent));
  ok(aiCalls.length === 0, 'a wrong passcode never reaches fal');
  await p11.fill('#mpass', 'letmein'); await p11.click('#aitag');
  await p11.waitForFunction(() => /Filled in/.test(document.querySelector('#aimsg').textContent));
  ok((await p11.inputValue('#name')) === 'Satin cami' && (await p11.inputValue('#type')) === 'tanks' && (await p11.inputValue('#season')) === 'light', 'Auto-fill sets name, type and warmth from the photo');
  ok((await p11.locator('#occs [aria-pressed=true]').allInnerTexts()).sort().join() === 'Date Night,GNO', 'Auto-fill ticks the suggested occasions');
  await p11.click('#aicut'); await p11.waitForSelector('#aiundo');
  ok(aiCalls.length === 2 && aiCalls.every((c) => c.auth === 'Key test-key' && c.hasImage), 'both helpers called fal with the server-side key and an image');
  ok(await p11.locator('#tol').isDisabled(), 'on-device sliders switch off while the AI cutout is used');
  await p11.click('#aiundo');
  ok(!(await p11.locator('#aiundo').count()) && !(await p11.locator('#tol').isDisabled()), 'can go back to the on-device cutout');
  await p11.click('#save'); await p11.waitForFunction(() => window.__closet.items.length === 1);
  ok((await p11.evaluate(() => window.__closet.items[0].type)) === 'tanks', 'the auto-filled piece is saved');
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
  await pI.waitForSelector('#cutimg');
  ok((await pI.inputValue('#name')) === 'Satin Cami Top' && (await pI.inputValue('#brand')) === 'Zara' && (await pI.inputValue('#price')) === '29.9', 'a product link fills in the name, brand and price');
  ok((await pI.inputValue('#type')) === 'tanks' && /guessed/.test(await pI.locator('label[for=type]').innerText()), 'the category is guessed from the title and flagged as a guess');
  ok((await pI.locator('.cswatch').count()) > 0 && (await pI.locator('#cutimg').count()) === 1, 'colours are suggested from the cutout');
  await pI.click('#saveadd'); await pI.waitForFunction(() => window.__closet.items.length === 1);
  await pI.waitForSelector('#srcpick');
  ok((await pI.inputValue('#name')) === '' && (await pI.evaluate(() => window.__closet.items[0].colors.length)) > 0, 'Save & add another keeps the first piece and opens a blank form');
  const calls0 = aiCalls.length;
  await pI.evaluate(() => localStorage.setItem('aipass', 'letmein'));
  await pI.click('#cancel'); await pI.click('header [data-act=add]'); await pI.setInputFiles('#file', join(out, 'photo.jpg'));
  await pI.waitForSelector('#aiundo'); await pI.waitForFunction(() => /Filled in/.test(document.querySelector('#aimsg').textContent));
  ok(aiCalls.length - calls0 === 2 && (await pI.inputValue('#name')) === 'Satin cami', 'with a saved passcode the AI cuts out and describes a new photo by itself');
  await pI.click('#cancel'); await pI.click('header [data-act=add]');
  await pI.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 100; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 80, 100); x.fillStyle = '#2a8c8c'; x.fillRect(20, 10, 40, 80);
    const b = await new Promise((r) => c.toBlob(r, 'image/png')), dt = new DataTransfer(); dt.items.add(new File([b], 'p.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await pI.waitForSelector('#cutimg'); ok((await pI.locator('.cswatch').count()) > 0, 'pasting a picture (⌘/Ctrl+V) brings it into the add dialog');
  await pI.click('#cancel');
  await pI.goto(`http://localhost:${PORT}/?add=link&u=${encodeURIComponent('http://localhost:5198/shop/1')}`);
  await pI.waitForFunction(() => document.querySelector('#name')?.value === 'Satin Cami Top');
  ok((await pI.evaluate(() => location.search)) === '', 'a Shortcut link (?add=link&u=…) opens the dialog, fetches the product and tidies the address bar');
  await pI.evaluate(async () => { const c = document.createElement('canvas'); c.width = 60; c.height = 60; c.getContext('2d').fillRect(10, 10, 40, 40); const b = await new Promise((r) => c.toBlob(r, 'image/png')); await (await caches.open('closet-share')).put('/shared/photo', new Response(b, { headers: { 'content-type': 'image/png' } })); });
  await pI.goto(`http://localhost:${PORT}/?add=shared`); await pI.waitForSelector('#cutimg');
  ok(true, 'a picture shared into the installed app opens the add dialog');
  const lab = await pI.evaluate(async () => (await import('/js/browsercut.js')).labProbe());
  ok(lab === true, 'the hidden on-device cutout page starts and its model library loads under its own security policy');
  const hdr = await pI.evaluate(async () => { const r = await fetch('/lab/cutout.html'), m = await fetch('/'); return [r.headers.get('content-security-policy'), m.headers.get('content-security-policy')]; });
  ok(/staticimgly\.com/.test(hdr[0]) && /frame-ancestors 'self'/.test(hdr[0]) && !/staticimgly/.test(hdr[1]) && /frame-ancestors 'none'/.test(hdr[1]), 'only the lab page may reach the model host; the main app policy is unchanged');
  await pI.goto(`http://localhost:${PORT}/?add=paste`); await pI.waitForSelector('#srcpaste:focus');
  ok(/Tap Paste/.test(await pI.locator('#intakemsg').innerText()), '?add=paste opens the dialog ready for the Paste button');

  // ── phase 2: the 2D paper doll ──
  const cdl = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await cdl.addInitScript(() => localStorage.setItem('flat', '1'));
  const pdl = await cdl.newPage(); pdl.on('pageerror', (e) => errors.push(e.message)); pdl.on('dialog', (d) => d.accept());
  await pdl.goto(`http://localhost:${PORT}/`); await pdl.waitForSelector('svg.doll');
  ok((await pdl.locator('.dollmode').count()) === 1 && (await pdl.getAttribute('svg.doll', 'data-pack')) === 'studio', 'Dress up opens on the 2D doll by default, drawn from the swappable art pack');
  await pdl.click('[data-act=samples]'); await pdl.waitForFunction(() => window.__closet.items.length === 10);
  const wearOne = async (tab, name) => { await pdl.click(`[data-act=tab][data-v=${tab}]`); await pdl.click(`.pick:has-text("${name}")`); };
  await wearOne('tops', 'White tee'); await wearOne('bottoms', 'Blue jeans'); await wearOne('outerwear', 'Camel blazer'); await wearOne('shoes', 'Nude heels');
  const slots = () => pdl.evaluate(() => [...document.querySelectorAll('#stage .gar')].map((g) => g.dataset.slot));
  ok(JSON.stringify(await slots()) === JSON.stringify(['shoes', 'bottom', 'top', 'outer']), 'layers stack correctly: shoes, bottom, top, jacket over top');
  ok((await pdl.locator('#stage .gar image').first().getAttribute('href')).startsWith('blob:'), 'the real photo cutouts are what is drawn on the doll');
  // fit: select the top, nudge, and it is remembered
  await pdl.click('.dfpieces [data-act=fit]:has-text("Top")');
  const tfm = () => pdl.getAttribute('#stage .gar[data-slot=top]', 'transform');
  const tf0 = await tfm();
  await pdl.dispatchEvent('[data-act=dnudge][data-v="x:3"]', 'pointerdown'); await pdl.dispatchEvent('[data-act=dnudge][data-v="x:3"]', 'pointerup');
  ok((await tfm()) !== tf0, 'a nudge button moves the piece');
  await pdl.dispatchEvent('[data-act=dsize][data-v="0.03"]', 'pointerdown'); await pdl.dispatchEvent('[data-act=dsize][data-v="0.03"]', 'pointerup');
  await pdl.dispatchEvent('[data-act=drot][data-v="2"]', 'pointerdown'); await pdl.dispatchEvent('[data-act=drot][data-v="2"]', 'pointerup');
  const saved = () => pdl.evaluate(() => window.__closet.items.find((i) => i.name === 'White tee').fit?.studio);
  await pdl.waitForFunction(() => window.__closet.items.find((i) => i.name === 'White tee').fit?.studio?.dx > 0);
  const f1 = await saved(); ok(f1.dx > 0 && f1.scale > 1 && f1.rot > 0, `size, turn and position are all kept (${JSON.stringify(f1)})`);
  // drag the piece on the doll
  const box = await pdl.locator('#stage svg.doll').boundingBox(), dx0 = f1.dx;
  await pdl.mouse.move(box.x + box.width / 2, box.y + box.height * 0.42); await pdl.mouse.down(); await pdl.mouse.move(box.x + box.width / 2 + 40, box.y + box.height * 0.42 + 20, { steps: 4 }); await pdl.mouse.up();
  const f2 = await pdl.evaluate(() => window.__closet.items.find((i) => i.name === 'Camel blazer').fit?.studio || {});
  ok(f2.dx > 10 && f2.dy > 5 && (await saved()).dx === dx0, `touching a piece selects it and dragging moves just that piece (jacket moved ${Math.round(f2.dx)}, ${Math.round(f2.dy)}; tee stayed)`);
  await pdl.click('.dfpieces [data-act=fit]:has-text("Top")');
  // tucked in: the top goes under the bottoms and is cut at the waist
  await pdl.click('[data-act=dtuck]'); await pdl.waitForFunction(() => document.querySelector('#stage .gar').dataset.slot === 'shoes' && document.querySelectorAll('#stage .gar')[1].dataset.slot === 'top');
  ok(JSON.stringify(await slots()) === JSON.stringify(['shoes', 'top', 'bottom', 'outer']) && (await pdl.locator('#stage [clip-path] .gar[data-slot=top]').count()) === 1, 'tucking in puts the top under the bottoms');
  await pdl.click('[data-act=dtuck]'); await pdl.waitForFunction(() => document.querySelectorAll('#stage .gar')[1].dataset.slot === 'bottom');
  ok(JSON.stringify(await slots()) === JSON.stringify(['shoes', 'bottom', 'top', 'outer']), 'and untucking puts it back over them');
  await pdl.reload(); await pdl.waitForSelector('svg.doll'); await pdl.waitForFunction(() => window.__closet.items.find((i) => i.name === 'White tee').fit?.studio?.dx > 0);
  ok(true, 'fit survives a reload');
  await pdl.click('[data-act=samples]').catch(() => {});
  await pdl.click('[data-act=dreset]').catch(() => {});
  await pdl.click('[data-act=drawer][data-v=look]'); await pdl.click('[data-act=skin]:nth-of-type(9)');
  ok((await pdl.locator('#stage svg.doll').innerHTML()).includes(await pdl.evaluate(() => window.__closet.skin)), 'the customizer’s skin colour reaches the doll');
  ok((await pdl.locator('.cas-tabs [data-v=body]').count()) === 0, 'body sliders are hidden for the doll (they shape the 3D model)');
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
  await devA.click('[data-view=closet]'); await devA.click('[data-act=samples]'); await devA.waitForFunction(() => window.__closet.items.length === 10);
  await devA.fill('#synckey', 'wrong-key'); await devA.click('[data-act=syncconnect]');
  await devA.waitForFunction(() => /rejected/.test(document.querySelector('#syncmsg')?.textContent || ''));
  ok(cloud.records.size === 0, 'a wrong sync key is refused and nothing is uploaded');
  await devA.fill('#synckey', 'Amber Apple Arrow'); await devA.click('[data-act=syncconnect]');
  await devA.waitForFunction(() => /Synced/.test(document.querySelector('#syncmsg')?.textContent || ''));
  ok([...cloud.records.keys()].filter((k) => k.startsWith('items/')).length === 10 && cloud.blobs.size >= 10, 'device A uploads its pieces and their photos');
  await devB.click('[data-view=closet]'); await devB.fill('#synckey', SYNC_KEY); await devB.click('[data-act=syncconnect]');
  await devB.waitForFunction(() => window.__closet?.items?.length === 10);
  ok(await devB.evaluate(() => window.__closet.items.every((i) => i.cutout instanceof Blob && i.cutout.size > 0)), 'device B receives the pieces with working photos');
  await devA.evaluate(() => { const i = window.__closet.items[0]; return import('/js/db.js').then((m) => m.put('items', { ...i, name: 'Renamed on A' })); });
  await devA.click('[data-act=syncnow]'); await devA.waitForFunction(() => /Synced/.test(document.querySelector('#syncmsg')?.textContent || ''));
  await devB.click('[data-view=closet]'); await devB.click('[data-act=syncnow]'); await devB.waitForFunction(() => window.__closet?.items?.some((i) => i.name === 'Renamed on A'));
  ok(true, 'an edit on one device reaches the other (newest edit wins)');
  await devB.click('[data-view=closet]'); await devB.click('[data-act=rmsamples]'); await devB.waitForFunction(() => window.__closet.items.length === 0);
  await devB.click('[data-act=syncnow]'); await devB.waitForFunction(() => /Synced/.test(document.querySelector('#syncmsg')?.textContent || ''));
  await devA.click('[data-view=closet]'); await devA.click('[data-act=syncnow]'); await devA.waitForFunction(() => window.__closet?.items?.length === 0);
  ok(true, 'a delete on one device removes the piece on the other');

  // front + back photos: the back photo is kept with the piece
  const pB = await mk(); await pB.click('[data-view=closet]'); await pB.click('[data-act=samples]'); await pB.waitForFunction(() => window.__closet.items.length === 10);
  await pB.locator('.piece:has-text("White tee") .edit').click();
  const backPhoto = join(out, 'back.jpg'); writeFileSync(backPhoto, Buffer.from((await pB.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#e8dfd0'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#2a4d9b'; x.beginPath(); x.moveTo(220, 100); x.lineTo(380, 100); x.lineTo(470, 700); x.lineTo(130, 700); x.fill(); return c.toDataURL('image/jpeg', 0.9); })).split(',')[1], 'base64'));
  await pB.setInputFiles('#backfile', backPhoto); await pB.waitForSelector('.backthumb');
  await pB.click('#save'); await pB.waitForFunction(() => window.__closet.items.some((i) => i.name === 'White tee' && i.backCutout instanceof Blob && i.backCutout.size > 0));
  ok(true, 'a back photo is saved with the piece');
  await pB.click('[data-view=closet]'); await pB.locator('.piece:has-text("White tee") .edit').click(); await pB.click('#backrm'); await pB.click('#save');
  await pB.waitForFunction(() => !window.__closet.items.find((i) => i.name === 'White tee').backCutout);
  ok(true, 'the back photo can be removed');

  // ── phase 3: the 3D apartment ──
  const ca = await _newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); await ca.addInitScript(() => localStorage.setItem('scene', 'apt'));
  const pa = await ca.newPage(); pa.setDefaultTimeout(120000); pa.on('pageerror', (e) => errors.push(e.message)); pa.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pa.goto(`http://localhost:${PORT}/`); await pa.waitForFunction(() => window.__closet);
  if (!(await pa.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } }))) console.log('SKIP  apartment tests (no WebGL in this browser)');
  else {
    await pa.waitForFunction(() => window.__apt?.debug()?.ready, null, { timeout: 180000 });
    const d0 = await pa.evaluate(() => window.__apt.debug());
    ok(await pa.locator('.room.apt .gamebar .gb-theme').count() === 1, 'the apartment shows the day’s challenge banner');
    ok(JSON.stringify(d0.stations) === JSON.stringify(['wardrobe', 'vanity', 'mirror', 'bed', 'desk']) && d0.solids >= 10, `the apartment has its five stations and ${d0.solids} solid pieces of furniture`);
    await pa.screenshot({ path: join(out, '20-apartment.png') });
    await pa.locator('#stage canvas').focus();
    await pa.keyboard.down('ArrowUp'); await pa.waitForTimeout(1200); await pa.keyboard.up('ArrowUp');
    ok((await pa.evaluate(() => window.__apt.debug().pos[1])) < d0.pos[1] - 0.3, 'the arrow keys walk the avatar forward');
    // the camera must never end up inside furniture, wherever you stand and however you turn
    let inside = 0, checked = 0;
    for (const [x, z] of [[-4.7, 2.4], [-3.7, 3.4], [5.3, 1.5], [4.2, 3.3], [0, -4.2], [-3, -2.8], [2.8, -2.4], [-6.3, 4.6], [6.2, -3.5], [-2.4, 0.3]]) {
      await pa.evaluate(([x, z]) => window.__apt.teleport(x, z), [x, z]);
      for (let turn = 0; turn < 4; turn++) { await pa.evaluate(() => window.__apt.rotateCam(2)); let dbg; for (let n = 0; n < 12; n++) { await pa.waitForTimeout(350); dbg = await pa.evaluate(() => window.__apt.debug()); if (!dbg.camInsideFurniture && dbg.camDist >= 0.85) break; } checked++; if (dbg.camInsideFurniture || dbg.camDist < 0.85) { inside++; console.log('  camera problem at', x, z, JSON.stringify(dbg.cam), dbg.camDist); } }
    }
    ok(inside === 0, `the follow camera never clips into furniture (${checked} viewpoints checked)`);
    await pa.evaluate(() => window.__apt.teleport(0, 2.6));
    // walk to the wardrobe: its full-screen screen opens by itself
    await pa.click('[data-act=gostation][data-v=wardrobe]');
    await pa.waitForSelector('#stationui:not([hidden]) #sttitle', { timeout: 120000 });
    ok(/Wardrobe/.test(await pa.locator('#sttitle').innerText()), 'walking up to the wardrobe opens its screen');
    await pa.click('[data-act=samples]'); await pa.waitForFunction(() => window.__closet.items.length === 10); await pa.waitForSelector('.st-grid .pick');
    await pa.click('.st-grid .pick >> nth=0');
    ok((await pa.locator('#stationui .st-doll .gar').count()) === 1 && await pa.evaluate(() => Object.keys(window.__closet.outfit).length === 1), 'picking a piece dresses the doll');
    await pa.evaluate(axeSource);
    const ra = await pa.evaluate(() => window.axe.run(document.querySelector('#stationui'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bada = ra.violations.filter((v) => v.impact !== 'minor');
    ok(bada.length === 0, `axe (wardrobe screen): ${bada.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await pa.screenshot({ path: join(out, '21-wardrobe.png') });
    await pa.keyboard.press('Escape');
    ok(await pa.locator('#stationui').isHidden() && await pa.evaluate(() => !document.querySelector('main').inert), 'Esc closes the screen and gives the apartment back');
    // vanity: look and avatar
    await pa.click('[data-act=gostation][data-v=vanity]'); await pa.waitForSelector('#stationui:not([hidden]) .cas', { timeout: 120000 });
    await pa.click('[data-act=cas][data-v=avatar]'); await pa.click('[data-act=avatar][data-v=mini_male_b]');
    await pa.click('[data-act=cas][data-v=hair]'); await pa.click('[data-act=hair][data-v="#7c4dff"]');
    ok((await pa.evaluate(() => [localStorage.getItem('avatar'), localStorage.getItem('hair')])).join() === 'mini_male_b,#7c4dff', 'the vanity changes the avatar and its hair colour');
    await pa.click('[data-act=stclose]');
    // bed: end the day
    await pa.click('[data-act=gostation][data-v=bed]'); await pa.waitForSelector('#stationui:not([hidden])', { timeout: 120000 });
    await pa.waitForFunction(() => /Bed/.test(document.querySelector('#sttitle')?.textContent || ''));
    await pa.click('[data-act=endday]'); await pa.waitForFunction(() => window.__closet.wears.length >= 1 && window.__closet.game.day.ended);
    ok(true, 'the bed logs today’s outfit and ends the day');
    await pa.click('[data-act=stclose]');
    // mirror and desk take you to the doll and the planner
    await pa.click('[data-act=gostation][data-v=mirror]'); await pa.waitForSelector('.dollmode svg.doll', { timeout: 120000 });
    ok(await pa.evaluate(() => !window.__apt?.running), 'the mirror takes you to the doll (and the apartment stops running)');
    await pa.click('[data-act=scene][data-v=apt]'); await pa.waitForFunction(() => window.__apt?.debug()?.ready, null, { timeout: 180000 });
    await pa.click('[data-act=gostation][data-v=desk]'); await pa.waitForSelector('[data-view=plan].on', { timeout: 120000 });
    ok(true, 'the desk opens the planner');
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
