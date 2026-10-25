// Client for the /api/tryon function (fal.ai virtual try-on). The fal key never touches the browser;
// the passcode below only proves it's you, so strangers can't spend your credits.
export const PRICE = 0.075; // USD per garment — keep in sync with lib/tryon.js
const CATEGORY = { dress: 'one-pieces', top: 'tops', bottom: 'bottoms', outer: 'tops' };

/** Which pieces the AI renders, in order. The rest (shoes, bag, accessories, a jacket over a top) are layered on top. */
export function aiSteps(bySlot) {
  const steps = bySlot.dress ? [['dress', bySlot.dress]] : ['top', 'bottom'].filter((s) => bySlot[s]).map((s) => [s, bySlot[s]]);
  if (!steps.length && bySlot.outer) steps.push(['outer', bySlot.outer]);
  return steps;
}
export const aiSignature = (steps) => steps.map(([, i]) => i.id).join('+');

const bitmap = (blob) => createImageBitmap(blob);
function jpeg(src, max, bg) {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
  const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}
export const personImage = async (blob) => jpeg(await bitmap(blob), 1024, '#fff');
/** Garment cutouts go on a plain white background — what try-on models expect from a product shot. */
export const garmentImage = async (blob) => jpeg(await bitmap(blob), 768, '#fff');

async function call(url, opts, passcode) {
  const res = await fetch(url, { ...opts, headers: { ...opts.headers, 'x-app-passcode': passcode } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Try-on service error (${res.status})`);
  return body;
}

/** Applies each garment in turn, feeding every result into the next step. Resolves with a data URI. */
export async function renderOutfit({ person, steps, passcode, signal, onProgress = () => {}, onPiece = () => {}, pollMs = 2000 }) {
  let current = person;
  for (let i = 0; i < steps.length; i++) {
    const label = `piece ${i + 1} of ${steps.length}`;
    onProgress(`Starting ${label}…`);
    const { statusUrl, responseUrl } = await call('/api/tryon', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ person: current, garment: steps[i].garment, category: steps[i].category }),
    }, passcode);
    const qs = new URLSearchParams({ status: statusUrl, response: responseUrl });
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 150_000) throw new Error('That took too long — try again.');
      await new Promise((r) => setTimeout(r, pollMs));
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const r = await call(`/api/tryon?${qs}`, { signal }, passcode);
      if (r.status === 'done') { current = r.image; onPiece(i); break; }
      if (r.status === 'failed') throw new Error(r.error || 'The render failed.');
      onProgress(`${r.status === 'queued' ? 'Waiting in line' : 'Rendering'} — ${label}…`);
    }
  }
  return current;
}
export const categoryFor = (slot) => CATEGORY[slot];
