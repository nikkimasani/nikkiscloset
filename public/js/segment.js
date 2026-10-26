// Tap-to-select cutout engine (GrabCut, OpenCV). It runs in a Web Worker (/lab/segment-worker.js) with its own security policy,
// so the rest of the app keeps its strict one. Nothing is uploaded: the picture never leaves the phone.
let worker = null, ready = null, seq = 0;

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

/** Hand the engine a picture (a Blob). Resolves to the size it works at. */
export const loadPicture = (blob) => ask({ type: 'load', blob }, 'loaded');

/**
 * Select by tapping. pos / neg: [[u, v], ...] as fractions (0..1) of the picture: spots on the garment, and spots that must be left out.
 * rect: [u0, v0, u1, v1] the crop. Resolves to { w, h, data } where data is a Uint8Array of 0 / 255 (255 = garment).
 */
export const selectByTaps = ({ pos, neg, rect }) => ask({ type: 'cut', pos, neg, rect }, 'mask').then((m) => (m.data ? m : null)); // null: a newer tap replaced this request

/** Drop the hidden page (frees its memory). */
export function closeEngine() { worker?.terminate(); worker = null; ready = null; }
