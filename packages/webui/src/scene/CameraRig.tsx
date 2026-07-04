/**
 * Orthographic 2D camera: drag/wheel/pinch pan-zoom via drei's
 * CameraControls (camera-controls), rotation disabled. Handles the initial
 * fit-to-graph, search/selection camera flights, bookmark save/recall and
 * the overview command (RTS-style fit-all) — every move a smooth tween.
 */
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CameraCommand } from '../state/store';
import type { GraphRuntime } from './runtime';

export function CameraRig({ runtime }: { runtime: GraphRuntime }) {
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const fitted = useRef(false);
  const size = useThree((s) => s.size);
  // The overview command needs the viewport size outside the render cycle.
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const A = CameraControlsImpl.ACTION;
    // 2D presentation: every gesture pans or zooms; nothing orbits.
    controls.mouseButtons.left = A.TRUCK;
    controls.mouseButtons.right = A.TRUCK;
    controls.mouseButtons.middle = A.ZOOM;
    controls.mouseButtons.wheel = A.ZOOM;
    controls.touches.one = A.TOUCH_TRUCK;
    controls.touches.two = A.TOUCH_ZOOM_TRUCK;
    controls.touches.three = A.TOUCH_TRUCK;
    controls.dollyToCursor = true;
    controls.draggingSmoothTime = 0.05;
    controls.smoothTime = 0.3;
    controls.enabled = !runtime.store.getState().morphActive;
  }, [runtime]);

  // While the brain morph is on screen the perspective BrainCameraRig owns the
  // gestures — disable the ortho cosmos controls so they are not trucked around
  // underneath it (the cosmos pose is preserved for the return).
  useEffect(() => {
    return runtime.store.subscribe((state, prev) => {
      if (state.morphActive === prev.morphActive) return;
      const controls = controlsRef.current;
      if (controls) controls.enabled = !state.morphActive;
    });
  }, [runtime]);

  // Fit the cosmos once the first simulated positions arrive.
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls || fitted.current) return;
    if (!runtime.firstPositionsSeen || runtime.liveCount === 0) return;
    fitted.current = true;
    const r = Math.max(40, runtime.boundsRadius() * 1.3);
    const zoom = Math.min(size.width, size.height) / (2 * r);
    runtime.fitZoom = zoom;
    controls.minZoom = zoom * 0.2;
    controls.maxZoom = zoom * 150;
    void controls.setLookAt(0, 0, 100, 0, 0, 0, false);
    void controls.zoomTo(zoom, false);
  });

  // Camera flight on flyTo requests (search focus, neighbor navigation).
  useEffect(() => {
    return runtime.store.subscribe((state, prev) => {
      if (!state.flyTo || state.flyTo === prev.flyTo) return;
      const controls = controlsRef.current;
      const pos = runtime.positionOf(state.flyTo.id);
      if (!controls || !pos) return;
      void controls.moveTo(pos[0], pos[1], 0, true);
      // Reading distance: render the node's halo at ~56 px regardless of
      // graph size, clamped so tiny graphs never blow one node full-screen.
      const index = runtime.index.get(state.flyTo.id);
      const halo = index !== undefined ? runtime.radii[index] ?? 8 : 8;
      const targetZoom = Math.min(Math.max(56 / halo, runtime.fitZoom * 1.15), runtime.fitZoom * 40);
      void controls.zoomTo(targetZoom, true);
    });
  }, [runtime]);

  // Bookmark recall + overview commands (HUD buttons, keys 1–3 / 0).
  // Nonce-tracked and replayed on mount: the R3F tree mounts asynchronously,
  // so a command issued during boot must not be dropped.
  useEffect(() => {
    let lastNonce = 0;
    const run = (command: CameraCommand) => {
      const controls = controlsRef.current;
      if (!controls || command.nonce === lastNonce) return;
      lastNonce = command.nonce;
      if (command.kind === 'pose') {
        void controls.moveTo(command.pose.x, command.pose.y, 0, true);
        void controls.zoomTo(command.pose.zoom, true);
      } else {
        // Overview: recenter and fit the whole cosmos (recomputed live —
        // the graph may have grown since the initial fit).
        const r = Math.max(40, runtime.boundsRadius() * 1.3);
        const zoom = Math.min(sizeRef.current.width, sizeRef.current.height) / (2 * r);
        runtime.fitZoom = zoom;
        void controls.moveTo(0, 0, 0, true);
        void controls.zoomTo(zoom, true);
      }
    };
    const pending = runtime.store.getState().cameraCommand;
    if (pending) run(pending);
    return runtime.store.subscribe((state) => {
      if (state.cameraCommand) run(state.cameraCommand);
    });
  }, [runtime]);

  // Bookmark save requests: capture the CURRENT pose into the asked slot.
  useEffect(() => {
    const target = new THREE.Vector3();
    let lastNonce = 0;
    const capture = (request: { slot: number; nonce: number }) => {
      const controls = controlsRef.current;
      if (!controls || request.nonce === lastNonce) return;
      lastNonce = request.nonce;
      controls.getTarget(target);
      const zoom = (controls.camera as THREE.OrthographicCamera).zoom;
      runtime.store.getState().saveBookmark(request.slot, { x: target.x, y: target.y, zoom });
    };
    const pending = runtime.store.getState().bookmarkSaveRequest;
    if (pending) capture(pending);
    return runtime.store.subscribe((state) => {
      if (state.bookmarkSaveRequest) capture(state.bookmarkSaveRequest);
    });
  }, [runtime]);

  return <CameraControls ref={controlsRef} makeDefault />;
}
