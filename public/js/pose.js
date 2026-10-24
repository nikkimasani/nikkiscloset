// On-device body landmark detection (MediaPipe Pose, bundled in /vendor + /models — nothing is uploaded).
let landmarker;

export async function detectPose(imageEl) {
  if (!landmarker) {
    const { PoseLandmarker, FilesetResolver } = await import('../vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('../models/pose_landmarker_full.task', import.meta.url).href },
      runningMode: 'IMAGE', numPoses: 1,
    });
  }
  return landmarker.detect(imageEl).landmarks[0] || null;
}
