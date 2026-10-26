// Landmarks on a garment cutout (neckline, shoulders, armpits, hems, sleeve ends, waistband, crotch...): where each one sits is suggested from the
// cutout's silhouette, then you can drag them. They are stored as fractions (0..1) of the cutout so they survive any resize.

/** Whether a piece has sleeves, going by its category and name ("Sleeveless blouse", "Satin cami"...). undefined when the name doesn't say. */
export const sleevesFromName = (type, name = '') => (type === 'tanks' || type === 'bodysuits' || /\b(sleeveless|tank|cami(sole)?|strapless|halter|tube|vest|gilet|bandeau|bustier|corset)\b/i.test(name) ? false : /\b(long|short|3\/4|puff|cap) ?-?sleeve/i.test(name) ? true : undefined);

/** Which landmark set a category uses. */
export const groupOf = (type) => (type === 'dresses' ? 'dress' : type === 'bottoms' || type === 'skirts' ? 'bottom' : ['tops', 'tanks', 'bodysuits', 'outerwear'].includes(type) ? 'top' : null);
/** Pieces that are fitted with the mesh warp (shoes, bags and accessories just sit on their anchor). */
export const isWarped = (type) => !!groupOf(type);

export const LABELS = {
  neck: 'Neckline centre', shoulderL: 'Shoulder (left)', shoulderR: 'Shoulder (right)', armpitL: 'Armpit (left)', armpitR: 'Armpit (right)',
  hemL: 'Hem (left)', hemR: 'Hem (right)', sleeveL: 'Sleeve end (left)', sleeveR: 'Sleeve end (right)', waistL: 'Waist (left)', waistR: 'Waist (right)',
  crotch: 'Crotch', hemLo: 'Left leg hem, outer', hemLi: 'Left leg hem, inner', hemRi: 'Right leg hem, inner', hemRo: 'Right leg hem, outer',
};
/** The landmarks each kind of piece has (sleeve ends are optional: sleeveless pieces have none). */
export function namesFor(type, marks = null) {
  const g = groupOf(type);
  const sleeves = !marks || marks.sleeveL || marks.sleeveR ? ['sleeveL', 'sleeveR'] : [];
  if (g === 'top') return ['neck', 'shoulderL', 'shoulderR', 'armpitL', 'armpitR', 'hemL', 'hemR', ...sleeves];
  if (g === 'dress') return ['neck', 'shoulderL', 'shoulderR', 'armpitL', 'armpitR', 'waistL', 'waistR', 'hemL', 'hemR', ...sleeves];
  if (g === 'bottom') return type === 'skirts' ? ['waistL', 'waistR', 'hemL', 'hemR'] : ['waistL', 'waistR', 'crotch', 'hemLo', 'hemLi', 'hemRi', 'hemRo'];
  return [];
}

