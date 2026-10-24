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

const PORT = 5199;
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const out = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'closet-'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
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
  await page.waitForSelector('.piece');
  ok((await page.locator('.piece').count()) === 1, 'uploaded piece appears in closet');
  const colorName = await page.locator('.piece .meta').innerText();
  ok(/red/i.test(colorName), `colour auto-detected (${colorName.trim()})`);

  await page.reload();
  ok((await page.locator('.piece').count()) === 1, 'piece persists after reload (IndexedDB)');

  await page.click('[data-view=closet]');

  // Try on
  await page.click('.piece .img');
  ok(await page.locator('#stage image').count() === 1, 'tapping a piece puts it on the mannequin');
  await page.click('[data-act=tab][data-v=shoes]');
  await page.screenshot({ path: join(out, '2-tryon.png') });

  // Log + planner
  await page.fill('#lookname', 'Test look');
  await page.click('[data-act=savelook]');
  await page.waitForSelector('[data-act=loadlook]');
  ok(await page.locator('[data-act=loadlook]').count() === 1, 'look saved');
  await page.click('[data-act=wearToday]');
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
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(`http://localhost:${PORT}/`);
  await p2.click('.empty [data-act=samples]');
  await p2.waitForSelector('.piece');
  ok((await p2.locator('.piece').count()) === 10, 'sample closet loads 10 pieces');
  await p2.screenshot({ path: join(out, '5-closet.png'), fullPage: true });
  await p2.click('[data-view=tryon]');
  await p2.selectOption('#styleocc', 'Date Night');
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
  await p2.click('[data-act=setup]');
  ok(await p2.locator('[role=dialog][aria-modal=true]').isVisible(), 'model dialog opens');
  ok(await p2.evaluate(() => document.querySelector('main').inert), 'background inert while dialog is open');
  await p2.locator('#p-legs').fill('1.25');
  await p2.locator('#p-shoulders').fill('0.85');
  await p2.click('#msave');
  await p2.waitForSelector('#stage svg');
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

  // accessibility: axe on each view + dialog
  const axe = async (name) => {
    await p2.evaluate(axeSource);
    const r = await p2.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const bad = r.violations.filter((v) => v.impact !== 'minor');
    ok(bad.length === 0, `axe (${name}): ${bad.map((v) => `${v.id}[${v.nodes.map((n) => n.target).join(' ')}]`).join('; ') || 'no violations'}`);
  };
  for (const v of ['closet', 'tryon', 'planner', 'inspo']) { await p2.click(`[data-view=${v}]`); await axe(v); }
  await p2.click('[data-view=closet]'); await p2.click('header [data-act=add]'); await axe('add dialog'); await p2.keyboard.press('Escape');
  ok(await p2.evaluate(() => !document.querySelector('main').inert), 'Esc closes dialog and restores the page');
} catch (e) { console.error(e); failed++; }

ok(errors.length === 0, `no console/page errors ${errors.join(' | ')}`);
console.log('screenshots in', out);
await browser.close(); server.kill();
process.exit(failed ? 1 : 0);
