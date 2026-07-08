/**
 * Nearest-node hit test in world space (the flat cosmos). O(n) over the position
 * buffer — ample for the 10^2..10^4 nodes this UI targets, and far simpler than
 * raycasting into a custom instanced geometry.
 *
 * PRECISION (2026-07-08): at density the old test used a fat `max(maxDist, radius)`
 * tolerance — a leaf's ~5-unit dot was pickable from 14 units away, so hovering a gap
 * grabbed a wrong neighbour. Now the hit tolerance is the node's OWN radius: you must
 * be roughly ON the dot, and among the dots you are inside the one whose centre is
 * NEAREST the cursor wins. `maxDist` is only a small FALLBACK floor, consulted solely
 * when the cursor is inside no dot at all (so a tiny far dot stays clickable) — a
 * contained hit always beats a floor-only one, however near the floor dot sits.
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
  let haveContained = false;
  for (let i = 0; i < count; i++) {
    const dx = (positions[i * 2] ?? 0) - x;
    const dy = (positions[i * 2 + 1] ?? 0) - y;
    const d = Math.hypot(dx, dy);
    const r = radii ? radii[i] ?? 0 : 0;
    if (d <= r) {
      // Genuinely inside this dot — contained hits always outrank floor-only ones.
      if (!haveContained || d < bestDist) {
        bestDist = d;
        best = i;
      }
      haveContained = true;
    } else if (!haveContained && d <= maxDist && d < bestDist) {
      // Fallback: cursor in a gap, nearest dot within the small floor stays clickable.
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
 * Nearest-node hit test in SCREEN space — the brain-mode counterpart of pickNearest.
 * Each node's CURRENT (morphed 3D) world position is projected to the screen by the
 * caller (`project`), so a tap on the perspective brain selects whatever dot is under
 * the finger.
 *
 * PRECISION (2026-07-08): the old test admitted any dot within `max(minPickPx,
 * radiusPx)` and then took the FRONT-MOST — so a foreground dot the cursor was NOT on
 * stole the pick from the background dot the cursor WAS on (the "picks something in
 * front, not under the cursor" bug at density). Now front-most decides only among dots
 * the cursor is GENUINELY INSIDE (d ≤ radiusPx) — true overlap, where picking what you
 * see is right. `minPickPx` is only a FALLBACK floor for when the cursor is inside no
 * dot (a tiny far dot stays tappable); there the NEAREST centre wins, and any contained
 * dot always beats a floor-only one. Pure and unit-testable: projection injected.
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
  let haveContained = false;
  for (let i = 0; i < count; i++) {
    const p = project(i);
    if (!p || !p.visible) continue;
    const d = Math.hypot(p.sx - px, p.sy - py);
    if (d <= p.radiusPx) {
      // Genuinely inside this dot. Among contained dots the FRONT-most (nearest the
      // camera) wins; a raw-distance tie-break settles co-planar overlaps. A contained
      // hit always outranks a floor-only one, so switch modes on the first one seen.
      if (!haveContained || p.depth < bestDepth - 1e-3 || (Math.abs(p.depth - bestDepth) <= 1e-3 && d < bestDist)) {
        bestDepth = p.depth;
        bestDist = d;
        best = i;
      }
      haveContained = true;
    } else if (!haveContained && d <= minPickPx && d < bestDist) {
      // Fallback: cursor inside no dot — the nearest small far dot stays tappable.
      bestDist = d;
      best = i;
    }
  }
  return best;
}
