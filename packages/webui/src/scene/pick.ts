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
