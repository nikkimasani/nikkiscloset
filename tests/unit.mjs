// Pure-logic unit tests: node --test tests/unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { closetInsights, costPerWear, streak, gapAnalysis, wearCountMap } from '../public/js/insights.js';
import { bandFor, parseForecast, geocode, weatherEmoji } from '../public/js/weather.js';
import { styleMe, suitsWeather } from '../public/js/stylist.js';
import { planWeek, packingList } from '../public/js/planner.js';
import { outfitMeters } from '../public/js/meters.js';
import { colorName, hexDist, toLab, unhex } from '../public/js/color.js';
import { wear } from '../public/js/data.js';

const it = (id, type, extra = {}) => ({ id, name: id, type, occasions: ['Work / Office'], color: { hex: '#222222' }, createdAt: 0, ...extra });
const closet = [
  it('t1', 'tops', { price: 20, color: { hex: '#f4f1ea' } }), it('t2', 'tops', { price: 80, color: { hex: '#e6a9b8' } }), it('t3', 'tanks', { season: 'light' }),
  it('b1', 'bottoms', { price: 60, color: { hex: '#46628f' } }), it('s1', 'skirts', { season: 'light' }), it('d1', 'dresses'),
  it('o1', 'outerwear', { season: 'warm', color: { hex: '#c19a6b' } }), it('h1', 'shoes'), it('g1', 'bags'),
];

test('cost per wear divides price by wears, and is null without a price or wears', () => {
  const c = { t1: 4 };
  assert.equal(costPerWear(closet[0], c), 5);
  assert.equal(costPerWear(closet[2], c), null);
  assert.equal(costPerWear(closet[1], c), null);
});

test('insights: value, best value, dormant pieces', () => {
  const wears = [{ date: '2026-10-20', itemIds: ['t1', 'b1'] }, { date: '2026-10-21', itemIds: ['t1'] }, { date: '2026-01-02', itemIds: ['t2'] }];
  const r = closetInsights(closet, wears, '2026-10-25');
  assert.equal(r.value, 160);
  assert.equal(r.bestValue[0].item.id, 't1');
  assert.equal(r.bestValue[0].cpw, 10);
  assert.ok(r.dormant.some((d) => d.item.id === 't2' && d.days > 90), 'worn in January → dormant');
  assert.ok(r.dormant.every((d) => d.item.id !== 't1'));
});

test('streak counts consecutive logged days, tolerating an unlogged today', () => {
  const w = (d) => ({ date: d, itemIds: ['t1'] });
  assert.equal(streak([w('2026-10-25'), w('2026-10-24'), w('2026-10-23')], '2026-10-25'), 3);
  assert.equal(streak([w('2026-10-24'), w('2026-10-23')], '2026-10-25'), 2, 'today not logged yet → streak from yesterday');
  assert.equal(streak([w('2026-10-22')], '2026-10-25'), 0);
  assert.equal(streak([w('2026-10-25'), w('2026-10-23')], '2026-10-25'), 1, 'a gap breaks it');
  assert.equal(streak([w('2026-10-31'), w('2026-11-01')], '2026-11-01'), 2, 'month boundary');
});

test('gap analysis finds what an occasion is missing', () => {
  const rows = gapAnalysis([it('t', 'tops', { occasions: ['Brunch'] }), it('h', 'shoes', { occasions: ['Brunch'] })]);
  const brunch = rows.find((r) => r.occasion === 'Brunch');
  assert.deepEqual(brunch.missing, ['a bottom']);
  const none = rows.find((r) => r.occasion === 'Travel');
  assert.ok(none.missing.includes('shoes') && none.total === 0);
  assert.equal(gapAnalysis([it('d', 'dresses', { occasions: ['GNO'] }), it('h', 'shoes', { occasions: ['GNO'] })]).find((r) => r.occasion === 'GNO').missing.length, 0, 'dress + shoes is a full outfit');
});

test('weather bands and forecast parsing', () => {
  assert.deepEqual(['0', '10', '20', '26', '35'].map((n) => bandFor(+n)), ['cold', 'cool', 'mild', 'warm', 'hot']);
  const f = parseForecast({ daily: { time: ['2026-10-25', '2026-10-26'], temperature_2m_max: [5, 31], temperature_2m_min: [1, 22], precipitation_probability_max: [80, 0], weathercode: [61, 0] } });
  assert.equal(f[0].band, 'cold'); assert.equal(f[0].rain, 80); assert.equal(f[1].band, 'hot');
  assert.throws(() => parseForecast({}), /unexpected/);
  assert.equal(weatherEmoji(0), '☀️');
});

test('geocode returns the first hit and a friendly error for none', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ results: [{ name: 'Houston', admin1: 'Texas', latitude: 29.7, longitude: -95.3 }] }) });
  assert.deepEqual(await geocode('Houston', ok), { lat: 29.7, lon: -95.3, name: 'Houston, Texas' });
  await assert.rejects(geocode('zzzz', async () => ({ ok: true, json: async () => ({}) })), /No place called/);
});

test('weather rules: cold needs warm pieces, hot needs light ones', () => {
  assert.ok(suitsWeather({ season: 'warm' }, 'cold') && !suitsWeather({ season: 'light' }, 'cold'));
  assert.ok(suitsWeather({ season: 'light' }, 'hot') && !suitsWeather({ season: 'warm' }, 'hot'));
  assert.ok(suitsWeather({}, 'cold'), 'unlabelled = all-season');
});

test('Style me adds outerwear when cold or rainy, and skips it when hot', () => {
  let cold = 0, hot = 0;
  for (let n = 0; n < 40; n++) { if (styleMe(closet, '', {}, { band: 'cold' }).outer) cold++; if (styleMe(closet, '', {}, { band: 'hot' }).outer) hot++; }
  assert.equal(cold, 40); assert.equal(hot, 0);
  assert.ok(styleMe(closet, '', {}, { band: 'mild', rain: 90 }).outer, 'rain → layer');
});

