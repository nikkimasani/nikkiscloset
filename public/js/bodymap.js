// Reads the body's outline from the base picture's own transparency (nothing is drawn or guessed): for any row, where the torso or the two legs are.
import { rowRuns } from './warp.js';

/**
 * @param {{data:Uint8ClampedArray, width:number, height:number}} img  base.png's pixels
 * @param {{points:object}} pack
 * @returns {{cx:number, crotchY:number, runs:(y:number)=>number[][], outlineAt:(y:number)=>{l:number,r:number}|null, legCentres:(y:number)=>number[]}}
 */
export function makeBody(img, pack) {
  const { data, width: w, height: h } = img, P = pack.points;
  const cx = (P.shoulderL[0] + P.shoulderR[0]) / 2;
  const cache = new Map(), row = (y) => { y = Math.round(y); let r = cache.get(y); if (!r) cache.set(y, (r = rowRuns(data, w, Math.max(0, Math.min(h - 1, y)), { thr: 128, gap: 1, min: 4 }))); return r; };
  const hipY = (P.hipL[1] + P.hipR[1]) / 2, band = (P.hipR[0] - P.hipL[0]) / 2 + 12;
  // where the legs part: the first row below the hips where no visible pixel sits on the centre line
  let crotchY = hipY; while (crotchY < h - 1 && row(crotchY).some((r) => r[0] <= cx && cx < r[1])) crotchY++;
  /** Body runs on a row: the torso (the run on the centre line) above the crotch, each leg below it. Arms are left out. */
  const runs = (y) => {
    const rs = row(y);
    if (y < crotchY) { const t = rs.find((r) => r[0] <= cx && cx < r[1]); return t ? [t] : []; }
    return rs.filter((r) => { const o = Math.min(r[1], cx + band) - Math.max(r[0], cx - band); return o > 0.7 * (r[1] - r[0]); });
  };
  const outlineAt = (y) => { const rs = runs(y); return rs.length ? { l: rs[0][0], r: rs[rs.length - 1][1] } : null; };
  const legCentres = (y) => runs(y).map((r) => (r[0] + r[1]) / 2);
  return { cx, crotchY, runs, outlineAt, legCentres };
}

/** A point `t` (0..1) of the way along an arm's centre line (a list of [x, y]). */
export function alongPath(path, t) {
  const seg = []; let tot = 0;
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(d); tot += d; }
  let want = Math.max(0, Math.min(1, t)) * tot;
  for (let i = 0; i < seg.length; i++) { if (want <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, want / seg[i]) : 0; return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k]; } want -= seg[i]; }
  return path[path.length - 1];
}
export const pathLength = (path) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
