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

const wrap = (fn) => async (request, env) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const denied = await guard(request, env);
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
