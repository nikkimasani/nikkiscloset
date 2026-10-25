// Shared by every serverless endpoint: JSON helper, constant-time compare, fal error text, and the passcode guard.
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function safeEqual(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export const detail = async (res) => {
  const t = await res.text().catch(() => '');
  try { const j = JSON.parse(t); return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j); } catch { return t.slice(0, 300); }
};

/** null when the caller may proceed; otherwise the Response to send back. Fails closed if the server isn't configured. */
export async function guard(request, env, { needsFal = true } = {}) {
  if ((needsFal && !env.FAL_KEY) || !env.APP_PASSCODE) return json({ error: 'AI features are not set up on this server (needs FAL_KEY and APP_PASSCODE).' }, 503);
  if (!safeEqual(request.headers.get('x-app-passcode') || '', env.APP_PASSCODE)) {
    await new Promise((r) => setTimeout(r, 400)); // slows down passcode guessing
    return json({ error: 'Wrong passcode.' }, 401);
  }
  return null;
}

export const DATA_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function toBase64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Only ever fetch result images from fal's own hosts (or the configured base, e.g. a test mock). */
export const falMediaOk = (u, base) => {
  try { const x = new URL(u), b = new URL(base); return x.host === b.host || /(^|\.)fal\.(media|run)$/.test(x.hostname); } catch { return false; }
};