test('week plan: one outfit per day, respects weather, avoids repeating pieces', () => {
  const days = ['2026-10-26', '2026-10-27', '2026-10-28'].map((date, n) => ({ date, band: n === 0 ? 'cold' : 'mild', rain: 0 }));
  const plan = planWeek(closet, days, {}, '');
  assert.equal(plan.length, 3);
  assert.ok(plan[0].outfit.outer, 'cold day gets a coat');
  assert.ok(plan.every((p) => Object.keys(p.outfit).length >= 2));
});

test('packing list: right counts, layers for cold, reports what is missing', () => {
  const r = packingList(closet, { days: 5, band: 'cold' });
  assert.ok(r.list.outer.length === 1 && r.list.shoes.length >= 1 && r.list.bag.length === 1);
  assert.ok(r.list.top.length >= 1 && r.outfits >= 1);
  const tiny = packingList([it('t', 'tops')], { days: 7, band: 'mild' });
  assert.ok(tiny.missing.some((m) => m.slot === 'bottom') && tiny.missing.some((m) => m.slot === 'top'));
});

test('outfit meters: neutrals harmonise, three loud hues do not, mood fit counts tagged pieces', () => {
  const p = (hex, occ = ['Brunch']) => ({ id: hex, color: { hex }, occasions: occ });
  assert.equal(outfitMeters({ top: p('#222222'), bottom: p('#f4f1ea') }, '', {}).harmony, 100);
  assert.ok(outfitMeters({ a: p('#ff0000'), b: p('#00ff00'), c: p('#0000ff') }, '', {}).harmony <= 50);
  assert.equal(outfitMeters({ top: p('#222222'), bottom: p('#f4f1ea', ['Work / Office']) }, 'Brunch', {}).fit, 50);
  assert.equal(outfitMeters({}, '', {}), null);
});

test('colour helpers', () => {
  assert.equal(colorName('#46628f'), 'Denim');
  assert.ok(hexDist('#000000', '#ffffff') > 90 && hexDist('#123456', '#123456') === 0);
  assert.ok(toLab(unhex('#ffffff'))[0] > 99);
});

test('wearing a dress removes top and bottom, and tapping again takes it off', () => {
  let o = wear({}, { id: 't', type: 'tops' }); o = wear(o, { id: 'b', type: 'bottoms' });
  o = wear(o, { id: 'd', type: 'dresses' });
  assert.deepEqual(o, { dress: 'd' });
  assert.deepEqual(wear(o, { id: 'd', type: 'dresses' }), {});
});

test('wear counts', () => assert.deepEqual(wearCountMap([{ itemIds: ['a', 'b'] }, { itemIds: ['a'] }]), { a: 2, b: 1 }));

// ── AI helper endpoints (pure parts) ──
import { parseTags, extractOgImage, pinUrlOk, handleSegment, handleTag, handlePin, samPrompts } from '../lib/ai.js';

test('auto-tag parser keeps only values the app accepts', () => {
  const t = parseTags('Sure! ```json\n{"name":"Satin <b>cami</b>","type":"tanks","season":"light","occasions":["GNO","Bogus","Date Night"],"brand":"Zara"}\n```');
  assert.deepEqual(t, { name: 'Satin cami', brand: 'Zara', type: 'tanks', season: 'light', occasions: ['GNO', 'Date Night'] });
  assert.equal(parseTags('{"type":"spaceship","season":"monsoon"}').type, null);
  assert.equal(parseTags('{"type":"tops"}').season, null);
  assert.throws(() => parseTags('no json here'), /didn’t include details/);
  assert.throws(() => parseTags('{type: tops, oops}'), /readable/);
});

test('Pinterest import only trusts Pinterest hosts', () => {
  for (const ok of ['https://www.pinterest.com/pin/123/', 'https://pin.it/abc', 'https://i.pinimg.com/736x/a.jpg', 'https://uk.pinterest.co.uk/pin/1']) assert.ok(pinUrlOk(ok), ok);
  for (const bad of ['http://pinterest.com/pin/1', 'https://evil.com/pinterest.com', 'https://pinterest.com.evil.com/x', 'https://localhost/x', 'file:///etc/passwd', 'not a url', 'https://169.254.169.254/']) assert.ok(!pinUrlOk(bad), bad);
  assert.ok(pinUrlOk('http://localhost:5198/pin/1', ['localhost:5198']), 'test allow-list works');
});

test('og:image extraction handles attribute order and entities', () => {
  assert.equal(extractOgImage('<meta property="og:image" content="https://i.pinimg.com/a.jpg?x=1&amp;y=2">'), 'https://i.pinimg.com/a.jpg?x=1&y=2');
  assert.equal(extractOgImage("<meta content='https://i.pinimg.com/b.jpg' name='twitter:image'>"), 'https://i.pinimg.com/b.jpg');
  assert.equal(extractOgImage('<html></html>'), null);
});

test('AI endpoints fail closed and demand the passcode', async () => {
  const req = (pass) => new Request('http://x/api/tag', { method: 'POST', headers: { 'x-app-passcode': pass ?? '' }, body: '{}' });
  for (const h of [handleSegment, handleTag, handlePin]) {
    assert.equal((await h(req('x'), {})).status, 503, 'unconfigured');
    assert.equal((await h(req('wrong'), { FAL_KEY: 'k', APP_PASSCODE: 'right' })).status, 401, 'wrong passcode');
    assert.equal((await h(new Request('http://x', { method: 'GET' }), { FAL_KEY: 'k', APP_PASSCODE: 'right' })).status, 405);
  }
  const bad = await handleSegment(new Request('http://x', { method: 'POST', headers: { 'x-app-passcode': 'right' }, body: JSON.stringify({ image: 'http://evil/x.png', w: 10, h: 10, pos: [[0.5, 0.5]] }) }), { FAL_KEY: 'k', APP_PASSCODE: 'right' });
  assert.equal(bad.status, 400, 'URLs are not accepted as images');
  const none = await handleSegment(new Request('http://x', { method: 'POST', headers: { 'x-app-passcode': 'right' }, body: JSON.stringify({ image: 'data:image/png;base64,AAAA', w: 10, h: 10, pos: [], neg: [[0.1, 0.1]] }) }), { FAL_KEY: 'k', APP_PASSCODE: 'right' });
  assert.equal(none.status, 400, 'at least one keep tap');
});

