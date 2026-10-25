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
const falCalls = [];
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
  else if (req.url === '/media/out.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(RED_PNG); }
  else send({ detail: 'nope' }, 404);
}).listen(FAL);
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT, FAL_KEY: 'test-key', APP_PASSCODE: 'letmein', FAL_QUEUE_BASE: `http://localhost:${FAL}` }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const out = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'closet-'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.addInitScript(() => localStorage.setItem('flat', '1')); // existing flows exercise the 2D fallback; 3D has its own section below
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failed = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failed++; };

try {
  await page.goto(`http://localhost:${PORT}/`);
  ok(await page.locator('.empty').isVisible(), 'empty state shows');

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


  // ── 3D mannequin ──
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p3 = await c3.newPage(); p3.on('pageerror', (e) => errors.push(e.message)); p3.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p3.goto(`http://localhost:${PORT}/`);
  await p3.waitForFunction(() => window.__stage3d);
  if (!(await p3.evaluate(() => window.__stage3d.usable))) console.log('SKIP  3D tests (no WebGL in this browser)');
  else {
    await p3.click('[data-act=samples]'); await p3.waitForFunction(() => window.__closet.items.length === 10);
    await p3.click('[data-act=styleme]');
    await p3.waitForFunction(() => window.__stage3d.debug()?.garments >= 2, null, { timeout: 15000 });
    ok(await p3.locator('#stage canvas').count() === 1 && await p3.locator('#stage svg').count() === 0, '3D canvas replaces the flat mannequin');
    const filled = await p3.evaluate(() => { const c = document.querySelector('#stage canvas'), t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n / (t.width * t.height); });
    ok(filled > 0.04 && filled < 0.6, `figure is actually drawn (${(filled * 100).toFixed(1)}% of canvas)`);
    const dbg3 = await p3.evaluate(() => window.__stage3d.debug());
    ok(dbg3.depths.length >= 2 && dbg3.depths.every((d) => d >= 8), `clothes are real 3D volumes, not flat sheets (thickness per piece: ${dbg3.depths.join(', ')} units)`);
    const before = (await p3.evaluate(() => window.__stage3d.debug())).rot;
    await p3.click('[data-act=turn][data-v="1"]');
    ok(Math.abs((await p3.evaluate(() => window.__stage3d.debug())).rot - before - Math.PI / 4) < 1e-6, 'turn button rotates the model 45°');
    await p3.click('[data-act=turn][data-v="0"]');
    ok(Math.abs((await p3.evaluate(() => window.__stage3d.debug())).rot) < 1e-6, 'Front button returns to facing the camera');
    const box = await p3.locator('#stage canvas').boundingBox();
    await p3.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p3.mouse.down(); await p3.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 }); await p3.mouse.up();
    ok(Math.abs((await p3.evaluate(() => window.__stage3d.debug())).rot) > 0.3, 'dragging the model spins it');
    const types0 = (await p3.evaluate(() => window.__stage3d.debug())).types;
    await p3.click('[data-act=mood][data-v="Dinner"]'); await p3.click('[data-act=styleme]'); await p3.waitForTimeout(600);
    ok((await p3.evaluate(() => window.__stage3d.debug())).garments >= 2, `outfit changes update the 3D garments (was ${types0.join('+')})`);
    await p3.evaluate(axeSource);
    const r3 = await p3.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad3 = r3.violations.filter((v) => v.impact !== 'minor');
    ok(bad3.length === 0, `axe (3D dress-up): ${bad3.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await p3.screenshot({ path: join(out, '10-3d.png') });
    // customization
    await p3.click('[data-act=drawer][data-v=look]');
    await p3.click('[data-act=hairstyle][data-v=pony]'); await p3.click('[data-act=hair][data-v="#e8639a"]'); await p3.click('[data-act=skin][data-v="#8a5636"]');
    await p3.click('[data-act=bodytype][data-v="Plus size"]'); await p3.waitForTimeout(500);
    const saved = await p3.evaluate(() => ({ style: localStorage.getItem('hairstyle'), hair: localStorage.getItem('hair'), skin: localStorage.getItem('skin'), shape: JSON.parse(localStorage.getItem('shape') || 'null') }));
    ok(saved.style === 'pony' && saved.hair === '#e8639a' && saved.skin === '#8a5636' && saved.shape?.build > 1.2, 'appearance choices are saved on the device');
    await p3.locator('#sh-legs').fill('1.15');
    ok((await p3.evaluate(() => JSON.parse(localStorage.getItem('shape')))).legs === 1.15 && (await p3.evaluate(() => localStorage.getItem('shapename'))) === 'Custom', 'sliders fine-tune the body (preset becomes Custom)');
    const filled2 = await p3.evaluate(() => { const c = document.querySelector('#stage canvas'), t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n / (t.width * t.height); });
    ok(filled2 > 0.04 && filled2 < 0.6, `customized figure still renders in frame (${(filled2 * 100).toFixed(1)}% of canvas)`);
    await p3.evaluate(axeSource);
    const r4 = await p3.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad4 = r4.violations.filter((v) => v.impact !== 'minor');
    ok(bad4.length === 0, `axe (customize tab): ${bad4.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
    await p3.click('[data-act=resetlook]');
    ok((await p3.evaluate(() => localStorage.getItem('shape'))) === '', 'Reset appearance clears customizations');
    await p3.click('[data-act=drawer][data-v=me]'); await p3.check('#flat');
    ok(await p3.locator('#stage svg').count() === 1, 'Flat 2D toggle switches back to the SVG mannequin');
  }


  // ── audit regressions ──
  const mk = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true }); await c.addInitScript(() => localStorage.setItem('flat', '1')); const pg = await c.newPage(); pg.on('pageerror', (e) => errors.push(e.message)); pg.on('dialog', (d) => d.accept()); await pg.goto(`http://localhost:${PORT}/`); await pg.waitForFunction(() => window.__stage3d); return pg; };
  const p4 = await mk();
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
  await p4.click('[data-view=tryon]'); await p4.click('[data-act=drawer][data-v=look]'); await p4.click('[data-act=bodytype][data-v=Petite]');
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
  ok(backup.app === 'nikkis-closet' && backup.stores.items.length === 9 && backup.stores.items[0].cutout?.__blob?.startsWith('data:image/png'), 'backup file contains every piece with its image');
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
  await p6.click('[data-view=tryon]'); await p6.click('[data-act=drawer][data-v=look]'); await p6.click('[data-act=hairstyle][data-v=bob]'); await p6.click('[data-act=resetlook]');
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
