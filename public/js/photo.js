// Photo mode: draws the doll in a pose, in front of a backdrop, with a caption, as a picture you can keep in the Diary's lookbook.
// Backdrops and poses are plain data + small canvas drawings, so adding one is a few lines (and an entry in CATALOG in game.js to sell it).

/** A small seeded random generator so a backdrop looks the same every time it's drawn. */
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const grad = (g, w, h, stops, x0 = 0, y0 = 0, x1 = 0, y1 = h) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, w, h); };

/** id -> { name, ink (caption colour), floor (ground shadow colour), draw(ctx, w, h) } */
export const BACKGROUNDS = {
  blush: { name: 'Blush', ink: '#5a1b3a', floor: '#b3586b', draw: (g, w, h) => { grad(g, w, h, [[0, '#ffe9f2'], [1, '#ffbfd8']]); const r = rng(7); for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.25})`; g.beginPath(); g.arc(r() * w, r() * h * 0.8, 30 + r() * 80, 0, 7); g.fill(); } } },
  studio: { name: 'Studio', ink: '#2a2a33', floor: '#777', draw: (g, w, h) => { grad(g, w, h, [[0, '#f4f4f7'], [0.7, '#dcdce4'], [1, '#c4c4cf']]); g.fillStyle = '#ffffff55'; g.beginPath(); g.ellipse(w / 2, h * 0.86, w * 0.5, h * 0.07, 0, 0, 7); g.fill(); } },
  sunset: { name: 'Sunset', ink: '#fff', floor: '#3a1030', draw: (g, w, h) => { grad(g, w, h, [[0, '#ff9966'], [0.45, '#ff5e8a'], [1, '#6a3ea1']]); g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(w * 0.72, h * 0.34, w * 0.14, 0, 7); g.fill(); g.fillStyle = '#ffffff22'; for (let i = 0; i < 4; i++) g.fillRect(0, h * (0.5 + i * 0.05), w, 6); } },
  garden: { name: 'Garden', ink: '#1f3d24', floor: '#2f5a33', draw: (g, w, h) => { grad(g, w, h, [[0, '#bfe6ff'], [0.62, '#eaf8ff'], [0.62, '#9bd37b'], [1, '#5fae55']]); const r = rng(11); for (let i = 0; i < 40; i++) { const x = r() * w, y = h * (0.66 + r() * 0.3); g.fillStyle = ['#ff7aa8', '#ffd23f', '#ffffff', '#c76bff'][i % 4]; g.beginPath(); g.arc(x, y, 5 + r() * 7, 0, 7); g.fill(); } g.fillStyle = '#ffffffcc'; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(w * (0.2 + i * 0.3), h * (0.12 + (i % 2) * 0.08), 70, 24, 0, 0, 7); g.fill(); } } },
  night: { name: 'Night city', ink: '#fff', floor: '#000', draw: (g, w, h) => { grad(g, w, h, [[0, '#0d1033'], [1, '#3b2a6b']]); const r = rng(5); g.fillStyle = '#fff'; for (let i = 0; i < 60; i++) g.fillRect(r() * w, r() * h * 0.5, 2, 2); let x = 0; while (x < w) { const bw = 40 + r() * 60, bh = h * (0.18 + r() * 0.25); g.fillStyle = '#1a1745'; g.fillRect(x, h * 0.86 - bh, bw, bh + h * 0.14); g.fillStyle = '#ffd86b'; for (let k = 0; k < 8; k++) if (r() > 0.45) g.fillRect(x + 6 + (k % 3) * 14, h * 0.86 - bh + 10 + ((k / 3) | 0) * 22, 7, 10); x += bw + 4; } } },
  confetti: { name: 'Confetti', ink: '#4b1d6b', floor: '#7a4aa6', draw: (g, w, h) => { grad(g, w, h, [[0, '#fff1fb'], [1, '#e8d9ff']]); const r = rng(3); for (let i = 0; i < 120; i++) { g.save(); g.translate(r() * w, r() * h); g.rotate(r() * 6); g.fillStyle = ['#ff5c93', '#ffd23f', '#5ad1ff', '#9b6bff', '#2fb892'][i % 5]; g.fillRect(-6, -3, 12, 6); g.restore(); } } },
};

/** id -> { name, rot (degrees), skew, scale, dx, dy, flip } applied to the doll about her feet. */
export const POSES = {
  stand: { name: 'Stand' },
  tilt: { name: 'Chic tilt', rot: -4, dx: -14 },
  walk: { name: 'Walk', rot: 3, skew: -0.07, dx: 14 },
  twirl: { name: 'Twirl', flip: true, rot: 6, scale: 1.03 },
  pop: { name: 'Pop', rot: -3, scale: 1.1, dy: -8 },
};

export const PHOTO_SIZE = [720, 960];

/** Draw the picture. doll: a canvas with the doll on a transparent background (or null). */
export function composePhoto({ doll, bg = 'blush', pose = 'stand', title = '', sub = '' }) {
  const [W, H] = PHOTO_SIZE, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), B = BACKGROUNDS[bg] || BACKGROUNDS.blush, P = { rot: 0, skew: 0, scale: 1, dx: 0, dy: 0, flip: false, ...(POSES[pose] || POSES.stand) };
  B.draw(g, W, H);
  const footY = H * 0.86, cx = W / 2;
  g.fillStyle = B.floor + '55'; g.beginPath(); g.ellipse(cx + P.dx * 0.5, footY, W * 0.2, 16, 0, 0, 7); g.fill(); // soft ground shadow
  if (doll) {
    const dh = H * 0.74 * P.scale, dw = (doll.width / doll.height) * dh;
    g.save(); g.translate(cx + P.dx, footY + P.dy); g.rotate((P.rot * Math.PI) / 180); g.transform(1, 0, P.skew, 1, 0, 0); g.scale(P.flip ? -1 : 1, 1);
    g.drawImage(doll, -dw / 2, -dh, dw, dh); g.restore();
  }
  g.fillStyle = B.ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.shadowColor = B.ink === '#fff' ? '#0008' : '#fff9'; g.shadowBlur = 8;
  g.font = '700 30px system-ui, sans-serif'; g.globalAlpha = 0.85; g.fillText("Nikki's Closet", 36, 58); g.globalAlpha = 1;
  if (title) { g.font = '800 44px system-ui, "Apple Color Emoji", sans-serif'; g.fillText(title.length > 26 ? title.slice(0, 25) + '…' : title, 36, H - 70); }
  if (sub) { g.font = '500 26px system-ui, sans-serif'; g.globalAlpha = 0.9; g.fillText(sub, 36, H - 30); g.globalAlpha = 1; }
  return c;
}

export const photoBlob = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.9));
