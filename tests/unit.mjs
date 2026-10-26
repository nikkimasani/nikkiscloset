// Pure-logic unit tests: node --test tests/unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { closetInsights, costPerWear, streak, gapAnalysis, wearCountMap } from '../public/js/insights.js';
import { bandFor, parseForecast, geocode, weatherEmoji } from '../public/js/weather.js';
import { styleMe, suitsWeather } from '../public/js/stylist.js';
import { planWeek, packingList } from '../public/js/planner.js';
import { outfitMeters } from '../public/js/meters.js';
import { colorName, hexDist, toLab, unhex } from '../public/js/color.js';
import { fromProportions, measures, place, DEFAULT_BODY } from '../public/js/body.js';
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

test('body model: proportions change the figure, garments scale with build', () => {
  const tall = measures(fromProportions({ legs: 1.2 })), norm = measures(DEFAULT_BODY);
  assert.ok(tall.L > norm.L * 1.15 && Math.abs(tall.sw - norm.sw) < 1);
  const wide = place('tops', { ...fromProportions({ build: 1.3 }) }), slim = place('tops', fromProportions({ build: 1 }));
  assert.ok(wide.w > slim.w * 1.25);
});

test('wearing a dress removes top and bottom, and tapping again takes it off', () => {
  let o = wear({}, { id: 't', type: 'tops' }); o = wear(o, { id: 'b', type: 'bottoms' });
  o = wear(o, { id: 'd', type: 'dresses' });
  assert.deepEqual(o, { dress: 'd' });
  assert.deepEqual(wear(o, { id: 'd', type: 'dresses' }), {});
});

test('wear counts', () => assert.deepEqual(wearCountMap([{ itemIds: ['a', 'b'] }, { itemIds: ['a'] }]), { a: 2, b: 1 }));

// ── AI helper endpoints (pure parts) ──
import { parseTags, extractOgImage, pinUrlOk, handleCutout, handleTag, handlePin } from '../lib/ai.js';

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
  for (const h of [handleCutout, handleTag, handlePin]) {
    assert.equal((await h(req('x'), {})).status, 503, 'unconfigured');
    assert.equal((await h(req('wrong'), { FAL_KEY: 'k', APP_PASSCODE: 'right' })).status, 401, 'wrong passcode');
    assert.equal((await h(new Request('http://x', { method: 'GET' }), { FAL_KEY: 'k', APP_PASSCODE: 'right' })).status, 405);
  }
  const bad = await handleCutout(new Request('http://x', { method: 'POST', headers: { 'x-app-passcode': 'right' }, body: JSON.stringify({ image: 'http://evil/x.png' }) }), { FAL_KEY: 'k', APP_PASSCODE: 'right' });
  assert.equal(bad.status, 400, 'URLs are not accepted as images');
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

// ── 2D doll: art is separate from the placement and layering rules ──
import { dollSVG, fitOf, garmentTransform, tokens, mix, isTuckable } from '../public/js/doll.js';
import { readFileSync, readdirSync } from 'node:fs';
const studio = JSON.parse(readFileSync(new URL('../public/dolls/studio/pack.json', import.meta.url), 'utf8'));
const studioFiles = Object.fromEntries(readdirSync(new URL('../public/dolls/studio/', import.meta.url)).filter((f) => f.endsWith('.svg')).map((f) => [f, readFileSync(new URL(`../public/dolls/studio/${f}`, import.meta.url), 'utf8')]));
const pack = { ...studio, files: studioFiles };
const mkItem = (id, type, extra = {}) => ({ id, type, name: id, ...extra });
const urls = new Map([['t', 'blob:t'], ['b', 'blob:b'], ['j', 'blob:j']]);
const slotsIn = (svg) => [...svg.matchAll(/data-slot="(\w+)"/g)].map((m) => m[1]);

test('the studio pack covers every clothing type and every file it names exists', async () => {
  const { TYPES } = await import('../public/js/data.js');
  for (const t of Object.keys(TYPES)) assert.ok(studio.anchors[t], `anchor for ${t}`);
  for (const f of Object.values(studio.layers)) for (const g of f.includes('{style}') ? studio.hairStyles.map((s) => f.replace('{style}', s)) : [f]) assert.ok(studioFiles[g], g);
});

test('doll layers stack in the right order, and tucking swaps top and bottom', () => {
  const items = { top: mkItem('t', 'tops'), bottom: mkItem('b', 'bottoms'), outer: mkItem('j', 'outerwear') };
  const look = { skin: '#eec3a0', hair: '#4a2e1e', hairStyle: 'bob', eyes: '#2b1d17', lips: '#c4505f' };
  assert.deepEqual(slotsIn(dollSVG({ pack, look, items, urls })), ['bottom', 'top', 'outer']);
  const tucked = { ...items, top: { ...items.top, fit: { studio: { tuck: true } } } };
  const svg = dollSVG({ pack, look, items: tucked, urls });
  assert.deepEqual(slotsIn(svg), ['top', 'bottom', 'outer']);
  assert.match(svg, /clip-path="url\(#tuckclip-\d+\)"/);
  assert.ok(!/\{\{/.test(svg), 'no unfilled art tokens');
  assert.ok(svg.includes('#4a2e1e') || svg.includes('4a2e1e'), 'hair colour reaches the art');
});

test('each art pack remembers its own fit for a piece', () => {
  const it = mkItem('t', 'tops', { fit: { studio: { dx: 12, scale: 1.2 }, other: { dx: -5 } } });
  assert.equal(fitOf(it, { id: 'studio' }).dx, 12); assert.equal(fitOf(it, { id: 'other' }).dx, -5); assert.equal(fitOf(it, { id: 'new' }).dx, 0);
  const a = studio.anchors.tops;
  assert.match(garmentTransform(a, { scale: 1, dx: 0, dy: 0, rot: 0 }), /^translate\(250 347\) rotate\(0\) scale\(1\) translate\(-145 -135\)$/);
  assert.ok(isTuckable(mkItem('t', 'tops'), pack) && !isTuckable(mkItem('d', 'dresses'), pack));
});

test('a different art pack changes the drawing and the placement without touching the rules', () => {
  const alt = { ...pack, id: 'alt', view: [0, 0, 1000, 1800], anchors: { ...pack.anchors, tops: { x: 300, y: 400, w: 400, h: 400, align: 'xMidYMin' } }, layers: { ...pack.layers, body: 'mybody.svg' }, files: { ...studioFiles, 'mybody.svg': '<rect id="mine" width="10" height="10" fill="{{skin}}"/>' } };
  const svg = dollSVG({ pack: alt, look: { skin: '#123456', hair: '#000000', hairStyle: 'pixie', eyes: '#000000', lips: '#ff0000' }, items: { top: mkItem('t', 'tops') }, urls });
  assert.match(svg, /viewBox="0 0 1000 1800"/); assert.match(svg, /id="mine"[^>]*fill="#123456"/); assert.match(svg, /translate\(500 600\)/);
});

test('skin and hair shades are derived from the customizer colours', () => {
  const t = tokens({ skin: '#eec3a0', hair: '#4a2e1e' });
  assert.notEqual(t.skinShade, t.skin); assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});
