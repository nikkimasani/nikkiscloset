// IndexedDB wrapper. Photos are stored as Blobs, so everything stays on-device.
const DB_NAME = 'nikkis-closet';
const STORES = ['items', 'outfits', 'wears', 'inspos', 'profile'];
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
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
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
