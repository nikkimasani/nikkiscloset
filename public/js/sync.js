// Optional cloud sync. Talks straight to a Supabase project's REST API; nothing is sent until a sync key is entered.
// The key is sent as the x-sync-key header and checked server-side by a row-level-security policy (only its hash is stored there).
import { all, put, del, tombstones, clearTombstones } from './db.js';

export const CLOUD = { url: 'https://kyswqvjgbgztkqamkmac.supabase.co', key: 'sb_publishable_hBZiTFY0fCo7VodkXHDoYA_JeLZTz7E' }; // public by design
const SYNCED = ['items', 'outfits', 'wears', 'inspos', 'profile', 'plans', 'wishlist', 'renders'];
const PREFS = ['skin', 'hair', 'hairstyle', 'shape', 'shapename', 'eyes', 'lips', 'room', 'budget'];
const ls = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
export const syncState = () => ({ on: !!ls.get('synckey'), last: Number(ls.get('sync_last')) || 0 });
export const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[\s_.,]+/g, '-').replace(/^-+|-+$/g, '');
export function connect(key) { ls.set('synckey', normalizeKey(key)); ls.del('sync_push'); ls.del('sync_pull'); }
export function disconnect() { ['synckey', 'sync_push', 'sync_pull', 'sync_last'].forEach(ls.del); }

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${CLOUD.url}/rest/v1/${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: CLOUD.key, 'x-sync-key': ls.get('synckey'), 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'The cloud rejected that sync key.' : `Cloud error ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
const fromB64 = async (b64, mime) => (await fetch(`data:${mime};base64,${b64}`)).blob();
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// replace each Blob with a reference and upload its bytes under a key that changes whenever the record does
async function pack(store, rec, blobRows) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v instanceof Blob) {
      const key = `${store}/${rec.id}/${k}/${rec._u}`;
      blobRows.push({ key, mime: v.type || 'application/octet-stream', b64: await toB64(v), updated_at: rec._u });
      out[k] = { __blobref: key, mime: v.type };
    } else out[k] = v;
  }
  return out;
}

async function unpack(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.__blobref === 'string') {
      const rows = await rest(`sync_blobs?key=eq.${encodeURIComponent(v.__blobref)}&select=mime,b64`);
      out[k] = rows?.[0] ? await fromB64(rows[0].b64, rows[0].mime) : undefined;
    } else out[k] = v;
  }
  return out;
}

const prefsRecord = () => ({ id: 'prefs', _u: Number(ls.get('prefs_u')) || 0, values: Object.fromEntries(PREFS.map((k) => [k, ls.get(k)]).filter(([, v]) => v)) });

/** Two-way sync, newest edit wins. Returns counts so the UI can say what happened. */
export async function syncNow() {
  if (!ls.get('synckey')) throw new Error('Not connected');
  const lastPull = Number(ls.get('sync_pull')) || 0;
  const lastPush = Number(ls.get('sync_push')) || 0;
  const started = Date.now();
  let pulled = 0, pushed = 0, removed = 0;

  // pull everything the cloud changed since last time
  const locals = new Map();
  for (const s of SYNCED) for (const r of await all(s)) locals.set(`${s}/${r.id}`, r);
  const tombs = tombstones();
  const remote = await rest(`sync_records?updated_at=gt.${lastPull}&select=store,id,data,deleted,updated_at&order=updated_at.asc&limit=2000`) || [];
  for (const row of remote) {
    if (row.store === 'prefs') {
      if (row.updated_at > prefsRecord()._u && !row.deleted) { for (const [k, v] of Object.entries(row.data?.values || {})) if (PREFS.includes(k)) ls.set(k, String(v)); ls.set('prefs_u', String(row.updated_at)); pulled++; }
      continue;
    }
    if (!SYNCED.includes(row.store)) continue;
    const mine = locals.get(`${row.store}/${row.id}`);
    const mineT = Math.max(mine?._u || 0, tombs[`${row.store}/${row.id}`] || 0);
    if (row.updated_at <= mineT) continue;
    if (row.deleted) { if (mine) { await del(row.store, row.id, { sync: true }); removed++; } continue; }
    const rec = await unpack(row.data);
    rec._u = row.updated_at;
    await put(row.store, rec, { sync: true });
    pulled++;
  }

  // push whatever changed here since last time (everything, the first time)
  const rows = [], blobs = [];
  for (const [k, r] of locals) {
    const [store] = k.split('/');
    const u = r._u || 1;
    if (lastPush && u <= lastPush) continue;
    if (remote.some((x) => x.store === store && x.id === r.id && x.updated_at >= u)) continue; // the cloud already has a newer copy
    const rec = { ...r, _u: u };
    rows.push({ store, id: r.id, data: await pack(store, rec, blobs), deleted: false, updated_at: u });
  }
  for (const [k, t] of Object.entries(tombs)) {
    if ((locals.get(k)?._u || 0) > t) continue; // deleted, then added back
    const i = k.indexOf('/');
    rows.push({ store: k.slice(0, i), id: k.slice(i + 1), data: null, deleted: true, updated_at: t });
  }
  const p = prefsRecord();
  if (p._u && (!lastPush || p._u > lastPush)) rows.push({ store: 'prefs', id: 'prefs', data: p, deleted: false, updated_at: p._u });
  for (const part of chunks(blobs, 5)) await rest('sync_blobs?on_conflict=key', { method: 'POST', body: part, prefer: 'resolution=merge-duplicates,return=minimal' });
  for (const part of chunks(rows, 50)) await rest('sync_records?on_conflict=store,id', { method: 'POST', body: part, prefer: 'resolution=merge-duplicates,return=minimal' });
  pushed = rows.length;
  clearTombstones();
  ls.set('sync_push', String(started));
  ls.set('sync_pull', String(Math.max(started, ...remote.map((r) => r.updated_at))));
  ls.set('sync_last', String(Date.now()));
  return { pulled, pushed, removed };
}
