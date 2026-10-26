// A real planar mirror: the scene is rendered a second time from the mirrored camera into a texture and shown on a plane.
// (This is the same technique as three.js's own Reflector example, written against the core API so nothing extra is bundled.)
import * as THREE from '../vendor/three/three.module.min.js';

const SHADER = {
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv;
    #include <common>
    void main() { vUv = textureMatrix * vec4( position, 1.0 ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv;
    #include <common>
    void main() {
      vec4 base = texture2DProj( tDiffuse, vUv );
      vec3 tint = mix( base.rgb, base.rgb * color, 0.35 );
      gl_FragColor = vec4( tint, 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class Mirror extends THREE.Mesh {
  /** geometry: a plane facing +z. size: render-target height in pixels (0 turns the reflection off and shows a flat pane). */
  constructor(geometry, { color = 0xe6f3ff, size = 640, clipBias = 0.002 } = {}) {
    super(geometry);
    this.isMirror = true;
    const aspect = (geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox)); const w = aspect.max.x - aspect.min.x, h = aspect.max.y - aspect.min.y;
    this.rt = new THREE.WebGLRenderTarget(Math.round((size * w) / h), size, { type: THREE.HalfFloatType, samples: 2 });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(SHADER.uniforms), vertexShader: SHADER.vertexShader, fragmentShader: SHADER.fragmentShader });
    this.material.uniforms.tDiffuse.value = this.rt.texture; this.material.uniforms.color.value = new THREE.Color(color); this.material.uniforms.textureMatrix.value = new THREE.Matrix4();

    const plane = new THREE.Plane(), normal = new THREE.Vector3(), mirrorPos = new THREE.Vector3(), camPos = new THREE.Vector3(), rot = new THREE.Matrix4();
    const lookAt = new THREE.Vector3(), clip = new THREE.Vector4(), view = new THREE.Vector3(), target = new THREE.Vector3(), q = new THREE.Vector4();
    const texMatrix = this.material.uniforms.textureMatrix.value, virtual = new THREE.PerspectiveCamera();

    this.onBeforeRender = (renderer, scene, camera) => {
      if (this.nested) return; // don't recurse into our own reflection pass
      mirrorPos.setFromMatrixPosition(this.matrixWorld); camPos.setFromMatrixPosition(camera.matrixWorld);
      rot.extractRotation(this.matrixWorld); normal.set(0, 0, 1).applyMatrix4(rot);
      view.subVectors(mirrorPos, camPos);
      if (view.dot(normal) > 0) return; // looking at the back of the mirror
      view.reflect(normal).negate().add(mirrorPos);
      rot.extractRotation(camera.matrixWorld);
      lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      target.subVectors(mirrorPos, lookAt).reflect(normal).negate().add(mirrorPos);
      virtual.position.copy(view); virtual.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); virtual.lookAt(target);
      virtual.far = camera.far; virtual.updateMatrixWorld(); virtual.projectionMatrix.copy(camera.projectionMatrix);
      texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      texMatrix.multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse).multiply(this.matrixWorld);
      // clip everything behind the mirror (oblique near plane)
      plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(virtual.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = virtual.projectionMatrix.elements;
      q.x = (Math.sign(clip.x) + pm[8]) / pm[0]; q.y = (Math.sign(clip.y) + pm[9]) / pm[5]; q.z = -1; q.w = (1 + pm[10]) / pm[14];
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - clipBias; pm[14] = clip.w;
      this.nested = true; this.visible = false;
      const cur = renderer.getRenderTarget(), shadowAuto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false; // the main pass already drew the shadow map this frame
      renderer.setRenderTarget(this.rt); renderer.state.buffers.depth.setMask(true); renderer.clear();
      renderer.render(scene, virtual);
      renderer.setRenderTarget(cur); renderer.shadowMap.autoUpdate = shadowAuto;
      this.visible = true; this.nested = false;
    };
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.geometry.dispose(); }
}
