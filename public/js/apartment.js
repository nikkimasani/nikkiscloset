// The 3D apartment: a cosy studio you walk around as a little rigged avatar. Walk up to a station (wardrobe, vanity, mirror, bed, desk)
// and its screen opens. Third-person follow camera with collision, real low-poly furniture (KayKit, CC0), real soft shadows.
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { configureRenderer, studioEnvironment, tier, FrameWatch } from './gfx.js';
import { Mirror } from './mirror.js';
import { loadAvatar } from './avatar.js';
import { webglOK } from './webgl.js';

const SRGB = THREE.SRGBColorSpace;
export const ROOM = { x0: -7, x1: 7, z0: -6, z1: 5.5, h: 3.4 };
const AV_R = 0.42;      // how close the avatar's centre may get to furniture
const CAM_R = 0.3;      // clearance the camera keeps from furniture and walls (less than AV_R, so the avatar itself is never inside it)
const CELL = 0.35;      // walking-grid size for finding a way round furniture

/** Where each station stands and where you stand to use it. Faces: the way the avatar looks when it arrives. */
const LAYOUT = {
  wardrobe: { x: -3.0, z: -5.0, padX: -3.0, padZ: -3.3, color: '#ff7aa8' },
  vanity: { x: 1.8, z: -5.3, padX: 1.8, padZ: -3.4, color: '#c76bff' },
  mirror: { x: -6.5, z: -0.5, padX: -4.7, padZ: -0.5, color: '#5aa9ff' },
  bed: { x: 5.3, z: -4.3, padX: 5.3, padZ: -2.1, color: '#ff9a6b' },
  desk: { x: 5.5, z: 3.3, padX: 5.5, padZ: 1.5, color: '#2fb892' },
};

/** [model, x, z, rotationY, scale, extra]. solid:false = you can walk over it (rugs). */
const PROPS = [
  ['rug_oval_A', 0, 0.6, 0, 1.5, { solid: false }],
  ['couch_pillows', -5.75, 2.4, Math.PI / 2, 1, {}],
  ['table_low', -3.7, 2.4, Math.PI / 2, 0.75, {}],
  ['armchair_pillows', -3.6, 0.2, -Math.PI * 0.35, 0.8, {}],
  ['cabinet_medium_decorated', -5.9, -5.45, 0, 1, {}],
  ['shelf_B_large_decorated', -0.3, -5.75, 0, 1, { wall: true }],
  ['pictureframe_large_B', -3.0, -5.9, 0, 1, { y: 1.9, solid: false }],
  ['pictureframe_medium', 3.9, -5.9, 0, 1, { y: 2.0, solid: false }],
  ['pictureframe_small_A', -1.2, -5.9, 0, 1, { y: 2.2, solid: false }],
  ['table_small', 1.8, -5.3, 0, 1, {}],
  ['chair_stool', 1.8, -4.2, Math.PI, 0.9, { solid: false }],
  ['lamp_table', 1.1, -5.3, 0, 0.6, { y: 1.0, solid: false }],
  ['bed_double_A', 5.3, -4.3, 0, 1, {}],
  ['table_medium', 6.0, 3.3, Math.PI / 2, 0.9, {}],
  ['chair_A', 4.2, 3.3, Math.PI / 2, 0.95, { solid: false }],
  ['lamp_table', 6.2, 4.0, 0, 0.7, { y: 0.9, solid: false }],
  ['book_set', 5.6, 2.6, 0.4, 0.8, { y: 0.9, solid: false }],
  ['lamp_standing', -6.4, 4.7, 0, 0.9, {}],
  ['lamp_standing', 6.3, -0.4, 0, 0.9, {}],
  ['cactus_medium_A', -4.2, 4.8, 0, 1, {}],
  ['cactus_small_A', 6.3, 4.9, 0, 1, {}],
];

const canvasTex = (w, h, draw, repeat) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
};
const blobTex = (() => { let t; return () => (t ||= canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(70,20,50,.55)'); gr.addColorStop(1, 'rgba(70,20,50,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); })); })();

const gltfLoader = new GLTFLoader(), models = new Map();
const model = (name) => (models.has(name) ? models.get(name) : (models.set(name, gltfLoader.loadAsync(`/assets/furniture/${name}.gltf`)), models.get(name)));

