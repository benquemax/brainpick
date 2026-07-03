/**
 * Ghost-edge geometry helpers: a ghost link points from a real node toward a
 * PHANTOM target (a path no document backs). The phantom has no simulated
 * position, so it hangs at a deterministic offset from its source — the
 * direction is hashed from the target path, stable across frames and reloads.
 */
import type { GhostEdge } from '../graph/types';

export interface GhostAnchor {
  /** Render-order index of the live source node. */
  sourceIndex: number;
  /** World-space offset from the source to the phantom marker. */
  dx: number;
  dy: number;
}

/** FNV-1a 32-bit (same recipe as scene/colors.ts) — stable everywhere. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic offset (angle from the target-id hash) at `distance`. */
export function phantomOffset(targetId: string, distance: number): [number, number] {
  const angle = (fnv1a(targetId) % 3600) * (Math.PI / 1800); // 0.1° steps over the circle
  return [Math.cos(angle) * distance, Math.sin(angle) * distance];
}

/** Resolve ghosts to per-frame anchors; ghosts without a live source are skipped. */
export function buildGhostAnchors(
  ghosts: readonly GhostEdge[],
  index: ReadonlyMap<string, number>,
  distance: number,
): GhostAnchor[] {
  const anchors: GhostAnchor[] = [];
  for (const ghost of ghosts) {
    const sourceIndex = index.get(ghost.source);
    if (sourceIndex === undefined) continue;
    const [dx, dy] = phantomOffset(ghost.target, distance);
    anchors.push({ sourceIndex, dx, dy });
  }
  return anchors;
}
