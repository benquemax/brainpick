/**
 * Pointer picking: hover highlights, click selects (opens the doc panel),
 * click on empty space clears. Distinguishes clicks from camera pans by
 * pointer travel + duration. Picking is a plain nearest-node scan in world
 * space (see pick.ts) — no raycasting against custom instanced geometry.
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { pickNearest } from './pick';
import { dirOfClusterId, isClusterId } from '../state/budget';
import { bareEntityId, isEntityRenderId } from '../graph/entities';
import type { GraphRuntime } from './runtime';

const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;

export function PointerControls({ runtime }: { runtime: GraphRuntime }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const el = gl.domElement;
    const v = new THREE.Vector3();

    const pickAt = (e: PointerEvent): number => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      v.set(nx, ny, 0).unproject(camera);
      const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
      return pickNearest(runtime.positions, runtime.liveCount, runtime.radii, v.x, v.y, 14 / zoom);
    };

    let down: { x: number; y: number; t: number } | null = null;

    const onMove = (e: PointerEvent) => {
      // In brain mode the perspective orbit camera owns the pointer; 2D picking
      // against the flat cosmos positions would be meaningless.
      if (runtime.store.getState().morphActive) return;
      const i = pickAt(e);
      const id = i >= 0 ? runtime.ids[i] ?? null : null;
      const s = runtime.store.getState();
      if (s.hovered !== id) s.setHovered(id);
      el.style.cursor = id !== null ? 'pointer' : '';
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      if (runtime.store.getState().morphActive) {
        down = null;
        return;
      }
      const travel = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (travel > CLICK_SLOP_PX || dt > CLICK_MAX_MS) return; // it was a pan
      const i = pickAt(e);
      const s = runtime.store.getState();
      if (i >= 0) {
        const id = runtime.ids[i] ?? null;
        if (id !== null && isClusterId(id)) {
          s.expandDir(dirOfClusterId(id)); // reveal the cluster's real docs
        } else if (id !== null && isEntityRenderId(id)) {
          s.selectEntity(bareEntityId(id)); // open the entity panel
        } else if (id !== null && s.layer === 'overlay') {
          s.selectDocInOverlay(id); // select the doc AND light its entities
        } else {
          s.select(id, false); // camera stays — user is here
        }
      } else {
        s.select(null);
      }
    };
    const onLeave = () => {
      runtime.store.getState().setHovered(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl, camera, runtime]);

  return null;
}
