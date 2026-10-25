// 3D dress-up stage (Three.js, bundled in /vendor — nothing loads from a CDN).
//  • The body is built from the same joint points as the 2D mannequin, so "shaped like me" carries over.
//  • Each garment photo is a cutout wrapped around the body as a curved shell (projected front-on, alpha-clipped to the
//    garment's silhouette). It gives depth, lighting and a full turn-around, but not real cloth folds or drape.
import * as THREE from '../vendor/three/three.module.min.js';
import { measures, place } from './body.js';
import { webglOK } from './webgl.js';

const webgl = webglOK;

// Thickness (half-depth) of each kind of garment as a fraction of shoulder width. Outer layers are thicker so they sit over inner ones.
const HMAX = { tops: .28, tanks: .26, bodysuits: .28, outerwear: .33, dresses: .28, bottoms: .27, skirts: .29, shoes: .17, bags: .07, accessories: .06 };

let S = null;           // singleton state (one WebGL context for the whole app)
let failed = false;

function ensure() {
  if (S) return S;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 10000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe3d6ff, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(180, 420, 520); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe4ff, .7); rim.position.set(-300, 200, -300); scene.add(rim);
  const figure = new THREE.Group(); scene.add(figure);
  S = { renderer, scene, camera, figure, shadow: null, rot: 0, target: 0, drag: null, raf: 0, bodyKey: '', ctx: null, outfit: null, textures: new Map(), shells: [], el: null, ro: null };
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); failed = true; });
  const cv = renderer.domElement;
  cv.style.touchAction = 'pan-y';
  cv.addEventListener('pointerdown', (e) => { S.drag = { x: e.clientX }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!S.drag) return; S.target += (e.clientX - S.drag.x) * 0.012; S.rot = S.target; S.drag.x = e.clientX; request(); });
  const end = () => (S.drag = null);
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  return S;
}

function request() {
  if (!S || S.raf) return;
  S.raf = requestAnimationFrame(() => {
    S.raf = 0;
    const d = S.target - S.rot;
    if (Math.abs(d) > 0.002) { S.rot += d * 0.2; request(); } else S.rot = S.target;
    S.figure.rotation.y = S.rot;
    S.renderer.render(S.scene, S.camera);
  });
}

function resize() {
  if (!S?.el) return;
  const { width, height } = S.el.getBoundingClientRect();
  if (!width || !height) return;
  S.renderer.setSize(width, height, false);
  S.camera.aspect = width / height;
  frame();
  request();
}

/** Camera that fits the whole figure (and its arms/bag) for the current aspect ratio. */
function frame() {
  if (!S?.ctx) return;
  const { H, halfW } = S.ctx, t = Math.tan((S.camera.fov * Math.PI) / 360);
  const dist = Math.max((H * 0.56) / t, (halfW * 1.1) / (t * S.camera.aspect));
  S.camera.position.set(0, H * 0.5, dist);
  S.camera.lookAt(0, H * 0.5, 0);
  S.camera.updateProjectionMatrix();
}

function dispose(group) {
  group.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.material.map) o.material.dispose(); else o.material?.dispose(); });
  group.clear();
}

/* ───────── body ───────── */
function loft(sections, seg = 36) {
  const pos = [], idx = [];
  sections.forEach((s) => { for (let k = 0; k <= seg; k++) { const t = (k / seg) * Math.PI * 2; pos.push((s.x || 0) + s.a * Math.cos(t), s.y, s.d * Math.sin(t)); } });
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * (seg + 1) + k, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function limb(a, b, r1, r2, mat) {
  const g = new THREE.Group(), len = a.distanceTo(b);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 20, 1, true), mat);
  cyl.position.copy(a).add(b).multiplyScalar(0.5);
  cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.add(cyl);
  for (const [p, r] of [[a, r1], [b, r2]]) { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat); s.position.copy(p); g.add(s); }
  return g;
}

