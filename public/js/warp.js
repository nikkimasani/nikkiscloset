// Fitting a flat garment cutout onto the body picture: a thin-plate-spline mesh warp (landmarks on the garment -> anchors on the body),
// then a row pass that widens the garment to the body's outline plus a little ease. Everything works in the body picture's pixels.

/** Solve A x = b (Gaussian elimination, partial pivoting). A is n x n (array of rows); returns x. */
export function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / (M[r][r] || 1e-12); }
  return x;
}
const U = (r2) => (r2 < 1e-9 ? 0 : 0.5 * r2 * Math.log(r2)); // r^2 ln r, from the squared distance

/** Least-squares affine map from src points to dst points: returns (x, y) -> [x', y']. */
export function affineFit(src, dst) {
  const n = src.length, S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = [src[i][0], src[i][1], 1];
    for (let a = 0; a < 3; a++) { for (let c = 0; c < 3; c++) S[a][c] += v[a] * v[c]; bx[a] += v[a] * dst[i][0]; by[a] += v[a] * dst[i][1]; }
  }
  for (let a = 0; a < 3; a++) S[a][a] += 1e-6;
  const cx = solve(S, bx), cy = solve(S, by);
  return (x, y) => [cx[0] * x + cx[1] * y + cx[2], cy[0] * x + cy[1] * y + cy[2]];
}

/** Thin-plate spline through src -> dst control points (smoothing lam >= 0). Returns (x, y) -> [x', y']. */
export function tps(src, dst, lam = 0) {
  const n = src.length, N = n + 3, L = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { const dx = src[i][0] - src[j][0], dy = src[i][1] - src[j][1]; L[i][j] = U(dx * dx + dy * dy); }
    L[i][i] += lam; L[i][n] = 1; L[i][n + 1] = src[i][0]; L[i][n + 2] = src[i][1];
    L[n][i] = 1; L[n + 1][i] = src[i][0]; L[n + 2][i] = src[i][1];
  }
  const wx = solve(L, [...dst.map((p) => p[0]), 0, 0, 0]), wy = solve(L, [...dst.map((p) => p[1]), 0, 0, 0]);
  return (x, y) => {
    let rx = wx[n] + wx[n + 1] * x + wx[n + 2] * y, ry = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
    for (let i = 0; i < n; i++) { const dx = x - src[i][0], dy = y - src[i][1], u = U(dx * dx + dy * dy); rx += wx[i] * u; ry += wy[i] * u; }
    return [rx, ry];
  };
}

/**
 * Draw `src` (a canvas) warped by f into a new canvas of outW x outH: the source is cut into a grid of triangles, each moved by
 * the affine map of its corners (no plain rectangle scaling anywhere).
 */
export function warpMesh(src, f, outW, outH, { cols = 40, rows = 56 } = {}) {
  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const g = out.getContext('2d'), sw = src.width, sh = src.height;
  const al = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const used = (x0, y0, x1, y1) => { // does any visible pixel fall inside this source cell? (skips empty cells)
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(sh - 1, Math.ceil(y1)); y += 2) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(sw - 1, Math.ceil(x1)); x += 2) if (al[(y * sw + x) * 4 + 3] > 8) return true;
    return false;
  };
  const px = (c, r) => [c * sw / cols, r * sh / rows], grid = [];
  for (let r = 0; r <= rows; r++) { const row = []; for (let c = 0; c <= cols; c++) { const [x, y] = px(c, r); row.push([x, y, ...f(x, y)]); } grid.push(row); }
  const tri = (a, b, c) => {
    const [x0, y0, X0, Y0] = a, [x1, y1, X1, Y1] = b, [x2, y2, X2, Y2] = c;
    const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (Math.abs(den) < 1e-9) return;
    const A = ((X1 - X0) * (y2 - y0) - (X2 - X0) * (y1 - y0)) / den, C = ((X2 - X0) * (x1 - x0) - (X1 - X0) * (x2 - x0)) / den;
    const B = ((Y1 - Y0) * (y2 - y0) - (Y2 - Y0) * (y1 - y0)) / den, D = ((Y2 - Y0) * (x1 - x0) - (Y1 - Y0) * (x2 - x0)) / den;
    const E = X0 - A * x0 - C * y0, F = Y0 - B * x0 - D * y0;
    const cx = (X0 + X1 + X2) / 3, cy = (Y0 + Y1 + Y2) / 3, grow = (X, Y) => { const dx = X - cx, dy = Y - cy, d = Math.hypot(dx, dy) || 1; return [X + dx / d * 1.4, Y + dy / d * 1.4]; };
    const p0 = grow(X0, Y0), p1 = grow(X1, Y1), p2 = grow(X2, Y2);
    g.save(); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.lineTo(...p2); g.closePath(); g.clip();
    g.setTransform(A, B, C, D, E, F); g.drawImage(src, 0, 0); g.restore();
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = grid[r][c], b = grid[r][c + 1], d = grid[r + 1][c], e = grid[r + 1][c + 1];
    if (!used(a[0] - 2, a[1] - 2, e[0] + 2, e[1] + 2)) continue;
    tri(a, b, d); tri(b, e, d);
  }
  return out;
}

