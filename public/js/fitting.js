// App side of fitting: reads the base picture's outline once, then turns an item (its cutout + landmarks) into the picture of it worn.
import { makeBody } from './bodymap.js';
import { fitGarment } from './garment.js';
import { suggestFor, groupOf } from './landmarks.js';
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
  const marks = item.marks || suggestFor(item.type, cut, { sleeves: item.sleeves });
  const res = fitGarment(cut, item.type, marks, pack, body); if (!res) return null;
  const blob = await new Promise((r) => res.canvas.toBlob(r, 'image/png'));
  return { url: URL.createObjectURL(blob), blob, marks };
}