let A = null; // the running apartment (null when not on screen)
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ───────── building the room ───────── */
/** The colours of each room (the ids match the shop's room:… items). */
const THEMES = {
  rose: { floor: ['#eab7bf', '#e6aeb8', '#efc0c6', '#e3a9b4'], plank: '#b3586b55', wall: ['#ffe6ef', '#ffd3e3'], trim: 0xd2557f, bg: 0xffd9e8 },
  sage: { floor: ['#d3dcc2', '#c9d4b6', '#d9e2cb', '#c1ceae'], plank: '#5f7a4a55', wall: ['#eef6e8', '#d9ebd0'], trim: 0x5f8a5a, bg: 0xdcefd6 },
  lilac: { floor: ['#d9cbe8', '#d1c1e2', '#e0d4ee', '#cbb9dd'], plank: '#6a4a9a55', wall: ['#f3ecfb', '#e3d6f4'], trim: 0x8f62c9, bg: 0xe8dcf7 },
  dusk: { floor: ['#6b5a8e', '#645386', '#725f96', '#5d4d80'], plank: '#1c143055', wall: ['#4a3d6e', '#41355f'], trim: 0xffb36b, bg: 0x2f2549 },
};
const themeOf = (id) => THEMES[id] || THEMES.rose;
const floorTexFor = (t) => canvasTex(256, 256, (c, w, hh) => { // planks
  for (let i = 0; i < 8; i++) { c.fillStyle = t.floor[i % 4]; c.fillRect(0, (i * hh) / 8, w, hh / 8); c.fillStyle = t.plank; c.fillRect(0, (i * hh) / 8, w, 2); for (let k = 0; k < 6; k++) { c.fillStyle = '#ffffff1c'; c.fillRect(Math.random() * w, (i * hh) / 8 + 4, 20 + Math.random() * 50, 1.5); } }
}, [(ROOM.x1 - ROOM.x0) / 3, (ROOM.z1 - ROOM.z0) / 3]);
const wallTexFor = (t) => canvasTex(128, 128, (c, w, hh) => { c.fillStyle = t.wall[0]; c.fillRect(0, 0, w, hh); c.fillStyle = t.wall[1]; for (let i = 0; i < 4; i++) c.fillRect((i * w) / 4, 0, w / 8, hh); }, [(ROOM.x1 - ROOM.x0) / 2, 1]);

function buildRoom(themeId = 'rose') {
  const th = themeOf(themeId), g = new THREE.Group(), { x0, x1, z0, z1, h } = ROOM, W = x1 - x0, D = z1 - z0;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTexFor(th), roughness: 0.75, envMapIntensity: 0.3 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); floor.receiveShadow = true; g.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexFor(th), roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, h), wallMat); back.position.set(0, h / 2, z0); back.receiveShadow = true; g.add(back);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(D, h), wallMat); w.rotation.y = -sx * Math.PI / 2; w.position.set(sx > 0 ? x1 : x0, h / 2, (z0 + z1) / 2); w.receiveShadow = true; g.add(w); }
  const trim = new THREE.MeshStandardMaterial({ color: th.trim, roughness: 0.6 }), crown = new THREE.MeshStandardMaterial({ color: 0xfff7fa, roughness: 0.7 });
  const bar = (w, hh, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); m.position.set(x, y, z); m.receiveShadow = true; g.add(m); };
  bar(W, 0.3, 0.12, trim, 0, 0.15, z0 + 0.06); bar(0.12, 0.3, D, trim, x0 + 0.06, 0.15, (z0 + z1) / 2); bar(0.12, 0.3, D, trim, x1 - 0.06, 0.15, (z0 + z1) / 2); // darker skirting boards
  bar(W, 0.18, 0.14, crown, 0, h - 0.09, z0 + 0.07); bar(0.14, 0.18, D, crown, x0 + 0.07, h - 0.09, (z0 + z1) / 2); bar(0.14, 0.18, D, crown, x1 - 0.07, h - 0.09, (z0 + z1) / 2);
  // a window with a bit of sky on the right wall, and soft light panels
  const sky = canvasTex(32, 128, (c, w, hh) => { const gr = c.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, '#8fd3ff'); gr.addColorStop(1, '#f2fbff'); c.fillStyle = gr; c.fillRect(0, 0, w, hh); });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.7), new THREE.MeshBasicMaterial({ map: sky })); win.rotation.y = -Math.PI / 2; win.position.set(x1 - 0.02, 1.9, 0.6); g.add(win);
  for (const [y, hh, w, d] of [[1.9, 0.1, 0.12, 2.6], [2.75, 0.1, 0.12, 2.6], [1.05, 0.1, 0.12, 2.6]]) bar(w, hh, d, crown, x1 - 0.08, y, 0.6);
  bar(0.12, 1.8, 0.1, crown, x1 - 0.08, 1.9, 0.6); bar(0.12, 1.8, 0.1, crown, x1 - 0.08, 1.9, -0.65); bar(0.12, 1.8, 0.1, crown, x1 - 0.08, 1.9, 1.85);
  // neon sign above the bed, over the back wall
  const neon = canvasTex(512, 128, (c, w, hh) => { c.shadowColor = '#ff3d9a'; c.shadowBlur = 24; c.fillStyle = '#ffe1ee'; c.font = '800 70px "Brush Script MT","Segoe Script",cursive,system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText("Nikki's Closet", w / 2, hh / 2); c.fillText("Nikki's Closet", w / 2, hh / 2); });
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: neon, transparent: true, depthWrite: false })); sg.position.set(5.3, 2.6, z0 + 0.03); g.add(sg);
  g.userData.mats = { floor: floor.material, wall: wallMat, trim };
  return g;
}

/** A glowing circle on the floor with a bouncing icon above it. */
function stationMarker(st) {
  const g = new THREE.Group(), color = new THREE.Color(st.color);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.88, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  disk.rotation.x = ring.rotation.x = -Math.PI / 2; disk.position.y = 0.02; ring.position.y = 0.025; g.add(disk, ring);
  const tex = canvasTex(128, 128, (c, w) => { c.fillStyle = st.color; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); c.fill(); c.lineWidth = 8; c.strokeStyle = '#fff'; c.stroke(); c.font = '64px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(st.emoji, w / 2, w / 2 + 6); });
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); icon.scale.set(0.95, 0.95, 1); icon.position.y = 2.7; g.add(icon);
  g.userData = { disk, ring, icon };
  return g;
}

