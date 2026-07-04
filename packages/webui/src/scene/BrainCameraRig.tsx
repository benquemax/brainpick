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
import { orbitStartPosition } from './brainCamera';
import { BRAIN, BRAIN_CAMERA } from './tuning';
import { nodeStagger, type GraphRuntime } from './runtime';

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
  const returning = useRef(false);

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
    // A gentle 3/4 starting pose, tilted down off the equator so the idle spin
    // reveals the brain's depth (shared spherical math with the spin, testable).
    const [sx, sy, sz] = orbitStartPosition(dist, BRAIN_CAMERA.startAzimuthAngle, BRAIN_CAMERA.startPolarAngle);
    void controls.setLookAt(sx, sy, sz, 0, 0, 0, false);
    controlsRef.current = controls;

    const touched = () => {
      lastInteract.current = performance.now();
      runtime.orbited = true;
    };
    controls.addEventListener('controlstart', touched);
    controls.addEventListener('control', touched);

    set({ camera }); // take over the render camera

    // e2e/debug hook: project a node's CURRENT morphed position to client pixels
    // (the same mix the sprite shader and the 3D picker use), so a test can tap a
    // real dot in the hologram. Lives only while brain mode is mounted.
    const wp = new THREE.Vector3();
    runtime.projectNodeToScreen = (i: number) => {
      const bp = runtime.brainPositions;
      if (i < 0 || bp.length < (i + 1) * 3) return null;
      const span = BRAIN.staggerSpan;
      const m = Math.min(1, Math.max(0, (runtime.morph - nodeStagger(i) * span) / (1 - span)));
      const cx = runtime.positions[i * 2] ?? 0;
      const cy = runtime.positions[i * 2 + 1] ?? 0;
      wp.set(cx + (bp[i * 3]! - cx) * m, cy + (bp[i * 3 + 1]! - cy) * m, bp[i * 3 + 2]! * m).project(camera);
      if (wp.z >= 1) return null;
      const rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + (wp.x * 0.5 + 0.5) * rect.width, y: rect.top + (-wp.y * 0.5 + 0.5) * rect.height };
    };

    return () => {
      controls.removeEventListener('controlstart', touched);
      controls.removeEventListener('control', touched);
      controls.disconnect();
      controls.dispose();
      controlsRef.current = null;
      runtime.projectNodeToScreen = null;
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
    const leaving = runtime.store.getState().mode === 'cosmos';
    if (leaving) {
      // Returning to the flat cosmos: ease the perspective camera to a HEAD-ON,
      // face-the-viewer pose (azimuth → the nearest whole turn, polar → the
      // equator) so the dots settle onto a plane that is ALREADY facing front
      // when the ortho cosmos camera takes over — the morph eases both ways, no
      // snap/teleport at the swap. Triggered once, then camera-controls damps it.
      if (!returning.current) {
        returning.current = true;
        const flat = Math.round(controls.azimuthAngle / (2 * Math.PI)) * 2 * Math.PI;
        void controls.rotateTo(flat, Math.PI / 2, true);
      }
    } else {
      returning.current = false;
      const idleMs = performance.now() - lastInteract.current;
      if (idleMs > BRAIN_CAMERA.autoRotateResumeMs) {
        // The Milky-Way turntable: advance the AZIMUTH around the vertical (Y) axis
        // (polar delta 0 keeps the tilt). Active immediately on entry (lastInteract
        // starts at -Infinity); pauses on gesture, resumes after the window.
        controls.rotate(BRAIN_CAMERA.autoRotateSpeed * Math.min(dt, 0.05), 0, false);
      }
    }
    controls.update(dt);
    runtime.brainAzimuth = controls.azimuthAngle;
  });

  return null;
}
