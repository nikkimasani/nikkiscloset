// Colour helpers: palette extraction, naming, and perceptual distance (CIE Lab).
export const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
export const unhex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function toLab([r, g, b]) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const hexDist = (a, b) => labDist(toLab(unhex(a)), toLab(unhex(b)));

const NAMED = {
  Black: '#1a1a1a', Charcoal: '#4a4a4f', Grey: '#9a9a9a', White: '#f7f7f4', Cream: '#efe6d2', Beige: '#d6c2a3',
  Tan: '#b58a5b', Brown: '#6b4a32', Camel: '#c19a6b', Navy: '#1f2a4d', Denim: '#46628f', 'Light Blue': '#a9c6e8',
  Blue: '#2f5fd0', Teal: '#2a8c8c', Green: '#3f8a4f', Olive: '#6b6b35', Sage: '#a3b59a', Yellow: '#ecc94b',
  Orange: '#e8832a', Rust: '#a8482a', Red: '#c4262e', Burgundy: '#6e1a2c', Pink: '#f0a3bd', 'Hot Pink': '#e0368a',
  Blush: '#f0cdc8', Purple: '#7a49a8', Lavender: '#c4b0e0', Gold: '#c9a227', Silver: '#c6c9ce',
};
const NAMED_LAB = Object.entries(NAMED).map(([n, h]) => [n, toLab(unhex(h))]);

export function colorName(h) {
  const lab = toLab(unhex(h));
  return NAMED_LAB.reduce((best, [n, l]) => {
    const d = labDist(lab, l);
    return d < best[1] ? [n, d] : best;
  }, ['', Infinity])[0];
}

// Most common distinct colours of a canvas (transparent pixels ignored).
export function palette(canvas, n = 5, minDist = 16) {
  const s = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * s));
  c.height = Math.max(1, Math.round(canvas.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = buckets.get(key) || [0, 0, 0, 0];
    b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++;
    buckets.set(key, b);
  }
  const cands = [...buckets.values()]
    .sort((a, b) => b[3] - a[3])
    .map((b) => ({ rgb: [b[0] / b[3], b[1] / b[3], b[2] / b[3]].map(Math.round), count: b[3] }));
  const picked = [];
  for (const c of cands) {
    const lab = toLab(c.rgb);
    if (picked.every((p) => labDist(p.lab, lab) > minDist)) picked.push({ ...c, lab });
    if (picked.length >= n) break;
  }
  const total = picked.reduce((a, p) => a + p.count, 0) || 1;
  return picked.map((p) => ({ hex: hex(...p.rgb), share: p.count / total }));
}
