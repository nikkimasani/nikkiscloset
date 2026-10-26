// The walk-in closet as a little 3D world: a pink boutique with a rack for every kind of clothing (your real photos hang on them),
// a mirror to try things on at, and glowing pads on the floor that mark where to stand.
// Everything is built from rounded shapes, toon shading and canvas textures, so there is nothing to download.
import * as THREE from '../vendor/three/three.module.min.js';

const SRGB = THREE.SRGBColorSpace;

/** Shared 4-step lighting ramp: gives everything the soft "cel" look of a dress-up game. */
let GRADIENT = null;
export function toonGradient() {
  if (GRADIENT) return GRADIENT;
  const t = new THREE.DataTexture(new Uint8Array([150, 200, 235, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return (GRADIENT = t);
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

const roundRect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };

/** A floating name plate: emoji + label on a pill. Always faces the camera. */
function sign(U, emoji, label, color, scale = 1) {
  const t = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#00000030'; roundRect(g, 8, 16, w - 8, h - 16, 52); g.fill();
    g.fillStyle = color; roundRect(g, 4, 8, w - 8, h - 16, 52); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = '#ffffff'; g.font = '800 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${emoji} ${label}`.trim(), w / 2, h / 2 + 3);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(0.82 * U * scale, 0.205 * U * scale, 1);
  return s;
}

/** The glowing circle you stand on. */
function pad(U, color) {
  const g = new THREE.Group();
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.34 * U, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.29 * U, 0.35 * U, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
  disk.rotation.x = ring.rotation.x = -Math.PI / 2; disk.position.y = 0.004 * U; ring.position.y = 0.006 * U;
  g.add(disk, ring); g.userData.ring = ring; g.userData.disk = disk;
  return g;
}

/** A rounded slab, optionally arched on top, so the furniture is soft instead of boxy. */
function slab(w, h, d, r, color, archTop = false) {
  const sh = new THREE.Shape(), x = -w / 2; r = Math.min(r, w / 2, h / 2);
  sh.moveTo(x + r, 0); sh.lineTo(x + w - r, 0); sh.quadraticCurveTo(x + w, 0, x + w, r);
  if (archTop) { sh.lineTo(x + w, h - w / 2); sh.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); sh.lineTo(x, r); }
  else { sh.lineTo(x + w, h - r); sh.quadraticCurveTo(x + w, h, x + w - r, h); sh.lineTo(x + r, h); sh.quadraticCurveTo(x, h, x, h - r); sh.lineTo(x, r); }
  sh.quadraticCurveTo(x, 0, x + r, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: d * 0.14, bevelThickness: d * 0.14, bevelSegments: 4, curveSegments: 18 });
  g.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(g, toon(color)); m.castShadow = m.receiveShadow = true;
  return m;
}

/** A soft round contact shadow on the floor. */
function blob(U, w, d, a = 0.3) {
  const t = canvasTexture(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, `rgba(80,20,70,${a})`); gr.addColorStop(1, 'rgba(80,20,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004 * U;
  return m;
}

const box = (w, h, d, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color)); m.castShadow = true; return m; };

