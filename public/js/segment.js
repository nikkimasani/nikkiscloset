// Tap-to-select. Primary engine: SAM 2 on fal (through /api/segment, needs the passcode; nothing to download). Offline fallback:
// GrabCut (OpenCV) in a Web Worker (/lab/segment-worker.js, its own security policy), which never uploads anything.
import { callAI } from './aitryon.js';
let worker = null, ready = null, seq = 0, pic = null, samOff = false;
const passcode = () => { try { return localStorage.getItem('aipass') || ''; } catch { return ''; } };

function engine() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    worker = new Worker('/lab/segment-worker.js');
    const t = setTimeout(() => { reject(new Error('The selection tool didn’t start.')); ready = null; worker.terminate(); }, 15000);
    worker.addEventListener('message', function on(e) { if (e.data?.type === 'ready') { clearTimeout(t); worker.removeEventListener('message', on); resolve(worker); } });
    worker.addEventListener('error', () => { clearTimeout(t); reject(new Error('The selection tool didn’t start.')); ready = null; });
  });
  return ready;
}

const ask = (msg, want, transfer) => engine().then((w) => new Promise((resolve, reject) => {
  const id = ++seq;
  const on = (e) => {
    const m = e.data; if (m?.id && m.id !== id) return;
    if (m?.type === want) { w.removeEventListener('message', on); resolve(m); }
    else if (m?.type === 'error') { w.removeEventListener('message', on); reject(new Error(m.message)); }
  };
  w.addEventListener('message', on); w.postMessage({ ...msg, id }, transfer);
}));

/** Hand the engines a picture (a Blob). Resolves to the size the offline engine works at. */
export async function loadPicture(blob) {
  pic = null; samOff = false;
  const bmp = await createImageBitmap(blob), k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  pic = { uri: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
  if (passcode()) return { w: c.width, h: c.height }; // the offline engine starts only if SAM 2 isn't available
  return ask({ type: 'load', blob }, 'loaded');
}

/** A mask picture from SAM 2 -> { w, h, data } (its transparency if it has any, else its brightness). */
async function maskFrom(uri) {
  const img = new Image(); img.src = uri; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, data = new Uint8Array(n);
  let see = 0; for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 128) see++;
  for (let i = 0; i < n; i++) data[i] = (see > n * 0.02 ? d[i * 4 + 3] >= 128 : d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] > 384) ? 255 : 0;
  return { w: c.width, h: c.height, data };
}

let samSeq = 0;
async function sam({ pos, neg }) {
  const my = ++samSeq, out = await callAI('/api/segment', { image: pic.uri, w: pic.w, h: pic.h, pos, neg }, passcode());
  if (my !== samSeq) return null; // a newer tap replaced this request
  return { ...(await maskFrom(out.mask)), engine: 'sam2' };
}

/**
 * Select by tapping. pos / neg: [[u, v], ...] as fractions (0..1) of the picture: spots on the garment, and spots that must be left out.
 * rect: [u0, v0, u1, v1] the crop. Resolves to { w, h, data } where data is a Uint8Array of 0 / 255 (255 = garment).
 */
export async function selectByTaps({ pos, neg, rect }) {
  if (pic && passcode() && !samOff) {
    try { return await sam({ pos, neg }); } catch (e) { samOff = true; lastError = e.message; } // (it stays on the offline engine for this picture)
  }
  if (!worker) { const b = await (await fetch(pic.uri)).blob(); await ask({ type: 'load', blob: b }, 'loaded'); }
  const m = await ask({ type: 'cut', pos, neg, rect }, 'mask');
  return m.data ? { ...m, engine: 'grabcut' } : null; // null: a newer tap replaced this request
}
let lastError = '';
/** Why SAM 2 wasn't used for the last selection ('' if it was, or wasn't tried). */
export const samProblem = () => (samOff ? lastError : '');

/** Drop the hidden page (frees its memory). */
export function closeEngine() { worker?.terminate(); worker = null; ready = null; pic = null; }