function clothesRack(thumbs) {
  const g = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0xf6e3b0, metalness: 0.85, roughness: 0.3 });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 12), metal); rail.rotation.z = Math.PI / 2; rail.position.y = 1.85; rail.castShadow = true; g.add(rail);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 10), metal); post.position.set(sx * 1.1, 0.95, 0); post.castShadow = true; g.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.9), metal); foot.position.set(sx * 1.1, 0.03, 0); foot.castShadow = true; g.add(foot);
  }
  const loader = new THREE.TextureLoader(), n = Math.min(6, thumbs.length);
  thumbs.slice(0, 6).forEach((u, i) => {
    const t = loader.load(u); t.colorSpace = SRGB;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.86), new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }));
    m.position.set(-0.95 + (1.9 / Math.max(n, 1)) * (i + 0.5), 1.28, 0); m.rotation.y = (i % 2 ? 1 : -1) * 0.12; m.castShadow = true; g.add(m);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 14, Math.PI * 1.6), metal); hook.position.set(m.position.x, 1.78, 0); g.add(hook);
  });
  return g;
}

function standingMirror(real) {
  const g = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: 0xe8c25a, metalness: 0.85, roughness: 0.3 });
  const W = 1.2, H = 2.3;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.16, H + 0.16, 0.08), gold); frame.position.set(0, H / 2 + 0.25, -0.05); frame.castShadow = true; g.add(frame);
  let glass;
  if (real) glass = new Mirror(new THREE.PlaneGeometry(W, H), { size: tier().reflect, color: 0xfff0f6 });
  else glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0xdff1ff, metalness: 0.9, roughness: 0.15 }));
  glass.position.set(0, H / 2 + 0.25, -0.005); g.add(glass);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.55), gold); leg.position.set(sx * 0.5, 0.3, -0.25); leg.rotation.x = -0.5; g.add(leg); }
  return { group: g, mirror: real ? glass : null };
}

function vanityMirror() {
  const g = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: 0xe8c25a, metalness: 0.85, roughness: 0.3 });
  const frame = new THREE.Mesh(new THREE.CircleGeometry(0.72, 40), gold); frame.scale.y = 1.35; frame.position.set(0, 2.15, 0);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), new THREE.MeshStandardMaterial({ color: 0xe9f5ff, metalness: 0.9, roughness: 0.12, emissive: 0x6fa0d0, emissiveIntensity: 0.12 })); glass.scale.y = 1.35; glass.position.set(0, 2.15, 0.01);
  g.add(frame, glass);
  return g;
}