test('SAM 2 taps become pixel point prompts (1 = keep, 0 = remove); junk is dropped', () => {
  assert.deepEqual(samPrompts([[0.5, 0.5], [2, 0], ['x', 1]], [[0, 1]], 101, 201), [{ x: 50, y: 100, label: 1 }, { x: 0, y: 200, label: 0 }]);
  assert.equal(samPrompts(Array(30).fill([0.1, 0.1]), [], 10, 10).length, 12, 'capped');
});

import { matchInspo } from '../public/js/stylist.js';
test('inspo matching copes with a picture that has no usable colours', () => {
  assert.deepEqual(matchInspo(closet, [], { wanted: ['top', 'bottom'], occasion: '' }), { picks: {}, gaps: [] });
});

// ── item intake helpers and the product-page importer ──
import { guessType, tidyTitle, firstLink, deepLink } from '../public/js/intake.js';
import { publicUrlOk, extractProduct, handleProduct } from '../lib/ai.js';

test('category guess reads the words, most specific first', () => {
  assert.equal(guessType('Satin Cami Top'), 'tanks');
  assert.equal(guessType('Denim Mini Skirt'), 'skirts');
  assert.equal(guessType('sweater dress'), 'dresses');
  assert.equal(guessType('Wide-Leg Jeans'), 'bottoms');
  assert.equal(guessType('Cropped denim jacket'), 'outerwear');
  assert.equal(guessType('IMG_2041'), null);
  assert.equal(guessType('Leather Crossbody Bag'), 'bags');
  assert.equal(guessType('Chunky White Sneakers'), 'shoes');
});

test('page titles are tidied and shared text yields its link', () => {
  assert.equal(tidyTitle('Satin Cami Top | ZARA United States', 'Zara'), 'Satin Cami Top');
  assert.equal(tidyTitle('Buy Linen Shirt - Nordstrom'), 'Linen Shirt');
  assert.equal(tidyTitle('Zara Pleated Skirt', 'Zara'), 'Pleated Skirt');
  assert.equal(firstLink('Look at this! https://shop.example.com/p/1?x=2. so cute'), 'https://shop.example.com/p/1?x=2');
  assert.equal(firstLink('no link'), '');
  assert.deepEqual(deepLink('?add=link&u=https%3A%2F%2Fa.com%2Fp'), { mode: 'link', url: 'https://a.com/p' });
  assert.equal(deepLink('?add=evil'), null);
  assert.equal(deepLink(''), null);
});

test('product importer refuses private and non-https addresses', () => {
  for (const u of ['https://shop.example.com/p/1', 'https://www.zara.com/us/en/x.html']) assert.ok(publicUrlOk(u), u);
  for (const u of ['http://shop.com/p', 'https://127.0.0.1/', 'https://10.0.0.5/x', 'https://[::1]/', 'https://localhost/', 'https://router.local/', 'https://a.internal/x', 'https://user:pw@shop.com/', 'https://shop.com:8443/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://metadata/']) assert.ok(!publicUrlOk(u), u);
  assert.ok(publicUrlOk('http://localhost:5198/p', ['localhost:5198']));
});

test('product page details come from JSON-LD first, then meta tags', () => {
  const ld = '<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Linen Shirt","brand":{"@type":"Brand","name":"Everlane"},"image":["https://cdn.x.com/a.jpg"],"offers":{"@type":"Offer","price":"68.00"}}]}</script>';
  assert.deepEqual(extractProduct(ld), { title: 'Linen Shirt', brand: 'Everlane', price: 68, image: 'https://cdn.x.com/a.jpg' });
  const meta = '<title>Plain page</title><meta property="og:title" content="Wool &amp; Silk Scarf"><meta property="og:image" content="/img/s.png"><meta property="product:price:amount" content="1,250.50">';
  const m = extractProduct(meta);
  assert.equal(m.title, 'Wool & Silk Scarf'); assert.equal(m.image, '/img/s.png'); assert.equal(m.price, 1250.5); assert.equal(m.brand, '');
  assert.equal(extractProduct('<html></html>').image, null);
});

test('product endpoint demands the passcode but not a fal key', async () => {
  const req = (pass, url = 'https://shop.example.com/p') => new Request('http://x/api/product', { method: 'POST', headers: { 'x-app-passcode': pass ?? '' }, body: JSON.stringify({ url }) });
  assert.equal((await handleProduct(req('x'), {})).status, 503);
  assert.equal((await handleProduct(req('wrong'), { APP_PASSCODE: 'right' })).status, 401);
  assert.equal((await handleProduct(req('right', 'https://127.0.0.1/x'), { APP_PASSCODE: 'right' })).status, 400);
  assert.equal((await handleProduct(new Request('http://x', { method: 'GET' }), { APP_PASSCODE: 'right' })).status, 405);
});

