/**
 * Orthographic 2D camera: drag/wheel/pinch pan-zoom via drei's
 * CameraControls (camera-controls), rotation disabled. Handles the initial
 * fit-to-graph and search/selection camera flights (smooth tween).
 */
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { GraphRuntime } from './runtime';

export function CameraRig({ runtime }: { runtime: GraphRuntime }) {
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const fitted = useRef(false);
  const size = useThree((s) => s.size);

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
  }, []);

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

  return <CameraControls ref={controlsRef} makeDefault />;
}
