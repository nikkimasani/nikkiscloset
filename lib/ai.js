// AI helper endpoints on fal.ai credits: cleaner cutouts, auto-tagging a piece from its photo, and importing a Pinterest pin.
// The fal model ids/fields are written from fal's public docs and are UNVERIFIED against the live API: each is overridable by an
// env var, and fal's own error text is passed back to the app so a wrong field name is easy to spot.
import { json, detail, guard, DATA_URI, toBase64, falMediaOk } from './api.js';

const MAX_BODY = 6_000_000;
export const TYPES = ['tops', 'tanks', 'bodysuits', 'bottoms', 'skirts', 'dresses', 'outerwear', 'shoes', 'bags', 'accessories'];
export const OCCASIONS = ['Work / Office', 'Date Night', 'GNO', 'Casual Outing', 'Brunch', 'Dinner', 'Workout', 'Travel', 'Formal / Event', 'Lounge'];

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw Object.assign(new Error('Image too large.'), { status: 413 });
  try { return JSON.parse(await request.text()); } catch { throw Object.assign(new Error('Bad request.'), { status: 400 }); }
}

async function falRun(env, model, input) {
  const base = (env.FAL_RUN_BASE || 'https://fal.run').replace(/\/$/, '');
  const r = await fetch(`${base}/${model}`, { method: 'POST', headers: { authorization: `Key ${env.FAL_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!r.ok) throw Object.assign(new Error(`fal.ai said: ${await detail(r)}`), { status: 502 });
  return { out: await r.json(), base };
}

const wrap = (fn, { needsFal = true } = {}) => async (request, env) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const denied = await guard(request, env, { needsFal });
  if (denied) return denied;
  try { return await fn(request, env); } catch (e) { return json({ error: e.message || 'Something went wrong.' }, e.status || 500); }
};

/* ───────── cleaner cutout ───────── */
export const handleCutout = wrap(async (request, env) => {
  const { image } = await readBody(request);
  if (!DATA_URI.test(image || '')) return json({ error: 'image must be a JPEG/PNG data URI.' }, 400);
  const { out, base } = await falRun(env, env.FAL_CUTOUT_MODEL || 'fal-ai/imageutils/rembg', { image_url: image });
  const url = out?.image?.url || out?.images?.[0]?.url;
  if (!url || !falMediaOk(url, base)) return json({ error: 'fal.ai returned no image.' }, 502);
  const img = await fetch(url);
  if (!img.ok) return json({ error: 'Could not download the cutout.' }, 502);
  return json({ image: `data:${(img.headers.get('content-type') || 'image/png').split(';')[0]};base64,${toBase64(await img.arrayBuffer())}` });
});

/* ───────── auto-tag ───────── */
const TAG_PROMPT = `You are a wardrobe assistant. Look at the clothing item in the photo and reply with ONLY compact JSON, no other text:
{"name": "short descriptive name, max 4 words", "type": one of ${JSON.stringify(TYPES)}, "season": one of ["light","all","warm"], "occasions": a subset of ${JSON.stringify(OCCASIONS)}, "brand": "brand if clearly visible else empty string"}`;

/** Pull the JSON out of a model reply and keep only values we accept. */
export function parseTags(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error('The AI reply didn’t include details.'), { status: 502 });
  let j; try { j = JSON.parse(m[0]); } catch { throw Object.assign(new Error('The AI reply wasn’t readable.'), { status: 502 }); }
  const clean = (s, n) => String(s || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().slice(0, n);
  return {
    name: clean(j.name, 40), brand: clean(j.brand, 40),
    type: TYPES.includes(j.type) ? j.type : null,
    season: ['light', 'all', 'warm'].includes(j.season) ? j.season : null,
    occasions: Array.isArray(j.occasions) ? j.occasions.filter((o) => OCCASIONS.includes(o)) : [],
  };
}

export const handleTag = wrap(async (request, env) => {
  const { image } = await readBody(request);
  if (!DATA_URI.test(image || '')) return json({ error: 'image must be a JPEG/PNG data URI.' }, 400);
  const { out } = await falRun(env, env.FAL_VISION_MODEL || 'fal-ai/any-llm/vision', { model: env.FAL_VISION_LLM || 'google/gemini-flash-1.5', prompt: TAG_PROMPT, image_urls: [image] });
  return json({ tags: parseTags(out?.output ?? out?.text ?? '') });
});

/* ───────── Pinterest import ───────── */
// explicit list of Pinterest's domains — a loose pattern would let pinterest.com.evil.com through
const PIN_HOSTS = /^(([a-z0-9-]+\.)?pinterest\.(com|co\.uk|com\.au|com\.mx|ca|fr|de|es|it|jp|ph|ru|se|nz|ie|at|ch|dk|pt|cl|co|kr|nl)|pin\.it|([a-z0-9-]+\.)?pinimg\.com)$/i;
/** Only Pinterest hosts (https). `extra` lets tests allow a local mock. */
export function pinUrlOk(u, extra = []) {
  try { const x = new URL(u); return extra.includes(x.host) || (x.protocol === 'https:' && PIN_HOSTS.test(x.hostname)); } catch { return false; }
}
export function extractOgImage(html) {
  const tag = String(html).match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i)?.[0] || '';
  const url = tag.match(/content=["']([^"']+)["']/i)?.[1];
  return url ? url.replace(/&amp;/g, '&') : null;
}

export const handlePin = wrap(async (request, env) => {
  const { url } = await readBody(request);
  const extra = (env.PIN_ALLOW_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  if (!pinUrlOk(url, extra)) return json({ error: 'That doesn’t look like a Pinterest link.' }, 400);
  const get = (u) => fetch(u, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; NikkisCloset/1.0)', accept: 'text/html,image/*' } });
  let page = url, res;
  for (let hop = 0; hop < 4; hop++) { // follow redirects ourselves so every hop stays on Pinterest
    res = await get(page);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      page = new URL(res.headers.get('location'), page).href;
      if (!pinUrlOk(page, extra)) return json({ error: 'That link redirected somewhere that isn’t Pinterest.' }, 400);
      continue;
    }
    break;
  }
  if (!res.ok) return json({ error: 'Pinterest didn’t open that link. Save the picture and upload it instead.' }, 502);
  const imgUrl = extractOgImage(await res.text());
  if (!imgUrl || !pinUrlOk(new URL(imgUrl, page).href, extra)) return json({ error: 'Couldn’t find the picture on that pin. Save it and upload it instead.' }, 502);
  const img = await fetch(new URL(imgUrl, page).href);
  const type = (img.headers.get('content-type') || '').split(';')[0];
  if (!img.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: 'Couldn’t download that picture.' }, 502);
  const buf = await img.arrayBuffer();
  if (buf.byteLength > 6_000_000) return json({ error: 'That picture is too large.' }, 413);
  return json({ image: `data:${type};base64,${toBase64(buf)}` });
});

/* ───────── product page import ───────── */
const PRIVATE_NAME = /(^|\.)(localhost|local|internal|localdomain|lan|home|corp)$/i;
/** https only, no IP-literal hosts, no internal-looking names, no credentials or odd ports. `extra` lets tests allow a local mock host. */
export function publicUrlOk(u, extra = []) {
  try {
    const x = new URL(u);
    if (extra.includes(x.host)) return true;
    if (x.protocol !== 'https:' || x.username || x.password || (x.port && x.port !== '443')) return false;
    const h = x.hostname;
    if (!h.includes('.') || h.includes(':') || /^[0-9.]+$/.test(h) || /^\[/.test(h) || PRIVATE_NAME.test(h)) return false;
    return true;
  } catch { return false; }
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'");
const clean = (s, n) => decode(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
function metaContent(html, names) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const key = tag.match(/(?:property|name|itemprop)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key && names.includes(key)) { const c = tag.match(/content=["']([^"']*)["']/i)?.[1]; if (c) return decode(c); }
  }
  return null;
}
function ldProducts(html) {
  const found = [];
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); const t = [].concat(n['@type'] || []); if (t.includes('Product')) found.push(n); walk(n['@graph']); };
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch { /* ignore broken blocks */ } }
  return found;
}
const firstImage = (v) => (Array.isArray(v) ? firstImage(v[0]) : typeof v === 'string' ? v : v && typeof v === 'object' ? v.url || v.contentUrl || null : null);

/** What a shop page tells us about a product: title, brand, price and the main picture's URL (unresolved). */
export function extractProduct(html) {
  const p = ldProducts(html)[0], offer = p && [].concat(p.offers || [])[0];
  const price = Number(String(offer?.price ?? offer?.lowPrice ?? metaContent(html, ['product:price:amount', 'og:price:amount']) ?? '').replace(/[^0-9.]/g, ''));
  return {
    title: clean(p?.name || metaContent(html, ['og:title', 'twitter:title']) || String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 80),
    brand: clean(typeof p?.brand === 'string' ? p.brand : p?.brand?.name || metaContent(html, ['product:brand', 'og:brand']), 40),
    price: price > 0 && price < 100000 ? Math.round(price * 100) / 100 : null,
    image: firstImage(p?.image) || metaContent(html, ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']),
  };
}

async function readLimited(res, max) {
  const reader = res.body?.getReader?.(); if (!reader) return (await res.text()).slice(0, max);
  const parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; if (n > max) { reader.cancel().catch(() => {}); break; } }
  const all = new Uint8Array(n); let o = 0; for (const v of parts) { all.set(v, o); o += v.length; }
  return new TextDecoder().decode(all);
}

export const handleProduct = wrap(async (request, env) => {
  const { url } = await readBody(request);
  const extra = (env.PRODUCT_ALLOW_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  if (!publicUrlOk(url, extra)) return json({ error: 'That doesn’t look like a public web link (it must start with https://).' }, 400);
  const get = (u, accept) => fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(9000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; NikkisCloset/1.0)', accept, 'accept-language': 'en' } });
  const follow = async (start, accept) => { // follow redirects ourselves so every hop is checked
    let page = start, res;
    for (let hop = 0; hop < 5; hop++) {
      res = await get(page, accept);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        page = new URL(res.headers.get('location'), page).href;
        if (!publicUrlOk(page, extra)) throw Object.assign(new Error('That link redirected somewhere I won’t open.'), { status: 400 });
        continue;
      }
      return { res, page };
    }
    throw Object.assign(new Error('Too many redirects.'), { status: 502 });
  };
  let first; try { first = await follow(url, 'text/html,application/xhtml+xml'); } catch (e) { if (e.status) throw e; return json({ error: 'Couldn’t reach that page. Save the picture and upload it instead.' }, 502); }
  if (!first.res.ok) return json({ error: 'That shop didn’t let me open the page. Save the picture and upload it instead.' }, 502);
  const info = extractProduct(await readLimited(first.res, 1_500_000));
  if (!info.image) return json({ error: 'I couldn’t find a product picture on that page. Save it and upload it instead.' }, 502);
  const imgUrl = new URL(info.image, first.page).href;
  if (!publicUrlOk(imgUrl, extra)) return json({ error: 'The picture is hosted somewhere I won’t fetch from.' }, 400);
  let img; try { img = await follow(imgUrl, 'image/webp,image/jpeg,image/png,*/*'); } catch (e) { if (e.status) throw e; return json({ error: 'Couldn’t download that picture.' }, 502); }
  const type = (img.res.headers.get('content-type') || '').split(';')[0].trim();
  if (!img.res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: 'That picture is in a format I can’t use. Save it and upload it instead.' }, 502);
  const buf = await img.res.arrayBuffer();
  if (buf.byteLength > 6_000_000) return json({ error: 'That picture is too large.' }, 413);
  return json({ title: info.title, brand: info.brand, price: info.price, host: new URL(first.page).hostname, image: `data:${type};base64,${toBase64(buf)}` });
}, { needsFal: false });
