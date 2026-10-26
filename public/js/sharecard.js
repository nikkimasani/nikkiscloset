// Draws a shareable "look card" (PNG): the model, the pieces, the date and the mood.
import { trimTransparent } from './cutout.js';

const W = 1080, H = 1350;

const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const fit = (img, bw, bh) => { const k = Math.min(bw / img.width, bh / img.height); return [img.width * k, img.height * k]; };
function ellipsize(g, text, maxW) { let t = text; while (t.length > 3 && g.measureText(t).width > maxW) t = t.slice(0, -2); return t === text ? t : t.trimEnd() + '…'; }

/**
 * @param {{title:string, sub?:string, items:{name:string,url:string}[], model?:HTMLCanvasElement|null}} o
 * @returns {Promise<Blob>} a 1080x1350 PNG
 */
export async function lookCard({ title, sub = '', items, model = null }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#123a5c'); bg.addColorStop(1, '#3a2a6b');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  g.fillStyle = '#ffffff'; g.font = '700 66px Georgia, serif'; g.fillText(ellipsize(g, title, W - 120), 60, 112);
  g.fillStyle = '#b7d3ea'; g.font = '32px system-ui, sans-serif'; g.fillText(ellipsize(g, sub, W - 120), 60, 162);

  const imgs = await Promise.all(items.slice(0, 7).map((i) => load(i.url)));

  // the "room": the model if we have one, otherwise the pieces laid out
  const sx = 60, sy = 200, sw = 520, sh = 980;
  g.save(); rrect(g, sx, sy, sw, sh, 40); g.clip();
  const room = g.createLinearGradient(0, sy, 0, sy + sh);
  room.addColorStop(0, '#ddd3f8'); room.addColorStop(0.64, '#cfc4f3'); room.addColorStop(0.64, '#c98f5a'); room.addColorStop(1, '#b87d46');
  g.fillStyle = room; g.fillRect(sx, sy, sw, sh);
  if (model) { const m = trimTransparent(model, 12), [w, h] = fit(m, sw - 60, sh - 70); g.drawImage(m, sx + (sw - w) / 2, sy + sh - 40 - h, w, h); } // feet on the floor
  else {
    const n = Math.max(1, imgs.filter(Boolean).length), slot = (sh - 40) / n;
    imgs.forEach((img, k) => { if (!img) return; const [w, h] = fit(img, sw - 80, slot - 16); g.drawImage(img, sx + (sw - w) / 2, sy + 20 + k * slot + (slot - h) / 2, w, h); });
  }
  g.restore();

  items.slice(0, 7).forEach((it, k) => {
    const y = 200 + k * 140;
    g.fillStyle = 'rgba(255,255,255,.1)'; rrect(g, 620, y, 400, 124, 24); g.fill();
    g.fillStyle = '#eef5ff'; rrect(g, 634, y + 12, 100, 100, 16); g.fill();
    if (imgs[k]) { const [w, h] = fit(imgs[k], 88, 88); g.drawImage(imgs[k], 640 + (88 - w) / 2, y + 18 + (88 - h) / 2, w, h); }
    g.fillStyle = '#ffffff'; g.font = '600 30px system-ui, sans-serif'; g.fillText(ellipsize(g, it.name, 250), 752, y + 72);
  });

  g.fillStyle = '#b7d3ea'; g.font = '30px system-ui, sans-serif'; g.fillText("Nikki's Closet", 60, 1270);
  g.fillStyle = '#ff7aa8'; g.beginPath(); g.moveTo(W - 90, 1240); g.lineTo(W - 62, 1262); g.lineTo(W - 90, 1292); g.lineTo(W - 118, 1262); g.closePath(); g.fill();
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** Use the phone's share sheet when it can share a file; otherwise download it. */
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
