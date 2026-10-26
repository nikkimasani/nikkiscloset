// Fitting one garment cutout to the base body: its landmarks (landmarks.js) are warped onto the body's anchors (config.json + base.png's outline)
// with a thin-plate-spline mesh; then every row below the waist is widened to the body outline plus a little ease.
import { tps, affineFit, warpMesh, widenRows, featherEdge, rowRuns } from './warp.js';
import { groupOf } from './landmarks.js';
import { alongPath, pathLength } from './bodymap.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const EASE = { tops: 0.05, tanks: 0.04, bodysuits: 0.02, outerwear: 0.1, dresses: 0.05, skirts: 0.05, bottoms: 0.05 };
export const easeOf = (type) => EASE[type] ?? 0.05;
/** The point a fit nudge (scale / rotate) is applied around. */
export function pivotOf(type, pack) {
  const P = pack.points, cx = (P.shoulderL[0] + P.shoulderR[0]) / 2;
  return groupOf(type) === 'bottom' ? [cx, (P.waistbandL[1] + P.waistbandR[1]) / 2] : [cx, (P.shoulderL[1] + P.shoulderR[1]) / 2];
}

/** The body's width on a row, as { l, r }: the torso, or both legs together below the crotch. */
const spanAt = (body, y) => { const o = body.outlineAt(Math.round(y)); return o || { l: body.cx - 200, r: body.cx + 200 }; };

/**
 * The control points of the warp: [{ name, src: [x, y] in cutout pixels, dst: [x, y] in body pixels }], plus how the row pass runs.
 * marks: { name: [u, v] } as fractions of the cutout.
 */