function buildBody(body, skin, hair, style = 'long', face = {}) {
  const { pts: p } = body, m = measures(body), { sw, T, L, headH } = m, bf = body.build || 1;
  const gy = Math.max(p.anL[1], p.anR[1]) + 0.04 * L, cx = m.sm[0];
  const V = (x, y, z = 0) => new THREE.Vector3(x - cx, gy - y, z);
  const skinM = new THREE.MeshStandardMaterial({ color: skin, roughness: .75, metalness: 0, side: THREE.DoubleSide });
  const hairM = new THREE.MeshStandardMaterial({ color: hair, roughness: .6 });
  const g = new THREE.Group();

  // torso: shoulders -> chest -> waist -> hips -> crotch (elliptical sections)
  const shY = m.sm[1], hipY = m.hm[1], waistY = hipY - 0.3 * T;
  const sec = (y, a, d) => ({ y: gy - y, a: a * bf, d: d * bf });
  g.add(new THREE.Mesh(loft([
    sec(shY - 0.07 * T, 0.16 * sw, 0.12 * sw), sec(shY + 0.0 * T, 0.5 * sw, 0.15 * sw), sec(shY + 0.22 * T, 0.45 * sw, 0.19 * sw),
    sec(waistY, 0.33 * sw, 0.15 * sw), sec(hipY - 0.05 * T, 0.43 * sw, 0.19 * sw), sec(hipY + 0.1 * T, 0.46 * sw, 0.2 * sw), sec(hipY + 0.2 * T, 0.38 * sw, 0.17 * sw),
  ]), skinM));

  // neck + head + hair
  const hc = V(p.headTop[0], p.headTop[1] + headH / 2);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * sw + headH * 0.04, 0.09 * sw + headH * 0.04, headH * 0.7, 16), skinM);
  neck.position.set(hc.x, hc.y - headH * 0.55, 0); g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(headH / 2, 32, 24), skinM);
  head.scale.set(0.8, 1.04, 0.86); head.position.copy(hc); g.add(head);
  // hair: a cap over the crown + style-specific back/top pieces
  const sph = (r, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), hairM); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  const capScale = style === 'curly' ? 1.18 : 1;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(headH / 2, 36, 20, 0, Math.PI * 2, 0, Math.PI * (style === 'pixie' ? 0.45 : 0.48)), hairM);
  cap.scale.set(0.84 * capScale, 1.1 * capScale, 0.92); cap.position.set(hc.x, hc.y + headH * 0.02, -headH * 0.02); cap.rotation.x = 0.12; g.add(cap);
  if (style !== 'pixie') sph(headH / 2, 0.77, 1.0, 0.78, hc.x, hc.y + headH * 0.03, -headH * 0.17);
  const tube = (rTop, rBot, len, x, y, z, sz = 0.7) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 24, 1, true), hairM); o.position.set(x, y, z); o.scale.z = sz; g.add(o); return o; };
  if (style === 'long') tube(headH * 0.36, headH * 0.3, headH * 1.1, hc.x, hc.y - headH * 0.5, -headH * 0.2);
  if (style === 'bob') tube(headH * 0.37, headH * 0.4, headH * 0.55, hc.x, hc.y - headH * 0.28, -headH * 0.12, 0.85);
  if (style === 'bun') sph(headH * 0.2, 1, 1, 1, hc.x, hc.y + headH * 0.58, -headH * 0.1);
  if (style === 'pony') { const t = tube(headH * 0.12, headH * 0.04, headH * 1.1, hc.x, hc.y - headH * 0.35, -headH * 0.55, 1); t.rotation.x = -0.25; }
  if (style === 'curly') for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; sph(headH * 0.2, 1, 1, 1, hc.x + Math.cos(a) * headH * 0.4, hc.y + Math.sin(a) * headH * 0.42 + headH * 0.05, -headH * 0.12); }
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), pupil = new THREE.MeshBasicMaterial({ color: face.eyes || '#2b1d17' });
  for (const sd of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.05, 14, 10), white); w.scale.set(1.25, 0.85, 0.5); w.position.set(hc.x + sd * headH * 0.15, hc.y - headH * 0.08, headH * 0.4); g.add(w);
    const e = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.028, 12, 8), pupil); e.position.set(hc.x + sd * headH * 0.15, hc.y - headH * 0.08, headH * 0.43); g.add(e);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.03, 10, 8), new THREE.MeshBasicMaterial({ color: face.lips || '#c4505f' }));
  mouth.scale.set(2.2, .7, .6); mouth.position.set(hc.x, hc.y - headH * 0.27, headH * 0.42); g.add(mouth);

  // arms + hands
  for (const [s, w, side] of [[p.shL, p.wrL, -1], [p.shR, p.wrR, 1]]) {
    const sh = V(s[0] - side * 0.02 * sw, s[1] + 0.05 * T), wr = V(w[0], w[1]);
    const el = V((s[0] + w[0]) / 2 + side * sw * 0.07, (s[1] + w[1]) / 2);
    g.add(limb(sh, el, 0.125 * sw * bf, 0.1 * sw * bf, skinM), limb(el, wr, 0.1 * sw * bf, 0.07 * sw * bf, skinM));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085 * sw, 14, 10), skinM);
    hand.scale.set(0.8, 1.35, 0.6); hand.position.set(wr.x, wr.y - 0.09 * sw, 0); g.add(hand);
  }
  // legs + feet
  for (const [h, k, a] of [[p.hipL, p.knL, p.anL], [p.hipR, p.knR, p.anR]]) {
    const hp = V(h[0], h[1] + 0.04 * T), kn = V(k[0], k[1]), an = V(a[0], a[1]);
    g.add(limb(hp, kn, 0.25 * sw * bf, 0.155 * sw * bf, skinM), limb(kn, an, 0.155 * sw * bf, 0.09 * sw * bf, skinM));
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.1 * sw, 14, 10), skinM);
    foot.scale.set(0.85, 0.5, 2.1); foot.position.set(an.x, an.y - 0.02 * L, 0.1 * sw); g.add(foot);
  }

  const skinMeshes = []; // what clothes are fitted around (not hair or the head)
  g.traverse((o) => { if (o.isMesh && o.material === skinM && o !== head && o !== neck) skinMeshes.push(o); });
  const top = gy - p.headTop[1], halfW = Math.max(sw * 1.6, Math.abs(p.wrR[0] - cx) + sw * 0.7);
  return { group: g, ctx: { cx, gy, H: top * 1.08, halfW, m, body, skinMeshes } };
}

