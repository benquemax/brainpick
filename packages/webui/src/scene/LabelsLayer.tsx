/**
 * HTML overlay labels, positioned by projecting node world positions.
 * Semantic zoom: only the labelBudget(zoom) highest-degree nodes get labels;
 * zooming in earns more. Off-screen and overlapping candidates are culled.
 * The pool of divs is mutated imperatively — no React re-render per frame.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { rgbToCss } from './colors';
import { entityRenderId } from '../graph/entities';
import { labelBudget } from './semanticZoom';
import type { GraphRuntime } from './runtime';

const OVERLAP_X = 116;
const OVERLAP_Y = 22;

export function LabelsLayer({ runtime, container }: { runtime: GraphRuntime; container: HTMLDivElement }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const pool = useRef<HTMLDivElement[]>([]);
  const frame = useRef(0);
  const v = useRef(new THREE.Vector3());

  useEffect(() => {
    const divs = pool.current;
    return () => {
      for (const d of divs) d.remove();
      pool.current = [];
    };
  }, []);

  useFrame(() => {
    frame.current += 1;
    if (frame.current % 3 !== 0) return; // 20 Hz is plenty for labels

    // Labels are placed at the flat cosmos positions; once the morph is past
    // halfway they would no longer sit on their (now 3D) nodes, so hide them.
    if (runtime.morph > 0.5) {
      for (const div of pool.current) div.style.display = 'none';
      return;
    }

    const state = runtime.store.getState();
    const zoomRatio = (camera as THREE.OrthographicCamera).zoom / (runtime.fitZoom || 1);
    // Semantic-zoom budget, capped by the GPU tier's label ceiling.
    const budget = Math.min(labelBudget(zoomRatio), state.gpu.labelBudget);

    // Selection (doc OR entity) and hover are always labeled, then by degree.
    const focusId = state.entitySelection !== null ? entityRenderId(state.entitySelection) : state.selection;
    const forced: number[] = [];
    for (const id of [focusId, state.hovered]) {
      if (id !== null) {
        const i = runtime.index.get(id);
        if (i !== undefined) forced.push(i);
      }
    }
    const candidates = [...forced, ...runtime.labelOrder];

    const placed: Array<{ x: number; y: number }> = [];
    const seen = new Set<number>();
    let used = 0;

    for (const i of candidates) {
      if (used >= budget) break;
      if (seen.has(i)) continue;
      seen.add(i);
      const x = runtime.positions[i * 2] ?? 0;
      const y = runtime.positions[i * 2 + 1] ?? 0;
      v.current.set(x, y, 0).project(camera);
      if (Math.abs(v.current.x) > 1.05 || Math.abs(v.current.y) > 1.05) continue; // off-screen
      const px = ((v.current.x + 1) / 2) * size.width;
      const py = ((1 - v.current.y) / 2) * size.height;
      const isForced = forced.includes(i);
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
      div.style.transform = `translate3d(${px.toFixed(1)}px, ${(py - (runtime.radii[i] ?? 6) * (camera as THREE.OrthographicCamera).zoom * 0.34 - 6).toFixed(1)}px, 0)`;
      // Color from the render buffer so entity (gold) and doc labels both match.
      div.style.color = rgbToCss([runtime.colors[i * 3] ?? 0.8, runtime.colors[i * 3 + 1] ?? 0.8, runtime.colors[i * 3 + 2] ?? 1]);
      const focus = focusId === id || state.hovered === id;
      const hl = state.highlight.has(id);
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
