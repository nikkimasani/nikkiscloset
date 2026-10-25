// A starter closet drawn on the fly, so the app is explorable before you've photographed anything.
import { canvasToBlob } from './cutout.js';

function draw(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; }
const shape = (ctx, col, pts, curve) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(...pts[0]); pts.slice(1).forEach((p) => (p.length === 4 ? ctx.quadraticCurveTo(...p) : ctx.lineTo(...p))); ctx.closePath(); ctx.fill(); if (curve) ctx.stroke(); };

const tee = (col) => draw(300, 300, (c) => shape(c, col, [[90, 20], [130, 40, 150, 52], [170, 40, 210, 20], [290, 70], [260, 120], [225, 100], [225, 280], [75, 280], [75, 100], [40, 120], [10, 70]]));
const tank = (col) => draw(240, 300, (c) => shape(c, col, [[70, 10], [90, 10], [100, 70, 120, 78], [140, 70, 150, 10], [170, 10], [190, 120], [205, 290], [35, 290], [50, 120]]));
const jeans = (col) => draw(220, 420, (c) => { shape(c, col, [[30, 10], [190, 10], [210, 410], [120, 410], [110, 120], [100, 410], [10, 410]]); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(30, 10, 160, 14); });
const skirt = (col) => draw(300, 220, (c) => shape(c, col, [[80, 10], [220, 10], [290, 210], [10, 210]]));
const dress = (col) => draw(280, 440, (c) => shape(c, col, [[100, 10], [120, 10], [140, 70, 140, 70], [160, 70, 160, 10], [180, 10], [200, 120], [190, 150], [272, 430], [8, 430], [90, 150], [80, 120]]));
const blazer = (col) => draw(320, 300, (c) => { shape(c, col, [[100, 10], [140, 40, 160, 90], [180, 40, 220, 10], [310, 60], [300, 290], [250, 290], [250, 120], [210, 290], [110, 290], [70, 120], [70, 290], [20, 290], [10, 60]]); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(158, 90, 4, 190); });
const heels = (col) => draw(300, 120, (c) => { for (const ox of [0, 150]) shape(c, col, [[ox + 20, 20], [ox + 60, 20], [ox + 70, 70], [ox + 130, 80], [ox + 134, 96], [ox + 20, 96]]); });
const bag = (col) => draw(220, 240, (c) => { c.strokeStyle = col; c.lineWidth = 9; c.beginPath(); c.arc(110, 80, 50, Math.PI, 0); c.stroke(); shape(c, col, [[20, 80], [200, 80], [210, 230], [10, 230]]); });

export const SAMPLES = [
  { name: 'White tee', type: 'tops', make: () => tee('#f4f1ea'), occasions: ['Casual Outing', 'Brunch', 'Travel'], hex: '#f4f1ea' },
  { name: 'Silk blouse', type: 'tops', make: () => tee('#e6a9b8'), occasions: ['Work / Office', 'Dinner', 'Date Night'], hex: '#e6a9b8' },
  { name: 'Black tank', season: 'light', type: 'tanks', make: () => tank('#1d1d20'), occasions: ['GNO', 'Date Night', 'Casual Outing'], hex: '#1d1d20' },
  { name: 'Blue jeans', type: 'bottoms', make: () => jeans('#46628f'), occasions: ['Casual Outing', 'Brunch', 'GNO'], hex: '#46628f' },
  { name: 'Black trousers', type: 'bottoms', make: () => jeans('#26262b'), occasions: ['Work / Office', 'Dinner'], hex: '#26262b' },
  { name: 'Satin midi skirt', season: 'light', type: 'skirts', make: () => skirt('#a8482a'), occasions: ['Date Night', 'Dinner', 'Brunch'], hex: '#a8482a' },
  { name: 'Emerald wrap dress', type: 'dresses', make: () => dress('#1f7a5a'), occasions: ['Date Night', 'Formal / Event', 'Dinner'], hex: '#1f7a5a' },
  { name: 'Camel blazer', season: 'warm', type: 'outerwear', make: () => blazer('#c19a6b'), occasions: ['Work / Office', 'Dinner'], hex: '#c19a6b' },
  { name: 'Nude heels', type: 'shoes', make: () => heels('#d9b79a'), occasions: ['Work / Office', 'Date Night', 'GNO', 'Dinner'], hex: '#d9b79a' },
  { name: 'Black mini bag', type: 'bags', make: () => bag('#222'), occasions: ['Date Night', 'GNO', 'Dinner'], hex: '#222222' },
];

export async function sampleBlob(s) { return canvasToBlob(s.make()); }