/* ───────── garments ───────── */
/** Per-photo "mask": which cells are garment, and how far each is from the outline (in cells). Cached with the texture. */
function maskGrid(e) {
  if (e.grid) return e.grid;
  const iw = e.tex.image.width, ih = e.tex.image.height, G = 128;
  const nx = Math.max(8, Math.round(iw >= ih ? G : (G * iw) / ih)), ny = Math.max(8, Math.round(ih >= iw ? G : (G * ih) / iw));
  const c = document.createElement('canvas'); c.width = nx; c.height = ny;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(e.tex.image, 0, 0, nx, ny);
  // any visible pixel counts as garment, so the mesh always covers the cutout (the texture's alpha makes the crisp outline)
  const px = x.getImageData(0, 0, nx, ny).data, inside = new Uint8Array(nx * ny), dist = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) { inside[i] = px[i * 4 + 3] > 8 ? 1 : 0; dist[i] = inside[i] ? 1e9 : 0; }
  const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= nx || yy >= ny ? 0 : dist[yy * nx + xx]); // outside the picture counts as outside the garment
  for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) { const i = yy * nx + xx; if (dist[i]) dist[i] = Math.min(dist[i], at(xx - 1, yy) + 1, at(xx, yy - 1) + 1, at(xx - 1, yy - 1) + 1.414, at(xx + 1, yy - 1) + 1.414); }
  for (let yy = ny - 1; yy >= 0; yy--) for (let xx = nx - 1; xx >= 0; xx--) { const i = yy * nx + xx; if (dist[i]) dist[i] = Math.min(dist[i], at(xx + 1, yy) + 1, at(xx, yy + 1) + 1, at(xx + 1, yy + 1) + 1.414, at(xx - 1, yy + 1) + 1.414); }
  return (e.grid = { nx, ny, dist, inside });
}

