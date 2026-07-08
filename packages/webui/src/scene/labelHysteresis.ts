/**
 * Label stability (2026-07-08) — pure helpers, unit-tested, that stop the semantic-zoom
 * label set from churning every frame. At density the greedy overlap placement re-picked
 * winners frame to frame, so names flickered on/off while the view sat idle or the brain
 * slowly spun. The cure is HYSTERESIS: place the labels shown LAST frame before any
 * newcomer, and let settled/forced labels persist a little past the budget.
 */

/** How many labels beyond the budget a settled/forced label may hold, so a label at the
 * exact budget/zoom boundary does not blink as the budget jitters by one. */
export const LABEL_STICKY_MARGIN = 4;

/**
 * Stable candidate order for placement: forced (selection/hover) first, then the labels
 * shown LAST frame in their degree-priority order, then the rest by degree. Placing
 * settled labels before newcomers is the hysteresis — a fresh label can no longer evict
 * a steady one by winning an overlap tie, so the visible set stops thrashing.
 */
export function labelCandidateOrder(
  forced: readonly number[],
  labelOrder: readonly number[],
  shownPrev: ReadonlySet<number>,
): number[] {
  const forcedSet = new Set(forced);
  const sticky: number[] = [];
  const rest: number[] = [];
  for (const i of labelOrder) {
    if (forcedSet.has(i)) continue;
    if (shownPrev.has(i)) sticky.push(i);
    else rest.push(i);
  }
  return [...forced, ...sticky, ...rest];
}

/**
 * May this candidate take a slot this frame? Forced and previously-shown (sticky) labels
 * may fill up to a small margin beyond the budget (so a boundary label does not blink);
 * a brand-new label only within the budget proper.
 */
export function labelAdmits(args: {
  used: number;
  budget: number;
  isForced: boolean;
  isSticky: boolean;
}): boolean {
  if (args.isForced || args.isSticky) return args.used < args.budget + LABEL_STICKY_MARGIN;
  return args.used < args.budget;
}
