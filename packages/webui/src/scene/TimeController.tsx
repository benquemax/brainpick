/**
 * Drives the TIME MACHINE's per-frame values on the runtime — kept out of React
 * state exactly like MorphController, so scrubbing/playing never re-renders the
 * scene. Each frame it:
 *   - eases runtime.timeTravelAmt toward its 0/1 target (the dissolve in/out),
 *   - advances the store's scrub index while playing (the growth movie), and
 *   - eases runtime.scrub toward the logical scrubIndex (buttery drag + step).
 * The node/edge shaders read runtime.timeTravelAmt + runtime.scrub into uniforms;
 * nothing here touches a GPU buffer.
 */
import { useFrame } from '@react-three/fiber';
import type { GraphRuntime } from './runtime';
import { TIME_MACHINE } from './tuning';
import { advancePlay } from '../time/timeline';

export function TimeController({ runtime }: { runtime: GraphRuntime }) {
  useFrame((_, dt) => {
    const s = runtime.store.getState();

    // Ease the whole reconstruction on/off. Below restEps it is fully the present.
    const ttTarget = s.timeTravel ? 1 : 0;
    runtime.timeTravelAmt += (ttTarget - runtime.timeTravelAmt) * TIME_MACHINE.toggleEase;
    if (ttTarget === 0 && runtime.timeTravelAmt < TIME_MACHINE.restEps) {
      runtime.timeTravelAmt = 0;
      if (s.timeTravelActive) s.setTimeTravelActive(false); // fully back → unmount the field/fog
    }
    if (ttTarget === 1 && runtime.timeTravelAmt > 1 - TIME_MACHINE.restEps) runtime.timeTravelAmt = 1;

    // Auto-advance the growth movie. Advancing the LOGICAL target (store.scrubIndex)
    // keeps the eased runtime.scrub trailing it smoothly; done → stop at the end.
    if (s.timeTravel && s.playing) {
      const { index, done } = advancePlay(
        s.scrubIndex,
        // Clamp dt so a stall (tab switch) can't leap the movie forward.
        Math.min(dt, 0.05),
        TIME_MACHINE.commitsPerSecond,
        s.timeline.commits.length,
      );
      s.setScrubIndex(index, true);
      if (done) s.setPlaying(false);
    }

    // Ease the animated scrub toward the target (snap when negligibly close).
    const target = s.scrubIndex;
    const next = runtime.scrub + (target - runtime.scrub) * TIME_MACHINE.scrubEase;
    const eased = Math.abs(next - target) < 0.001 ? target : next;
    // Stamp actual movement: the shaders decay the birth/mod flashes by
    // time-since-this (flashRecency), so a RESTING scrub settles to true
    // colors instead of holding every just-touched node at full glow.
    if (eased !== runtime.scrub) runtime.scrubStamp = runtime.now();
    runtime.scrub = eased;
  });
  return null;
}