/** A cutout canvas -> a small mask { w, h, a: Uint8Array of 0/1, sx, sy (mask px per cutout px) }. */
export function maskOf(canvas, max = 640) {
  const s = Math.min(1, max / Math.max(canvas.width, canvas.height)), w = Math.max(1, Math.round(canvas.width * s)), h = Math.max(1, Math.round(canvas.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  return { w, h, a };
}

/** Pure suggestion on a mask: { name: [u, v] } with u, v as fractions of the mask. Works for the three groups. */
export function suggest(type, m, opt = {}) {
  const g = groupOf(type); if (!g) return {};
  const wantSleeves = opt.sleeves ?? (type === 'tops' || type === 'outerwear' || type === 'dresses');
  const { w, h, a } = m, at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x] === 1;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return {};
  const W = x1 - x0 + 1, H = y1 - y0 + 1, out = {}, put = (k, x, y) => { out[k] = [Math.max(0, Math.min(1, (x + 0.5) / w)), Math.max(0, Math.min(1, (y + 0.5) / h))]; };
  /** The outer corners of a hem: the leftmost and rightmost pixels in the bottom band (a hem is rarely level, so the very last row would miss them). */
  const hemCorners = (lo, hi, yEnd = y1) => { let l = null, r = null; for (let y = Math.max(y0, yEnd - Math.round(H * 0.07)); y <= yEnd; y++) for (let x = lo; x <= hi; x++) if (at(x, y)) { if (!l || x < l[0] || (x === l[0] && y > l[1])) l = [x, y]; if (!r || x > r[0] || (x === r[0] && y > r[1])) r = [x, y]; } return [l || [lo, yEnd], r || [hi, yEnd]]; };
  /** 1 for every see-through pixel that connects to the picture's edge (holes inside the piece don't count). */
  const floodOutside = () => { const o = new Uint8Array(w * h), q = []; const tryp = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (o[i] || a[i]) return; o[i] = 1; q.push(i); };
    for (let x = 0; x < w; x++) { tryp(x, 0); tryp(x, h - 1); } for (let y = 0; y < h; y++) { tryp(0, y); tryp(w - 1, y); }
    for (let k = 0; k < q.length; k++) { const i = q[k], x = i % w, y = (i / w) | 0; tryp(x + 1, y); tryp(x - 1, y); tryp(x, y + 1); tryp(x, y - 1); } return o; };
  const rowExt = (y) => { let l = -1, r = -1; for (let x = x0; x <= x1; x++) if (at(x, y)) { if (l < 0) l = x; r = x; } return l < 0 ? null : [l, r]; };
  const runsAt = (y, gap = 1) => { const rs = []; let s = -1, last = -9; for (let x = x0; x <= x1 + 1; x++) { if (at(x, y)) { if (s < 0) s = x; else if (x - last > gap + 1) { rs.push([s, last]); s = x; } last = x; } } if (s >= 0) rs.push([s, last]); return rs.filter((r) => r[1] - r[0] >= 1); };

  if (g === 'bottom') {
    const wy = y0 + Math.max(1, Math.round(H * 0.02)), we = rowExt(wy) || [x0, x1];
    put('waistL', we[0], wy); put('waistR', we[1], wy);
    if (type === 'skirts') { const [a, b] = hemCorners(x0, x1); put('hemL', a[0], a[1]); put('hemR', b[0], b[1]); return out; }
    // crotch: the first row (below the waistband) where the middle opens up between the legs and stays open
    const midX = Math.round((x0 + x1) / 2); let cy = -1;
    for (let y = y0 + Math.round(H * 0.12); y < y0 + H * 0.6; y++) { const rs = runsAt(y, 0).filter((r) => r[1] - r[0] > W * 0.06); if (rs.length >= 2 && [3, 6, 9].every((k) => runsAt(Math.min(y1, y + k), 0).filter((r) => r[1] - r[0] > W * 0.06).length >= 2)) { cy = y; break; } }
    if (cy < 0) cy = y0 + Math.round(H * 0.33);
    const rs = runsAt(cy + 3, 0).filter((r) => r[1] - r[0] > W * 0.06), midGap = rs.length >= 2 ? (rs[0][1] + rs[1][0]) / 2 : midX;
    put('crotch', midGap, cy);
    // each leg's lowest row gives its hem corners
    const lowest = (lo, hi) => { // the lowest row that still carries at least half the leg's width (stray threads hang lower)
      const cnt = (y) => { let n = 0; for (let x = lo; x <= hi; x++) if (at(x, y)) n++; return n; }, ref = cnt(y0 + Math.round(H * 0.8));
      for (let y = y1; y >= y0; y--) if (cnt(y) >= Math.max(1, ref * 0.5)) return y; return y1; };
    const gx = Math.round(midGap), ly = lowest(x0, gx - 1), ry = lowest(gx + 1, x1);
    const legEdge = (y, lo, hi) => { let l = -1, r = -1; for (let yy = Math.max(y0, y - Math.round(H * 0.03)); yy <= y; yy++) for (let x = lo; x <= hi; x++) if (at(x, yy)) { if (l < 0 || x < l) l = x; if (x > r) r = x; } return l < 0 ? [lo, hi] : [l, r]; }; // the band just above the hem: its very last row may be a single thread
    const le = legEdge(ly, x0, gx - 1), re = legEdge(ry, gx + 1, x1);
    put('hemLo', le[0], ly); put('hemLi', le[1], ly); put('hemRi', re[0], ry); put('hemRo', re[1], ry);
    return out;
  }

  // top / dress: the torso is the widest column cluster in the lower zone (tops), or the columns around the narrowest row (dresses: the skirt flares, the sleeves stick out)
  let torso, dressWaist = null;
  if (g === 'dress') {
    const mid0 = (x0 + x1) / 2; let wy = y0 + Math.round(H * 0.45), best = 1e9;
    for (let y = y0 + Math.round(H * 0.3); y < y0 + H * 0.65; y++) { const rs = runsAt(y, 2), c = rs.find((r) => r[0] <= mid0 && mid0 <= r[1]); if (c && c[1] - c[0] < best) { best = c[1] - c[0]; wy = y; } }
    const rs = runsAt(wy, 2), c = rs.find((r) => r[0] <= mid0 && mid0 <= r[1]) || rs[0] || [x0, x1];
    dressWaist = { y: wy, l: c[0], r: c[1] }; torso = [Math.round(c[0] - W * 0.04), Math.round(c[1] + W * 0.04)];
  } else {
    const z0 = y0 + Math.round(H * 0.55), z1 = y0 + Math.round(H * 0.93), occ = new Float32Array(w);
    for (let x = x0; x <= x1; x++) { let n = 0; for (let y = z0; y <= z1; y++) if (at(x, y)) n++; occ[x] = n / Math.max(1, z1 - z0 + 1); }
    const clusters = []; let cs = -1, cl = -9;
    for (let x = x0; x <= x1 + 1; x++) { if (x <= x1 && occ[x] > 0.25) { if (cs < 0) cs = x; else if (x - cl > Math.max(2, W * 0.008)) { clusters.push([cs, cl]); cs = x; } cl = x; } }
    if (cs >= 0) clusters.push([cs, cl]);
    while (clusters.length >= 3 && clusters[0][1] - clusters[0][0] < W * 0.25) clusters.shift();
    while (clusters.length >= 3 && clusters[clusters.length - 1][1] - clusters[clusters.length - 1][0] < W * 0.25) clusters.pop();
    const cArea = (c) => { let s2 = 0; for (let x = c[0]; x <= c[1]; x++) s2 += occ[x]; return s2; };
    torso = clusters.length ? [clusters[0][0], clusters[clusters.length - 1][1]] : [x0, x1];
  }
  // hanging sleeves: a see-through gap between sleeve and body that runs a long way down tells where the torso really ends
  const outside = floodOutside(), bm = (x0 + x1) / 2;
  const gapCol = (side) => {
    let best = null, bn = 0;
    for (let x = side < 0 ? x0 + Math.round(W * 0.03) : Math.ceil(bm + W * 0.2); x <= (side < 0 ? Math.floor(bm - W * 0.2) : x1 - Math.round(W * 0.03)); x++) {
      let n = 0; for (let y = y0 + Math.round(H * 0.25); y <= y1; y++) if (outside[y * w + x] && [2, 4, 7, 10].some((d) => at(x - d, y)) && [2, 4, 7, 10].some((d) => at(x + d, y))) n++;
      if (n > bn) { bn = n; best = x; }
    }
    return bn >= H * 0.12 ? best : null;
  };
  if (g === 'top') {
    const gl = gapCol(-1), gr = gapCol(1);
    if (!wantSleeves) torso = [x0, x1];
    else if (gl != null && gr != null) torso = [gl + 2, gr - 2];
    else torso = [Math.round(x0 + W * 0.2), Math.round(x1 - W * 0.2)]; // no visible gap: assume sleeves take about a fifth of the width each side
  }
  const [tl, tr] = torso, mid = (tl + tr) / 2, sleeveRows = g === 'dress' ? (dressWaist.y - y0) - H * 0.04 : H;
  // sleeves: the part of the piece that sticks out past the torso
  const beyond = (side) => { let n = 0, ly = -1, sx = 0, sn = 0, ty = h; const lim = side < 0 ? (x) => x < tl - W * 0.025 : (x) => x > tr + W * 0.025;
    for (let y = y0; y <= Math.min(y1, y0 + sleeveRows); y++) for (let x = x0; x <= x1; x++) if (at(x, y) && lim(x)) { n++; if (y > ly) ly = y; if (y < ty) ty = y; }
    if (n < W * H * 0.012) return null;
    for (let y = ly; y > ly - Math.max(2, H * 0.03); y--) for (let x = x0; x <= x1; x++) if (at(x, y) && lim(x)) { sx += x; sn++; }
    return { y: ly, x: sx / sn, top: ty }; };
  const sl = wantSleeves ? beyond(-1) : null, sr = wantSleeves ? beyond(1) : null;
  if (sl) put('sleeveL', sl.x, sl.y); if (sr) put('sleeveR', sr.x, sr.y);
  // neckline: where the centre column first becomes solid (the opening above it shows the form that was cut away)
  let ny = -1; const nx = Math.round(mid);
  for (let y = y0; y < y0 + H * 0.6; y++) if ([-2, 0, 2].every((d) => at(nx + d, y)) && [1, 2, 3].every((k) => at(nx, y + k * 2))) { ny = y; break; }
  put('neck', mid, ny < 0 ? y0 + H * 0.06 : Math.max(ny, y0 + 1));
  // shoulders: the outer corners of the top edge
  const sh = (side) => { let bx = side < 0 ? 1e9 : -1, by = y0; const lim = y0 + Math.max(3, Math.round(H * 0.14)); for (let y = y0; y <= lim; y++) { const e = rowExt(y); if (!e) continue; const x = side < 0 ? e[0] : e[1]; if (side < 0 ? x < bx : x > bx) { bx = x; by = y; } } return [bx, by]; };
  const [slx, sly] = sh(-1), [srx, sry] = sh(1);
  put('shoulderL', slx, sly + H * 0.01); put('shoulderR', srx, sry + H * 0.01);
  // armpits: the highest point of the see-through gap under a sleeve (a hanging sleeve's gap, or the space under a sleeve that sticks out); sleeveless pieces use the bottom of the armhole
  const gapTop = (side) => {
    const lo = side < 0 ? x0 : Math.ceil(mid + W * 0.2), hi = side < 0 ? Math.floor(mid - W * 0.2) : x1, ys = Math.round(y0 + H * 0.08), lim = g === 'dress' ? dressWaist.y - H * 0.04 : y0 + H * 0.7; let best = null;
    for (let x = lo; x <= hi; x++) { let seen = false; for (let y = ys; y < lim; y++) { if (a[y * w + x]) seen = true; else if (seen && outside[y * w + x]) { let run = 0; while (y + run < h && outside[(y + run) * w + x]) run++; if (run < H * 0.06) break; if (!best || y < best[1] - 1 || (Math.abs(y - best[1]) <= 1 && (side < 0 ? x > best[0] : x < best[0]))) best = [x, y]; break; } } }
    return best;
  };
  const armpit = (side, has) => {
    const edge = side < 0 ? tl : tr, gp = has ? gapTop(side) : null;
    if (gp) return gp;
    let by = y0 + Math.round(H * 0.28), bx = side < 0 ? -1 : 1e9;
    for (let y = y0 + Math.round(H * 0.14); y < y0 + H * 0.5; y++) { const e = rowExt(y); if (!e) continue; const x = side < 0 ? e[0] : e[1]; if (side < 0 ? x > bx : x < bx) { bx = x; by = y; } }
    return [Math.abs(bx - edge) > W * 0.2 ? edge : bx, by];
  };
  let [alx, aly] = armpit(-1, !!sl), [arx, ary] = armpit(1, !!sr);
  const sY = (sly + sry) / 2, okY = (y) => y >= sY + H * 0.08 && y <= sY + H * 0.42;
  if (!okY(aly)) { aly = sY + H * 0.22; alx = tl; } if (!okY(ary)) { ary = sY + H * 0.22; arx = tr; }
  put('armpitL', alx, aly); put('armpitR', arx, ary);
  if (g === 'top') {
    // hem: the lowest row that still has a good share of the torso's width
    let hy = y1; for (let y = y1; y > y0; y--) { let n = 0; for (let x = tl; x <= tr; x++) if (at(x, y)) n++; if (n > (tr - tl) * 0.3) { hy = y; break; } }
    const [hl, hr] = hemCorners(tl, tr, hy); put('hemL', hl[0], hl[1]); put('hemR', hr[0], hr[1]);
  } else {
    // dress: the hem corners are the outermost pixels of the bottom band; the waist is the narrowest row found above
    const [hl, hr] = hemCorners(x0, x1); put('hemL', hl[0], hl[1]); put('hemR', hr[0], hr[1]);
    put('waistL', dressWaist.l, dressWaist.y); put('waistR', dressWaist.r, dressWaist.y);
  }
  return out;
}

/** Suggest landmarks for a cutout canvas. */
export const suggestFor = (type, canvas, opt) => suggest(type, maskOf(canvas), opt);
