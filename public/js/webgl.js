// Tiny and dependency-free so the app can ask "can this device do 3D?" without downloading the 3D engine.
export const webglOK = (() => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
})();
