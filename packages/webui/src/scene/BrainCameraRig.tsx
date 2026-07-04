/**
 * The perspective ORBIT camera for brain mode. drei's CameraControls makeDefault
 * only swaps state.controls (not the render camera), so this rig owns a
 * THREE.PerspectiveCamera and installs it as the R3F default while mounted,
 * restoring the ortho cosmos camera on unmount. Touch-first via camera-controls:
 * one-finger orbit, pinch dolly + two-finger twist. A slow idle auto-rotation
 * spins the brain and pauses whenever you touch it.
 *
 * It is mounted only while the morph is active (CosmosCanvas gates it), and the
 * cosmos rig's controls are disabled meanwhile, so only one camera reacts to a
 * gesture at a time.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import CameraControlsImpl from 'camera-controls';
import { bounds } from './brainSDF';
import { BRAIN, BRAIN_CAMERA } from './tuning';
import type { GraphRuntime } from './runtime';

// camera-controls needs THREE installed once; full THREE is a safe superset of
// the subset drei installs for the cosmos rig.
CameraControlsImpl.install({ THREE });

/** The brain's world-space radius (largest half-extent × scale). */
function brainRadius(): number {
  return BRAIN.scale * Math.max(...bounds.max.map(Math.abs), ...bounds.min.map(Math.abs));
}

export function BrainCameraRig({ runtime }: { runtime: GraphRuntime }) {
  const gl = useThree((s) => s.gl);
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);

  const camera = useMemo(
    () => new THREE.PerspectiveCamera(BRAIN_CAMERA.fov, 1, BRAIN_CAMERA.near, BRAIN_CAMERA.far),
    [],
  );
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const lastInteract = useRef(-Infinity);

  useEffect(() => {
    const prevCamera = get().camera;
    const R = brainRadius();
    const dist = R * BRAIN_CAMERA.distanceFactor;
    camera.aspect = get().size.width / get().size.height || 1;
    camera.updateProjectionMatrix();

    const controls = new CameraControlsImpl(camera);
    controls.connect(gl.domElement);
    const A = CameraControlsImpl.ACTION;
    controls.mouseButtons.left = A.ROTATE;
    controls.mouseButtons.right = A.TRUCK;
    controls.mouseButtons.middle = A.DOLLY;
    controls.mouseButtons.wheel = A.DOLLY;
    controls.touches.one = A.TOUCH_ROTATE; // one finger orbits
    controls.touches.two = A.TOUCH_DOLLY_ROTATE; // pinch dolly + two-finger twist
    controls.touches.three = A.TOUCH_TRUCK;
    controls.smoothTime = BRAIN_CAMERA.smoothTime;
    controls.draggingSmoothTime = BRAIN_CAMERA.smoothTime * 0.5;
    controls.minDistance = R * BRAIN_CAMERA.minDistanceFactor;
    controls.maxDistance = R * BRAIN_CAMERA.maxDistanceFactor;
    // A gentle 3/4 starting pose looking at the origin.
    void controls.setLookAt(dist * 0.32, dist * 0.16, dist, 0, 0, 0, false);
    controlsRef.current = controls;

    const touched = () => {
      lastInteract.current = performance.now();
      runtime.orbited = true;
    };
    controls.addEventListener('controlstart', touched);
    controls.addEventListener('control', touched);

    set({ camera }); // take over the render camera

    return () => {
      controls.removeEventListener('controlstart', touched);
      controls.removeEventListener('control', touched);
      controls.disconnect();
      controls.dispose();
      controlsRef.current = null;
      set({ camera: prevCamera }); // hand the ortho cosmos camera back
    };
    // Created once for the life of the mount; resize is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, set, get, runtime]);

  // Keep the perspective aspect in step with the viewport (R3F does not manage a
  // camera it did not create).
  useEffect(() => {
    camera.aspect = size.width / size.height || 1;
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const idleMs = performance.now() - lastInteract.current;
    if (idleMs > BRAIN_CAMERA.autoRotateResumeMs) {
      // Slow idle spin — resumes only after the gesture-pause window.
      controls.rotate(BRAIN_CAMERA.autoRotateSpeed * Math.min(dt, 0.05), 0, false);
    }
    controls.update(dt);
    runtime.brainAzimuth = controls.azimuthAngle;
  });

  return null;
}
