// The walk-in closet as a little 3D world: a pink room with a rack for every kind of clothing (your real photos hang on them),
// a mirror to try things on at, and glowing pads on the floor that mark where to stand.
// Everything is built from boxes, cylinders and canvas textures, so there is nothing to download.
import * as THREE from '../vendor/three/three.module.min.js';

const SRGB = THREE.SRGBColorSpace;

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

const roundRect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };

/** A floating name plate: emoji + label on a pill. Always faces the camera. */
function sign(U, emoji, label, color) {
  const t = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = color; roundRect(g, 4, 8, w - 8, h - 16, 52); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = '#ffffff'; g.font = '800 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${emoji} ${label}`, w / 2, h / 2 + 3);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(0.82 * U, 0.205 * U, 1);
  return s;
}

/** The glowing circle you stand on. */
function pad(U, color) {
  const g = new THREE.Group();
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.34 * U, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.29 * U, 0.35 * U, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
  disk.rotation.x = ring.rotation.x = -Math.PI / 2; disk.position.y = 0.004 * U; ring.position.y = 0.006 * U;
  g.add(disk, ring); g.userData.ring = ring; g.userData.disk = disk;
  return g;
}

/** A rounded slab (front face rounded corners), so the furniture is soft instead of boxy. */
function slab(w, h, d, r, color, archTop = false) {
  const sh = new THREE.Shape(), x = -w / 2; r = Math.min(r, w / 2, h / 2);
  sh.moveTo(x + r, 0); sh.lineTo(x + w - r, 0); sh.quadraticCurveTo(x + w, 0, x + w, r);
  if (archTop) { sh.lineTo(x + w, h - w / 2); sh.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); sh.lineTo(x, r); }
  else { sh.lineTo(x + w, h - r); sh.quadraticCurveTo(x + w, h, x + w - r, h); sh.lineTo(x + r, h); sh.quadraticCurveTo(x, h, x, h - r); sh.lineTo(x, r); }
  sh.quadraticCurveTo(x, 0, x + r, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelSize: d * 0.12, bevelThickness: d * 0.12, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -d / 2);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
}

/** A soft round shadow on the floor. */
function blob(U, w, d) {
  const t = canvasTexture(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(60,20,60,.38)'); gr.addColorStop(1, 'rgba(60,20,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004 * U;
  return m;
}

const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));

/** A clothes rack with a rail, your photos hanging from it, and a name plate. Local +z is the front. */
function rack(U, st, loader) {
  const g = new THREE.Group(), tint = new THREE.Color(st.color), pale = tint.clone().lerp(new THREE.Color('#ffffff'), 0.6);
  const frame = slab(0.98 * U, 1.42 * U, 0.1 * U, 0.08 * U, tint, true); frame.position.set(0, 0, -0.17 * U); g.add(frame);       // coloured arch
  const inner = slab(0.8 * U, 1.3 * U, 0.06 * U, 0.06 * U, pale, true); inner.position.set(0, 0.05 * U, -0.1 * U); g.add(inner);   // pale panel
  for (const sx of [-1, 1]) { const post = slab(0.05 * U, 1.05 * U, 0.12 * U, 0.025 * U, tint); post.position.set(sx * 0.44 * U, 0, -0.04 * U); g.add(post); }
  const base = slab(1.0 * U, 0.1 * U, 0.34 * U, 0.04 * U, tint); base.position.set(0, 0, -0.02 * U); g.add(base);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.016 * U, 0.016 * U, 0.86 * U, 14), new THREE.MeshLambertMaterial({ color: 0xe9edf5 }));
  rail.rotation.z = Math.PI / 2; rail.position.set(0, 1.0 * U, 0.02 * U); g.add(rail);
  // your real pieces, hanging from the rail (flat photo cutouts, like paper dolls)
  const n = Math.min(5, st.thumbs.length), step = 0.82 * U / Math.max(n, 1);
  st.thumbs.slice(0, 5).forEach((u, i) => {
    const tex = loader.load(u); tex.colorSpace = SRGB;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28 * U, 0.4 * U), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide }));
    m.position.set(-0.41 * U + step * (i + 0.5), 0.78 * U, 0.05 * U); m.rotation.z = (i % 2 ? 1 : -1) * 0.03;
    const hook = box(0.012 * U, 0.06 * U, 0.012 * U, 0xe9edf5); hook.position.set(m.position.x, 0.99 * U, 0.05 * U);
    g.add(m, hook);
  });
  if (!n) { const e = sign(U * 0.5, '', 'empty', '#9aa3b8'); e.position.set(0, 0.7 * U, 0.1 * U); g.add(e); }
  const plate = sign(U, st.emoji, st.label, st.color); plate.position.set(0, 1.62 * U, 0.05 * U); g.add(plate);
  const shadow = blob(U, 1.3 * U, 0.8 * U); shadow.position.z = 0.2 * U; g.add(shadow);
  const p = pad(U, tint); p.position.set(0, 0, 0.62 * U); g.add(p);
  g.userData = { type: st.type, pad: p };
  return g;
}

