/**
 * Pure emphasis derivation — the single source of the "what lights up" rule the
 * node + edge layers apply imperatively each frame. Kept here (no three/DOM) so the
 * hover/selection/neighbour math is unit-tested against the EMPHASIS levels in
 * tuning.ts, and so cosmos and brain share one behaviour.
 *
 * The model: a FOCUS node (whatever the local neighbourhood lights around) is the
 * SELECTION when one exists, else the hovered node. Its incident edges brighten and
 * its neighbours lift, so the neighbourhood reads instantly. An active lens
 * ("dim others") governs everything: hidden nodes don't respond to hover, don't
 * lift as neighbours, don't get labels, and their edges fade to a whisper.
 */
import { entityRenderId } from '../graph/entities';
import { EMPHASIS } from './tuning';

/**
 * The render-graph id of the CURRENT selection, whichever kind it is: an
 * entity selection (its own store field) renders as its namespaced entity
 * node, a doc selection as itself. Every layer that anchors on "the
 * selection" — emphasis, edges, labels, picking — must resolve through this,
 * or a clicked entity anchors nothing and its connections only light on
 * hover (Tom, 2026-07-13).
 */
export function selectionRenderId(selection: string | null, entitySelection: string | null): string | null {
  return entitySelection !== null ? entityRenderId(entitySelection) : selection;
}

/**
 * The node the local neighbourhood lights around. A selection ANCHORS the
 * neighbourhood — hovering must not steal it, because the user is following the
 * selection's connections to click one and the visual clue has to hold still
 * (Tom, tester-zero 2026-07-12). Hover explores only while nothing is selected,
 * and a lens-hidden hover never becomes the focus at all. Returns -1 when
 * nothing applies.
 */
export function focusIndex(hoveredIdx: number, selectionIdx: number, hoveredHidden = false): number {
  if (selectionIdx >= 0) return selectionIdx;
  if (hoveredIdx >= 0 && !hoveredHidden) return hoveredIdx;
  return -1;
}

/**
 * Per-node emphasis level in [0,1] the sprite shader turns into extra glow + scale.
 * Priority: selection > hover > search/lens hit > neighbour-of-focus > idle (0).
 * A neighbour that is ALSO a stronger role keeps the stronger level (max), so lifting
 * the neighbourhood never dims the focus. A lens-hidden node (outside an active
 * lens) never lifts — not for hover, not as a neighbour — except a deliberate
 * selection, which was clicked on purpose and stays readable.
 */
export function nodeHighlightLevel(args: {
  isSelection: boolean;
  isHovered: boolean;
  inSearch: boolean;
  isNeighbor: boolean;
  lensHidden?: boolean;
}): number {
  if (args.isSelection) return EMPHASIS.selection;
  if (args.lensHidden) return 0;
  if (args.isHovered) return EMPHASIS.hovered;
  if (args.inSearch) return EMPHASIS.search;
  if (args.isNeighbor) return EMPHASIS.neighbor;
  return 0;
}

/**
 * How strongly an active lens dims an edge, graded by its endpoints:
 * 0 — both endpoints in the lens (the lens's own structure, full strength);
 * 0.5 — one endpoint in the lens (a member's outward connection — half, it
 *       answers "what is this connected to" without flooding the view);
 * 1 — both hidden (the background web, faded to a whisper).
 * Fed to the edge shader as a per-vertex attribute; a no-lens frame is all 0.
 */
export function edgeLensDim(aVisible: boolean, bVisible: boolean): number {
  return (aVisible ? 0 : 0.5) + (bVisible ? 0 : 0.5);
}

/**
 * Whether a node participates in the scene at all while a lens is active —
 * one rule for labels, picking, and emphasis (Tom, 2026-07-12, in three
 * escalating reports): hidden nodes must not carry labels ("names of nodes
 * that aren't shown make no sense"), must not catch clicks ("a node in front
 * gets selected… but is invisible"), and must not pop on hover — BUT the
 * focus's neighbours pierce the lens ("what is the point of seeing only
 * lines to invisible nodes"), and a deliberate selection always reads.
 */
export function lensAllowsInteraction(args: {
  dimOthers: boolean;
  inHighlight: boolean;
  isSelection: boolean;
  isFocusNeighbor: boolean;
}): boolean {
  if (!args.dimOthers) return true;
  return args.inHighlight || args.isSelection || args.isFocusNeighbor;
}
