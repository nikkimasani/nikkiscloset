// One body model drives everything: the proportional mannequin, the photo-based model, and where each
// garment lands. A body is { W, H, pts } in its own pixel space. pts are joint positions
// (l/r = left/right side of the IMAGE, i.e. smaller x first).
export const HANDLES = [
  ['headTop', 'Top of head'], ['shL', 'Left shoulder'], ['shR', 'Right shoulder'],
  ['wrL', 'Left wrist'], ['wrR', 'Right wrist'], ['hipL', 'Left hip'], ['hipR', 'Right hip'],
  ['knL', 'Left knee'], ['knR', 'Right knee'], ['anL', 'Left ankle'], ['anR', 'Right ankle'],
];

// ~7.5-head figure, 300x640.
export const DEFAULT_BODY = {
  W: 300, H: 640,
  pts: {
    headTop: [150, 14], shL: [104, 112], shR: [196, 112], wrL: [80, 298], wrR: [220, 298],
    hipL: [127, 276], hipR: [173, 276], knL: [130, 428], knR: [170, 428], anL: [132, 584], anR: [168, 584],
  },
};

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function measures({ pts: p }) {
  const sm = mid(p.shL, p.shR), hm = mid(p.hipL, p.hipR), am = mid(p.anL, p.anR);
  return {
    sm, hm, am,
    sw: Math.max(10, Math.abs(p.shR[0] - p.shL[0])),
    hw: Math.max(8, Math.abs(p.hipR[0] - p.hipL[0])),
    T: Math.max(10, hm[1] - sm[1]),          // shoulder line -> hip line
    L: Math.max(10, am[1] - hm[1]),          // hip line -> ankle
    headH: Math.max(10, (sm[1] - p.headTop[1]) / 1.25),
  };
}

/** Re-shape the default figure from four sliders (1 = default). */
export function fromProportions({ shoulders = 1, hips = 1, torso = 1, legs = 1 }) {
  const d = DEFAULT_BODY.pts, cx = 150;
  const sx = (pt, k) => [cx + (pt[0] - cx) * k, pt[1]];
  const shY = d.shL[1], hipY = shY + (d.hipL[1] - shY) * torso, anY = hipY + (d.anL[1] - d.hipL[1]) * legs;
  const knY = hipY + (anY - hipY) * 0.5;
  const at = (pt, k, y) => [sx(pt, k)[0], y];
  const p = {
    headTop: d.headTop, shL: at(d.shL, shoulders, shY), shR: at(d.shR, shoulders, shY),
    wrL: [cx + (d.wrL[0] - cx) * shoulders, hipY + 22], wrR: [cx + (d.wrR[0] - cx) * shoulders, hipY + 22],
    hipL: at(d.hipL, hips, hipY), hipR: at(d.hipR, hips, hipY),
    knL: at(d.knL, hips, knY), knR: at(d.knR, hips, knY), anL: at(d.anL, hips, anY), anR: at(d.anR, hips, anY),
  };
  return { W: 300, H: Math.round(anY + 40), pts: p };
}

/** MediaPipe pose landmarks (normalised 0-1, 33 points) -> body. Returns {body, warnings}. */
export function fromLandmarks(lm, W, H) {
  const P = (i) => [lm[i].x * W, lm[i].y * H];
  const pair = (a, b) => { const A = P(a), B = P(b); return A[0] <= B[0] ? [A, B] : [B, A]; };
  const [shL, shR] = pair(11, 12), [wrL, wrR] = pair(15, 16), [hipL, hipR] = pair(23, 24);
  const [knL, knR] = pair(25, 26), [anL, anR] = pair(27, 28);
  const nose = P(0), sm = mid(shL, shR);
  const headTop = [nose[0], nose[1] - 0.95 * (sm[1] - nose[1])];
  const warnings = [];
  const vis = (i) => lm[i].visibility ?? 1;
  if ([27, 28].some((i) => vis(i) < 0.5 || lm[i].y > 0.995)) warnings.push('Your feet look cut off — stand back so your whole body is in the photo.');
  if ([11, 12, 23, 24].some((i) => vis(i) < 0.5)) warnings.push('Some torso points are unclear — drag the dots to fix them.');
  return { body: { W, H, pts: { headTop, shL, shR, wrL, wrR, hipL, hipR, knL, knR, anL, anR } }, warnings };
}

