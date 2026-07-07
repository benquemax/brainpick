/**
 * Pure screen-projection helpers for the hologram labels (LabelsLayer), factored
 * out so the 3D placement math is unit-testable with a real THREE camera and no
 * DOM/WebGL. A node's CURRENT morphed world position (scene/runtime.morphedWorldOf)
 * projects to screen pixels here; nodes behind the camera / on the brain's far
 * hemisphere are culled so a name never floats over an occluded dot.
 */
import * as THREE from 'three';

export interface LabelPlacement {
  /** Screen-pixel position of the projected point (label anchor, before the lift). */
  sx: number;
  sy: number;
  /** NDC depth: ≥ 1 means behind the camera or beyond the far plane. */
  ndcZ: number;
  /** True when the point is in front of the camera AND within the viewport. */
  onScreen: boolean;
}

/**
 * Project a world point to screen pixels for label placement. `ndcOut` receives
 * the NDC (reused across calls to avoid per-frame allocation); the returned
 * `onScreen` folds the behind-camera (ndcZ ≥ 1) and off-viewport culls together.
 */
export function projectLabelPoint(
  world: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
  ndcOut: THREE.Vector3,
): LabelPlacement {
  ndcOut.copy(world).project(camera);
  const onScreen = ndcOut.z < 1 && Math.abs(ndcOut.x) <= 1.05 && Math.abs(ndcOut.y) <= 1.05;
  return {
    sx: (ndcOut.x * 0.5 + 0.5) * width,
    sy: (-ndcOut.y * 0.5 + 0.5) * height,
    ndcZ: ndcOut.z,
    onScreen,
  };
}

/**
 * Project a world point using a PRE-COMPOSED view-projection matrix
 * (`projectionMatrix · matrixWorldInverse`) instead of a live camera. This is
 * what the hologram labels use: BrainCameraRig publishes its camera's
 * view-projection AFTER it positions the orbit camera each frame, so labels
 * project with the exact pose the dots render with — never with the live render
 * camera, which drei's makeDefault controls reset to the origin at frame start.
 * Applying the composed matrix once is equivalent to `Vector3.project(camera)`
 * (the intermediate view space has w = 1), so the NDC / cull maths are identical.
 */
export function projectLabelPointMat(
  world: THREE.Vector3,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
  ndcOut: THREE.Vector3,
): LabelPlacement {
  ndcOut.copy(world).applyMatrix4(viewProj);
  const onScreen = ndcOut.z < 1 && Math.abs(ndcOut.x) <= 1.05 && Math.abs(ndcOut.y) <= 1.05;
  return {
    sx: (ndcOut.x * 0.5 + 0.5) * width,
    sy: (-ndcOut.y * 0.5 + 0.5) * height,
    ndcZ: ndcOut.z,
    onScreen,
  };
}

/**
 * Is a node clearly BEHIND the brain's centre (the origin the orbit camera
 * targets) in DEPTH — deep enough on the far side that the hologram's front
 * occludes it? Compares the node's camera-distance to the centre's: a node past
 * `centre × (1 + marginFactor)` is on the occluded far side. Depth-based, NOT a
 * hemisphere split through the origin — so the visible front + central cloud (the
 * majority of a volumetric brain) is never culled, only the clearly-behind dots.
 */
export function isBehindBrainCenter(world: THREE.Vector3, cameraPos: THREE.Vector3, marginFactor: number): boolean {
  const centreDepth = cameraPos.length(); // camera → brain centre (origin)
  const nodeDepth = cameraPos.distanceTo(world); // camera → node
  return nodeDepth > centreDepth * (1 + marginFactor);
}