export function plan(type, marks, cut, pack, body) {
  const g = groupOf(type); if (!g) return null;
  const P = pack.points, arms = pack.arms, cx = body.cx, ease = easeOf(type);
  const pt = (n) => (marks[n] ? [marks[n][0] * cut.width, marks[n][1] * cut.height] : null);
  const ctl = [], add = (name, src, dst) => { if (src && dst) ctl.push({ name, src, dst }); };
  const waistY = (P.waistL[1] + P.waistR[1]) / 2, hipY = (P.hipL[1] + P.hipR[1]) / 2, footY = (P.footL[1] + P.footR[1]) / 2, ankleY = (P.ankleL[1] + P.ankleR[1]) / 2;
  let widen;

  if (g === 'bottom') {
    const wl = pt('waistL'), wr = pt('waistR'); if (!wl || !wr) return null;
    const wbY = (P.waistbandL[1] + P.waistbandR[1]) / 2, bodyW = P.waistbandR[0] - P.waistbandL[0], s = bodyW / Math.max(8, dist(wl, wr)), gy = (wl[1] + wr[1]) / 2;
    const e0 = spanAt(body, wbY), k = 1 + ease;
    add('waistL', wl, [Math.min(P.waistbandL[0], e0.l) - bodyW * (k - 1) / 2, wbY]); add('waistR', wr, [Math.max(P.waistbandR[0], e0.r) + bodyW * (k - 1) / 2, wbY]);
    const destY = (y) => Math.min(footY - 8, wbY + (y - gy) * s);
    if (type === 'skirts') {
      const hl = pt('hemL'), hr = pt('hemR'); if (!hl || !hr) return null;
      const y = destY((hl[1] + hr[1]) / 2), e = spanAt(body, Math.min(y, body.crotchY - 1)), half = Math.max(dist(hl, hr) * s / 2, (e.r - e.l) / 2 * (1 + ease));
      add('hemL', hl, [cx - half, y]); add('hemR', hr, [cx + half, y]);
      widen = { y0: Math.round(wbY), y1: Math.round(y) + 4, hang: { y: hipY, y1: y + 4 } };
    } else {
      const cr = pt('crotch'), lo = pt('hemLo'), li = pt('hemLi'), ri = pt('hemRi'), ro = pt('hemRo'); if (!cr || !lo || !li || !ri || !ro) return null;
      add('crotch', cr, [body.cx, body.crotchY]);
      const data = cut.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cut.width, cut.height).data;
      const legAt = (y, side) => { // the garment's leg run on this row (left of the crotch, or right of it)
        const rs = rowRuns(data, cut.width, Math.max(0, Math.min(cut.height - 1, Math.round(y))), { thr: 128, gap: 1, min: 3 });
        // legs that touch show up as one run: cut it at the crotch seam
        const parts = rs.flatMap((q) => (q[0] < cr[0] - 2 && q[1] > cr[0] + 2 ? [[q[0], cr[0]], [cr[0], q[1]]] : [q]));
        const r = parts.filter((q) => (side < 0 ? (q[0] + q[1]) / 2 < cr[0] : (q[0] + q[1]) / 2 >= cr[0])).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0]; return r || null; };
      const legs = [[-1, lo, li, 'L'], [1, ri, ro, 'R']];
      for (const [side, a, b, tag] of legs) {
        const hy = (a[1] + b[1]) / 2, y = destY(hy);
        const leg = (yy) => { const cs = body.legCentres(Math.min(Math.max(yy, body.crotchY + 4), footY - 4)).sort((p, q) => p - q); return side < 0 ? cs[0] : cs[cs.length - 1]; };
        const run = (yy) => { const rs = body.runs(Math.min(Math.max(yy, body.crotchY + 4), footY - 4)); return side < 0 ? rs[0] : rs[rs.length - 1]; };
        const place = (yy, gl, gr) => { const c = leg(yy), br = run(yy) || [c - 40, c + 40], bw = br[1] - br[0], w = Math.max((gr - gl) * s, bw * (1 + 2 * ease)); return [c - w / 2, c + w / 2]; };
        const [dl, dr] = place(y, Math.min(a[0], b[0]), Math.max(a[0], b[0]));
        // outer / inner follow the leg: the outer corner is the one furthest from the crotch
        const outerIsLeft = side < 0;
        add('hem' + tag + 'o', outerIsLeft ? a : b, [outerIsLeft ? dl : dr, y]); add('hem' + tag + 'i', outerIsLeft ? b : a, [outerIsLeft ? dr : dl, y]);
        // two stations along the leg so each leg follows the body's leg (hip -> knee -> ankle) on its own
        for (const f of []) {
          const sy = cr[1] + (hy - cr[1]) * f, r = legAt(sy, side); if (!r) continue;
          const dy = Math.max(body.crotchY + 6, Math.min(destY(sy), footY - 10)), [pl, pr] = place(dy, r[0], r[1]);
          add(`leg${tag}${f}o`, [outerIsLeft ? r[0] : r[1], sy], [outerIsLeft ? pl : pr, dy]); add(`leg${tag}${f}i`, [outerIsLeft ? r[1] : r[0], sy], [outerIsLeft ? pr : pl, dy]);
        }
      }
      widen = { y0: Math.round(wbY), y1: Math.round(Math.max(destY((lo[1] + li[1]) / 2), destY((ri[1] + ro[1]) / 2))) + 4, hang: null };
    }
    return { ctl, widen, s };
  }

  // tops, outerwear and dresses
  const shL = pt('shoulderL'), shR = pt('shoulderR'); if (!shL || !shR) return null;
  const bodySh = P.shoulderR[0] - P.shoulderL[0], k = type === 'outerwear' ? 1.08 : 1.02, s = bodySh / Math.max(8, dist(shL, shR)), gShY = (shL[1] + shR[1]) / 2;
  const SHY = (P.shoulderL[1] + P.shoulderR[1]) / 2 - 14, halfSh = bodySh / 2 * k;
  add('shoulderL', shL, [cx - halfSh, SHY]); add('shoulderR', shR, [cx + halfSh, SHY]);
  const nk = pt('neck'); if (nk) add('neck', nk, [cx, Math.max(SHY - 8, SHY + (nk[1] - gShY) * s)]);
  const apL = pt('armpitL'), apR = pt('armpitR'), ak = type === 'outerwear' ? 1.12 : 1.04;
  if (apL) add('armpitL', apL, [cx - (cx - P.armpitL[0]) * ak, P.armpitL[1]]);
  if (apR) add('armpitR', apR, [cx + (P.armpitR[0] - cx) * ak, P.armpitR[1]]);
  for (const [tag, arm, sh] of [['L', arms.L, shL], ['R', arms.R, shR]]) {
    const se = pt('sleeve' + tag); if (!se) continue;
    const len = dist(sh, se) * s, t = Math.min(1, len / pathLength(arm));
    add('sleeve' + tag, se, alongPath(arm, t));
  }
  const hl = pt('hemL'), hr = pt('hemR'); if (!hl || !hr) return null;
  const hemY = Math.min(footY - 60, SHY + ((hl[1] + hr[1]) / 2 - gShY) * s);
  const he = spanAt(body, Math.min(hemY, g === 'dress' || hemY < body.crotchY ? hemY : body.crotchY - 1)), half = Math.max(dist(hl, hr) * s / 2, (he.r - he.l) / 2 * (1 + ease));
  add('hemL', hl, [cx - half, hemY]); add('hemR', hr, [cx + half, hemY]);
  if (g === 'dress') {
    const wl = pt('waistL'), wr = pt('waistR');
    if (wl && wr) { const e = spanAt(body, waistY), c = 1 + ease * 0.6; add('waistL', wl, [cx - (cx - e.l) * c, waistY]); add('waistR', wr, [cx + (e.r - cx) * c, waistY]); }
    widen = { y0: Math.round(waistY), y1: Math.round(hemY) + 4, hang: { y: hipY, y1: hemY + 4 } };
  } else widen = { y0: Math.round(waistY), y1: Math.round(hemY) + 4, hang: null };
  return { ctl, widen, s };
}

