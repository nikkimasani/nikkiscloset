// The avatar: a stylised "game NPC" built from smooth sculpted shapes (no assets to download).
//  • Torso, thighs, calves and arms are lofted along curves with hand-tuned radius profiles, so they taper and curve like a body.
//  • Underwear is painted onto the torso with vertex colours, so it sits flush instead of floating on top.
//  • Limbs hang from pivots (shoulders and hips) so they can swing in the walk cycle; the clothes follow in the vertex shader.
import * as THREE from '../vendor/three/three.module.min.js';
import { measures } from './body.js';
import { toonGradient } from './world.js';

/** Light and dark streaks plus a glossy band, multiplied by the hair colour, so hair reads as strands rather than a solid slab. */
let STRANDS = null;
function hairStrands() {
  if (STRANDS) return STRANDS;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, 128, 256);
  for (let x = 0; x < 128; x += 2) { const v = 170 + Math.floor(Math.random() * 85); g.fillStyle = `rgba(${v},${v},${v},${0.35 + Math.random() * 0.4})`; g.fillRect(x, 0, 1 + Math.random() * 2, 256); }
  const gl = g.createLinearGradient(0, 70, 0, 120); gl.addColorStop(0, '#ffffff00'); gl.addColorStop(0.5, '#ffffffcc'); gl.addColorStop(1, '#ffffff00'); g.fillStyle = gl; g.fillRect(0, 70, 128, 50);
  STRANDS = new THREE.CanvasTexture(c); STRANDS.colorSpace = THREE.SRGBColorSpace; STRANDS.wrapS = STRANDS.wrapT = THREE.RepeatWrapping;
  return STRANDS;
}

/** Orient triangles so the surface normals point away from each ring's centre (matters for lighting and the outline). */
function outward(geo, centres, seg, rings) {
  geo.computeVertexNormals();
  const n = geo.attributes.normal, p = geo.attributes.position, r = Math.floor(rings / 2), k = 0, i = r * (seg + 1) + k;
  const d = n.getX(i) * (p.getX(i) - centres[r].x) + n.getY(i) * (p.getY(i) - centres[r].y) + n.getZ(i) * (p.getZ(i) - centres[r].z);
  if (d < 0) { const ix = geo.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } geo.computeVertexNormals(); }
  return geo;
}

/** A tube along a smooth path with an elliptical cross-section that changes along its length. radius(t) -> [rx, rz]. */
function tube(path, radius, { rings = 30, seg = 28 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal'), pos = [], idx = [], centres = [];
  const z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, c = curve.getPoint(t), tan = curve.getTangent(t).normalize();
    const side = new THREE.Vector3().crossVectors(tan, z); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    const fwd = new THREE.Vector3().crossVectors(side, tan).normalize(), [rx, rz] = radius(t);
    centres.push(c);
    for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; pos.push(c.x + side.x * rx * Math.cos(a) + fwd.x * rz * Math.sin(a), c.y + side.y * rx * Math.cos(a) + fwd.y * rz * Math.sin(a), c.z + side.z * rx * Math.cos(a) + fwd.z * rz * Math.sin(a)); }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return outward(g, centres, seg, rings);
}

/** Piecewise-linear profile: keys = [[t, value], ...] -> function(t). Smoothed with a cosine ease between keys. */
const profile = (keys) => (t) => {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) { const u = (t - t0) / (t1 - t0 || 1), e = (1 - Math.cos(Math.max(0, Math.min(1, u)) * Math.PI)) / 2; return v0 + (v1 - v0) * e; }
  }
  return keys[keys.length - 1][1];
};

/**
 * Torso loft: keys are { k (0 = shoulder line, 1 = hip line, in torso lengths), a, d (half-width/depth, in shoulder widths), z (forward shift) }.
 * Returns a mesh whose vertex colours paint the underwear.
 */