/* ───────── collision ───────── */
function solidsFrom(group, list) {
  group.updateWorldMatrix(true, true);
  const b = new THREE.Box3().setFromObject(group); if (b.isEmpty()) return;
  list.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y0: b.min.y, y1: b.max.y });
}
/** Slide a point out of any furniture rectangle (circle radius r). */
function pushOut(p, r) {
  for (const s of A.solids) {
    if (s.y0 > 1.6) continue; // things up on the walls don't block your feet
    const x0 = s.x0 - r, x1 = s.x1 + r, z0 = s.z0 - r, z1 = s.z1 + r;
    if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
      const l = p.x - x0, rr = x1 - p.x, t = p.z - z0, b = z1 - p.z, m = Math.min(l, rr, t, b);
      if (m === l) p.x = x0; else if (m === rr) p.x = x1; else if (m === t) p.z = z0; else p.z = z1;
    }
  }
  p.x = Math.max(ROOM.x0 + r, Math.min(ROOM.x1 - r, p.x)); p.z = Math.max(ROOM.z0 + r, Math.min(ROOM.z1 - r, p.z));
}
/** Distance along a ray (origin o, unit direction d) to the first thing it would hit, up to maxT. Walls and furniture, grown by `margin`. */
function rayHit(o, d, maxT, margin) {
  let best = maxT;
  const test = (x0, x1, y0, y1, z0, z1) => {
    let tmin = 0, tmax = best;
    for (const [oo, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
      if (Math.abs(dd) < 1e-6) { if (oo < lo || oo > hi) return; continue; }
      let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return;
    }
    if (tmin < best) best = tmin;
  };
  for (const s of A.solids) test(s.x0 - margin, s.x1 + margin, Math.max(0, s.y0 - margin), s.y1 + margin, s.z0 - margin, s.z1 + margin);
  const { x0, x1, z0, h } = ROOM; // the three walls and the ceiling are thick slabs just outside the room, the floor a slab below it
  test(x0 - 9, x0 + margin, -2, h + 9, -20, 30); test(x1 - margin, x1 + 9, -2, h + 9, -20, 30); test(-30, 30, -2, h + 9, z0 - 9, z0 + margin);
  test(-30, 30, -9, margin, -20, 30); // (the room is open at the top, so nothing stops the camera rising)
  return best;
}

/* ───────── finding a way round furniture ───────── */
function gridOf() {
  const nx = Math.ceil((ROOM.x1 - ROOM.x0) / CELL), nz = Math.ceil((ROOM.z1 - ROOM.z0) / CELL), blocked = new Uint8Array(nx * nz), p = new THREE.Vector3();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { p.set(ROOM.x0 + (i + 0.5) * CELL, 0, ROOM.z0 + (j + 0.5) * CELL); const q = p.clone(); pushOut(q, AV_R); if (Math.hypot(q.x - p.x, q.z - p.z) > 0.01) blocked[j * nx + i] = 1; }
  return { nx, nz, blocked };
}
function findPath(from, to) {
  const { nx, nz, blocked } = A.grid, cell = (x, z) => [Math.max(0, Math.min(nx - 1, Math.floor((x - ROOM.x0) / CELL))), Math.max(0, Math.min(nz - 1, Math.floor((z - ROOM.z0) / CELL)))];
  const centre = (i, j) => new THREE.Vector3(ROOM.x0 + (i + 0.5) * CELL, 0, ROOM.z0 + (j + 0.5) * CELL);
  let [si, sj] = cell(from.x, from.z); let [ti, tj] = cell(to.x, to.z);
  if (blocked[tj * nx + ti]) { let best = null, bd = 1e9; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!blocked[j * nx + i]) { const d = Math.hypot(i - ti, j - tj); if (d < bd) { bd = d; best = [i, j]; } } if (!best) return [to]; [ti, tj] = best; }
  const prev = new Int32Array(nx * nz).fill(-1), dist = new Float32Array(nx * nz).fill(1e9), open = [[0, sj * nx + si]]; dist[sj * nx + si] = 0;
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); const [, cur] = open.shift(), ci = cur % nx, cj = (cur / nx) | 0;
    if (ci === ti && cj === tj) break;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= nz || blocked[j * nx + i]) continue;
      if (di && dj && (blocked[cj * nx + i] || blocked[j * nx + ci])) continue; // no squeezing diagonally past a corner
      const nd = dist[cur] + Math.hypot(di, dj); if (nd < dist[j * nx + i]) { dist[j * nx + i] = nd; prev[j * nx + i] = cur; open.push([nd + Math.hypot(ti - i, tj - j), j * nx + i]); }
    }
  }
  const cells = []; for (let c = tj * nx + ti; c >= 0 && c !== sj * nx + si; c = prev[c]) cells.push(c);
  const pts = cells.reverse().map((c) => centre(c % nx, (c / nx) | 0));
  const clear = (a, b) => { const n = Math.ceil(a.distanceTo(b) / (CELL * 0.5)); for (let k = 1; k < n; k++) { const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n, [i, j] = cell(x, z); if (blocked[j * nx + i]) return false; } return true; };
  const out = []; let cur = from.clone();
  for (let k = 0; k < pts.length; k++) { if (k + 1 < pts.length && clear(cur, pts[k + 1])) continue; out.push(pts[k]); cur = pts[k]; }
  const last = to.clone(); pushOut(last, AV_R); out.push(last);
  return out;
}

/* ───────── the loop ───────── */
const tmpDir = new THREE.Vector3(), tmpO = new THREE.Vector3(), tmpTarget = new THREE.Vector3(), tmpWant = new THREE.Vector3();
const KEYS = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };

