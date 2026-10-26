// Rendering quality: tiers, renderer settings, the studio environment map, a frame-rate watcher, and an optional FPS counter.
import * as THREE from '../vendor/three/three.module.min.js';

export const TIERS = {
  high: { dpr: 2, shadow: 2048, reflect: 640, fx: true },
  low: { dpr: 1.5, shadow: 1024, reflect: 0, fx: false },
};

const read = (k, d = '') => { try { return localStorage.getItem(k) || d; } catch { return d; } };

/** 'auto' | 'high' | 'low' as chosen in settings. */
export const qualityPref = () => read('gfx', 'auto');
/** The tier actually in use: the user's choice, else what the frame-rate watcher decided, else a guess from the device. */
export function qualityName() {
  const p = qualityPref();
  if (p === 'high' || p === 'low') return p;
  const auto = read('gfx_auto');
  if (auto) return auto;
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return weak ? 'low' : 'high';
}
export const tier = () => TIERS[qualityName()];
/** ACES tone mapping gives richer contrast; "true colours" turns it off so photos keep their exact colours. */
export const toneEnabled = () => read('tone', 'on') !== 'off';

export function configureRenderer(r) {
  const t = tier();
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.dpr));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = toneEnabled() ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** A soft studio "sky" with bright softbox panels, baked once into an environment map for realistic reflections and ambient light. */
export function studioEnvironment(renderer) {
  const sc = new THREE.Scene();
  const c = document.createElement('canvas'); c.width = 8; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#fff1f7'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#e9c9d8'); g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const sky = new THREE.CanvasTexture(c); sky.colorSpace = THREE.SRGBColorSpace;
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
  for (const [x, y, z, w, h, k] of [[0, 4, -8, 7, 3, 5], [-8, 3, 0, 5, 3, 4], [8, 3, 2, 5, 3, 4], [0, 8, 0, 6, 6, 3], [3, 2, 8, 4, 2, 2.5]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.95, k * 0.92), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(sc, 0.04); pm.dispose();
  sky.dispose();
  return rt;
}

/**
 * Watches frame times. If the device can't hold ~40fps on automatic quality it drops to the Low tier (once) and remembers that.
 * Also draws a tiny FPS counter when the URL has ?fps or localStorage fps=1.
 */
export class FrameWatch {
  constructor(onDowngrade) {
    this.onDowngrade = onDowngrade; this.n = 0; this.t0 = 0; this.frames = 0; this.last = 0; this.done = false; this.el = null;
    if (/[?&]fps\b/.test(location.search) || read('fps') === '1') {
      this.el = document.createElement('div'); this.el.setAttribute('aria-hidden', 'true');
      this.el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99;background:#000a;color:#7dffb0;font:700 11px/1 monospace;padding:4px 6px;border-radius:6px;pointer-events:none';
      document.body.append(this.el);
    }
  }
  tick(now) {
    if (!this.t0) this.t0 = this.last = now;
    this.frames++;
    if (this.el && now - this.last > 500) { this.el.textContent = `${Math.round((this.frames * 1000) / (now - this.last))} fps`; this.last = now; this.frames = 0; }
    if (!this.done && now - this.t0 > 5000) { // judge after the first 5 seconds
      this.done = true;
      const fps = this.n ? (this.n * 1000) / (now - this.t0) : 60;
      if (qualityPref() === 'auto' && qualityName() === 'high' && fps < 38) { try { localStorage.setItem('gfx_auto', 'low'); } catch { /* private mode */ } this.onDowngrade?.(); }
    }
    this.n++;
  }
  stop() { this.el?.remove(); this.el = null; }
}