function torso(keys, { shY, T, sw, bf, gy, skin, under, bra, briefs }) {
  const ks = keys.map((q) => q.k), at = (field) => (k) => {
    for (let i = 0; i < keys.length - 1; i++) if (k <= keys[i + 1].k) { const u = (k - keys[i].k) / (keys[i + 1].k - keys[i].k), e = (1 - Math.cos(u * Math.PI)) / 2; return keys[i][field] + (keys[i + 1][field] - keys[i][field]) * e; }
    return keys[keys.length - 1][field];
  };
  const A = at('a'), D = at('d'), Z = at('z'), rings = 44, seg = 48, pos = [], col = [], idx = [], centres = [];
  const skinC = new THREE.Color(skin), underC = new THREE.Color(under), tmp = new THREE.Color();
  const band = (k, [k0, k1], soft) => Math.max(0, Math.min(1, Math.min((k - k0) / soft, (k1 - k) / soft)));
  for (let i = 0; i <= rings; i++) {
    const k = ks[0] + (i / rings) * (ks[ks.length - 1] - ks[0]), y = gy - (shY + k * T), a = A(k) * sw * bf, d = D(k) * sw * bf, zc = Z(k) * sw;
    centres.push({ x: 0, y, z: zc });
    for (let q = 0; q <= seg; q++) {
      const th = (q / seg) * Math.PI * 2, front = Math.sin(th); // +z side is the front
      pos.push(a * Math.cos(th), y, zc + d * front);
      // painted underwear: a bandeau all round, and briefs that dip lower in front
      const w = Math.max(band(k, bra, 0.025), band(k, [briefs[0] + (front > 0 ? 0.0 : -0.03), briefs[1]], 0.03));
      tmp.copy(skinC).lerp(underC, w); col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let q = 0; q < seg; q++) { const a = i * (seg + 1) + q, b = a + seg + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  return outward(g, centres, seg, rings);
}

export function buildBody(body, skin, hair, style = 'long', face = {}) {
  const { pts: p } = body, m = measures(body), { sw, T, L } = m, headH = m.headH * 1.16, bf = body.build || 1;
  const gy = Math.max(p.anL[1], p.anR[1]) + 0.04 * L, cx = m.sm[0];
  const V = (x, y, z = 0) => new THREE.Vector3(x - cx, gy - y, z);
  const grad = toonGradient();
  const skinM = new THREE.MeshToonMaterial({ color: skin, gradientMap: grad, side: THREE.DoubleSide });
  const torsoM = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad, side: THREE.DoubleSide });
  const hairM = new THREE.MeshToonMaterial({ color: hair, map: hairStrands(), gradientMap: grad });
  const g = new THREE.Group(), skinMeshes = [], fit = []; // skinMeshes get an outline; fit is what clothes are wrapped around
  const mark = (mesh, mat = skinM, wrap = true) => { mesh.material = mat; mesh.userData.skin = true; skinMeshes.push(mesh); if (wrap) fit.push(mesh); return mesh; };

  // ── torso: a sculpted S-curve (bust forward, waist in, hips and seat back) ──
  const shY = m.sm[1];
  const keys = [
    { k: -0.1, a: 0.14, d: 0.12, z: 0 }, { k: -0.04, a: 0.28, d: 0.145, z: -0.005 }, { k: 0.02, a: 0.5, d: 0.15, z: 0 }, { k: 0.12, a: 0.47, d: 0.175, z: 0.012 },
    { k: 0.23, a: 0.45, d: 0.205, z: 0.04 }, { k: 0.34, a: 0.39, d: 0.17, z: 0.015 }, { k: 0.62, a: 0.325, d: 0.15, z: 0 }, { k: 0.82, a: 0.4, d: 0.175, z: -0.01 },
    { k: 1.0, a: 0.46, d: 0.205, z: -0.032 }, { k: 1.12, a: 0.46, d: 0.205, z: -0.036 }, { k: 1.2, a: 0.4, d: 0.185, z: -0.02 }, { k: 1.26, a: 0.3, d: 0.15, z: 0 },
  ];
  g.add(mark(new THREE.Mesh(torso(keys, { shY, T, sw, bf, gy, skin, under: '#f6eef5', bra: [0.17, 0.3], briefs: [0.98, 1.26] })), torsoM));

  // ── neck, head, ears ──
  const hc = V(p.headTop[0], p.headTop[1] + headH / 2);
  g.add(mark(new THREE.Mesh(tube([new THREE.Vector3(0, gy - (shY - 0.08 * T), 0), new THREE.Vector3(0, hc.y - headH * 0.35, 0.004 * sw)], (t) => { const r = (0.088 - 0.018 * t) * sw; return [r, r * 0.95]; }, { rings: 8, seg: 24 })), skinM, false));
  const headG = new THREE.SphereGeometry(headH / 2, 44, 32), hp = headG.attributes.position;
  for (let i = 0; i < hp.count; i++) { // soften the lower face into a chin and a touch flatter at the back
    const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i), r = headH / 2, low = Math.max(0, -y / r), taper = 1 - 0.2 * Math.pow(low, 1.6);
    hp.setXYZ(i, x * taper, y, z * taper * (z < 0 ? 0.94 : 1));
  }
  headG.computeVertexNormals();
  const head = mark(new THREE.Mesh(headG), skinM, false); head.scale.set(0.8, 1.04, 0.88); head.position.copy(hc); g.add(head);
  for (const sd of [-1, 1]) { const ear = mark(new THREE.Mesh(new THREE.SphereGeometry(headH * 0.07, 14, 10)), skinM, false); ear.scale.set(0.45, 1, 0.8); ear.position.set(hc.x + sd * headH * 0.4, hc.y - headH * 0.04, -headH * 0.02); g.add(ear); }

  // ── hair ──
  const sph = (r, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 18), hairM); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  const capScale = style === 'curly' ? 1.18 : 1;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(headH / 2, 40, 22, 0, Math.PI * 2, 0, Math.PI * (style === 'pixie' ? 0.45 : 0.49)), hairM);
  cap.scale.set(0.84 * capScale, 1.1 * capScale, 0.94); cap.position.set(hc.x, hc.y + headH * 0.02, -headH * 0.02); cap.rotation.x = 0.12; g.add(cap);
  if (style !== 'pixie') sph(headH / 2, 0.78, 1.0, 0.8, hc.x, hc.y + headH * 0.03, -headH * 0.17);
  const tubeH = (rTop, rBot, len, x, y, z, sz = 0.7) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 28, 1, true), hairM); o.position.set(x, y, z); o.scale.z = sz; g.add(o); return o; };
  if (style === 'long') { tubeH(headH * 0.37, headH * 0.3, headH * 1.15, hc.x, hc.y - headH * 0.52, -headH * 0.2); sph(headH * 0.3, 1, 0.55, 0.6, hc.x, hc.y - headH * 1.05, -headH * 0.22); }
  if (style === 'bob') tubeH(headH * 0.38, headH * 0.41, headH * 0.55, hc.x, hc.y - headH * 0.28, -headH * 0.12, 0.85);
  if (style === 'bun') sph(headH * 0.2, 1, 1, 1, hc.x, hc.y + headH * 0.58, -headH * 0.1);
  if (style === 'pony') { const t = tubeH(headH * 0.12, headH * 0.04, headH * 1.1, hc.x, hc.y - headH * 0.35, -headH * 0.55, 1); t.rotation.x = -0.25; }
  if (style === 'curly') for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; sph(headH * 0.2, 1, 1, 1, hc.x + Math.cos(a) * headH * 0.4, hc.y + Math.sin(a) * headH * 0.42 + headH * 0.05, -headH * 0.12); }
  if (style !== 'pixie') for (const sd of [-1, 1]) sph(headH * 0.12, 0.6, 1.5, 0.7, hc.x + sd * headH * 0.34, hc.y - headH * 0.08, headH * 0.1); // face-framing side locks

  // ── face ──
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), iris = new THREE.MeshBasicMaterial({ color: face.eyes || '#2b1d17' }), ink = new THREE.MeshBasicMaterial({ color: 0x20141a });
  const blushM = new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.38, depthWrite: false }), browM = new THREE.MeshToonMaterial({ color: new THREE.Color(hair).multiplyScalar(0.75), gradientMap: grad });
  const eyes = [];
  for (const sd of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(hc.x + sd * headH * 0.16, hc.y - headH * 0.07, headH * 0.39);
    const w = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.075, 20, 14), white); w.scale.set(1, 1.18, 0.4); eye.add(w);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.05, 20, 14), iris); ir.scale.set(1, 1.15, 0.4); ir.position.set(0, -0.006 * headH, headH * 0.02); eye.add(ir);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.026, 14, 10), ink); pu.scale.set(1, 1.15, 0.4); pu.position.set(0, -0.006 * headH, headH * 0.035); eye.add(pu);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.016, 10, 8), white); hl.position.set(headH * 0.018, headH * 0.03, headH * 0.045); eye.add(hl);
    const lash = new THREE.Mesh(new THREE.TorusGeometry(headH * 0.07, headH * 0.008, 6, 20, Math.PI), ink); lash.position.set(0, headH * 0.012, headH * 0.012); lash.scale.set(1, 0.9, 0.5); eye.add(lash);
    g.add(eye); eyes.push(eye);
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(headH * 0.008, headH * 0.1, 4, 8), browM); brow.rotation.z = Math.PI / 2 + sd * 0.14;
    brow.position.set(hc.x + sd * headH * 0.165, hc.y + headH * 0.06, headH * 0.405); g.add(brow);
    const blush = new THREE.Mesh(new THREE.CircleGeometry(headH * 0.06, 20), blushM); blush.scale.set(1.3, 0.8, 1); blush.position.set(hc.x + sd * headH * 0.25, hc.y - headH * 0.17, headH * 0.345); blush.rotation.y = sd * 0.5; g.add(blush);
  }
  const nose = mark(new THREE.Mesh(new THREE.SphereGeometry(headH * 0.022, 10, 8)), skinM, false); nose.scale.set(1, 0.9, 0.9); nose.position.set(hc.x, hc.y - headH * 0.15, headH * 0.43); g.add(nose);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.03, 10, 8), new THREE.MeshBasicMaterial({ color: face.lips || '#c4505f' }));
  mouth.scale.set(2.2, 0.7, 0.6); mouth.position.set(hc.x, hc.y - headH * 0.27, headH * 0.425); g.add(mouth);

  // ── arms: tapered from the shoulder through the elbow to the wrist, hanging from a pivot so they can swing ──
  const rig = { legs: [], arms: [] };
  const armR = profile([[0, 0.125], [0.25, 0.102], [0.5, 0.082], [0.62, 0.088], [0.9, 0.062], [1, 0.054]]);
  for (const [s, w, side] of [[p.shL, p.wrL, -1], [p.shR, p.wrR, 1]]) {
    const sh = V(s[0] - side * 0.02 * sw, s[1] + 0.05 * T), wr = V(w[0], w[1]), el = V((s[0] + w[0]) / 2 + side * sw * 0.07, (s[1] + w[1]) / 2);
    const piv = new THREE.Group(); piv.position.copy(sh);
    const rel = (v) => v.clone().sub(sh);
    piv.add(mark(new THREE.Mesh(tube([rel(sh), rel(el), rel(wr)], (t) => { const r = armR(t) * sw * bf; return [r, r * 0.93]; }, { rings: 22, seg: 22 }))));
    const cap = mark(new THREE.Mesh(new THREE.SphereGeometry(0.125 * sw * bf, 24, 16))); piv.add(cap); // rounded shoulder
    const hand = mark(new THREE.Mesh(new THREE.SphereGeometry(0.075 * sw, 18, 12))); hand.scale.set(0.8, 1.35, 0.55); hand.position.set(wr.x - sh.x, wr.y - 0.085 * sw - sh.y, 0); piv.add(hand);
    const thumb = mark(new THREE.Mesh(new THREE.SphereGeometry(0.03 * sw, 10, 8))); thumb.scale.set(0.7, 1.5, 0.7); thumb.position.set(hand.position.x - side * 0.05 * sw, hand.position.y + 0.03 * sw, 0.03 * sw); piv.add(thumb);
    g.add(piv); rig.arms.push({ piv, x: sh.x, y: sh.y });
  }
  // ── legs: thigh, knee, calf, ankle ──
  const legR = profile([[0, 0.26], [0.12, 0.25], [0.34, 0.185], [0.5, 0.152], [0.62, 0.162], [0.82, 0.108], [0.95, 0.082], [1, 0.075]]);
  for (const [h, k, a] of [[p.hipL, p.knL, p.anL], [p.hipR, p.knR, p.anR]]) {
    const hpv = V(h[0], h[1] + 0.04 * T), kn = V(k[0], k[1]), an = V(a[0], a[1]);
    const piv = new THREE.Group(); piv.position.copy(hpv);
    const rel = (v) => v.clone().sub(hpv);
    piv.add(mark(new THREE.Mesh(tube([rel(hpv), rel(kn), rel(an)], (t) => { const r = legR(t) * sw * bf; return [r, r * 0.97]; }, { rings: 30, seg: 26 }))));
    const foot = mark(new THREE.Mesh(new THREE.SphereGeometry(0.1 * sw, 20, 14))); foot.scale.set(0.8, 0.46, 1.9); foot.position.set(an.x - hpv.x, an.y - 0.02 * L - hpv.y, 0.1 * sw); piv.add(foot);
    const heel = mark(new THREE.Mesh(new THREE.SphereGeometry(0.085 * sw, 16, 12))); heel.scale.set(0.9, 0.8, 1); heel.position.set(an.x - hpv.x, an.y - 0.005 * L - hpv.y + 0.01 * sw, -0.03 * sw); piv.add(heel);
    g.add(piv); rig.legs.push({ piv, x: hpv.x, y: hpv.y });
  }
  rig.legs.sort((p1, p2) => p1.x - p2.x); rig.arms.sort((p1, p2) => p1.x - p2.x); // [0] is the one at smaller x
  rig.eyes = eyes;
  // numbers the clothes' vertex shader needs to swing with the limbs
  rig.hip = new THREE.Vector4(rig.legs[0].x, (rig.legs[0].y + rig.legs[1].y) / 2, rig.legs[1].x, 0.35 * T);
  rig.sh = new THREE.Vector4(rig.arms[0].x, (rig.arms[0].y + rig.arms[1].y) / 2, rig.arms[1].x, 0.42 * sw * bf);

  // ── the "game character" look: a dark outline around the skin (inverted hull) and shadows ──
  const outlineM = new THREE.MeshBasicMaterial({ color: 0x6a3d57, side: THREE.BackSide }), thick = 0.018 * sw;
  outlineM.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${thick.toFixed(3)};`); };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  skinMeshes.slice().forEach((o) => { const ol = new THREE.Mesh(o.geometry, outlineM); ol.userData.outline = true; o.add(ol); });
  const top = gy - p.headTop[1], halfW = Math.max(sw * 1.6, Math.abs(p.wrR[0] - cx) + sw * 0.7);
  return { group: g, ctx: { cx, gy, H: top * 1.08, halfW, m, body, skinMeshes: fit, rig } };
}