/** A clothes rack with a rail, your photos hanging from it, and a name plate. Local +z is the front. */
function rack(U, st, loader) {
  const g = new THREE.Group(), tint = new THREE.Color(st.color), pale = tint.clone().lerp(new THREE.Color('#ffffff'), 0.65);
  const frame = slab(0.98 * U, 1.42 * U, 0.1 * U, 0.08 * U, tint, true); frame.position.set(0, 0, -0.17 * U); g.add(frame);       // coloured arch
  const inner = slab(0.8 * U, 1.3 * U, 0.06 * U, 0.06 * U, pale, true); inner.position.set(0, 0.05 * U, -0.1 * U); g.add(inner);   // pale panel
  for (const sx of [-1, 1]) { const post = slab(0.05 * U, 1.05 * U, 0.12 * U, 0.025 * U, tint); post.position.set(sx * 0.44 * U, 0, -0.04 * U); g.add(post); }
  const base = slab(1.0 * U, 0.1 * U, 0.34 * U, 0.04 * U, tint); base.position.set(0, 0, -0.02 * U); g.add(base);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.016 * U, 0.016 * U, 0.86 * U, 14), toon(0xeef1f8)); rail.castShadow = true;
  rail.rotation.z = Math.PI / 2; rail.position.set(0, 1.0 * U, 0.02 * U); g.add(rail);
  // your real pieces, hanging from the rail (flat photo cutouts, like paper dolls)
  const n = Math.min(5, st.thumbs.length), step = 0.82 * U / Math.max(n, 1);
  st.thumbs.slice(0, 5).forEach((u, i) => {
    const tex = loader.load(u); tex.colorSpace = SRGB;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3 * U, 0.42 * U), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(-0.41 * U + step * (i + 0.5), 0.77 * U, 0.05 * U); m.rotation.z = (i % 2 ? 1 : -1) * 0.03;
    const hook = box(0.012 * U, 0.06 * U, 0.012 * U, 0xeef1f8); hook.position.set(m.position.x, 0.99 * U, 0.05 * U);
    g.add(m, hook);
  });
  if (!n) { const e = sign(U, '', 'nothing here yet', '#b3a6c9', 0.55); e.position.set(0, 0.72 * U, 0.1 * U); g.add(e); }
  const plate = sign(U, st.emoji, st.label, st.color); plate.position.set(0, 1.62 * U, 0.05 * U); g.add(plate);
  const shadow = blob(U, 1.4 * U, 0.9 * U); shadow.position.z = 0.2 * U; g.add(shadow);
  const p = pad(U, tint); p.position.set(0, 0, 0.62 * U); g.add(p);
  g.userData = { type: st.type, pad: p };
  return g;
}

/** The try-on mirror: an oval gold frame with a bright pane. */
function mirror(U, st) {
  const g = new THREE.Group();
  const glass = canvasTexture(256, 384, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#e6f6ff'); gr.addColorStop(1, '#b5d9f5'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff77'; c.beginPath(); c.moveTo(w * 0.1, h); c.lineTo(w * 0.45, 0); c.lineTo(w * 0.62, 0); c.lineTo(w * 0.27, h); c.fill();
    c.fillStyle = '#ffffff55'; c.beginPath(); c.moveTo(w * 0.7, h); c.lineTo(w * 0.8, 0); c.lineTo(w * 0.86, 0); c.lineTo(w * 0.77, h); c.fill();
  });
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.36 * U, 48), new THREE.MeshBasicMaterial({ map: glass }));
  pane.scale.set(1, 1.55, 1); pane.position.set(0, 0.95 * U, -0.1 * U);
  const frame = new THREE.Mesh(new THREE.RingGeometry(0.36 * U, 0.44 * U, 48), toon(0xe3bf62, { side: THREE.DoubleSide }));
  frame.scale.set(1, 1.55, 1); frame.position.set(0, 0.95 * U, -0.095 * U);
  const stand = slab(0.7 * U, 0.08 * U, 0.3 * U, 0.03 * U, 0xe3bf62); stand.position.set(0, 0, -0.02 * U);
  g.add(pane, frame, stand);
  const plate = sign(U, st.emoji, st.label, st.color); plate.position.set(0, 1.95 * U, 0.05 * U); g.add(plate);
  const shadow = blob(U, 1.0 * U, 0.7 * U); shadow.position.z = 0.15 * U; g.add(shadow);
  const p = pad(U, new THREE.Color(st.color)); p.position.set(0, 0, 0.62 * U); g.add(p);
  g.userData = { type: st.type, pad: p };
  return g;
}