/**
 * Inflate a garment's outline into a rounded 3D volume: thickness grows with distance from the edge (so thin parts like straps,
 * sleeves and pant legs are slim, big panels are full) and rolls off smoothly at the outline. Returns a front and a back surface.
 * rect = {cx, top, w, h} in world units; hMax = half-thickness; zc = depth of the centre plane.
 */
function inflate(grid, rect, hMax, zc, flipBack = false, fit = null) {
  const { nx, ny, dist, inside } = grid, cw = rect.w / nx, ch = rect.h / ny, cell = (cw + ch) / 2, N = nx * ny;
  // Fallback shape (loose fabric, bags, accessories): thickness grows with distance from the edge, rolling off at the outline.
  const height = new Float32Array(N);
  for (let i = 0; i < N; i++) if (inside[i]) { const t = Math.min(1, (dist[i] * cell) / (0.8 * hMax)); height[i] = hMax * (0.04 + 0.96 * Math.sqrt(1 - (1 - t) * (1 - t))); }
  // Depth of the front and back surfaces. Where the garment sits on the body they hug it (body surface + a little ease), so skin
  // can't poke through; elsewhere they fall back to the inflated shape and everything is smoothed so there are no steps.
  const zf = new Float32Array(N), zb = new Float32Array(N);
  const ease = 0.16 * hMax;
  for (let i = 0; i < N; i++) {
    if (!inside[i]) continue;
    const h = fit?.hit[i];
    zf[i] = h ? fit.zf[i] + ease : zc + height[i] * 0.6; zb[i] = h ? fit.zb[i] - ease : zc - height[i] * 0.6;
  }
  if (fit) for (let pass = 0; pass < 3; pass++) for (const arr of [zf, zb]) {
    const src = arr.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!inside[k]) continue;
      let sum = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= nx || y >= ny) continue; const q = y * nx + x; if (inside[q]) { sum += src[q]; n++; } }
      arr[k] = sum / n;
    }
  }
  for (let i = 0; i < N; i++) if (inside[i] && fit?.hit[i]) { zf[i] = Math.max(zf[i], fit.zf[i] + ease); zb[i] = Math.min(zb[i], fit.zb[i] - ease); }
  const build = (sign) => {
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), idx = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos.set([rect.cx - rect.w / 2 + (i + 0.5) * cw, rect.top - (j + 0.5) * ch, sign > 0 ? zf[k] : zb[k]], k * 3);
      uv.set([sign < 0 && flipBack ? 1 - (i + 0.5) / nx : (i + 0.5) / nx, 1 - (j + 0.5) / ny], k * 2);
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (!(inside[a] || inside[b] || inside[c] || inside[d])) continue;
      if (sign > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  // side walls along the outline (and around holes) so a turned garment is a closed volume, not two floating sheets
  const wall = (() => {
    const pos = new Float32Array(N * 6), uv = new Float32Array(N * 4), idx = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = rect.cx - rect.w / 2 + (i + 0.5) * cw, y = rect.top - (j + 0.5) * ch, u = (i + 0.5) / nx, v = 1 - (j + 0.5) / ny;
      pos.set([x, y, zf[k]], k * 3); pos.set([x, y, zb[k]], (N + k) * 3);
      uv.set([u, v], k * 2); uv.set([u, v], (N + k) * 2);
    }
    const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? false : inside[j * nx + i]);
    const quad = (a, b) => idx.push(a, b, N + a, b, N + b, N + a); // front edge a-b down to the back edge
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      const k = j * nx + i;
      if (at(i + 1, j)) { if (!at(i, j - 1) || !at(i + 1, j - 1)) quad(k, k + 1); if (!at(i, j + 1) || !at(i + 1, j + 1)) quad(k, k + 1); }
      if (at(i, j + 1)) { if (!at(i - 1, j) || !at(i - 1, j + 1)) quad(k, k + nx); if (!at(i + 1, j) || !at(i + 1, j + 1)) quad(k, k + nx); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  })();
  return [build(1), build(-1), wall];
}

function getTexture(url) {
  let e = S.textures.get(url);
  if (!e) {
    e = { tex: null, ready: false };
    e.tex = new THREE.TextureLoader().load(url, () => { e.ready = true; buildGarments(); });
    e.tex.colorSpace = THREE.SRGBColorSpace; e.tex.anisotropy = 4;
    S.textures.set(url, e);
  }
  return e;
}

