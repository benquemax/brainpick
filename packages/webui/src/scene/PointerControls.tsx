/**
 * Pointer picking: hover highlights, click selects (opens the doc panel),
 * click on empty space clears. Distinguishes clicks from camera pans/orbits by
 * pointer travel + duration.
 *
 * Two picking paths share one selection flow:
 *  - COSMOS (flat ortho): a nearest-node scan in world space (pick.ts).
 *  - BRAIN (perspective): each node's CURRENT morphed 3D position is projected to
 *    the screen and the nearest dot under the finger wins (front-most on ties), so
 *    tapping a dot in the hologram opens its article exactly like in the cosmos.
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { pickNearest, pickNearest3D, type Projected } from './pick';
import { dirOfClusterId, isClusterId } from '../state/budget';
import { bareEntityId, isEntityRenderId } from '../graph/entities';
import { nodeStagger, type GraphRuntime } from './runtime';
import { BRAIN } from './tuning';

const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;
/** Minimum tap radius in brain mode, so small far dots stay tappable. */
const BRAIN_MIN_PICK_PX = 16;

export function PointerControls({ runtime }: { runtime: GraphRuntime }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const el = gl.domElement;
    const v = new THREE.Vector3();
    const world = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const right = new THREE.Vector3();
    const ndc = new THREE.Vector3();

    // --- COSMOS: flat nearest-node scan in world space. ---
    const pickAt = (e: PointerEvent): number => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      v.set(nx, ny, 0).unproject(camera);
      const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
      return pickNearest(runtime.positions, runtime.liveCount, runtime.radii, v.x, v.y, 14 / zoom);
    };

    // The node's CURRENT world position under the morph — mix of its flat cosmos
    // target and its 3D brain target, with the same per-node stagger the shader uses.
    const worldOfNode = (i: number, out: THREE.Vector3): boolean => {
      const bp = runtime.brainPositions;
      if (bp.length < (i + 1) * 3) return false;
      const span = BRAIN.staggerSpan;
      const m = Math.min(1, Math.max(0, (runtime.morph - nodeStagger(i) * span) / (1 - span)));
      const cx = runtime.positions[i * 2] ?? 0;
      const cy = runtime.positions[i * 2 + 1] ?? 0;
      out.set(
        cx + (bp[i * 3]! - cx) * m,
        cy + (bp[i * 3 + 1]! - cy) * m,
        bp[i * 3 + 2]! * m,
      );
      return true;
    };

    // --- BRAIN: project each morphed node to the screen; nearest dot wins. ---
    const pickAt3D = (e: PointerEvent): number => {
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const halfH = rect.height / 2;
      const project = (i: number): Projected | null => {
        if (!worldOfNode(i, world)) return null;
        const depth = world.distanceTo(camera.position);
        ndc.copy(world).project(camera);
        if (ndc.z >= 1) return null; // behind the camera / beyond far
        const sx = (ndc.x * 0.5 + 0.5) * rect.width;
        const sy = (-ndc.y * 0.5 + 0.5) * rect.height;
        // Size the dot: project a point one world-radius along the camera's right
        // axis and measure the screen gap to the centre.
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        const r = runtime.radii[i] ?? 8;
        edge.copy(world).addScaledVector(right, r).project(camera);
        const radiusPx = Math.hypot((edge.x - ndc.x) * 0.5 * rect.width, (edge.y - ndc.y) * halfH);
        return { sx, sy, radiusPx, depth, visible: true };
      };
      return pickNearest3D(runtime.liveCount, project, px, py, BRAIN_MIN_PICK_PX);
    };

    const pick = (e: PointerEvent): number =>
      runtime.store.getState().morphActive ? pickAt3D(e) : pickAt(e);

    let down: { x: number; y: number; t: number } | null = null;

    const onMove = (e: PointerEvent) => {
      const i = pick(e);
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
      const travel = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (travel > CLICK_SLOP_PX || dt > CLICK_MAX_MS) return; // it was a pan/orbit
      const i = pick(e);
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