/** Runs of visible pixels in row y of RGBA data: [[x0, x1], ...] (x1 exclusive); gaps of up to `gap` pixels are bridged, runs under `min` are ignored. */
export function rowRuns(data, w, y, { thr = 40, gap = 2, min = 3 } = {}) {
  const runs = []; let s = -1, last = -1;
  for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > thr) { if (s < 0) s = x; else if (x - last > gap + 1) { runs.push([s, last + 1]); s = x; } last = x; }
  }
  if (s >= 0) runs.push([s, last + 1]);
  return runs.filter((r) => r[1] - r[0] >= min);
}

const boxBlur = (a, k) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) if (a[j] != null) { s += a[j]; n++; } return n ? s / n : null; });
const dilate = (a, k) => a.map((_, i) => { let m = null; for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) if (a[j] != null && (m == null || a[j] > m)) m = a[j]; return m; });

/**
 * Row pass: from y0 down, every garment run that sits on a body run is stretched (never narrowed) so it covers the body's outline plus
 * `ease` (a fraction of the body's width there). The stretch is smoothed from row to row so the fabric doesn't ripple. With `hang`, from
 * y >= hang.y the garment never gets narrower than the widest point above it, so a skirt falls straight down from the hip instead of following the legs.
 *   body: (y) => [[x0, x1], ...] body runs for that row.  Returns a new canvas.
 */