// A real back photo, fitted onto a silhouette of the front in the garment's colour so any gaps in the back cutout stay filled.
function backTexture(front, backUrl, hex) {
  const key = `${backUrl}|${hex}`;
  let e = S.textures.get(key);
  if (e) return e;
  e = { tex: null, ready: false };
  S.textures.set(key, e);
  const img = new Image();
  img.onload = () => {
    const w = front.tex.image.width, h = front.tex.image.height, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(front.tex.image, 0, 0, w, h); g.globalCompositeOperation = 'source-in'; g.fillStyle = hex || '#888'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    const f = Math.min(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * f, dh = img.naturalHeight * f;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    e.tex = new THREE.CanvasTexture(c); e.tex.colorSpace = THREE.SRGBColorSpace; e.tex.anisotropy = 4; e.ready = true; buildGarments();
  };
  img.src = backUrl;
  return e;
}

/** Shoot rays front-to-back through the body at every garment cell: where they hit, the garment can wrap the body. */
function bodyFit(grid, rect) {
  const { nx, ny, inside } = grid, cw = rect.w / nx, ch = rect.h / ny, N = nx * ny;
  const hit = new Uint8Array(N), zf = new Float32Array(N), zb = new Float32Array(N);
  const turned = S.figure.rotation.y; S.figure.rotation.y = 0; S.figure.updateMatrixWorld(true); // probe the body facing front
  const rc = new THREE.Raycaster(), from = new THREE.Vector3(), dir = new THREE.Vector3(0, 0, -1), far = S.ctx.H * 4;
  rc.far = far * 2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!inside[k]) continue;
    rc.set(from.set(rect.cx - rect.w / 2 + (i + 0.5) * cw, rect.top - (j + 0.5) * ch, far), dir);
    const h = rc.intersectObjects(S.ctx.skinMeshes, false);
    if (h.length) { hit[k] = 1; zf[k] = far - h[0].distance; zb[k] = far - h[h.length - 1].distance; }
  }
  S.figure.rotation.y = turned; S.figure.updateMatrixWorld(true);
  return { hit, zf, zb };
}

const FITS = new Set(['tops', 'tanks', 'bodysuits', 'outerwear', 'dresses', 'bottoms', 'skirts', 'shoes']);

function buildGarments() {
  if (!S?.ctx || !S.outfit) return;
  S.shells.forEach((g) => { S.figure.remove(g); g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); });
  S.shells = [];
  const { cx, gy, m, body } = S.ctx, k = body.H / 640;
  for (const it of Object.values(S.outfit.items)) {
    const e = getTexture(S.outfit.urls.get(it.id) || '');
    if (!e.ready) continue;
    const box = place(it.type, body), a = it.adj || { scale: 1, dx: 0, dy: 0 };
    const iw = e.tex.image.width, ih = e.tex.image.height;
    const fit = Math.min(box.w / iw, box.h / ih), dw = iw * fit, dh = ih * fit;
    const iy = box.align === 'xMidYMin' ? box.y : box.align === 'xMidYMax' ? box.y + box.h - dh : box.y + (box.h - dh) / 2;
    const bcx = box.x + box.w / 2, bcy = box.y + box.h / 2;
    const gcx = bcx + a.dx * k + (box.x + (box.w - dw) / 2 + dw / 2 - bcx) * a.scale;
    const gcy = bcy + a.dy * k + (iy + dh / 2 - bcy) * a.scale;
    const W = dw * a.scale, H = dh * a.scale;
    const sw = m.sw * (body.build || 1);
    const zc = it.type === 'bags' ? 0.2 * m.sw : it.type === 'accessories' ? m.headH * 0.42 : it.type === 'shoes' ? 0.15 * m.sw : 0;
    const backUrl = S.outfit.urls.get(it.id + ':back'), be = backUrl ? backTexture(e, backUrl, it.color?.hex) : null;
    const backTex = be?.ready ? be.tex : null;
    const grid = maskGrid(e), rect = { cx: gcx - cx, top: gy - (gcy - H / 2), w: W, h: H };
    const [front, back, wall] = inflate(grid, rect, (HMAX[it.type] || 0.24) * sw, zc, !!backTex, FITS.has(it.type) ? bodyFit(grid, rect) : null);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(front, new THREE.MeshLambertMaterial({ map: e.tex, alphaTest: 0.5, alphaToCoverage: true })));
    group.add(new THREE.Mesh(back, new THREE.MeshLambertMaterial({ map: backTex || e.tex, alphaTest: 0.5, alphaToCoverage: true, color: backTex ? 0xffffff : 0xd9d9d9 }))); // no back photo: the front photo, a little darker
    group.add(new THREE.Mesh(wall, new THREE.MeshLambertMaterial({ color: new THREE.Color(it.color?.hex || '#888888').multiplyScalar(0.8), side: THREE.DoubleSide }))); // solid fabric edge: always visible, never clipped by the photo's soft outline
    if (box.rot) group.rotation.z = -box.rot * 0.6; // follow the shoulder tilt a little
    group.userData.slot = it.type;
    S.figure.add(group); S.shells.push(group);
  }
  request();
}

