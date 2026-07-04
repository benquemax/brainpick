/**
 * Nearest-node hit test in world space. O(n) over the position buffer —
 * ample for the 10^2..10^4 nodes this UI targets, and far simpler than
 * raycasting into a custom instanced geometry.
 */
export function pickNearest(
  positions: Float32Array,
  count: number,
  radii: Float32Array | null,
  x: number,
  y: number,
  maxDist: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = (positions[i * 2] ?? 0) - x;
    const dy = (positions[i * 2 + 1] ?? 0) - y;
    const d = Math.hypot(dx, dy);
    const limit = Math.max(maxDist, radii ? radii[i] ?? 0 : 0);
    if (d <= limit && d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** A node projected to the screen for 3D picking (brain mode). */
export interface Projected {
  /** Screen-pixel position of the node centre. */
  sx: number;
  sy: number;
  /** Node screen radius in pixels (its sprite's half-size). */
  radiusPx: number;
  /** Distance from the camera (for the front-most tie-break). */
  depth: number;
  /** False when the node is behind the camera / off the near-far range. */
  visible: boolean;
}

/**
 * Nearest-node hit test in SCREEN space — the brain-mode counterpart of
 * pickNearest. Each node's CURRENT (morphed 3D) world position is projected to
 * the screen by the caller (`project`), so a tap on the perspective brain selects
 * whatever dot is under the finger. Ties (overlapping dots) resolve to the
 * FRONT-MOST one — you pick what you see, not something hidden behind it. Pure and
 * unit-testable: the projection is injected, no three/DOM here.
 */
export function pickNearest3D(
  count: number,
  project: (i: number) => Projected | null,
  px: number,
  py: number,
  minPickPx: number,
): number {
  let best = -1;
  let bestDepth = Infinity;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const p = project(i);
    if (!p || !p.visible) continue;
    const d = Math.hypot(p.sx - px, p.sy - py);
    const limit = Math.max(minPickPx, p.radiusPx);
    if (d > limit) continue;
    // Prefer the front-most dot under the cursor; only fall back to raw screen
    // distance when nothing is clearly in front (depths within a hair).
    if (p.depth < bestDepth - 1e-3 || (Math.abs(p.depth - bestDepth) <= 1e-3 && d < bestDist)) {
      bestDepth = p.depth;
      bestDist = d;
      best = i;
    }
  }
  return best;
}