export function widenRows(src, body, { y0, y1, ease = 0.05, hang = null, debug = null, maxStretch = 1.45 } = {}) {
  const w = src.width, h = src.height, data = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d'); g.drawImage(src, 0, 0);
  y1 = Math.min(h - 1, y1); y0 = Math.max(0, y0);
  const n = y1 - y0 + 1; if (n <= 0) return out;
  // per row: the garment's runs and the body's runs, then pair them up (track k = the k-th body run on that row)
  const gruns = [], bruns = []; let tracks = 0;
  for (let y = y0; y <= y1; y++) { gruns.push(rowRuns(data, w, y)); const b = body(y); bruns.push(b); tracks = Math.max(tracks, b.length); }
  const pair = Array.from({ length: tracks }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    const br = bruns[i]; if (br.length !== tracks && br.length !== 1) continue;
    const got = br.map((b) => {
      const bc = (b[0] + b[1]) / 2, bw = b[1] - b[0], inside = gruns[i].filter((r) => (r[0] + r[1]) / 2 >= b[0] - bw * 0.1 && (r[0] + r[1]) / 2 <= b[1] + bw * 0.1);
      let best = null, bd = 1e9;
      if (inside.length) { best = [inside[0][0], inside[inside.length - 1][1]]; bd = 0; } // an open jacket is one piece: its two halves are stretched together
      else for (const r of gruns[i]) { const d = bc >= r[0] && bc <= r[1] ? 0 : Math.min(Math.abs(bc - r[0]), Math.abs(bc - r[1])); if (d < bd) { bd = d; best = r; } }
      return best && bd <= bw * 0.6 ? best : null;
    });
    if (got.length === 2 && got[0] && got[1] && got[0][0] === got[1][0] && got[0][1] === got[1][1]) { // two legs touching: split the garment's run between them
      const r = got[0], m = r[0] + (r[1] - r[0]) * ((br[0][1] + br[1][0]) / 2 - br[0][0]) / (br[1][1] - br[0][0]); got[0] = [r[0], m]; got[1] = [m, r[1]];
    }
    br.forEach((b, k) => { if (got[k]) pair[br.length === 1 ? 0 : k][i] = { g: got[k], b }; });
  }
  const R = 8, plan = Array.from({ length: n }, () => []);
  pair.forEach((col) => {
    const bl = boxBlur(col.map((c) => (c ? c.b[0] : null)), R), br = boxBlur(col.map((c) => (c ? c.b[1] : null)), R);
    const needL = col.map((c, i) => (c ? Math.max(0, c.g[0] - (bl[i] - (br[i] - bl[i]) * ease / 2)) : null));
    const needR = col.map((c, i) => (c ? Math.max(0, (br[i] + (br[i] - bl[i]) * ease / 2) - c.g[1]) : null));
    const dl = boxBlur(dilate(needL, R), R), dr = boxBlur(dilate(needR, R), R);
    // the extents each row should reach (never narrower than the garment itself)
    const tl = col.map((c, i) => (c ? c.g[0] - Math.max(dl[i], needL[i] * 0.999) : null)), tr = col.map((c, i) => (c ? c.g[1] + Math.max(dr[i], needR[i] * 0.999) : null));
    if (hang) { // from the widest point (the hip row) the edges drop straight down
      const hi = Math.max(0, Math.min(n - 1, Math.round(hang.y) - y0)); let eL = null, eR = null;
      for (let j = hi; j >= Math.max(0, hi - 6) && eL == null; j--) if (tl[j] != null) { eL = tl[j]; eR = tr[j]; }
      if (eL != null) for (let i = hi + 1; i < n && y0 + i <= (hang.y1 ?? h); i++) if (col[i] && tr[i] - tl[i] > 0.7 * (eR - eL)) { tl[i] = Math.min(tl[i], eL); tr[i] = Math.max(tr[i], eR); }
    }
    // the garment's own edges are ragged, so the stretch is smoothed over rows: scale about the run's centre, plus a shift
    const wid = col.map((c) => (c ? c.g[1] - c.g[0] : 0)), med = (i) => { const a = []; for (let j = Math.max(0, i - 14); j < i; j++) if (wid[j]) a.push(wid[j]); a.sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };
    const ok = col.map((c, i) => (c && tr[i] - tl[i] <= maxStretch * (c.g[1] - c.g[0]) && wid[i] >= 0.8 * (med(i) || wid[i]) ? 1 : 0));
    const ratio = boxBlur(col.map((c, i) => (ok[i] ? (tr[i] - tl[i]) / (c.g[1] - c.g[0]) : null)), R);
    const shift = boxBlur(col.map((c, i) => (ok[i] ? (tl[i] + tr[i]) / 2 - (c.g[0] + c.g[1]) / 2 : null)), R);
    const capL = boxBlur(dilate(col.map((c, i) => (c ? Math.max(0, c.g[0] - tl[i]) : null)), R), R), capR = boxBlur(dilate(col.map((c, i) => (c ? Math.max(0, tr[i] - c.g[1]) : null)), R), R);
    col.forEach((c, i) => {
      if (!ok[i]) return; const cx = (c.g[0] + c.g[1]) / 2, half = (c.g[1] - c.g[0]) / 2 * ratio[i] + 1;
      const bw = c.b[1] - c.b[0], l = Math.max(cx + shift[i] - half, c.g[0] - capL[i] - 4, Math.min(c.g[0], c.b[0] - bw * 0.3)), r = Math.min(cx + shift[i] + half, c.g[1] + capR[i] + 4, Math.max(c.g[1], c.b[1] + bw * 0.3)); // (a wide row never stretches more than the body needs)
      if (debug) debug.push([y0 + i, c.g[0], c.g[1], Math.round(l), Math.round(r), Math.round(ratio[i] * 100) / 100]);
      if (ratio[i] > 1.004 || Math.abs(shift[i]) > 1) plan[i].push({ g: c.g, l: Math.min(l, c.g[0]), r: Math.max(r, c.g[1]) });
    });
  });
  plan.forEach((rowPlan, i) => {
    const y = y0 + i;
    for (const p of rowPlan) {
      g.clearRect(p.g[0] - 1, y, p.g[1] - p.g[0] + 2, 1);
      g.drawImage(src, p.g[0], y, p.g[1] - p.g[0], 1, p.l, y, p.r - p.l, 1);
    }
  });
  return out;
}

/** A 1px feathered edge: the cutout's alpha is eroded a hair and blurred, so a garment doesn't look pasted on. Returns a new canvas. */
export function featherEdge(src, px = 1) {
  const out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
  const g = out.getContext('2d'); g.drawImage(src, 0, 0);
  const m = document.createElement('canvas'); m.width = src.width; m.height = src.height;
  const mg = m.getContext('2d'); mg.filter = `blur(${px}px)`; mg.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
  return out;
}
