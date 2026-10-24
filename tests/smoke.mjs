// End-to-end smoke test in headless Chromium. Run: npm start (other terminal) then npm test,
// or let this script start its own server.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

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
  await page.waitForSelector('#toast:not([hidden])');
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
} catch (e) { console.error(e); failed++; }

ok(errors.length === 0, `no console/page errors ${errors.join(' | ')}`);
console.log('screenshots in', out);
await browser.close(); server.kill();
process.exit(failed ? 1 : 0);
