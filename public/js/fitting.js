// App side of fitting: reads the base picture's outline once, then turns an item (its cutout + landmarks) into the picture of it worn.
import { makeBody } from './bodymap.js';
import { isStrapless, fitGarment } from './garment.js';
import { suggestFor, groupOf, sleevesFromName } from './landmarks.js';
import { loadImage } from './cutout.js';

let bodyPromise = null;
/** The base picture's body outline (cached). */
export function bodyOf(pack) {
  return (bodyPromise ||= (async () => {
    const img = new Image(); img.src = pack.files[pack.layers.body]; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    return makeBody(g.getImageData(0, 0, c.width, c.height), pack);
  })().catch((e) => { bodyPromise = null; throw e; }));
}

export const cutoutCanvas = async (blob) => {
  const { img, url } = await loadImage(blob); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(url); return c;
};

/** What decides whether a worn picture is still current. */
export const fitSignature = (item, pack) => JSON.stringify([item.type, item.marks || null, item.sleeves ?? null, pack.id, item.cutout?.size]);

/**
 * The item fitted to the body. Resolves to { url, marks } (marks are suggested the first time and should be saved on the item),
 * or null for pieces that aren't warped (shoes, bags, accessories) or have no usable landmarks.
 */
export async function fitItem(item, pack) {
  if (!groupOf(item.type) || !item.cutout) return null;
  const [body, cut] = await Promise.all([bodyOf(pack), cutoutCanvas(item.cutout)]);
  const marks = item.marks || suggestFor(item.type, cut, { sleeves: item.sleeves ?? sleevesFromName(item.type, item.name) });
  const sleeveless = (item.sleeves ?? sleevesFromName(item.type, item.name)) === false;
  const res = fitGarment(cut, item.type, marks, pack, body, { strapless: isStrapless(item.name), sleeveless }); if (!res) return null;
  const blob = await new Promise((r) => res.canvas.toBlob(r, 'image/png'));
  return { url: URL.createObjectURL(blob), blob, marks };
}

/**
 * The base picture with the strip of shorts that would show below a short skirt or dress hidden: for each column of the legs, the rows
 * between the garment's hem and the shorts' hem take the colour of base.png's own thigh just below the shorts. Resolves to a blob URL,
 * or null when nothing worn is short enough to need it.  fitted: canvases (or blobs) of the worn skirts / dresses, as fitted to the body.
 */
export async function baseUnder(pack, fitted) {
  if (!fitted.length) return null;
  const body = await bodyOf(pack), { data, width: w, height: h } = body.img, hem = body.shortsHem;
  const cover = new Int32Array(w).fill(-1); // per column, the lowest row a worn skirt or dress reaches
  for (const f of fitted) {
    const c = f instanceof HTMLCanvasElement ? f : await cutoutCanvas(f), d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    for (let x = 0; x < w; x++) for (let y = h - 1; y >= body.crotchY - 60; y--) if (d[(y * w + x) * 4 + 3] > 128) { cover[x] = Math.max(cover[x], y); break; }
  }
  const out = new ImageData(new Uint8ClampedArray(data), w, h), o = out.data; let changed = false;
  for (let x = 0; x < w; x++) {
    const hy = hem[x] ?? (hem[x - 1] ?? hem[x + 1]); if (hy == null || cover[x] < 0 || cover[x] >= hy + 2) continue; // no garment over this column, or it already covers the shorts
    const src = Math.min(h - 1, hy + 9), s4 = (src * w + x) * 4; // (the thigh's outline is copied too, so the leg keeps its own shape)
    for (let y = Math.max(cover[x] - 6, 0); y <= hy + 6; y++) { const t = (y * w + x) * 4; o[t] = data[s4]; o[t + 1] = data[s4 + 1]; o[t + 2] = data[s4 + 2]; o[t + 3] = data[s4 + 3]; }
    changed = true;
  }
  if (!changed) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(out, 0, 0);
  return URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/png')));
}