/** The try-on mirror: an oval gold frame with a bright pane. */
function mirror(U, st) {
  const g = new THREE.Group();
  const glass = canvasTexture(256, 384, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#dff4ff'); gr.addColorStop(1, '#b8dcf6'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff66'; c.beginPath(); c.moveTo(w * 0.1, h); c.lineTo(w * 0.45, 0); c.lineTo(w * 0.62, 0); c.lineTo(w * 0.27, h); c.fill();
  });
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.36 * U, 40), new THREE.MeshBasicMaterial({ map: glass }));
  pane.scale.set(1, 1.55, 1); pane.position.set(0, 0.95 * U, -0.1 * U);
  const frame = new THREE.Mesh(new THREE.RingGeometry(0.36 * U, 0.43 * U, 40), new THREE.MeshLambertMaterial({ color: 0xd9b45f, side: THREE.DoubleSide }));
  frame.scale.set(1, 1.55, 1); frame.position.set(0, 0.95 * U, -0.095 * U);
  g.add(pane, frame);
  const plate = sign(U, st.emoji, st.label, st.color); plate.position.set(0, 1.92 * U, 0.05 * U); g.add(plate);
  const shadow = blob(U, 1.0 * U, 0.7 * U); shadow.position.z = 0.15 * U; g.add(shadow);
  const p = pad(U, new THREE.Color(st.color)); p.position.set(0, 0, 0.62 * U); g.add(p);
  g.userData = { type: st.type, pad: p };
  return g;
}

/**
 * Builds the room. Returns { group, stations: [{ type, group, padPos }], bounds, update(t) }.
 * U = the avatar's height in world units; the room is sized from it.
 */
export function buildWorld(U, stations, theme = {}) {
  const group = new THREE.Group(), loader = new THREE.TextureLoader();
  const W = 3 * U, D0 = -3.2 * U, D1 = 3.4 * U;

  const floorTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = theme.floorA || '#ffc9de'; g.fillRect(0, 0, w, h);
    g.fillStyle = theme.floorB || '#ffe3ee'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
  }, [(2 * W) / (0.6 * U) / 2, (D1 - D0) / (0.6 * U) / 2]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, D1 - D0), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (D0 + D1) / 2); group.add(floor);

  const wallTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = theme.wall || '#f4a3c2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff55'; g.lineWidth = 3;
    for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 32) % 2 ? 0 : 32; x < w; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } }
  }, [6, 2]);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const wallH = 2.7 * U;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, wallH), wallMat); back.position.set(0, wallH / 2, D0); group.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D1 - D0, wallH), wallMat);
    side.rotation.y = -sx * Math.PI / 2; side.position.set(sx * W, wallH / 2, (D0 + D1) / 2); group.add(side);
  }
  // skirting board
  const skirt = box(2 * W, 0.12 * U, 0.04 * U, 0xffffff); skirt.position.set(0, 0.06 * U, D0 + 0.02 * U); group.add(skirt);
  // a rug and a couple of plants
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.25 * U, 48), new THREE.MeshLambertMaterial({ color: theme.rug || '#c9b3ff' }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.003 * U, 0.2 * U); group.add(rug);
  for (const [px, pz] of [[-2.55 * U, 1.6 * U], [2.55 * U, 1.6 * U]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * U, 0.09 * U, 0.2 * U, 14), new THREE.MeshLambertMaterial({ color: 0xb9a2ff })); pot.position.set(px, 0.1 * U, pz);
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.2 * U, 14, 10), new THREE.MeshLambertMaterial({ color: 0x57c78a })); leaves.position.set(px, 0.38 * U, pz); leaves.scale.y = 1.3;
    group.add(pot, leaves);
  }
  // lamps along the top of the back wall
  for (let i = -2; i <= 2; i++) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06 * U, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
    bulb.position.set(i * 1.1 * U, 2.35 * U, D0 + 0.1 * U); group.add(bulb);
  }

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
    update(t) { // pads breathe, and the one you're standing on glows
      for (const s of built) { const k = 1 + Math.sin(t * 3) * 0.05; s.pad.scale.set(k, 1, k); }
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.dispose(); } });
    },
  };
}
