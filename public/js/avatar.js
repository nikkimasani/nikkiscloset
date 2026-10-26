// The little 3D avatar: a rigged, ready-made low-poly character (Kenney "Mini Characters", CC0) with a hand-driven idle and walk cycle.
// The pack's own animation clips are not used; the bones are posed here, so the pose is the same whichever of the twelve characters you pick.
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/meshopt_decoder.module.js';
import { clone } from '../vendor/three/SkeletonUtils.js';
import { AVATARS } from './data.js';

const REST_HEIGHT = 0.78; // the model's height in its own units
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

const hex = (c) => '#' + new THREE.Color(c).getHexString();
const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/** Load a character once. The model has long spikes at the ends of its arms (a held-item mount), which are dropped here. */
function base(id) {
  if (!cache.has(id)) cache.set(id, loader.loadAsync(`/assets/characters/${id}.glb`).then((g) => {
    const P = new THREE.Vector3();
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const idx = m.geometry.index, keep = [], far = (v) => { m.getVertexPosition(v, P); return Math.abs(P.x) > 0.44; };
      for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (!(far(a) || far(b) || far(c))) keep.push(a, b, c); }
      m.geometry.setIndex(keep);
    });
    return { scene: g.scene, cells: findCells(g.scene) };
  }));
  return cache.get(id);
}

/** Which colour swatches of the shared palette texture are this character's skin and hair (read from the ears and the top of the head). */
function findCells(root) {
  const head = root.getObjectByName('head-mesh'), uv = head.geometry.attributes.uv, P = new THREE.Vector3(), n = uv.count, vs = [];
  for (let i = 0; i < n; i++) { head.getVertexPosition(i, P); vs.push({ x: Math.abs(P.x), y: P.y, cell: `${Math.floor(uv.getX(i) * 16)},${Math.floor(uv.getY(i) * 4)}` }); }
  const maxX = Math.max(...vs.map((v) => v.x)), ys = vs.map((v) => v.y), minY = Math.min(...ys), maxY = Math.max(...ys);
  const mode = (list) => { const c = {}; list.forEach((v) => (c[v.cell] = (c[v.cell] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const skin = mode(vs.filter((v) => v.x > maxX * 0.85 && v.y < minY + (maxY - minY) * 0.75));
  const hair = mode(vs.filter((v) => v.y > maxY - (maxY - minY) * 0.04));
  return { skin, hair: hair === skin ? null : hair };
}

/** A fresh avatar: { group, height, update(dt, speed, t), setLook({skin, hair}), hop() }. */
export async function loadAvatar(id = AVATARS[0], { height = 1.4 } = {}) {
  const b = await base(AVATARS.includes(id) ? id : AVATARS[0]);
  const root = clone(b.scene), group = new THREE.Group(), k = height / REST_HEIGHT;
  root.scale.setScalar(k); group.add(root);
  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; m.material = m.material.clone(); m.material.metalness = 0; m.material.roughness = 0.9; m.material.side = THREE.FrontSide; } });
  const bone = (n) => root.getObjectByName(n), torso = bone('torso'), head = bone('head'), arms = [bone('arm-left'), bone('arm-right')], legs = [bone('leg-left'), bone('leg-right')];
  arms.forEach((a) => (a.scale.x = 0.66)); // the arms are long for a chibi: shorten them so they hang to the hips
  const tex = root.getObjectByName('body-mesh').material.map, img = tex.image;
  let map = null;
  const X = new THREE.Vector3(1, 0, 0), qDown = new THREE.Quaternion(), qSwing = new THREE.Quaternion(), E = new THREE.Euler();
  const st = { phase: 0, hop: 0 };

  const api = {
    group, height, root,
    /** Recolour the skin and hair swatches in this avatar's own copy of the palette texture. */
    setLook({ skin, hair } = {}) {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const paint = (cell, color) => { if (!cell || !color) return; const [cx, cy] = cell.split(',').map(Number), w = c.width / 16, h = c.height / 4, gr = g.createLinearGradient(0, cy * h, 0, (cy + 1) * h); gr.addColorStop(0, mixHex(color, '#ffffff', 0.18)); gr.addColorStop(1, mixHex(color, '#000000', 0.14)); g.fillStyle = gr; g.fillRect(cx * w, cy * h, w, h); };
      paint(b.cells.skin, skin && hex(skin)); paint(b.cells.hair, hair && hex(hair));
      map?.dispose(); map = new THREE.CanvasTexture(c); map.flipY = tex.flipY; map.colorSpace = tex.colorSpace; map.magFilter = map.minFilter = THREE.NearestFilter; map.generateMipmaps = false;
      root.traverse((m) => { if (m.isMesh) m.material.map = map; });
    },
    hop() { st.hop = 1; },
    /** speed 0..1: how hard the stick is pushed. */
    update(dt, speed, t) {
      const moving = speed > 0.04;
      st.phase += dt * (5 + 7 * speed) * (moving ? 1 : 0);
      const amt = Math.min(1, speed * 1.5), sw = Math.sin(st.phase) * 0.75 * amt, breathe = Math.sin(t * 2.2) * 0.012;
      legs[0].rotation.x = sw; legs[1].rotation.x = -sw;
      qDown.setFromEuler(E.set(0, 0, -1.3 - breathe * 2)); arms[0].quaternion.copy(qSwing.setFromAxisAngle(X, -sw * 0.8)).multiply(qDown);
      qDown.setFromEuler(E.set(0, 0, 1.3 + breathe * 2)); arms[1].quaternion.copy(qSwing.setFromAxisAngle(X, sw * 0.8)).multiply(qDown);
      torso.rotation.set(0.08 * amt, Math.sin(st.phase) * 0.1 * amt, 0);
      head.rotation.set(-0.04 * amt + Math.sin(t * 0.9) * 0.02, -Math.sin(st.phase) * 0.06 * amt, Math.sin(t * 1.3) * 0.015 * (1 - amt));
      st.hop = Math.max(0, st.hop - dt * 2.8);
      root.position.y = Math.abs(Math.sin(st.phase)) * 0.04 * amt + Math.sin((1 - st.hop) * Math.PI) * 0.35 * (st.hop > 0 ? 1 : 0);
      root.scale.set(k, k * (1 + breathe), k);
    },
    dispose() { map?.dispose(); root.traverse((m) => { if (m.isMesh) m.material.dispose(); }); },
  };
  api.update(0, 0, 0);
  return api;
}