function tick(now) {
  const a = A; if (!a) return;
  a.raf = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - a.last) / 1000); a.last = now; a.t += dt; a.watch.tick(now);
  // ── input → a walking direction relative to the camera ──
  const k = a.keys; let ix = a.move.x + ((k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)), iy = a.move.y + ((k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0));
  if (a.paused) { ix = iy = 0; }
  const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
  const s = Math.sin(a.yaw), c = Math.cos(a.yaw);
  let vx = 0, vz = 0;
  if (il > 0.12) { a.path = null; vx = ix * c - iy * s; vz = -ix * s - iy * c; }
  else if (a.path?.length && !a.paused) {
    const p = a.path[0], dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { a.path.shift(); if (!a.path.length) a.path = null; } else { vx = dx / d; vz = dz / d; }
  }
  const want = Math.hypot(vx, vz) > 0.02 ? Math.min(1, Math.hypot(vx, vz)) : 0;
  a.speed += (want - a.speed) * (1 - Math.exp(-dt * 9));
  if (want) { a.dirx = vx / Math.hypot(vx, vz); a.dirz = vz / Math.hypot(vx, vz); }
  if (a.speed > 0.04) {
    const step = 3.1 * a.speed * dt;
    a.pos.x += a.dirx * step; a.pos.z += a.dirz * step; pushOut(a.pos, AV_R);
    a.face += wrapPi(Math.atan2(a.dirx, a.dirz) - a.face) * Math.min(1, dt * 11);
  }
  if (a.key.dir) { a.yawGoal += a.key.dir * dt * 1.9; }
  a.yaw += wrapPi(a.yawGoal - a.yaw) * Math.min(1, dt * 9);
  // the camera drifts round behind you while you walk away from it or across the screen (never while you walk towards it)
  if (a.speed > 0.3 && performance.now() - a.lookedAt > 1800) {
    const towardCam = a.dirx * Math.sin(a.yaw) + a.dirz * Math.cos(a.yaw);
    if (towardCam < 0.35) a.yawGoal += wrapPi(a.face + Math.PI - a.yawGoal) * Math.min(1, dt * 0.9);
  }
  a.avatar.group.position.copy(a.pos); a.avatar.group.rotation.y = a.face; a.avatar.update(dt, a.speed, a.t);
  a.blob.position.set(a.pos.x, 0.03, a.pos.z);
  // ── camera: behind and above, pulled in before it would go into furniture or a wall ──
  a.shift += (a.shiftTo - a.shift) * Math.min(1, dt * 6);
  const portrait = a.camera.aspect < 0.8, dist = portrait ? 6.8 : 5.6, base = (portrait ? 0.66 : 0.52) + 0.1 * a.shift;
  tmpTarget.set(a.pos.x, 1.0, a.pos.z);
  // behind and above; if furniture is in the way, rise higher (the room is open at the top) before getting closer
  let pitch = base, clear = 0;
  for (const p of [base, 0.9, 1.15, 1.4]) {
    const cp = Math.cos(p); tmpDir.set(Math.sin(a.yaw) * cp, Math.sin(p), Math.cos(a.yaw) * cp);
    const c = rayHit(tmpTarget, tmpDir, dist, CAM_R);
    if (c > clear) { clear = c; pitch = p; }
    if (c >= dist * 0.85) break;
  }
  { const cp = Math.cos(pitch); tmpDir.set(Math.sin(a.yaw) * cp, Math.sin(pitch), Math.cos(a.yaw) * cp); }
  const goal = Math.max(0.9, clear);
  a.camDist += (goal - a.camDist) * (goal < a.camDist ? 1 : 1 - Math.exp(-dt * 3)); // in fast, out slowly
  tmpWant.copy(tmpDir).multiplyScalar(a.camDist).add(tmpTarget);
  a.camera.position.lerp(tmpWant, 1 - Math.exp(-dt * 10));
  tmpO.copy(a.camera.position).sub(tmpTarget); const len = tmpO.length(); tmpO.divideScalar(len || 1);
  const hit = rayHit(tmpTarget, tmpO, len, CAM_R); // damping must never carry it through something
  if (hit < len) a.camera.position.copy(tmpO.multiplyScalar(Math.max(0.5, hit)).add(tmpTarget));
  a.camera.lookAt(a.pos.x, 0.95 + 0.35 * a.shift, a.pos.z);
  // ── the guide: a bouncing arrow over the station you should go to next, and an edge arrow when it's off screen ──
  const gd = a.guide;
  if (gd.st) {
    const st = gd.st; gd.arrow.visible = true; gd.arrow.position.set(st.padX, 3.55 + Math.abs(Math.sin(a.t * 4)) * 0.3, st.padZ);
    tmpO.set(st.padX, 2.4, st.padZ).project(a.camera);
    const inView = tmpO.z < 1 && Math.abs(tmpO.x) < 0.88 && Math.abs(tmpO.y) < 0.88;
    gd.el.hidden = inView;
    if (!inView) {
      const behind = tmpO.z > 1, x = behind ? -tmpO.x : tmpO.x, y = behind ? -tmpO.y : tmpO.y, k = 0.82 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      const w = a.el.clientWidth, h = a.el.clientHeight;
      gd.el.style.transform = `translate(${((x * k + 1) / 2) * w}px, ${((1 - y * k) / 2) * h}px) translate(-50%, -50%) rotate(${Math.atan2(-y, x) + Math.PI / 2}rad)`;
    }
  } else { gd.arrow.visible = false; gd.el.hidden = true; }
  // ── stations ──
  let near = null;
  for (const st of a.stations) {
    const d = Math.hypot(st.padX - a.pos.x, st.padZ - a.pos.z), on = d < 0.85, u = st.marker.userData;
    u.disk.material.opacity = on ? 0.7 : 0.32; u.icon.position.y = 2.7 + Math.abs(Math.sin(a.t * 3 + st.padX)) * 0.22; u.ring.scale.setScalar(1 + Math.sin(a.t * 3) * 0.04);
    if (on && !near) near = st;
    if (d > 1.9) st.armed = true;
  }
  if (near?.type !== a.near?.type) { a.near = near; a.dwell = 0; a.onNear?.(near?.type || null); }
  if (near && near.armed && !a.paused) { a.dwell += dt; if (a.dwell > 0.35 && a.speed < 0.25) { near.armed = false; a.onEnter?.(near.type); } }
  if (A === a) a.renderer.render(a.scene, a.camera); // (a callback above may have left the apartment)
}

/* ───────── public API ───────── */

/** Put one piece of furniture in `parent`; solid ones also go in `solids` (tagged with `tag`), with a soft dark patch under them. */
async function addProp(parent, solids, name, x, z, ry, sc, ex, tag) {
  const g = (await model(name)).scene.clone(true); g.scale.setScalar(sc); g.rotation.y = ry; g.position.set(x, ex.y || 0, z);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = ex.solid !== false; m.receiveShadow = true; m.material = m.material.clone(); m.material.envMapIntensity = 0.5; if (name.startsWith('rug')) { m.material.map = null; m.material.color.set(0xf4a3c1); } } });
  parent.add(g); if (tag) g.userData.uid = tag;
  if (ex.solid !== false) {
    const n = solids.length; solidsFrom(g, solids); if (tag && solids.length > n) solids[n].extra = tag;
    if (!ex.y) {
      const b = new THREE.Box3().setFromObject(g), blob = new THREE.Mesh(new THREE.PlaneGeometry((b.max.x - b.min.x) * 1.3, (b.max.z - b.min.z) * 1.3), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.8 }));
      blob.rotation.x = -Math.PI / 2; blob.position.set((b.min.x + b.max.x) / 2, 0.012, (b.min.z + b.max.z) / 2); parent.add(blob);
    }
  }
  return g;
}

