// Renders the model (proportional mannequin OR the user's own photo) with garments fitted to the body.
import { Z } from './data.js';
import { figureSVG, place, viewBox } from './body.js';

/**
 * @param {{body:object, photoUrl?:string, skin:string, hair:string, items:Record<string,object>, urls:Map, cls?:string, label?:string}} o
 */
export function mannequinSVG({ body, photoUrl, skin, hair, hairStyle = 'long', items, urls, cls = '', label = '' }) {
  const vb = viewBox(body, !!photoUrl);
  const k = body.H / 640; // slider offsets are expressed in 1/640ths of body height
  const layers = Z.map((slot) => {
    const it = items[slot];
    if (!it) return '';
    const b = place(it.type, body);
    const a = it.adj || { scale: 1, dx: 0, dy: 0 };
    const cx = b.x + b.w / 2 + a.dx * k, cy = b.y + b.h / 2 + a.dy * k;
    const deg = (b.rot * 180) / Math.PI;
    return `<g transform="translate(${cx} ${cy}) rotate(${deg}) scale(${a.scale}) translate(${-b.w / 2} ${-b.h / 2})" data-slot="${slot}">
      <image href="${urls.get(it.id) || ''}" width="${b.w}" height="${b.h}" preserveAspectRatio="${b.align} meet"/></g>`;
  }).join('');
  const base = photoUrl
    ? `<image href="${photoUrl}" width="${body.W}" height="${body.H}" preserveAspectRatio="none"/>`
    : figureSVG(body, skin, hair, hairStyle);
  const names = Z.map((s) => items[s]?.name).filter(Boolean);
  const desc = label || (names.length ? `Model wearing ${names.join(', ')}` : 'Model with no clothes selected');
  return `<svg class="mannequin ${cls}" viewBox="${vb.map((n) => Math.round(n * 10) / 10).join(' ')}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${desc.replace(/"/g, '&quot;')}">${base}${layers}</svg>`;
}
