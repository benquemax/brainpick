/**
 * Semantic zoom tiers for labels: a handful of the highest-degree nodes are
 * labeled when zoomed out; zooming in earns more labels.
 *
 * `zoomRatio` is camera.zoom divided by the fit-to-graph zoom, i.e. 1 when
 * the whole cosmos fills the view.
 */
export const LABEL_BUDGET_MIN = 8;
export const LABEL_BUDGET_MAX = 144;

export function labelBudget(zoomRatio: number): number {
  if (!(zoomRatio > 0)) return LABEL_BUDGET_MIN;
  const raw = Math.round(LABEL_BUDGET_MIN * Math.pow(zoomRatio, 1.4));
  return Math.min(LABEL_BUDGET_MAX, Math.max(LABEL_BUDGET_MIN, raw));
}
