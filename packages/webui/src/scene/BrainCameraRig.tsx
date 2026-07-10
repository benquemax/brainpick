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
import { morphedWorldOf, type GraphRuntime } from './runtime';

// camera-controls needs THREE installed once; full THREE is a safe superset of
// the subset drei installs for the cosmos rig.
CameraControlsImpl.install({ THREE });

/** The brain's world-space radius (largest half-extent × scale). */
function brainRadius(): number {
  return BRAIN.scale * Math.max(...bounds.max.map(Math.abs), ...bounds.min.map(Math.abs));
}

/**
 * Re-derive an orthographic camera's frustum for the current viewport — the same
 * left/right/top/bottom R3F assigns in its own resize handler. R3F only refreshes
 * the frustum of the ACTIVE render camera on resize, so a resize while the brain's
 * perspective camera is active leaves the ortho cosmos frustum stale; we call this
 * when handing rendering back so the flat map is never horizontally stretched.
 */
function refreshOrthoFrustum(cam: THREE.Camera, width: number, height: number): void {
  // `manual` is R3F's opt-out flag (it is set true only if the camera was given a
  // frustum prop); the cosmos camera has none, so R3F owns its frustum and so may we.
  const o = cam as THREE.OrthographicCamera & { manual?: boolean };
  if (!o.isOrthographicCamera || o.manual || width === 0 || height === 0) return;
  o.left = width / -2;
  o.right = width / 2;
  o.top = height / 2;
  o.bottom = height / -2;
  o.updateProjectionMatrix();
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
  // The last flyTo nonce this rig has flown to. 0 = none handled yet, so a flyTo
  // already present at mount (e.g. a brain_show that flies AND enters the brain
  // in one turn, set before this rig existed) is replayed once the morph settles.
  const lastFlyNonce = useRef(0);
  const targetTmp = useMemo(() => new THREE.Vector3(), []);
  const flyWorld = useMemo(() => new THREE.Vector3(), []);
  // Scratch for the per-frame pose snapshot the labels project from.
  const pose = useMemo(() => ({ viewProj: new THREE.Matrix4(), right: new THREE.Vector3() }), []);

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
      if (!morphedWorldOf(i, runtime.morph, runtime.positions, runtime.brainPositions, BRAIN.staggerSpan, wp)) return null;
      wp.project(camera);
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
      runtime.brainCamValid = false; // the published pose is stale once we leave the brain
      // Hand the ortho cosmos camera back with a frustum matched to the CURRENT
      // viewport. R3F only refreshes the ACTIVE camera's frustum on resize, so a
      // resize while the perspective brain camera was active left the ortho one
      // stale — restore it AND re-derive its frustum, or the flat map returns
      // horizontally stretched. PointerControls picks with whatever camera is
      // active, so render and pick stay in agreement across the swap.
      const vp = get().size;
      refreshOrthoFrustum(prevCamera, vp.width, vp.height);
      set({ camera: prevCamera });
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
    const state = runtime.store.getState();

    // SEARCH / PRESENTATION-AS-FLIGHT: a flyTo (search focus, entity select, or an
    // agent presentation's focus) frames the target's 3D position — re-centre the
    // orbit on its CURRENT morphed world position (the same stagger math the dots
    // use) and dolly to a reading distance. Handled per-frame + nonce-tracked (not
    // via a store subscription) so a flyTo issued BEFORE this rig mounted — a
    // brain_show that flies AND switches cosmos→brain in one turn — is replayed
    // once the morph has settled enough for the brain positions to be real.
    const fly = state.flyTo;
    if (fly && fly.nonce !== lastFlyNonce.current && runtime.morph > 0.85) {
      lastFlyNonce.current = fly.nonce;
      const i = runtime.index.get(fly.id);
      if (i !== undefined) {
        morphedWorldOf(i, runtime.morph, runtime.positions, runtime.brainPositions, BRAIN.staggerSpan, flyWorld);
        const dist = Math.max(controls.minDistance, brainRadius() * BRAIN_CAMERA.focusDistanceFactor);
        void controls.moveTo(flyWorld.x, flyWorld.y, flyWorld.z, true);
        void controls.dollyTo(dist, true);
        lastInteract.current = performance.now(); // hold the idle spin so the focus stays framed
      }
    }

    const leaving = state.mode === 'cosmos';
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
      // Published for e2e/debug: the deterministic mirror of the branch below —
      // true exactly while a gesture holds the turntable inside its resume window
      // (asserting THIS is flake-proof; measuring motion over wall-clock is not).
      runtime.spinPaused = idleMs <= BRAIN_CAMERA.autoRotateResumeMs;
      if (!runtime.spinPaused) {
        // The Milky-Way turntable: advance the AZIMUTH around the vertical (Y) axis
        // (polar delta 0 keeps the tilt). Active immediately on entry (lastInteract
        // starts at -Infinity); pauses on gesture, resumes after the window.
        controls.rotate(BRAIN_CAMERA.autoRotateSpeed * Math.min(dt, 0.05), 0, false);
      }
    }
    controls.update(dt);
    runtime.brainAzimuth = controls.azimuthAngle;
    // Mirror the orbit target for e2e/debug: a search-flight moves it to the hit.
    controls.getTarget(targetTmp);
    runtime.brainTarget.x = targetTmp.x;
    runtime.brainTarget.y = targetTmp.y;
    runtime.brainTarget.z = targetTmp.z;

    // Publish the pose the labels project from. controls.update() just refreshed
    // the camera's world matrix (and, being a Camera, its matrixWorldInverse); we
    // compose projection·viewInverse ONCE so LabelsLayer needs no live camera.
    // This runs at priority 0 (after drei's -1 frame-start reset), so the snapshot
    // is the true render pose, not the origin the reset left behind.
    camera.updateMatrixWorld();
    pose.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    pose.viewProj.toArray(runtime.brainViewProj);
    runtime.brainCamPos.x = camera.position.x;
    runtime.brainCamPos.y = camera.position.y;
    runtime.brainCamPos.z = camera.position.z;
    pose.right.setFromMatrixColumn(camera.matrixWorld, 0);
    runtime.brainCamRight.x = pose.right.x;
    runtime.brainCamRight.y = pose.right.y;
    runtime.brainCamRight.z = pose.right.z;
    runtime.brainCamValid = true;
  });

  return null;
}