/* ───────── public API ───────── */
export const stage3d = {
  get usable() { return webgl && !failed; },

  attach(el) {
    const s = ensure();
    s.el = el; el.append(s.renderer.domElement);
    s.ro?.disconnect(); s.ro = new ResizeObserver(resize); s.ro.observe(el);
    resize();
  },

  setModel({ body, skin, hair, hairStyle = 'long', face = {} }) {
    const s = ensure(), key = JSON.stringify([body.W, body.H, body.pts, body.build, skin, hair, hairStyle, face]);
    if (key === s.bodyKey) return;
    s.bodyKey = key;
    s.figure.children.slice().forEach((c) => { s.figure.remove(c); dispose(c); });
    s.shells = [];
    const built = buildBody(body, skin, hair, hairStyle, face);
    s.figure.add(built.group); s.ctx = built.ctx;
    if (s.shadow) { s.scene.remove(s.shadow); s.shadow.geometry.dispose(); s.shadow.material.dispose(); }
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    s.shadow = new THREE.Mesh(new THREE.PlaneGeometry(built.ctx.m.sw * 3, built.ctx.m.sw * 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    s.shadow.rotation.x = -Math.PI / 2; s.shadow.position.y = 0.5; s.scene.add(s.shadow);
    frame(); buildGarments(); request();
  },

  /** @param {Record<string,object>} items slot -> item   @param {Map<string,string>} urls item.id -> image URL */
  setOutfit(items, urls) { ensure().outfit = { items, urls }; buildGarments(); },

  /** dir: -1 / +1 turn 45°, 0 face front */
  turn(dir) {
    const s = ensure();
    s.target = dir === 0 ? Math.round(s.target / (Math.PI * 2)) * Math.PI * 2 : s.target + dir * Math.PI / 4;
    request();
  },

  /** The current frame as a canvas (for look cards), or null. */
  snapshot() {
    if (!S) return null;
    const { rot, target } = S, front = Math.round(target / (Math.PI * 2)) * Math.PI * 2;
    S.figure.rotation.y = front; S.renderer.render(S.scene, S.camera); // always facing the camera, whatever angle you're viewing at
    const src = S.renderer.domElement, copy = document.createElement('canvas');
    copy.width = src.width; copy.height = src.height; copy.getContext('2d').drawImage(src, 0, 0);
    S.figure.rotation.y = rot; S.rot = rot; S.target = target; request();
    return copy;
  },

  setLabel(text) { ensure().renderer.domElement.setAttribute('aria-label', text); },
  setRole() { const c = ensure().renderer.domElement; c.setAttribute('role', 'img'); },
  debug() { return S && { garments: S.shells.length, types: S.shells.map((g) => g.userData.slot), depths: S.shells.map((g) => { const b = new THREE.Box3().setFromObject(g); return Math.round(b.max.z - b.min.z); }), backPhoto: S.shells.map((g) => !!g.children[1]?.material.map?.isCanvasTexture), rot: S.target, canvas: [S.renderer.domElement.width, S.renderer.domElement.height] }; },
};
