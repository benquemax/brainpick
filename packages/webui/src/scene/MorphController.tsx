/**
 * Drives the single per-frame morph value (runtime.morph) toward its 0/1 target
 * (cosmos ⇄ brain), which the node + edge shaders read into uMorph. Kept out of
 * React state so the morph never triggers a re-render; the store only learns
 * when the transition finishes (setMorphActive(false)), so the perspective rig
 * and shell can unmount once we are fully back in the flat cosmos.
 */
import { useFrame } from '@react-three/fiber';
import type { GraphRuntime } from './runtime';
import { BRAIN } from './tuning';

export function MorphController({ runtime }: { runtime: GraphRuntime }) {
  useFrame(() => {
    const s = runtime.store.getState();
    const target = s.mode === 'brain' ? 1 : 0;
    const next = runtime.morph + (target - runtime.morph) * BRAIN.morphEase;
    runtime.morph = Math.abs(next - target) < 0.0005 ? target : next;
    if (target === 0 && runtime.morph <= BRAIN.morphRestEps) {
      runtime.morph = 0;
      if (s.morphActive) s.setMorphActive(false); // transition complete → unmount rig/shell
    }
  });
  return null;
}
