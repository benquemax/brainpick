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
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { pickNearest, pickNearest3D, presentAtScrub, type Projected } from './pick';
import { focusIndex, lensAllowsInteraction, selectionRenderId } from './emphasis';
import { dirOfClusterId, isClusterId } from '../state/budget';
import { bareEntityId, isEntityRenderId } from '../graph/entities';
import { morphedWorldOf, type GraphRuntime } from './runtime';
import { BRAIN, PICK_CORE_FRACTION } from './tuning';

const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;
/** Minimum tap radius in brain mode, so small far dots stay tappable. Only a FALLBACK
 * floor now — a dot the cursor is genuinely inside always wins first (pick.ts). */
const BRAIN_MIN_PICK_PX = 16;
/** Cosmos fallback floor in SCREEN pixels (÷ zoom → world), consulted only when the
 * cursor is inside no dot. Tight (was an effective ~14 world units) so hovering a gap
 * no longer grabs a wrong neighbour — you must be roughly ON the dot. */
const COSMOS_MIN_PICK_PX = 8;

export function PointerControls({ runtime }: { runtime: GraphRuntime }) {
  const gl = useThree((s) => s.gl);
  // Read the R3F state getter, not a snapshot of the camera: the render camera
  // swaps ortho⇄perspective across every brain morph, and picking MUST use the
  // exact camera the scene was drawn with this frame. Capturing `state.camera`
  // in the effect closure risks a stale pick during the swap (clicks miss).
  const get = useThree((s) => s.get);

  useEffect(() => {
    const el = gl.domElement;
    const v = new THREE.Vector3();
    const world = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const right = new THREE.Vector3();
    const ndc = new THREE.Vector3();

    // What the lens (or the time machine) hides, the picker must not see —
    // an invisible node kept catching clicks aimed at the visible one behind
    // it (Tom, 2026-07-12). One rule with the layers (scene/emphasis): lens
    // members, the selection, and the focus's lens-piercing neighbours are
    // clickable; everything else is simply not there. Undefined when nothing
    // hides anything, so the common path pays nothing.
    const makePickable = (): ((i: number) => boolean) | undefined => {
      const st = runtime.store.getState();
      const traveling = runtime.timeTravelAmt > 0.5;
      if (!st.dimOthers && !traveling) return undefined;
      const selId = selectionRenderId(st.selection, st.entitySelection);
      const hoveredIdx = st.hovered !== null ? runtime.index.get(st.hovered) ?? -1 : -1;
      const selectionIdx = selId !== null ? runtime.index.get(selId) ?? -1 : -1;
      const hoveredHidden = st.dimOthers && st.hovered !== null && !st.highlight.has(st.hovered);
      const focus = focusIndex(hoveredIdx, selectionIdx, hoveredHidden);
      const neighborSet = st.dimOthers && focus >= 0 ? new Set(runtime.neighbors[focus] ?? []) : null;
      return (i: number): boolean => {
        if (traveling && !presentAtScrub(runtime.birthIdx[i] ?? -1, runtime.deathIdx[i] ?? 1e9, runtime.scrub)) {
          return false;
        }
        const id = runtime.ids[i] as string;
        return lensAllowsInteraction({
          dimOthers: st.dimOthers,
          inHighlight: st.highlight.has(id),
          isSelection: selId === id,
          isFocusNeighbor: neighborSet !== null && neighborSet.has(i),
        });
      };
    };

    // --- COSMOS: flat nearest-node scan in world space. ---
    const pickAt = (e: PointerEvent, camera: THREE.Camera): number => {
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      v.set(nx, ny, 0).unproject(camera);
      const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
      return pickNearest(
        runtime.positions,
        runtime.liveCount,
        runtime.radii,
        v.x,
        v.y,
        COSMOS_MIN_PICK_PX / zoom,
        PICK_CORE_FRACTION, // hitbox = the visible dot, not the halo quad
        makePickable(),
      );
    };

    // --- BRAIN: project each morphed node to the screen; nearest dot wins. ---
    const pickAt3D = (e: PointerEvent, camera: THREE.Camera): number => {
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const halfH = rect.height / 2;
      const pickable = makePickable();
      const project = (i: number): Projected | null => {
        if (pickable && !pickable(i)) return null; // hidden by the lens/scrub: not there
        // The node's CURRENT morphed world position — the exact mix (flat cosmos
        // target ⇄ 3D brain target, per-node stagger) the shader + labels share.
        if (!morphedWorldOf(i, runtime.morph, runtime.positions, runtime.brainPositions, BRAIN.staggerSpan, world)) return null;
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
      // hitbox = the visible dot, not the halo quad — a near node's halo must not
      // shadow the far node the cursor is dead-centre on (Tom, 2026-07-12).
      return pickNearest3D(runtime.liveCount, project, px, py, BRAIN_MIN_PICK_PX, PICK_CORE_FRACTION);
    };

    // Dispatch by the ACTUAL render camera, not by morphActive: during the swap
    // (morph just settled but the perspective camera has not yet handed back to
    // the ortho one) render and pick must still agree, or the flat dots become
    // unclickable. Ortho → flat scan; perspective → 3D projection scan.
    const pick = (e: PointerEvent): number => {
      const camera = get().camera;
      return (camera as THREE.OrthographicCamera).isOrthographicCamera
        ? pickAt(e, camera)
        : pickAt3D(e, camera);
    };

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
  }, [gl, get, runtime]);

  // e2e/debug: mirror the ACTUAL render camera (state.camera, read live inside
  // the frame loop) so a test can assert the flat cosmos is drawn by the ortho
  // camera with a viewport-matched frustum (no perspective stretch).
  useFrame((state) => {
    const cam = state.camera as THREE.OrthographicCamera & THREE.PerspectiveCamera;
    const ortho = cam.isOrthographicCamera === true;
    const viewportAspect = state.size.height > 0 ? state.size.width / state.size.height : 1;
    const frustumAspect = ortho
      ? (cam.right - cam.left) / (cam.top - cam.bottom || 1)
      : cam.aspect;
    runtime.activeCamera = { ortho, zoom: cam.zoom ?? 1, frustumAspect, viewportAspect };
  });

  return null;
}