/** Where a garment of this type goes on this body: {x,y,w,h,rot,align} (box centre = x+w/2, y+h/2). */
export function place(type, body) {
  const { pts: p } = body, m = measures(body);
  const { sm, hm, am, sw, hw, T, L, headH } = m;
  const tilt = Math.max(-0.17, Math.min(0.17, Math.atan2(p.shR[1] - p.shL[1], p.shR[0] - p.shL[0])));
  const top = sm[1] - 0.12 * T, waist = hm[1] - 0.3 * T;
  const box = (cx, y, w, h, align = 'xMidYMin', rot = 0) => ({ x: cx - w / 2, y, w, h, rot, align });
  switch (type) {
    case 'tops': return box(sm[0], top, sw * 1.7, T * 1.3, 'xMidYMin', tilt);
    case 'tanks': return box(sm[0], top, sw * 1.35, T * 1.25, 'xMidYMin', tilt);
    case 'bodysuits': return box(sm[0], top, sw * 1.5, T * 1.5, 'xMidYMin', tilt);
    case 'bottoms': return box(hm[0], waist, hw * 2.2, am[1] + 0.05 * L - waist, 'xMidYMin');
    case 'skirts': return box(hm[0], waist, hw * 2.6, L * 0.8, 'xMidYMin');
    case 'dresses': return box(sm[0], top, sw * 1.9, (am[1] - top) * 0.97, 'xMidYMin', tilt * 0.5);
    case 'outerwear': return box(sm[0], sm[1] - 0.16 * T, sw * 2.15, T * 1.85, 'xMidYMin', tilt);
    case 'shoes': return box(am[0], am[1] - 0.08 * L, Math.max(sw * 1.25, Math.abs(p.anR[0] - p.anL[0]) * 2.4), 0.2 * L, 'xMidYMax');
    case 'bags': { const w = p.wrR; return box(w[0], w[1] - 0.1 * sw, sw * 0.95, sw * 1.15, 'xMidYMin'); }
    case 'accessories': return box(p.headTop[0], p.headTop[1] - 0.1 * headH, headH * 1.9, headH * 1.5, 'xMidYMid');
    default: return box(sm[0], top, sw * 1.7, T * 1.3);
  }
}

/** viewBox for the drawn mannequin (cropped around the figure) or the full photo. */
export function viewBox(body, photo) {
  if (photo) return [0, 0, body.W, body.H];
  const { pts: p } = body, m = measures(body);
  const bh = m.am[1] - p.headTop[1], w = Math.max(m.sw * 3.6, bh * 0.52);
  return [m.sm[0] - w / 2, p.headTop[1] - 0.05 * bh, w, bh * 1.16];
}

