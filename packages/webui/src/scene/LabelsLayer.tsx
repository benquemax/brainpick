/**
 * HTML overlay labels, positioned by projecting node world positions.
 *
 * Two placement paths share one budget + selection flow, dispatched by the ACTIVE
 * render camera (which swaps ortho ⇄ perspective across every brain morph):
 *  - COSMOS (flat ortho): labels at the flat cosmos coords; semantic-zoom budget.
 *    Byte-for-byte the original behaviour.
 *  - BRAIN (perspective): each labelled node's CURRENT morphed 3D position
 *    (scene/runtime.morphedWorldOf — the exact mix the sprite shader + 3D picker
 *    use) projects to the screen, so names ride the dots as the brain forms and
 *    spins. Nodes behind the camera or on the brain's far hemisphere are culled.
 *
 * Semantic zoom: only the labelBudget highest-degree nodes get labels (hovered /
 * selected always). The pool of divs is mutated imperatively — no React re-render
 * per frame.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rgbToCss } from './colors';
import { entityRenderId } from '../graph/entities';
import { isBehindBrainCenter, projectLabelPointMat } from './labelProjection';
import { labelBudget } from './semanticZoom';
import { morphedWorldOf, type GraphRuntime } from './runtime';
import { BRAIN } from './tuning';

const OVERLAP_X = 116;
const OVERLAP_Y = 22;

export function LabelsLayer({ runtime, container }: { runtime: GraphRuntime; container: HTMLDivElement }) {
  const size = useThree((s) => s.size);
  const pool = useRef<HTMLDivElement[]>([]);
  const frame = useRef(0);
  const v = useRef(new THREE.Vector3());
  // Scratch objects for the perspective (brain) projection path. `viewProj`,
  // `camPos` and `camRight` are filled from BrainCameraRig's published pose
  // snapshot each frame (never from the live render camera — see below).
  const t = useMemo(
    () => ({
      world: new THREE.Vector3(),
      ndc: new THREE.Vector3(),
      edge: new THREE.Vector3(),
      viewProj: new THREE.Matrix4(),
      camPos: new THREE.Vector3(),
      camRight: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(() => {
    const divs = pool.current;
    return () => {
      for (const d of divs) d.remove();
      pool.current = [];
    };
  }, []);

  // Dispatch by the camera R3F is drawing with THIS frame (state.camera): it
  // swaps ortho ⇄ perspective on every brain morph. The FLAT cosmos projects
  // with that live ortho camera (drei's makeDefault controls own it, uncontested).
  //
  // The BRAIN path does NOT read the live perspective camera's pose: drei's
  // makeDefault CameraControls rebinds to the swapped camera and, at renderPriority
  // -1 (before every priority-0 frame), resets it to its stale init pose (the
  // origin) at the TOP of each frame. BrainCameraRig restores the real orbit pose
  // later in the frame — correct at render, but AFTER this layer would have read a
  // camera parked at the origin (centreDepth 0 → every label culled: the prod
  // labels-never-show bug, which React StrictMode masked in dev). So labels ride
  // the pose BrainCameraRig PUBLISHES after it positions the camera — one frame
  // old, pose-consistent with the dots, immune to the frame-start reset.
  useFrame((state) => {
    frame.current += 1;
    if (frame.current % 3 !== 0) return; // 20 Hz is plenty for labels

    const camera = state.camera;
    const perspective = !(camera as THREE.OrthographicCamera).isOrthographicCamera;
    const ui = runtime.store.getState();
    // Wait for BrainCameraRig's first published pose before labelling the brain —
    // one frame at most (its useFrame subscribes after this one). Leaves any prior
    // labels untouched rather than flashing them off during the swap.
    if (perspective && !runtime.brainCamValid) return;
    if (perspective) {
      t.viewProj.fromArray(runtime.brainViewProj);
      t.camPos.set(runtime.brainCamPos.x, runtime.brainCamPos.y, runtime.brainCamPos.z);
      t.camRight.set(runtime.brainCamRight.x, runtime.brainCamRight.y, runtime.brainCamRight.z);
    }
    const viewProj = t.viewProj;
    const camPos = t.camPos;

    // Budget: cosmos earns labels from semantic zoom; the hologram has no ortho
    // zoom, so it labels a fixed handful of top hubs. Both capped by the GPU tier.
    const budget = perspective
      ? Math.min(BRAIN.labelBudget, ui.gpu.labelBudget)
      : Math.min(
          labelBudget((camera as THREE.OrthographicCamera).zoom / (runtime.fitZoom || 1)),
          ui.gpu.labelBudget,
        );

    // Selection (doc OR entity) and hover are always labeled, then by degree.
    const focusId = ui.entitySelection !== null ? entityRenderId(ui.entitySelection) : ui.selection;
    const forced: number[] = [];
    for (const id of [focusId, ui.hovered]) {
      if (id !== null) {
        const i = runtime.index.get(id);
        if (i !== undefined) forced.push(i);
      }
    }
    const candidates = [...forced, ...runtime.labelOrder];

    // TIME MACHINE: while travelling, a node's label rides with its presence —
    // hide labels for nodes not yet born (or already gone) at the scrub position,
    // so no name floats over an empty patch of the young brain.
    const traveling = runtime.timeTravelAmt > 0.01;
    const present = (i: number): boolean => {
      const b = runtime.birthIdx[i] ?? -1;
      const d = runtime.deathIdx[i] ?? 1e9;
      return (b < 0 || runtime.scrub >= b) && runtime.scrub < d;
    };

    const placed: Array<{ x: number; y: number }> = [];
    const seen = new Set<number>();
    let used = 0;

    for (const i of candidates) {
      if (used >= budget) break;
      if (seen.has(i)) continue;
      seen.add(i);
      if (traveling && !present(i)) continue;
      const isForced = forced.includes(i);

      let px: number;
      let py: number;
      let lift: number; // pixels to raise the label above its dot

      if (perspective) {
        // The node's CURRENT morphed 3D world position (shared stagger math).
        morphedWorldOf(i, runtime.morph, runtime.positions, runtime.brainPositions, BRAIN.staggerSpan, t.world);
        // Far-side cull: a dot deep on the occluded back of the hologram gets no
        // label (but a hovered / selected node is always shown when it is in front
        // of the camera). Depth-based, so the visible front + centre always labels.
        if (!isForced && isBehindBrainCenter(t.world, camPos, BRAIN.labelBackMargin)) continue;
        const p = projectLabelPointMat(t.world, viewProj, size.width, size.height, t.ndc);
        if (!p.onScreen) continue; // behind the camera (ndcZ ≥ 1) or off-viewport
        px = p.sx;
        py = p.sy;
        // Lift above the dot's projected radius (the same right-axis projection the
        // 3D picker uses to size a dot), so the name floats just over it — clamped
        // so a dot near the camera can never fling its label off-screen. The
        // camera's world-right axis is part of the published pose snapshot.
        t.edge.copy(t.world).addScaledVector(t.camRight, runtime.radii[i] ?? 8).applyMatrix4(viewProj);
        const radiusPx = Math.hypot((t.edge.x - t.ndc.x) * 0.5 * size.width, (t.edge.y - t.ndc.y) * 0.5 * size.height);
        lift = Math.min(radiusPx + BRAIN.labelLift, 44);
      } else {
        const x = runtime.positions[i * 2] ?? 0;
        const y = runtime.positions[i * 2 + 1] ?? 0;
        v.current.set(x, y, 0).project(camera);
        if (Math.abs(v.current.x) > 1.05 || Math.abs(v.current.y) > 1.05) continue; // off-screen
        px = ((v.current.x + 1) / 2) * size.width;
        py = ((1 - v.current.y) / 2) * size.height;
        lift = (runtime.radii[i] ?? 6) * (camera as THREE.OrthographicCamera).zoom * 0.34 + 6;
      }

      if (!isForced && placed.some((p) => Math.abs(p.x - px) < OVERLAP_X && Math.abs(p.y - py) < OVERLAP_Y)) {
        continue;
      }
      placed.push({ x: px, y: py });

      let div = pool.current[used];
      if (!div) {
        div = document.createElement('div');
        div.className = 'node-label';
        container.appendChild(div);
        pool.current[used] = div;
      }
      const id = runtime.ids[i] as string;
      const title = runtime.titles[i] ?? id;
      if (div.textContent !== title) div.textContent = title;
      div.style.transform = `translate3d(${px.toFixed(1)}px, ${(py - lift).toFixed(1)}px, 0)`;
      // Color from the render buffer so entity (gold) and doc labels both match.
      div.style.color = rgbToCss([runtime.colors[i * 3] ?? 0.8, runtime.colors[i * 3 + 1] ?? 0.8, runtime.colors[i * 3 + 2] ?? 1]);
      const focus = focusId === id || ui.hovered === id;
      const hl = ui.highlight.has(id);
      div.classList.toggle('focus', focus);
      div.classList.toggle('hl', hl);
      div.style.display = '';
      used += 1;
    }
    for (let i = used; i < pool.current.length; i++) {
      const div = pool.current[i];
      if (div) div.style.display = 'none';
    }
  });

  return null;
}
