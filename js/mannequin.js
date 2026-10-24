// The "NPC": a stylised SVG croquis. Garment cutouts are layered on top by slot.
import { BOX, Z, slotOf } from './data.js';

/**
 * @param {{skin:string,hair:string,items:Record<string,object>,urls:Map<string,string>}} o
 * items: slot -> item. urls: item.id -> object URL of its cutout.
 */
export function mannequinSVG({ skin, hair, items, urls, cls = '' }) {
  const layers = Z.map((slot) => {
    const it = items[slot];
    if (!it) return '';
    const b = BOX[it.type];
    const a = it.adj || { scale: 1, dx: 0, dy: 0 };
    const cx = b.x + b.w / 2 + a.dx, cy = b.y + b.h / 2 + a.dy;
    return `<g transform="translate(${cx} ${cy}) scale(${a.scale}) translate(${-b.w / 2} ${-b.h / 2})" data-slot="${slot}">
      <image href="${urls.get(it.id) || ''}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid meet"/></g>`;
  }).join('');
  const shade = 'rgba(0,0,0,.07)';
  return `<svg class="mannequin ${cls}" viewBox="0 0 300 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mannequin wearing selected outfit">
    <ellipse cx="150" cy="624" rx="96" ry="9" fill="${shade}"/>
    <path d="M118 60 Q150 -4 182 60 Q190 120 178 150 L122 150 Q110 120 118 60Z" fill="${hair}"/>
    <g fill="${skin}">
      <path d="M128 296 Q122 450 130 596 L148 596 Q152 450 150 300Z"/>
      <path d="M172 296 Q178 450 170 596 L152 596 Q148 450 150 300Z"/>
      <ellipse cx="136" cy="600" rx="18" ry="7"/><ellipse cx="164" cy="600" rx="18" ry="7"/>
      <path d="M140 80 h20 v26 h-20z"/>
      <path d="M104 106 Q150 92 196 106 L190 192 Q184 240 194 296 Q150 312 106 296 Q116 240 110 192Z"/>
      <ellipse cx="150" cy="54" rx="26" ry="31"/>
    </g>
    <g fill="none" stroke="${skin}" stroke-width="20" stroke-linecap="round">
      <path d="M100 118 Q80 196 76 290"/><path d="M200 118 Q220 196 224 290"/>
    </g>
    <path d="M124 38 Q150 20 176 38 Q164 30 150 32 Q136 30 124 38Z" fill="${hair}"/>
    <circle cx="140" cy="56" r="1.8" fill="#2b1d17" opacity=".6"/><circle cx="160" cy="56" r="1.8" fill="#2b1d17" opacity=".6"/>
    <path d="M144 70 Q150 75 156 70" stroke="#b5584f" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${layers}</svg>`;
}

export { slotOf };