export const apartment = {
  get usable() { return webglOK; },
  get running() { return !!A; },

  /** Build the room and start walking. Resolves when everything has loaded. */
  async start({ el, stations = [], look = {}, avatar, pos, decor = 'rose', onNear, onEnter, onProgress = () => {} }) {
    this.stop();
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    configureRenderer(renderer); renderer.domElement.setAttribute('role', 'img'); renderer.domElement.style.touchAction = 'none'; renderer.domElement.tabIndex = 0;
    el.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
    scene.background = new THREE.Color(0xffd9e8); scene.fog = new THREE.Fog(0xffd9e8, 22, 40);
    scene.environment = studioEnvironment(renderer).texture;
    scene.add(new THREE.HemisphereLight(0xfff3f8, 0xd7a3b8, 1.15));
    const sun = new THREE.DirectionalLight(0xfff1e2, 2.1); sun.position.set(-5, 11, 8); sun.target.position.set(0, 0, -1);
    sun.castShadow = true; sun.shadow.mapSize.set(tier().shadow, tier().shadow); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 9, bottom: -9, near: 1, far: 30 }); sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun, sun.target);
    const me = A = { renderer, scene, camera, el, stations: [], solids: [], keys: new Set(), key: { dir: 0 }, move: { x: 0, y: 0 }, pos: pos ? new THREE.Vector3(pos[0], 0, pos[1]) : new THREE.Vector3(0, 0, 2.6), face: Math.PI, yaw: 0, yawGoal: 0, speed: 0, dirx: 0, dirz: -1, path: null, shift: 0, shiftTo: 0, camDist: 6, t: 0, last: performance.now(), lookedAt: 0, near: null, dwell: 0, paused: false, onNear, onEnter, raf: 0, grid: null, };
    const room = buildRoom(decor); scene.add(room); A.room = room; scene.background.set(themeOf(decor).bg); scene.fog.color.set(themeOf(decor).bg);
    const gone = () => A !== me; // another start() or stop() happened while we were loading
    // furniture
    const total = PROPS.length + 2; let done = 0; const bump = () => onProgress(++done / total);
    await Promise.all(PROPS.map(async ([name, x, z, ry, sc, ex]) => {
      try { await addProp(scene, A.solids, name, x, z, ry, sc, ex); } catch { /* a missing prop just leaves a gap */ }
      bump();
    }));
    if (gone()) return this;
    // stations: the procedural ones (rack, mirrors) plus a glowing pad and bouncing icon for each
    const meta = Object.fromEntries(stations.map((s) => [s.type, s]));
    const real = tier().reflect > 0;
    const rack = clothesRack(meta.wardrobe?.thumbs || []); rack.position.set(LAYOUT.wardrobe.x, 0, LAYOUT.wardrobe.z); scene.add(rack); solidsFrom(rack, A.solids); A.rack = rack;
    const sm = standingMirror(real); sm.group.position.set(LAYOUT.mirror.x, 0, LAYOUT.mirror.z); sm.group.rotation.y = Math.PI / 2; scene.add(sm.group);
    solidsFrom(sm.group, A.solids);
    const vm = vanityMirror(); vm.position.set(LAYOUT.vanity.x, 0, -5.93); scene.add(vm);
    bump();
    A.stations = Object.entries(LAYOUT).map(([type, L]) => {
      const m = meta[type] || { label: type, emoji: '•' }, marker = stationMarker({ ...m, color: L.color });
      marker.position.set(L.padX, 0, L.padZ); scene.add(marker);
      return { type, label: m.label, padX: L.padX, padZ: L.padZ, marker, armed: true };
    });
    // the avatar
    const av = await loadAvatar(avatar, { height: 1.4 }); if (gone()) { av.dispose(); return this; }
    A.avatar = av; av.setLook(look); scene.add(av.group);
    A.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }));
    A.blob.rotation.x = -Math.PI / 2; scene.add(A.blob);
    A.grid = gridOf();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f })); arrow.rotation.x = Math.PI; arrow.visible = false; scene.add(arrow);
    const gel = document.createElement('div'); gel.className = 'guide'; gel.hidden = true; gel.setAttribute('aria-hidden', 'true'); gel.textContent = '▲'; el.append(gel);
    A.guide = { st: null, arrow, el: gel };
    bump();
    // input
    const cv = renderer.domElement;
    const kd = (down) => (e) => { const key = e.key.toLowerCase(); if (key === 'q' || key === 'e') { me.key.dir = down ? (key === 'q' ? 1 : -1) : 0; return; } const dir = KEYS[key]; if (!dir) return; e.preventDefault(); down ? me.keys.add(dir) : me.keys.delete(dir); };
    cv.addEventListener('keydown', kd(true)); cv.addEventListener('keyup', kd(false)); cv.addEventListener('blur', () => me.keys.clear());
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; cv.setPointerCapture(e.pointerId); cv.focus({ preventScroll: true }); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y); me.yawGoal -= (e.clientX - drag.x) * 0.008; drag.x = e.clientX; drag.y = e.clientY; me.lookedAt = performance.now(); });
    const up = (e) => { const d = drag; drag = null; if (A === me && d && e.type === 'pointerup' && d.moved < 10 && performance.now() - d.t < 450) tap(e); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    const ro = new ResizeObserver(() => resize()); ro.observe(el); A.ro = ro;
    A.watch = new FrameWatch(() => { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); });
    resize();
    A.last = performance.now(); A.raf = requestAnimationFrame(tick); A.ready = true;
    return this;
  },

  stop() {
    const a = A; if (!a) return;
    cancelAnimationFrame(a.raf); a.ro?.disconnect(); a.watch?.stop(); A = null;
    a.scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.()); }); // shared furniture re-uploads itself if the room is opened again
    a.guide?.el.remove(); a.avatar?.dispose(); a.renderer.dispose(); a.renderer.forceContextLoss?.(); a.renderer.domElement.remove();
  },

  setMove(x, y) { if (A) A.move = { x, y }; },
  setPaused(p) { if (A) { A.paused = !!p; if (p) { A.move = { x: 0, y: 0 }; A.keys.clear(); A.path = null; } } },
  rotateCam(dir) { if (A) { A.yawGoal += dir * Math.PI / 4; A.lookedAt = performance.now(); } },
  setFraming(open) { if (A) A.shiftTo = open ? 1 : 0; },
  setLook(look) { A?.avatar?.setLook(look); },
  async setAvatar(id, look) { if (!A) return; const old = A.avatar, a = await loadAvatar(id, { height: 1.4 }); if (!A) return; a.setLook(look); A.scene.add(a.group); A.scene.remove(old.group); old.dispose(); A.avatar = a; },
  pop() { A?.avatar.hop(); },
  where() { return A ? [A.pos.x, A.pos.z] : null; },
  /** Point the way to a station (or nothing). */
  setGuide(type) { if (A?.guide) A.guide.st = A.stations.find((s) => s.type === type) || null; },
  setLabel(text) { A?.renderer.domElement.setAttribute('aria-label', text); },
  walkToStation(type) { const st = A?.stations.find((s) => s.type === type); if (st) { st.armed = true; A.path = findPath(A.pos, new THREE.Vector3(st.padX, 0, st.padZ)); } },
  /** Stand somewhere sensible when the page wants you at a station already (e.g. coming back from its screen). */
  rearm() { A?.stations.forEach((s) => (s.armed = Math.hypot(s.padX - A.pos.x, s.padZ - A.pos.z) > 1.9)); },
  /** Repaint the room in another colour scheme. */
  setTheme(id) {
    const a = A, m = a?.room?.userData.mats; if (!m) return;
    const th = themeOf(id);
    m.floor.map?.dispose(); m.floor.map = floorTexFor(th); m.floor.needsUpdate = true;
    m.wall.map?.dispose(); m.wall.map = wallTexFor(th); m.wall.needsUpdate = true;
    m.trim.color.set(th.trim); a.scene.background.set(th.bg); a.scene.fog.color.set(th.bg);
  },
  /** Show the furniture you've placed: [{uid, model, scale, solid, x, z, ry (quarter turns)}]. `selected` gets a ring round it. */
  async setExtras(list, selected = '') {
    const a = A; if (!a) return;
    const seq = (a.extraSeq = (a.extraSeq || 0) + 1), grp = new THREE.Group(), solids = [];
    await Promise.all(list.map(async (p) => { try { await addProp(grp, solids, p.model, p.x, p.z, (p.ry * Math.PI) / 2, p.scale, { solid: p.solid }, p.uid); } catch { /* a missing model leaves a gap */ } }));
    if (A !== a || a.extraSeq !== seq) return; // a newer call (or a new room) took over while the models loaded
    if (a.extras) { a.extras.removeFromParent(); a.extras.traverse((o) => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.()); }); } // the geometry is shared with the model cache, so it stays
    a.solids = a.solids.filter((x) => !x.extra).concat(solids);
    a.extras = grp; a.scene.add(grp);
    const sel = list.find((p) => p.uid === selected);
    if (sel) {
      const box = solids.find((x) => x.extra === selected), r = box ? Math.max(box.x1 - box.x0, box.z1 - box.z0) / 2 + 0.15 : 0.9;
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.07, 40), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(box ? (box.x0 + box.x1) / 2 : sel.x, 0.035, box ? (box.z0 + box.z1) / 2 : sel.z); grp.add(ring);
    }
    a.grid = gridOf();
  },
  /** Can this piece go there? Not through a wall, not on another piece, not on a station, and never so that a station can't be reached. */
  async canPlace(p, selfUid = '') {
    const a = A; if (!a) return { ok: false, why: 'The room isn’t open.' };
    const b0 = new THREE.Box3().setFromObject((await model(p.model)).scene), th = (p.ry * Math.PI) / 2, c = Math.cos(th), sn = Math.sin(th);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [cx, cz] of [[b0.min.x, b0.min.z], [b0.max.x, b0.min.z], [b0.min.x, b0.max.z], [b0.max.x, b0.max.z]]) {
      const lx = cx * p.scale, lz = cz * p.scale, rx = p.x + lx * c + lz * sn, rz = p.z - lx * sn + lz * c;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); z0 = Math.min(z0, rz); z1 = Math.max(z1, rz);
    }
    if (x0 < ROOM.x0 + 0.15 || x1 > ROOM.x1 - 0.15 || z0 < ROOM.z0 + 0.15 || z1 > ROOM.z1 - 0.15) return { ok: false, why: 'That’s outside the room.' };
    if (p.solid === false) return { ok: true, why: '' }; // rugs go anywhere
    for (const st of a.stations) { const dx = Math.max(x0 - st.padX, 0, st.padX - x1), dz = Math.max(z0 - st.padZ, 0, st.padZ - z1); if (Math.hypot(dx, dz) < 1.0) return { ok: false, why: 'That’s in front of a station.' }; }
    if (a.solids.some((s) => s.extra !== selfUid && s.y0 < 1.6 && x0 < s.x1 + 0.05 && x1 > s.x0 - 0.05 && z0 < s.z1 + 0.05 && z1 > s.z0 - 0.05)) return { ok: false, why: 'Something is already there.' };
    // which stations can the avatar still reach? Only a piece that cuts off one that was reachable is refused.
    const reach = () => {
      const { nx, nz, blocked: bl } = gridOf(), at = (x, z) => [Math.max(0, Math.min(nx - 1, Math.floor((x - ROOM.x0) / CELL))), Math.max(0, Math.min(nz - 1, Math.floor((z - ROOM.z0) / CELL)))];
      const seen = new Uint8Array(nx * nz), [si, sj] = at(a.pos.x, a.pos.z), stack = [sj * nx + si]; seen[stack[0]] = 1;
      while (stack.length) { const cur = stack.pop(), ci = cur % nx, cj = (cur / nx) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= nz || seen[j * nx + i] || bl[j * nx + i]) continue; seen[j * nx + i] = 1; stack.push(j * nx + i); } }
      // a pad that sits in a tight spot counts as reached when a free cell next to it is
      return a.stations.map((st) => { const [i, j] = at(st.padX, st.padZ); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && seen[jj * nx + ii]) return true; } return false; });
    };
    const kept = a.solids; let blocked = false;
    try {
      a.solids = kept.filter((s) => s.extra !== selfUid); const before = reach();
      a.solids = [...a.solids, { x0, x1, z0, z1, y0: 0, y1: 1.2 }]; const after = reach();
      blocked = before.some((ok, k) => ok && !after[k]);
    } finally { a.solids = kept; }
    return blocked ? { ok: false, why: 'That would block the way to a station.' } : { ok: true, why: '' };
  },
  /** Build mode: taps go to fn(x, z, uidOfPieceHit) instead of walking. Pass null to walk again. */
  setFloorTap(fn) { if (A) A.floorTap = fn; },
  /** Which way is "up the screen" and "right" on the floor, so arrow buttons feel natural whatever way the camera faces. */
  camDir() { if (!A) return null; const f = new THREE.Vector3(); A.camera.getWorldDirection(f); f.y = 0; f.normalize(); return { forward: [f.x, f.z], right: [-f.z, f.x] }; },
  debug() {
    if (!A) return null;
    const cp = A.camera.position, inside = A.solids.some((s) => cp.x > s.x0 && cp.x < s.x1 && cp.z > s.z0 && cp.z < s.z1 && cp.y > s.y0 && cp.y < s.y1);
    return { ready: !!A.ready, pos: [A.pos.x, A.pos.z], cam: [cp.x, cp.y, cp.z], camInsideFurniture: inside, camDist: A.camDist, near: A.near?.type || null, speed: A.speed, solids: A.solids.length, extras: A.extras?.children.filter((o) => o.userData.uid).length || 0, stations: A.stations.map((s) => s.type), yaw: A.yaw, pathLen: A.path?.length || 0, canvas: [A.renderer.domElement.width, A.renderer.domElement.height], tris: A.renderer.info.render.triangles, calls: A.renderer.info.render.calls };
  },
  /** Test hook: put the avatar somewhere. */
  teleport(x, z) { if (A) { A.pos.set(x, 0, z); pushOut(A.pos, AV_R); A.path = null; apartment.rearm(); } },
};

