/**
 * Pure emphasis derivation — the single source of the "what lights up" rule the
 * node + edge layers apply imperatively each frame. Kept here (no three/DOM) so the
 * hover/selection/neighbour math is unit-tested against the EMPHASIS levels in
 * tuning.ts, and so cosmos and brain share one behaviour.
 *
 * The model: a FOCUS node (whatever the local neighbourhood lights around) is the
 * hovered node, or — when nothing is hovered — the current selection. Its incident
 * edges brighten and its neighbours lift, so the neighbourhood reads instantly.
 */
import { EMPHASIS } from './tuning';

/**
 * The node the local neighbourhood lights around. Hover takes precedence over a
 * persistent selection: you EXPLORE by hovering while the selection stays home, so a
 * hover always previews its own neighbourhood. Returns -1 when neither is present.
 */
export function focusIndex(hoveredIdx: number, selectionIdx: number): number {
  if (hoveredIdx >= 0) return hoveredIdx;
  return selectionIdx;
}

/**
 * Per-node emphasis level in [0,1] the sprite shader turns into extra glow + scale.
 * Priority: selection > hover > search/lens hit > neighbour-of-focus > idle (0).
 * A neighbour that is ALSO a stronger role keeps the stronger level (max), so lifting
 * the neighbourhood never dims the focus.
 */
export function nodeHighlightLevel(args: {
  isSelection: boolean;
  isHovered: boolean;
  inSearch: boolean;
  isNeighbor: boolean;
}): number {
  if (args.isSelection) return EMPHASIS.selection;
  if (args.isHovered) return EMPHASIS.hovered;
  if (args.inSearch) return EMPHASIS.search;
  if (args.isNeighbor) return EMPHASIS.neighbor;
  return 0;
}
