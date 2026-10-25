// IndexedDB wrapper. Photos are stored as Blobs, so everything stays on-device.
const DB_NAME = 'nikkis-closet';
const STORES = ['items', 'outfits', 'wears', 'inspos', 'profile', 'plans', 'wishlist', 'renders'];
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => STORES.forEach((s) => { if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out.result);
    t.onerror = () => reject(t.error);
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
// Every write is time-stamped (_u) and every delete leaves a tombstone, so cloud sync knows what changed. Sync's own writes pass { sync: true }.
export const put = (store, obj, opt) => { if (!opt?.sync) obj._u = Date.now(); return tx(store, 'readwrite', (s) => s.put(obj)); };
export const del = (store, id, opt) => {
  if (!opt?.sync && localStorage.getItem('synckey')) { const t = tombstones(); t[`${store}/${id}`] = Date.now(); try { localStorage.setItem('sync_tombs', JSON.stringify(t)); } catch { /* private mode */ } }
  return tx(store, 'readwrite', (s) => s.delete(id));
};
export const tombstones = () => { try { return JSON.parse(localStorage.getItem('sync_tombs') || '{}'); } catch { return {}; } };
export const clearTombstones = () => { try { localStorage.removeItem('sync_tombs'); } catch { /* private mode */ } };