/** The proportional mannequin, drawn from the body's own joints. */
export function figureSVG(body, skin, hair) {
  const { pts: p } = body, { sm, hm, am, sw, hw, T, L, headH } = measures(body);
  const f = (n) => Math.round(n * 10) / 10;
  const shY = sm[1], hipY = hm[1], waistY = hipY - 0.3 * T, crotch = hipY + 0.16 * T;
  const LS = p.shL[0] - 0.12 * sw, RS = p.shR[0] + 0.12 * sw, nw = headH * 0.32;
  const wH = sw * 0.34, hH = sw * 0.47, cx = sm[0], hx = hm[0];
  const torso = `M${f(cx - nw / 2)} ${f(shY - 0.03 * T)} Q${f(LS + 0.1 * sw)} ${f(shY - 0.03 * T)} ${f(LS)} ${f(shY + 0.06 * T)}
    C${f(LS)} ${f(shY + 0.25 * T)} ${f(cx - wH)} ${f(waistY - 0.2 * T)} ${f(cx - wH)} ${f(waistY)}
    C${f(cx - wH)} ${f(waistY + 0.12 * T)} ${f(hx - hH)} ${f(hipY - 0.1 * T)} ${f(hx - hH)} ${f(hipY + 0.04 * T)}
    Q${f(hx - hH)} ${f(crotch)} ${f(hx)} ${f(crotch)} Q${f(hx + hH)} ${f(crotch)} ${f(hx + hH)} ${f(hipY + 0.04 * T)}
    C${f(hx + hH)} ${f(hipY - 0.1 * T)} ${f(cx + wH)} ${f(waistY + 0.12 * T)} ${f(cx + wH)} ${f(waistY)}
    C${f(cx + wH)} ${f(waistY - 0.2 * T)} ${f(RS)} ${f(shY + 0.25 * T)} ${f(RS)} ${f(shY + 0.06 * T)}
    Q${f(RS - 0.1 * sw)} ${f(shY - 0.03 * T)} ${f(cx + nw / 2)} ${f(shY - 0.03 * T)}Z`;
  const elbow = (s, w, side) => [(s[0] + w[0]) / 2 + side * sw * 0.07, (s[1] + w[1]) / 2];
  const arm = (s, w, side) => { const e = elbow(s, w, side), a = [s[0] + side * 0.02 * sw, s[1] + 0.05 * T];
    return `<path d="M${f(a[0])} ${f(a[1])} L${f(e[0])} ${f(e[1])}" stroke-width="${f(sw * 0.25)}"/><path d="M${f(e[0])} ${f(e[1])} L${f(w[0])} ${f(w[1])}" stroke-width="${f(sw * 0.18)}"/>`; };
  const leg = (h, k, a) => `<path d="M${f(h[0])} ${f(h[1])} L${f(k[0])} ${f(k[1])}" stroke-width="${f(sw * 0.43)}"/><path d="M${f(k[0])} ${f(k[1])} L${f(a[0])} ${f(a[1])}" stroke-width="${f(sw * 0.25)}"/>`;
  const hcx = p.headTop[0], hcy = p.headTop[1] + headH / 2, rx = headH * 0.36;
  return `<ellipse cx="${f(am[0])}" cy="${f(am[1] + 0.05 * L)}" rx="${f(sw * 1.05)}" ry="${f(sw * 0.1)}" fill="rgba(0,0,0,.08)"/>
    <path d="M${f(hcx - rx * 1.2)} ${f(hcy)} Q${f(hcx - rx * 1.25)} ${f(p.headTop[1] - 0.12 * headH)} ${f(hcx)} ${f(p.headTop[1] - 0.12 * headH)} Q${f(hcx + rx * 1.25)} ${f(p.headTop[1] - 0.12 * headH)} ${f(hcx + rx * 1.2)} ${f(hcy)} L${f(hcx + rx * 1.1)} ${f(hcy + headH * 0.7)} L${f(hcx - rx * 1.1)} ${f(hcy + headH * 0.7)}Z" fill="${hair}"/>
    <g fill="none" stroke="${skin}" stroke-linecap="round" stroke-linejoin="round">${leg(p.hipL, p.knL, p.anL)}${leg(p.hipR, p.knR, p.anR)}${arm(p.shL, p.wrL, -1)}${arm(p.shR, p.wrR, 1)}</g>
    <g fill="${skin}"><ellipse cx="${f(p.anL[0] - sw * 0.03)}" cy="${f(p.anL[1] + 0.04 * L)}" rx="${f(sw * 0.17)}" ry="${f(sw * 0.06)}"/><ellipse cx="${f(p.anR[0] + sw * 0.03)}" cy="${f(p.anR[1] + 0.04 * L)}" rx="${f(sw * 0.17)}" ry="${f(sw * 0.06)}"/>
      <ellipse cx="${f(p.wrL[0])}" cy="${f(p.wrL[1] + sw * 0.1)}" rx="${f(sw * 0.07)}" ry="${f(sw * 0.12)}"/><ellipse cx="${f(p.wrR[0])}" cy="${f(p.wrR[1] + sw * 0.1)}" rx="${f(sw * 0.07)}" ry="${f(sw * 0.12)}"/>
      <rect x="${f(cx - nw / 2)}" y="${f(hcy + headH * 0.3)}" width="${f(nw)}" height="${f(shY - hcy)}"/><path d="${torso}"/><ellipse cx="${f(hcx)}" cy="${f(hcy)}" rx="${f(rx)}" ry="${f(headH / 2)}"/></g>
    <path d="M${f(hcx - rx * 1.03)} ${f(hcy - headH * 0.02)} C${f(hcx - rx * 1.15)} ${f(hcy - headH * 0.66)} ${f(hcx + rx * 1.15)} ${f(hcy - headH * 0.66)} ${f(hcx + rx * 1.03)} ${f(hcy - headH * 0.02)} C${f(hcx + rx * 0.8)} ${f(hcy - headH * 0.3)} ${f(hcx + rx * 0.3)} ${f(hcy - headH * 0.3)} ${f(hcx - rx * 0.15)} ${f(hcy - headH * 0.36)} C${f(hcx - rx * 0.6)} ${f(hcy - headH * 0.3)} ${f(hcx - rx * 0.9)} ${f(hcy - headH * 0.2)} ${f(hcx - rx * 1.03)} ${f(hcy - headH * 0.02)}Z" fill="${hair}"/>
    <g fill="#2b1d17" opacity=".55"><circle cx="${f(hcx - rx * 0.4)}" cy="${f(hcy + headH * 0.04)}" r="${f(headH * 0.022)}"/><circle cx="${f(hcx + rx * 0.4)}" cy="${f(hcy + headH * 0.04)}" r="${f(headH * 0.022)}"/></g>
    <path d="M${f(hcx - rx * 0.25)} ${f(hcy + headH * 0.24)} Q${f(hcx)} ${f(hcy + headH * 0.3)} ${f(hcx + rx * 0.25)} ${f(hcy + headH * 0.24)}" stroke="#b5584f" stroke-width="${f(headH * 0.03)}" fill="none" stroke-linecap="round"/>`;
}