function plant(U, x, z) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * U, 0.095 * U, 0.22 * U, 20), toon(0xb9a2ff)); pot.position.y = 0.11 * U; pot.castShadow = true; g.add(pot);
  const leafMat = toon(0x4fc487);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1 * U, 12, 8), leafMat);
    leaf.scale.set(0.45, 1.7, 0.22); leaf.position.set(Math.cos(a) * 0.09 * U, 0.42 * U, Math.sin(a) * 0.09 * U);
    leaf.rotation.set(Math.sin(a) * 0.5, -a, -Math.cos(a) * 0.5); leaf.castShadow = true; g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}

/**
 * Builds the room. Returns { group, stations: [{ type, group, padPos }], bounds, update(t) }.
 * U = the avatar's height in world units; the room is sized from it.
 */
export function buildWorld(U, stations, theme = {}) {
  const group = new THREE.Group(), loader = new THREE.TextureLoader();
  const W = 3 * U, D0 = -3.2 * U, D1 = 3.4 * U, wallH = 2.9 * U;

  // glossy marble tiles
  const floorTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = theme.floorA || '#ffc9de'; g.fillRect(0, 0, w, h);
    g.fillStyle = theme.floorB || '#fff0f6'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
    g.strokeStyle = '#ffffffaa'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.fillStyle = '#ffffff55'; for (const [x, y] of [[40, 40], [200, 60], [90, 190], [220, 220], [150, 120]]) { g.beginPath(); g.ellipse(x, y, 18, 6, -0.6, 0, Math.PI * 2); g.fill(); }
  }, [(2 * W) / (1.2 * U), (D1 - D0) / (1.2 * U)]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, D1 - D0), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (D0 + D1) / 2); floor.receiveShadow = true; group.add(floor);

  // wallpaper: soft lattice with little hearts, white wainscot below
  const wallTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = theme.wall || '#f7aecb'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff40'; g.lineWidth = 4;
    for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 256, 256); g.moveTo(i * 64 + 256, 0); g.lineTo(i * 64, 256); g.stroke(); }
    g.fillStyle = '#ffffff70'; g.font = '34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [x, y] of [[64, 64], [192, 64], [128, 128], [64, 192], [192, 192]]) g.fillText('♥', x, y);
  }, [4, 2]);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, wallH), wallMat); back.position.set(0, wallH / 2, D0); back.receiveShadow = true; group.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D1 - D0, wallH), wallMat);
    side.rotation.y = -sx * Math.PI / 2; side.position.set(sx * W, wallH / 2, (D0 + D1) / 2); side.receiveShadow = true; group.add(side);
  }
  const wain = new THREE.MeshLambertMaterial({ color: 0xfff7fb });
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 0.5 * U), wain); wb.position.set(0, 0.25 * U, D0 + 0.005 * U); group.add(wb);
  for (const sx of [-1, 1]) { const ws = new THREE.Mesh(new THREE.PlaneGeometry(D1 - D0, 0.5 * U), wain); ws.rotation.y = -sx * Math.PI / 2; ws.position.set(sx * (W - 0.005 * U), 0.25 * U, (D0 + D1) / 2); group.add(ws); }
  const crown = box(2 * W, 0.12 * U, 0.08 * U, 0xffffff); crown.position.set(0, wallH - 0.06 * U, D0 + 0.04 * U); group.add(crown);
  const rail = box(2 * W, 0.05 * U, 0.05 * U, 0xffffff); rail.position.set(0, 0.5 * U, D0 + 0.025 * U); group.add(rail);

  // neon sign over the middle of the back wall
  const neon = canvasTexture(512, 160, (g, w, h) => {
    g.shadowColor = '#ff3d9a'; g.shadowBlur = 28; g.fillStyle = '#ffd1e6'; g.font = '800 82px "Brush Script MT", "Segoe Script", cursive, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText("Nikki's Closet", w / 2, h / 2 - 6); g.fillText("Nikki's Closet", w / 2, h / 2 - 6);
  });
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.7 * U, 0.53 * U), new THREE.MeshBasicMaterial({ map: neon, transparent: true, depthWrite: false }));
  sg.position.set(0, 2.38 * U, D0 + 0.02 * U); group.add(sg);

  // a round rug with a scalloped edge
  const rugTex = canvasTexture(256, 256, (g, w, h) => {
    const c = w / 2; g.fillStyle = theme.rug || '#cdb8ff'; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff90'; g.beginPath(); g.arc(c, c, c * 0.78, 0, Math.PI * 2); g.fill();
    g.fillStyle = theme.rug || '#cdb8ff'; g.beginPath(); g.arc(c, c, c * 0.7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffffaa'; g.font = '40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✨', c, c);
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.25 * U, 64), new THREE.MeshLambertMaterial({ map: rugTex, transparent: true }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.003 * U, 0.2 * U); rug.receiveShadow = true; group.add(rug);

  group.add(plant(U, -2.62 * U, 1.7 * U), plant(U, 2.62 * U, 1.7 * U));

  // string lights draped along the back wall
  const bulbs = [];
  for (let i = -6; i <= 6; i++) {
    const x = i * 0.42 * U, y = 2.15 * U - Math.cos((i / 6) * Math.PI / 2) * 0.22 * U + 0.22 * U * 0;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045 * U, 12, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfff1b8 : 0xffd1e6 }));
    bulb.position.set(x, y + 0.2 * U, D0 + 0.08 * U); group.add(bulb); bulbs.push(bulb);
  }

  // floating sparkles
  const N = 70, pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) { seeds.push([(Math.random() * 2 - 1) * 2.6 * U, Math.random() * 2.2 * U, D0 + Math.random() * (D1 - D0) * 0.9, Math.random() * 6.28]); }
  const starTex = canvasTexture(64, 64, (g, s) => { g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r = i % 2 ? s * 0.12 : s * 0.46; g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); } g.closePath(); g.fill(); });
  const sparkles = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ map: starTex, size: 0.07 * U, transparent: true, opacity: 0.85, depthWrite: false, color: 0xfff6c9 }));
  sparkles.frustumCulled = false; group.add(sparkles);

  // where each station stands: along the back wall, then down the two side walls
  const spots = [
    [-2.0, -3.05, 0], [-1.0, -3.05, 0], [0, -3.05, 0], [1.0, -3.05, 0], [2.0, -3.05, 0],
    [-2.85, -2.1, Math.PI / 2], [-2.85, -1.0, Math.PI / 2], [-2.85, 0.1, Math.PI / 2],
    [2.85, -2.1, -Math.PI / 2], [2.85, -1.0, -Math.PI / 2], [2.85, 0.1, -Math.PI / 2],
  ];
  const built = stations.map((st, i) => {
    const [sx, sz, ry] = spots[i] || spots[spots.length - 1];
    const g = st.type === 'mirror' ? mirror(U, st) : rack(U, st, loader);
    g.position.set(sx * U, 0, sz * U); g.rotation.y = ry; group.add(g);
    const padPos = new THREE.Vector3(0, 0, 0.62 * U).applyEuler(new THREE.Euler(0, ry, 0)).add(g.position);
    return { type: st.type, group: g, padPos, pad: g.userData.pad };
  });

  return {
    group, stations: built,
    bounds: { x: 2.55 * U, zMin: -2.6 * U, zMax: 2.4 * U },
    update(t) { // pads breathe, bulbs twinkle, sparkles drift
      for (const s of built) { const k = 1 + Math.sin(t * 3) * 0.05; s.pad.scale.set(k, 1, k); }
      bulbs.forEach((b, i) => { b.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.12); });
      const a = sparkles.geometry.attributes.position;
      seeds.forEach(([x, y, z, ph], i) => { a.setXYZ(i, x + Math.sin(t * 0.6 + ph) * 0.1 * U, (y + t * 0.05 * U + ph * 0.1 * U) % (2.4 * U), z); });
      a.needsUpdate = true; sparkles.material.opacity = 0.65 + Math.sin(t * 2) * 0.2;
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.dispose(); } });
    },
  };
}
