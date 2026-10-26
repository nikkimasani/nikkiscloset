// Talks only to the app page that embeds it (same origin). Messages in: ping, probe, cut {blob}. Out: ready, probed, progress, done {blob}, error.
const ORIGIN = location.origin;
const post = (m) => parent.postMessage(m, ORIGIN);
let lib = null;
const load = async () => (lib ||= await import('../vendor/imgly/imgly.js'));

addEventListener('message', async (e) => {
  if (e.origin !== ORIGIN || e.source !== parent) return;
  const m = e.data;
  try {
    if (m?.type === 'ping') return post({ type: 'ready' });
    if (m?.type === 'probe') { await load(); return post({ type: 'probed', ok: typeof lib.removeBackground === 'function' }); }
    if (m?.type !== 'cut' || !(m.blob instanceof Blob)) return;
    await load();
    const out = await lib.removeBackground(m.blob, {
      model: 'isnet_quint8', device: 'cpu', output: { format: 'image/png' },
      progress: (key, current, total) => post({ type: 'progress', key, current, total }),
    });
    post({ type: 'done', blob: out });
  } catch (err) { post({ type: 'error', message: String(err?.message || err).slice(0, 200) }); }
});
post({ type: 'ready' });