// ── the dress-up figure: a picture shown as it is, plus points and rules for the clothes ──
import { dollSVG, fitOf, garmentTransform, isTuckable, deriveAnchors, withPoints, bodyWidth, levelY, contentBox, imageRect } from '../public/js/doll.js';
import { readFileSync, existsSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../public/assets/avatar/config.json', import.meta.url), 'utf8'));
const pack = { ...withPoints(config), files: { 'base.png': '/assets/avatar/base.png' }, base: '/assets/avatar/' };
const mkItem = (id, type, extra = {}) => ({ id, type, name: id, ...extra });
const urls = new Map([['t', 'blob:t'], ['b', 'blob:b'], ['j', 'blob:j']]);
const slotsIn = (svg) => [...svg.matchAll(/data-slot="(\w+)"/g)].map((m) => m[1]);

test('base.png is shown unchanged: the picture is an <image> at its own size and nothing draws a body', () => {
  assert.ok(existsSync(new URL('../public/assets/avatar/base.png', import.meta.url)), 'base.png is in the repo');
  const png = readFileSync(new URL('../public/assets/avatar/base.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), config.size[0]); assert.equal(png.readUInt32BE(20), config.size[1]); // the config's size is the picture's real size
  const svg = dollSVG({ pack, items: {}, urls });
  assert.match(svg, /<image class="basepic" href="\/assets\/avatar\/base\.png" x="0" y="0" width="896" height="1776"\/>/);
  assert.match(svg, /viewBox="0 -110 896 1886"/); // (room above the head for a bun or a ponytail)
  assert.ok(!/<(path|circle|ellipse|polygon)\b/.test(svg), 'no code-drawn shapes');
});

test('the config gives every clothing type a box, worked out from the body points', async () => {
  const { TYPES } = await import('../public/js/data.js');
  for (const t of Object.keys(TYPES)) { const a = pack.anchors[t]; assert.ok(a && a.w > 50 && a.h > 50, `box for ${t}`); assert.ok(a.x >= 0 && a.x + a.w <= 896 + 1 && a.y + a.h <= 1776 + 120, `${t} stays on the picture`); }
  const P = config.points, shoulder = bodyWidth(P, 'shoulder'), hip = bodyWidth(P, 'hip');
  assert.ok(shoulder > 300 && hip > 300, 'widths come from the left and right points');
  assert.equal(pack.anchors.tops.w, Math.round(shoulder * config.rules.tops.w[1] * 10) / 10, 'shirts are sized by the shoulders');
  assert.equal(pack.anchors.bottoms.w, Math.round(hip * config.rules.bottoms.w[1] * 10) / 10, 'trousers are sized by the hips');
  assert.ok(Math.abs(pack.anchors.tops.x + pack.anchors.tops.w / 2 - (P.shoulderL[0] + P.shoulderR[0]) / 2) < 0.2, 'a shirt is centred on the shoulders');
  assert.equal(pack.anchors.shoes.y + pack.anchors.shoes.h, levelY(P, 'foot') + config.rules.shoes.y1[1], 'shoes end at the feet');
  // moving the points moves the clothes, with no other change
  const wider = deriveAnchors({ ...P, shoulderL: [P.shoulderL[0] - 50, P.shoulderL[1]], shoulderR: [P.shoulderR[0] + 50, P.shoulderR[1]] }, config.rules);
  assert.ok(wider.tops.w > pack.anchors.tops.w + 100 && wider.bottoms.w === pack.anchors.bottoms.w);
});

test('layers stack as base, clothes, then accessories, and tucking swaps top and bottom', () => {
  const items = { top: mkItem('t', 'tops'), bottom: mkItem('b', 'bottoms'), outer: mkItem('j', 'outerwear') };
  assert.deepEqual(slotsIn(dollSVG({ pack, items, urls })), ['bottom', 'top', 'outer']);
  const tucked = { ...items, top: { ...items.top, fit: { base: { tuck: true } } } };
  const svg = dollSVG({ pack, items: tucked, urls });
  assert.deepEqual(slotsIn(svg), ['top', 'bottom', 'outer']);
  assert.match(svg, /clip-path="url\(#tuckclip-\d+\)"/);
  const body = svg.indexOf('class="basepic"'), first = svg.indexOf('class="gar'); assert.ok(body > 0 && body < first, 'the picture is under the clothes');
  assert.match(svg, /filter="url\(#gfx-\d+\)"/); assert.match(svg, /<filter id="gfx-\d+"/); // feathered edge and soft shadow
});

test('each piece remembers a small fit for this picture only', () => {
  const it = mkItem('t', 'tops', { fit: { base: { dx: 12, scale: 1.2 }, other: { dx: -5 } } });
  assert.equal(fitOf(it, { id: 'base' }).dx, 12); assert.equal(fitOf(it, { id: 'other' }).dx, -5); assert.equal(fitOf(it, { id: 'new' }).dx, 0);
  const a = { x: 100, y: 200, w: 300, h: 400 };
  assert.match(garmentTransform(a, { scale: 1, dx: 0, dy: 0, rot: 0 }), /^translate\(250 400\) rotate\(0\) scale\(1\) translate\(-150 -200\)$/);
  assert.ok(isTuckable(mkItem('t', 'tops'), pack) && !isTuckable(mkItem('d', 'dresses'), pack));
});

test('the dashed selection box hugs the visible part of the cutout, not the whole box', () => {
  const a = { x: 0, y: 0, w: 400, h: 400, align: 'xMidYMin' };
  const wide = { iw: 200, ih: 100, bx: 0.1, by: 0.2, bw: 0.8, bh: 0.6 };      // a wide picture in a square box: scaled to 400 x 200, top-aligned
  assert.deepEqual(imageRect(a, wide), { x: 0, y: 0, w: 400, h: 200 });
  assert.deepEqual(contentBox(a, wide), { x: 40, y: 40, w: 320, h: 120 });
  const tall = { iw: 100, ih: 200, bx: 0, by: 0, bw: 1, bh: 1 };              // a tall picture: 200 x 400, centred across
  assert.deepEqual(contentBox(a, tall), { x: 100, y: 0, w: 200, h: 400 });
  assert.deepEqual(contentBox(a, null), { x: 0, y: 0, w: 400, h: 400 }, 'unknown size: the whole box');
  const svg = dollSVG({ pack, items: { top: mkItem('t', 'tops') }, urls, meta: new Map([['t', { iw: 100, ih: 100, bx: 0.25, by: 0.25, bw: 0.5, bh: 0.5 }]]), selected: 't' });
  const box = svg.match(/class="selbox" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(box && +box[3] < pack.anchors.tops.w, 'the box is smaller than the anchor box when the cutout has empty margins');
});

test('the debug overlay draws every point from the config', () => {
  const svg = dollSVG({ pack, items: { top: mkItem('t', 'tops') }, urls, debug: true });
  for (const name of Object.keys(config.points)) assert.ok(svg.includes(`>${name}</text>`), `${name} is labelled`);
  assert.ok(svg.includes('class="pointsdbg"')); assert.ok(!dollSVG({ pack, items: {}, urls }).includes('pointsdbg'));
});

test('every API route is registered on all three hosts (local server, Vercel, Cloudflare worker)', () => {
  const paths = (f) => [...readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/'(\/api\/\w+)'/g)].map((m) => m[1]).sort().join();
  const local = paths('../server.js');
  assert.equal(paths('../worker/index.js'), local);
  for (const route of local.split(',')) assert.ok(readFileSync(new URL(`..${route}.js`, import.meta.url), 'utf8').includes('POST') || readFileSync(new URL(`..${route}.js`, import.meta.url), 'utf8').includes('export'), `Vercel function for ${route}`);
});
test('the share-target service worker redirects to absolute URLs', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(!/Response\.redirect\((`|')\//.test(sw), 'no relative Response.redirect');
  assert.equal(new URL('/?add=shared', 'https://x.example/share').href, 'https://x.example/?add=shared');
});

// ── the game around the closet ──
import { pickTheme, rateOutfit, coinsFor, rollOver, applyRating, spendEnergy, endDay, initial, CATALOG, catalogItem, owns, buy, usePhoto } from '../public/js/game.js';
import { BACKGROUNDS, POSES } from '../public/js/photo.js';
const piece = (id, type, o = {}) => ({ id, type, name: id, occasions: [], color: { hex: '#e8dfd0' }, season: 'all', ...o });

test('the daily theme comes from an event first, then a mood, then harsh weather, then luck', () => {
  const ev = [{ date: '2026-10-26', title: 'Sam’s birthday', occasion: 'Dinner' }];
  assert.deepEqual([pickTheme({ date: '2026-10-26', events: ev, mood: 'Brunch', band: 'cold' }).source, pickTheme({ date: '2026-10-26', events: ev }).title], ['event', 'Sam’s birthday']);
  assert.equal(pickTheme({ date: 'x', events: ev, mood: 'Brunch', band: 'cold' }).source, 'mood');
  assert.equal(pickTheme({ date: 'x', band: 'cold' }).source, 'weather');
  assert.equal(pickTheme({ date: 'x', band: 'mild', rand: () => 0 }).occasion, 'Work / Office');
  assert.equal(pickTheme({ date: 'x', events: [{ date: 'x', title: 'Gala', occasion: 'Nonsense' }] }).occasion, '', 'unknown occasions are ignored');
});

test('the rating explains itself from your tags and is fair at the extremes', () => {
  const theme = { occasion: 'Brunch', title: 'Brunch' };
  const good = { top: piece('t', 'tops', { occasions: ['Brunch'] }), bottom: piece('b', 'bottoms', { occasions: ['Brunch'] }), shoes: piece('s', 'shoes', { occasions: ['Brunch'] }) };
  const r = rateOutfit({ worn: good, theme, band: 'mild' });
  assert.equal(r.stars, 5); assert.equal(r.parts.length, 5); assert.ok(r.parts.every((p) => p.got <= p.max && p.note));
  assert.equal(r.parts.reduce((s, p) => s + p.max, 0), 100);
  const bad = { top: piece('t', 'tops', { season: 'light', color: { hex: '#ff0000' } }), bottom: piece('b', 'bottoms', { season: 'light', color: { hex: '#00cc00' } }) };
  const w = rateOutfit({ worn: bad, theme, band: 'cold' }, 0);
  assert.ok(w.stars <= 2 && /Biggest win/.test(w.tip), `${w.stars} stars: ${w.tip}`);
  assert.equal(rateOutfit({ worn: {}, theme }), null);
  const wxTheme = rateOutfit({ worn: good, theme: { occasion: '', title: 'Bundle up' }, band: 'cold' });
  assert.equal(wxTheme.parts.find((p) => p.key === 'weather').max, 55, 'a weather theme leans on the weather');
});

test('coins grow with stars and streak, shrink when tired, and are only paid once per improvement', () => {
  assert.ok(coinsFor({ stars: 5 }) > coinsFor({ stars: 2 })); assert.ok(coinsFor({ stars: 3, streak: 5 }) > coinsFor({ stars: 3, streak: 0 }));
  assert.ok(coinsFor({ stars: 4, energy: 10 }) < coinsFor({ stars: 4, energy: 100 }));
  let g = rollOver(initial(), '2026-10-26', () => ({ title: 'Brunch', occasion: 'Brunch' }));
  const three = { stars: 3, score: 60 }, five = { stars: 5, score: 95 };
  let { game, paid } = applyRating(g, three); const first = paid; assert.ok(first > 0 && game.coins === first && game.day.phase === 'evening');
  ({ game, paid } = applyRating(game, three)); assert.equal(paid, 0, 'rating the same again pays nothing');
  ({ game, paid } = applyRating(game, five)); assert.equal(paid, coinsFor({ stars: 5 }) - first, 'a better look pays only the difference');
  assert.equal(game.coins, coinsFor({ stars: 5 }));
});

test('a new date starts a new day, keeps coins, and ending the day closes it', () => {
  let g = rollOver(initial(), '2026-10-26', () => ({ title: 'A', occasion: '' })); g = { ...g, coins: 40 };
  g = spendEnergy(spendEnergy(g, 8), 4); assert.equal(g.day.energy, 88);
  g = applyRating(g, { stars: 4, score: 80 }).game; assert.equal(g.day.phase, 'evening');
  g = endDay(g); assert.equal(g.day.phase, 'done'); assert.equal(g.history.length, 1);
  const next = rollOver(g, '2026-10-27', () => ({ title: 'B', occasion: '' }));
  assert.equal(next.coins, g.coins); assert.equal(next.day.theme.title, 'B'); assert.equal(next.day.energy, 100); assert.equal(rollOver(next, '2026-10-27', () => ({ title: 'Z' })).day.theme.title, 'B', 'same day: unchanged');
});

test('the shop: free things are yours, paid things need coins and are bought once', () => {
  let g = { ...initial(), coins: 100 };
  assert.ok(owns(g, 'bg:blush') && owns(g, 'pose:stand') && !owns(g, 'bg:sunset'), 'free ones are yours from the start');
  assert.equal(buy({ ...g, coins: 10 }, 'bg:sunset').ok, false, 'too poor');
  const r = buy(g, 'bg:sunset'); assert.ok(r.ok && r.game.coins === 70 && owns(r.game, 'bg:sunset')); g = r.game;
  assert.equal(buy(g, 'bg:sunset').ok, false, 'bought once');
  assert.equal(buy(g, 'nope').ok, false);
  assert.ok(CATALOG.every((c) => ['bg', 'pose'].includes(c.kind)), 'only photo-mode things are sold (no furniture: the apartment is gone)');
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length, 'ids are unique');
  assert.ok(catalogItem('pose:twirl'));
});

test('photo mode: every backdrop and pose for sale has a drawing, and you can only use what you own', () => {
  for (const c of CATALOG.filter((x) => x.kind === 'bg')) assert.ok(BACKGROUNDS[c.id.slice(3)], `${c.id} has a backdrop`);
  for (const c of CATALOG.filter((x) => x.kind === 'pose')) assert.ok(POSES[c.id.slice(5)], `${c.id} has a pose`);
  assert.deepEqual(Object.keys(BACKGROUNDS).sort(), CATALOG.filter((x) => x.kind === 'bg').map((x) => x.id.slice(3)).sort(), 'nothing drawn but not sold');
  let g = { ...initial(), coins: 100 };
  assert.deepEqual(g.photo, { bg: 'blush', pose: 'stand' });
  assert.equal(usePhoto(g, 'bg:sunset').photo.bg, 'blush', 'not owned: unchanged');
  g = buy(g, 'bg:sunset').game; assert.equal(usePhoto(g, 'bg:sunset').photo.bg, 'sunset'); assert.equal(usePhoto(g, 'bg:studio').photo.bg, 'studio', 'free ones are always yours');
  assert.equal(usePhoto({ ...g, photo: undefined }, 'pose:stand').photo.bg, 'blush', 'an old save without photo settings still works');
});

/* ── garment fitting ── */
import { tps, affineFit, rowRuns } from '../public/js/warp.js';
import { homography } from '../public/js/editor.js';
import { suggest, namesFor, groupOf } from '../public/js/landmarks.js';
import { alongPath, pathLength } from '../public/js/bodymap.js';

test('thin-plate spline passes through every control point', () => {
  const src = [[0, 0], [100, 0], [100, 200], [0, 200], [50, 100]], dst = [[10, 5], [120, 0], [95, 210], [-5, 190], [60, 90]], f = tps(src, dst);
  src.forEach((p, i) => { const [x, y] = f(...p); assert.ok(Math.hypot(x - dst[i][0], y - dst[i][1]) < 1e-6); });
  const a = affineFit(src.slice(0, 4), src.slice(0, 4).map(([x, y]) => [x * 2 + 3, y * 2 - 1])); assert.deepEqual(a(10, 10).map(Math.round), [23, 19]);
});
test('straightening maps the four corners of the product to a rectangle', () => {
  const q = [[100, 50], [400, 80], [380, 600], [90, 560]], f = homography(q, 300, 500);
  [[0, 0], [300, 0], [300, 500], [0, 500]].forEach((c, i) => { const [x, y] = f(...q[i]); assert.ok(Math.hypot(x - c[0], y - c[1]) < 1e-6); });
});
test('row runs find the pieces of a row, bridging 1px gaps', () => {
  const w = 20, d = new Uint8ClampedArray(w * 4); [2, 3, 4, 6, 7, 15, 16, 17, 18].forEach((x) => (d[x * 4 + 3] = 255));
  assert.deepEqual(rowRuns(d, w, 0, { gap: 1, min: 2 }), [[2, 8], [15, 19]]);
});
test('landmarks: each category has its own set, and a silhouette gives plausible ones', () => {
  assert.deepEqual(namesFor('bottoms'), ['waistL', 'waistR', 'crotch', 'hemLo', 'hemLi', 'hemRi', 'hemRo']);
  assert.ok(namesFor('dresses').includes('waistL') && namesFor('tops').includes('armpitL') && !namesFor('shoes').length);
  // a plain pair of trousers: waistband on top, two legs below a crotch
  const w = 100, h = 200, a = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = y < 60 ? (x >= 20 && x < 80 ? 1 : 0) : ((x >= 20 && x < 48) || (x >= 52 && x < 80) ? 1 : 0);
  const m = suggest('bottoms', { w, h, a }); assert.ok(m.crotch[1] > 0.25 && m.crotch[1] < 0.4 && Math.abs(m.crotch[0] - 0.5) < 0.05, `crotch ${m.crotch}`);
  assert.ok(m.hemLo[0] < m.hemLi[0] && m.hemLi[0] < m.hemRi[0] && m.hemRi[0] < m.hemRo[0] && m.hemLo[1] > 0.95);
  assert.equal(groupOf('shoes'), null);
});
test('sleeves follow the arm line', () => {
  const arm = [[0, 0], [0, 100], [0, 300]]; assert.deepEqual(alongPath(arm, 0.5).map(Math.round), [0, 150]); assert.equal(pathLength(arm), 300);
});
test('the base picture config has the armpit, crotch and arm points the fit needs', async () => {
  const c = JSON.parse((await import('node:fs')).readFileSync(new URL('../public/assets/avatar/config.json', import.meta.url), 'utf8'));
  for (const k of ['armpitL', 'armpitR', 'crotch', 'waistbandL', 'waistbandR', 'wristL', 'wristR']) assert.ok(Array.isArray(c.points[k]), k);
  assert.ok(c.arms.L.length >= 3 && c.arms.R.length >= 3); assert.deepEqual(c.clothesOrder, ['shoes', 'bottom', 'top', 'dress', 'outer', 'bag']);
});

/* ── the walk-in closet ── */
import { SECTIONS, layoutSection, artBox, trackLayout, targetFor, sectionAt } from '../public/js/closet.js';
test('closet: every section has a place along the walls, and the strip order matches', () => {
  assert.deepEqual(SECTIONS.map((s) => s.k), ['overview', 'tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'bags', 'jewelry', 'vanity', 'mirror']);
  const { at, total } = trackLayout(390, 700);
  assert.ok(at.overview.w > 390 && at.tops.w === 390 && Math.abs(total - (at.mirror.x + 390)) < 1e-6);
  for (const s of SECTIONS) assert.equal(sectionAt(targetFor(s.k, 390, 700), 390, 700), s.k === 'overview' ? 'overview' : s.k, s.k);
  const b = artBox(SECTIONS.find((s) => s.k === 'jewelry'), 390, 700); assert.ok(b.w > 390 * 1.6 && b.x <= 0 && b.x >= 390 - b.w, 'jewelry is the vanity picture zoomed into the island');
});
test('closet: pieces hang on the rails and sit on the shelves without spilling out', () => {
  const rail = SECTIONS.find((s) => s.k === 'dresses'), items = Array.from({ length: 9 }, (_, i) => ({ id: 'd' + i, ar: 0.6 }));
  const L = layoutSection(rail, items); assert.equal(L.length, 9);
  for (const p of L) { assert.ok(p.x >= 100 && p.x + p.w <= 845 && p.y > 250 && p.y + p.h < 1300, JSON.stringify(p)); assert.ok(Math.abs(p.hanger[0] - (p.x + p.w / 2)) < 1e-6); }
  const shoes = layoutSection(SECTIONS.find((s) => s.k === 'shoes'), [{ id: 's', ar: 2 }])[0]; assert.ok(shoes.w <= 0.86 * 210 + 1e-6 && shoes.y + shoes.h <= 457);
  assert.deepEqual(layoutSection(SECTIONS.find((s) => s.k === 'vanity'), [{ id: 'x', ar: 1 }]), [], 'nothing is placed where nothing belongs');
});

/* ── selection clean-up and the screenshot crop ── */
import { cleanMask } from '../public/js/cutmask.js';
import { productBox } from '../public/js/editor.js';
test('a selection keeps the garment you tapped and drops a thin stray line', () => {
  const w = 100, h = 100, data = new Uint8Array(w * h);
  for (let y = 20; y < 80; y++) for (let x = 40; x < 60; x++) data[y * w + x] = 255; // the garment
  for (let x = 0; x < 40; x++) data[78 * w + x] = 255; // a 1px divider line touching it
  for (let y = 5; y < 10; y++) for (let x = 85; x < 95; x++) data[y * w + x] = 255; // a separate speck
  const out = cleanMask({ w, h, data }, [[0.5, 0.5]]).data;
  assert.equal(out[50 * w + 50], 255); assert.equal(out[78 * w + 5], 0, 'line gone'); assert.equal(out[7 * w + 90], 0, 'speck gone');
});
test('only a phone screenshot is cropped to its product photo; a set photographed with a gap is kept whole', () => {
  const img = (w, h, bands) => { const data = new Uint8ClampedArray(w * h * 4).fill(255); for (const [y0, y1] of bands) for (let y = y0; y < y1; y++) for (let x = w * 0.1; x < w * 0.9; x++) { const o = (y * w + Math.floor(x)) * 4; data[o] = data[o + 1] = data[o + 2] = 40; } return { data, width: w, height: h }; };
  const shot = productBox(img(100, 216, [[3, 8], [30, 140], [150, 156], [170, 180]]));
  assert.deepEqual([shot[0][1], shot[2][1]], [30, 140], 'status bar, text and buttons left out');
  const set = productBox(img(100, 280, [[10, 120], [150, 270]]));
  assert.deepEqual(set, [[0, 0], [100, 0], [100, 280], [0, 280]], 'two pieces with a gap: nothing cut away');
});

/* ── hairstyles: Nikki's own pictures, laid over the head ── */
test('every hairstyle in the config has its picture on the hair canvas, and a ponytail\'s tail goes behind the body', async () => {
  const { hairOf } = await import('../public/js/doll.js');
  for (const st of config.hair.styles.filter((s) => s.id !== 'none')) {
    for (const f of [st.id, ...(st.back ? [st.id + '-back'] : [])]) {
      const png = readFileSync(new URL(`../public/assets/avatar/hair/${f}.png`, import.meta.url));
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], config.hair.box.slice(2), `${f}.png is on the ${config.hair.box.slice(2).join(' x ')} canvas`);
    }
  }
  assert.equal(hairOf(pack, 'none', 'natural'), null, 'no picture for the base picture\'s own hair');
  const h = hairOf(pack, 'ponytail', 'auburn'), svg = dollSVG({ pack, items: {}, urls, hair: h });
  const back = svg.indexOf('hair/ponytail-back.png'), body = svg.indexOf('class="basepic"'), front = svg.indexOf('hair/ponytail.png');
  assert.ok(back > 0 && back < body && body < front, 'tail behind the body, the rest in front');
  assert.match(svg, /<feColorMatrix type="matrix"/, 'colour applied as a filter, the picture itself is untouched');
  assert.ok(!/feColorMatrix/.test(dollSVG({ pack, items: {}, urls, hair: hairOf(pack, 'bob', 'natural') })), 'as drawn: no filter');
});

/* ── starter closet ── */
test('the starter list: 20 pieces in each of 7 batches, valid types and occasions, one shared image spec', async () => {
  const { ITEMS, BATCHES, promptFor, sizeFor } = await import('../public/starter/items.js');
  const { TYPES: T, OCCASIONS: O } = await import('../public/js/data.js');
  assert.equal(ITEMS.length, 140); assert.equal(new Set(ITEMS.map((i) => i.id)).size, 140, 'unique ids');
  for (const [b] of BATCHES) assert.equal(ITEMS.filter((i) => i.batch === b).length, 20, b);
  for (const i of ITEMS) { assert.ok(T[i.type], i.id); assert.ok(i.occasions.length && i.occasions.every((o) => O.includes(o)), i.id); assert.ok(['light', 'all', 'warm'].includes(i.season)); }
  const top = ITEMS.find((i) => i.batch === 'tops'), shoe = ITEMS.find((i) => i.batch === 'shoes');
  assert.match(promptFor(top), /^Flat lay product photo of .*, laid flat and neatly arranged, viewed from directly above, flat lay, front view, structured shape, centered, entire item visible with margin on all sides, plain pure white background, soft even lighting/);
  for (const i of ITEMS) assert.doesNotMatch(promptFor(i), /mannequin|\bmodel\b|person|dress form/i, `${i.id}: no word that makes FLUX draw a body or a form`);
  assert.deepEqual(sizeFor(top), { width: 1024, height: 1365 }); assert.deepEqual(sizeFor(shoe), { width: 1024, height: 1024 });
});
test('/api/starter only makes pieces on the list, on Cloudflare (fal only as a fallback), and reports the daily limit', async () => {
  const { handleStarter, isDailyLimit, NEURONS_EACH, nextResetUTC } = await import('../lib/ai.js');
  const env = { CF_ACCOUNT_ID: 'a', CF_API_TOKEN: 't', APP_PASSCODE: 'pw', USAGE_DISABLED: '1' };
  const call = (body, pass = 'pw', e = env) => handleStarter(new Request('http://x/api/starter', { method: 'POST', headers: { 'x-app-passcode': pass, 'content-type': 'application/json' }, body: JSON.stringify(body) }), e);
  assert.equal((await call({ id: 'a cat in a hat' })).status, 400);
  assert.equal((await call({ id: 'starter-black-fitted-tee' }, 'nope')).status, 401);
  assert.equal((await call({ id: 'starter-black-fitted-tee' }, 'pw', { APP_PASSCODE: 'pw', USAGE_DISABLED: '1' })).status, 503, 'says what to set when no engine is configured');
  assert.equal((await call({ id: 'starter-black-fitted-tee' }, 'pw', { APP_PASSCODE: 'pw', FAL_KEY: 'f', USAGE_DISABLED: '1' })).status, 503, 'no silent switch to fal (paid) when Cloudflare is not set up');
  assert.equal(NEURONS_EACH, 57.6, '4 tiles x 4.8 + 4 steps x 9.6');
  assert.ok(isDailyLimit(429, '') && isDailyLimit(400, '4006: you have used up your daily free allocation of 10,000 neurons') && !isDailyLimit(500, 'internal error'));
  assert.equal(new Date(nextResetUTC(Date.UTC(2026, 9, 26, 17, 5))).toISOString(), '2026-10-27T00:00:00.000Z');
});
test('Style me can use starter pieces but prefers your own', async () => {
  const { styleMe } = await import('../public/js/stylist.js');
  const mine = { id: 'm', type: 'tops', occasions: ['Brunch'] }, st = { id: 's', type: 'tops', occasions: ['Brunch'], source: 'starter' }, b = { id: 'b', type: 'bottoms', occasions: ['Brunch'] };
  let own = 0; for (let k = 0; k < 400; k++) if (styleMe([mine, st, b], 'Brunch').top?.id === 'm') own++;
  assert.ok(own > 280 && own < 400, `own picked ${own}/400`);
  assert.equal(styleMe([st, b], 'Brunch').top.id, 's', 'a starter piece fills the gap when you have nothing');
});
test('accessories and bags snap to their body points: earrings split onto both ears, a watch on the wrist', () => {
  const earrings = mkItem('e', 'accessories', { acc: 'earrings' }), meta = new Map([['e', { iw: 200, ih: 100 }], ['w', { iw: 100, ih: 100 }]]);
  const svg = dollSVG({ pack, items: { acc: earrings }, urls: new Map([['e', 'blob:e']]), meta });
  const pics = [...svg.matchAll(/<svg x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" viewBox="([\d.]+) 0/g)].map((m) => m.slice(1).map(Number));
  const r = config.accRules.earrings, [eL, eR] = r.at.map((k) => config.points[k]);
  assert.equal(pics.length, 2, 'one half of the picture on each ear');
  assert.ok(Math.abs(pics[0][0] + r.anchor[0] * r.w - eL[0]) < 0.2 && Math.abs(pics[1][0] + r.anchor[0] * r.w - eR[0]) < 0.2, 'centred on the ear points');
  assert.deepEqual([pics[0][4], pics[1][4]], [0, 100], 'left half, right half');
  for (const k of ['head', 'eyes', 'earL', 'earR', 'necklace', 'handL', 'handR', 'belt']) assert.ok(config.points[k], `${k} point`);
  for (const [k, rule] of Object.entries(config.accRules)) for (const p of [].concat(rule.at)) assert.ok(config.points[p], `${k} -> ${p}`);
});
