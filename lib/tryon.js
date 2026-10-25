// Server-side proxy to fal.ai virtual try-on. Runs on Vercel (api/tryon.js), Cloudflare (worker/index.js)
// and the local dev server. The fal key lives only in env vars — never in the browser.
//
// UNVERIFIED against the live fal API (written from fal's public docs): if fal rejects a field name the
// UI shows fal's own error text. The whole fal contract is the constants below.
import { json, detail, guard, DATA_URI, toBase64 } from './api.js';

export const MODEL = 'fal-ai/fashn/tryon/v1.5';
export const PRICE_PER_PIECE = 0.075; // USD, per fal's listing — shown to the user before they spend it

const CATEGORIES = new Set(['tops', 'bottoms', 'one-pieces']);
const MAX_BODY = 7_000_000;

export async function handleTryOn(request, env) {
  const denied = await guard(request, env);
  if (denied) return denied;

  const base = (env.FAL_QUEUE_BASE || 'https://queue.fal.run').replace(/\/$/, '');
  const baseURL = new URL(base);
  const auth = { authorization: `Key ${env.FAL_KEY}` };
  // Only ever talk to fal's queue (and its media hosts) — never an arbitrary URL from the client.
  const fromFal = (u) => {
    try { const x = new URL(u); return x.host === baseURL.host && x.protocol === baseURL.protocol && x.pathname.startsWith('/fal-ai/fashn/'); } catch { return false; }
  };
  const mediaOk = (u) => { try { const x = new URL(u); return x.host === baseURL.host || /(^|\.)fal\.(media|run)$/.test(x.hostname); } catch { return false; } };

  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'Images too large.' }, 413);
    let body;
    try { body = JSON.parse(await request.text()); } catch { return json({ error: 'Bad request.' }, 400); }
    const { person, garment, category } = body || {};
    if (!DATA_URI.test(person || '') || !DATA_URI.test(garment || '')) return json({ error: 'person and garment must be JPEG/PNG data URIs.' }, 400);
    if (person.length + garment.length > MAX_BODY) return json({ error: 'Images too large.' }, 413);
    if (!CATEGORIES.has(category)) return json({ error: 'category must be tops, bottoms or one-pieces.' }, 400);

    const submit = (extra) => fetch(`${base}/${MODEL}`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ model_image: person, garment_image: garment, ...extra }),
    });
    let res = await submit({ category });
    if (res.status === 422) res = await submit({}); // unknown/renamed category field: fall back to fal's auto-detect
    if (!res.ok) return json({ error: `fal.ai said: ${await detail(res)}`, upstream: res.status }, 502);
    const q = await res.json();
    if (!fromFal(q.status_url) || !fromFal(q.response_url)) return json({ error: 'Unexpected response from fal.ai.' }, 502);
    return json({ statusUrl: q.status_url, responseUrl: q.response_url });
  }

  if (request.method === 'GET') {
    const p = new URL(request.url).searchParams;
    const statusUrl = p.get('status'), responseUrl = p.get('response');
    if (!fromFal(statusUrl) || !fromFal(responseUrl)) return json({ error: 'Bad status link.' }, 400);
    const st = await fetch(statusUrl, { headers: auth });
    if (!st.ok) return json({ error: `fal.ai said: ${await detail(st)}` }, 502);
    const s = await st.json();
    if (s.status !== 'COMPLETED') return json({ status: s.status === 'IN_PROGRESS' ? 'running' : 'queued' });
    const out = await fetch(responseUrl, { headers: auth });
    if (!out.ok) return json({ status: 'failed', error: `fal.ai said: ${await detail(out)}` });
    const result = await out.json();
    const imgUrl = result?.images?.[0]?.url;
    if (!imgUrl || !mediaOk(imgUrl)) return json({ status: 'failed', error: 'fal.ai returned no image.' });
    const img = await fetch(imgUrl);
    if (!img.ok) return json({ status: 'failed', error: 'Could not download the result image.' });
    const type = (img.headers.get('content-type') || 'image/png').split(';')[0];
    return json({ status: 'done', image: `data:${type};base64,${toBase64(await img.arrayBuffer())}` });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