function resize() {
  const a = A; if (!a) return;
  const { width, height } = a.el.getBoundingClientRect(); if (!width || !height) return;
  a.renderer.setSize(width, height, false); a.camera.aspect = width / height; a.camera.fov = width / height < 0.8 ? 56 : 46; a.camera.updateProjectionMatrix();
}

/** Tap the floor to walk there; tap a station's pad or icon to walk to it. */
function tap(e) {
  const a = A, r = a.renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), a.camera);
  if (a.floorTap) { // build mode
    const hit = a.extras ? rc.intersectObject(a.extras, true)[0] : null; let o = hit?.object, uid = '';
    while (o && !uid) { uid = o.userData.uid || ''; o = o.parent; }
    const q = new THREE.Vector3(); rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), q) ? a.floorTap(q.x, q.z, uid) : a.floorTap(NaN, NaN, uid);
    return;
  }
  const icons = rc.intersectObjects(a.stations.map((s) => s.marker.userData.icon), false)[0];
  if (icons) { const st = a.stations.find((s) => s.marker.userData.icon === icons.object); apartment.walkToStation(st.type); return; }
  const p = new THREE.Vector3();
  if (rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) {
    const near = a.stations.find((s) => Math.hypot(s.padX - p.x, s.padZ - p.z) < 1.1);
    if (near) return apartment.walkToStation(near.type);
    a.path = findPath(a.pos, p);
  }
}
