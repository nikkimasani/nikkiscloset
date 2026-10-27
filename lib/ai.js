// AI helper endpoints on fal.ai credits: tap-to-select (SAM 2), auto-tagging a piece from its photo, and importing a Pinterest pin.
// The fal model ids/fields are written from fal's public docs and are UNVERIFIED against the live API: each is overridable by an
// env var, and fal's own error text is passed back to the app so a wrong field name is easy to spot.
import { json, detail, guard, DATA_URI, toBase64, falMediaOk } from './api.js';
import { starterItem, promptFor, sizeFor } from '../public/starter/items.js';

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

/* ───────── tap-to-select (SAM 2) ───────── */
/** Points as fractions of the picture -> fal's SAM 2 point prompts (pixels; label 1 = keep, 0 = remove). Pure, for tests. */
export function samPrompts(pos, neg, w, h) {
  const ok = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
  const pt = (label) => (p) => ({ x: Math.round(p[0] * (w - 1)), y: Math.round(p[1] * (h - 1)), label });
  return [...(pos || []).filter(ok).slice(0, 12).map(pt(1)), ...(neg || []).filter(ok).slice(0, 12).map(pt(0))];
}
export const handleSegment = wrap(async (request, env) => {
  const { image, pos, neg, w, h } = await readBody(request);
  if (!DATA_URI.test(image || '')) return json({ error: 'image must be a JPEG/PNG data URI.' }, 400);
  if (!(w > 0 && h > 0 && w <= 4096 && h <= 4096)) return json({ error: 'w and h must be the picture size.' }, 400);
  const prompts = samPrompts(pos, neg, w, h);
  if (!prompts.some((p) => p.label === 1)) return json({ error: 'Tap the garment at least once.' }, 400);
  const { out, base } = await falRun(env, env.FAL_SEGMENT_MODEL || 'fal-ai/sam2/image', { image_url: image, prompts, apply_mask: false, output_format: 'png' });
  const url = out?.image?.url || out?.mask?.url || out?.masks?.[0]?.url || out?.individual_masks?.[0]?.url;
  if (!url || !falMediaOk(url, base)) return json({ error: 'fal.ai returned no mask.' }, 502);
  const img = await fetch(url);
  if (!img.ok) return json({ error: 'Could not download the mask.' }, 502);
  return json({ mask: `data:${(img.headers.get('content-type') || 'image/png').split(';')[0]};base64,${toBase64(await img.arrayBuffer())}` });
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

/* ───────── starter closet: one product photo per piece from the fixed list ───────── */
// Only pieces on the list (public/starter/items.js) can be made, with the shared prompt, so the passcode can't be used for arbitrary images.
// Engine: Cloudflare Workers AI (FLUX.1 schnell, 4 steps, free tier of 10,000 neurons a day) when CF_ACCOUNT_ID and CF_API_TOKEN are set;
// fal is an optional fallback, used only when asked for with engine: 'fal' (it's paid, so never chosen silently).
export const CF_MODEL = '@cf/black-forest-labs/flux-1-schnell', CF_STEPS = 4, STARTER_FAL_MODEL = 'fal-ai/flux-pro/v1.1';
/** Cloudflare's price for one picture: 4.8 neurons per 512x512 tile (a 1024x1024 picture is 4 tiles) + 9.6 per step. */
export const NEURONS_EACH = Math.round((4 * 4.8 + CF_STEPS * 9.6) * 10) / 10;
export const DAILY_FREE = 10000, BUDGET = 9800; // (stops a little under the free allowance)
/* Neurons used today are kept server-side in Supabase (table starter_usage, functions starter_usage_today / starter_usage_add), per UTC
   day, so every device and every deployment sees the same count. If Supabase can't be reached the count is skipped, never guessed. */
const usageBase = (env) => ({ url: (env.USAGE_SUPABASE_URL || 'https://kyswqvjgbgztkqamkmac.supabase.co').replace(/\/$/, ''), key: env.USAGE_SUPABASE_KEY || 'sb_publishable_hBZiTFY0fCo7VodkXHDoYA_JeLZTz7E' });
async function usageRpc(env, fn, body = {}) {
  const { url, key } = usageBase(env);
  try {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return null; const v = Number(await r.json()); return Number.isFinite(v) ? v : null;
  } catch { return null; }
}
export const usedToday = (env) => (env.USAGE_DISABLED ? Promise.resolve(null) : usageRpc(env, 'starter_usage_today'));
export const addUsage = (env, n) => (env.USAGE_DISABLED ? Promise.resolve(null) : usageRpc(env, 'starter_usage_add', { n }));
/** The next 00:00 UTC, when Cloudflare's daily free allocation resets. */
export const nextResetUTC = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
/** True when a Cloudflare error means the daily free neurons are used up (as opposed to a real failure). */
export const isDailyLimit = (status, text) => status === 429 || /neuron|daily free allocation|4006/i.test(text || '');

/** The Cloudflare account ID: the 32-character hex ID, also when a dashboard address (dash.cloudflare.com/<id>/...) or stray spaces were pasted. */
export const cfAccount = (v) => String(v || '').match(/\b[0-9a-f]{32}\b/i)?.[0] || '';

async function cfImage(env, it, seed) {
  const base = (env.CF_API_BASE || 'https://api.cloudflare.com').replace(/\/$/, '');
  const r = await fetch(`${base}/client/v4/accounts/${cfAccount(env.CF_ACCOUNT_ID)}/ai/run/${CF_MODEL}`, {
    method: 'POST', headers: { authorization: `Bearer ${String(env.CF_API_TOKEN).trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: promptFor(it), steps: CF_STEPS, ...(Number.isInteger(seed) && { seed }) }),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
  if (!r.ok || !j?.success) {
    const msg = j?.errors?.map((e) => `${e.code ? e.code + ' ' : ''}${e.message}`).join('; ') || t.slice(0, 300);
    if (isDailyLimit(r.status, msg)) throw Object.assign(new Error('Cloudflare’s free daily allowance is used up.'), { status: 429, limit: true });
    throw Object.assign(new Error(`Cloudflare said: ${msg}`), { status: 502 });
  }
  if (!j.result?.image) throw Object.assign(new Error('Cloudflare returned no picture.'), { status: 502 });
  return { image: `data:image/jpeg;base64,${j.result.image}`, engine: 'cloudflare', neurons: NEURONS_EACH };
}
async function falImage(env, it, seed) {
  const input = { prompt: promptFor(it), image_size: sizeFor(it), num_images: 1, output_format: 'png', safety_tolerance: '2', ...(Number.isInteger(seed) && { seed }) };
  const { out, base } = await falRun(env, env.FAL_STARTER_MODEL || STARTER_FAL_MODEL, input);
  const url = out?.images?.[0]?.url || out?.image?.url;
  if (!url || !falMediaOk(url, base)) throw Object.assign(new Error('fal.ai returned no picture.'), { status: 502 });
  const img = await fetch(url);
  if (!img.ok) throw Object.assign(new Error('Could not download the picture.'), { status: 502 });
  return { image: `data:${(img.headers.get('content-type') || 'image/png').split(';')[0]};base64,${toBase64(await img.arrayBuffer())}`, engine: 'fal', neurons: 0 };
}
export const handleStarter = wrap(async (request, env) => {
  const { id, seed, engine, usage } = await readBody(request);
  if (usage) return json({ used: await usedToday(env), free: DAILY_FREE, resetAt: nextResetUTC() }); // just the day's count
  const it = starterItem(String(id || ''));
  if (!it) return json({ error: 'Not a starter piece.' }, 400);
  const cf = !!(env.CF_ACCOUNT_ID && env.CF_API_TOKEN), useFal = engine === 'fal'; // fal (paid) only when asked for by name, never as a silent fallback
  if (!useFal && !cf) return json({ error: 'The starter closet needs CF_ACCOUNT_ID and CF_API_TOKEN (Cloudflare Workers AI) set in Vercel, then a redeploy.' }, 503);
  if (!useFal && !cfAccount(env.CF_ACCOUNT_ID)) return json({ error: 'CF_ACCOUNT_ID in Vercel isn’t a Cloudflare account ID: it should be the 32 letters and numbers shown as “Account ID” on the Cloudflare dashboard.' }, 503);
  if (useFal && !env.FAL_KEY) return json({ error: 'fal needs FAL_KEY set on the server.' }, 503);
  if (!useFal) { const used = await usedToday(env); if (used !== null && used + NEURONS_EACH > BUDGET) return json({ error: 'Today’s free Cloudflare allowance is used up.', limit: true, used, resetAt: nextResetUTC() }, 429); }
  try {
    const out = await (useFal ? falImage : cfImage)(env, it, seed);
    if (!useFal) out.used = await addUsage(env, NEURONS_EACH);
    return json({ ...out, seed: seed ?? null, prompt: promptFor(it), bytes: Math.round((out.image.length - out.image.indexOf(',') - 1) * 3 / 4) }); // (prompt and size are for the review log)
  } catch (e) {
    if (e.limit) { const used = await usedToday(env); if (used !== null && used < DAILY_FREE) await addUsage(env, DAILY_FREE - used); return json({ error: e.message, limit: true, used: DAILY_FREE, resetAt: nextResetUTC() }, 429); } // Cloudflare says so: the day is used up
    throw e;
  }
}, { needsFal: false });
