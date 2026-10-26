// Optional on-device AI cutout. The model runs in a hidden same-origin page (/lab/cutout.html) that has its own, slightly wider
// security policy (it may fetch the model from staticimgly.com), so the rest of the app keeps its strict one.
let frame = null, ready = null;

function lab() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    frame = document.createElement('iframe');
    frame.src = '/lab/cutout.html'; frame.hidden = true; frame.title = 'On-device cutout (hidden)';
    const t = setTimeout(() => { reject(new Error('The on-device cutout page didn’t start.')); ready = null; frame.remove(); }, 10000);
    const on = (e) => { if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.type === 'ready') { clearTimeout(t); removeEventListener('message', on); resolve(frame); } };
    addEventListener('message', on);
    document.body.append(frame);
  });
  return ready;
}

/** Resolves true when the hidden page has started and its model library loads (nothing is downloaded). */
export async function labProbe() {
  const f = await lab();
  return new Promise((resolve) => {
    const on = (e) => { if (e.source === f.contentWindow && e.data?.type === 'probed') { removeEventListener('message', on); resolve(!!e.data.ok); } };
    addEventListener('message', on); f.contentWindow.postMessage({ type: 'probe' }, location.origin);
  });
}

/** blob in, transparent PNG blob out. onProgress(fraction 0..1 | null, phase 'download' | 'cut'). The first run downloads ~45 MB. */
export async function browserCut(blob, onProgress = () => {}) {
  const f = await lab(), keys = new Map();
  return new Promise((resolve, reject) => {
    const on = (e) => {
      if (e.origin !== location.origin || e.source !== f.contentWindow) return;
      const m = e.data;
      if (m?.type === 'progress') {
        keys.set(m.key, [m.current, m.total]);
        let cur = 0, tot = 0; for (const [k, [c, t]] of keys) if (k.startsWith('fetch')) { cur += c; tot += t; }
        if (cur < tot) onProgress(tot ? cur / tot : null, 'download'); else onProgress(null, 'cut');
      } else if (m?.type === 'done') { removeEventListener('message', on); resolve(m.blob); }
      else if (m?.type === 'error') { removeEventListener('message', on); reject(new Error(/fetch|network|load/i.test(m.message) ? 'Couldn’t download the model. Check your connection and try again.' : m.message)); }
    };
    addEventListener('message', on);
    f.contentWindow.postMessage({ type: 'cut', blob }, location.origin);
  });
}