/**
 * The garment cutout fitted to the body: a canvas the size of the base picture, ready to be drawn at 0,0.
 * `marks` may be null (then they are suggested). Resolves to { canvas, ctl } or null when the piece has no landmarks to warp.
 */
export function fitGarment(cut, type, marks, pack, body, { ease = easeOf(type), rows = true, debug = null } = {}) {
  const pl = plan(type, marks, cut, pack, body); if (!pl || pl.ctl.length < 3) return null;
  const [W, H] = pack.size, src = pl.ctl.map((c) => c.src), dst = pl.ctl.map((c) => c.dst);
  // a global affine fit keeps the far corners sane; pinned border points stop the spline from flinging the margins around
  const aff = affineFit(src, dst), b = [[0, 0], [cut.width, 0], [0, cut.height], [cut.width, cut.height], [cut.width / 2, 0], [cut.width / 2, cut.height], [0, cut.height / 2], [cut.width, cut.height / 2]];
  const S = src.map((p, i) => [p[0] + i * 1e-3, p[1]]), D = dst.slice();
  const near = (p) => src.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.max(cut.width, cut.height) * 0.04);
  for (const p of b) if (!near(p)) { S.push(p); D.push(aff(p[0], p[1])); }
  const f = tps(S, D, 120);
  let out = warpMesh(cut, f, W, H, { cols: 44, rows: 60 });
  // one outline for anything that hangs over both legs (dresses, skirts, tops); each leg on its own for trousers
  const bodyRuns = type === 'bottoms' ? (y) => body.runs(y) : (y) => { const o = body.outlineAt(y); return o ? [[o.l, o.r]] : []; };
  if (rows) out = widenRows(out, bodyRuns, { y0: pl.widen.y0, y1: pl.widen.y1, ease, hang: pl.widen.hang, debug });
  if (type === 'bottoms') { // trousers are two separate legs: nothing hangs in the gap between them below the crotch
    const g = out.getContext('2d');
    for (let y = Math.ceil(body.crotchY); y < pack.size[1]; y++) { const r = body.runs(y); if (r.length !== 2) continue; const m = (r[0][1] - r[0][0]) * 0.12, a = r[0][1] + m, b = r[1][0] - m; if (b > a) g.clearRect(a, y, b - a, 1); }
  }
  out = featherEdge(out, 1);
  return { canvas: out, ctl: pl.ctl, s: pl.s };
}
