import { describe, expect, it } from 'vitest';
import { LABEL_BUDGET_MAX, LABEL_BUDGET_MIN, labelBudget } from './semanticZoom';

describe('labelBudget (semantic zoom tiers)', () => {
  it('shows only a handful of labels when zoomed all the way out', () => {
    expect(labelBudget(0.2)).toBe(LABEL_BUDGET_MIN);
    expect(labelBudget(1)).toBeLessThanOrEqual(16);
  });

  it('grows monotonically with zoom', () => {
    let prev = -1;
    for (const ratio of [0.2, 0.5, 1, 2, 4, 8, 16, 32]) {
      const b = labelBudget(ratio);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('clamps to the configured bounds', () => {
    expect(labelBudget(0)).toBe(LABEL_BUDGET_MIN);
    expect(labelBudget(10_000)).toBe(LABEL_BUDGET_MAX);
    expect(LABEL_BUDGET_MIN).toBeGreaterThan(0);
    expect(LABEL_BUDGET_MAX).toBeGreaterThan(LABEL_BUDGET_MIN);
  });
});
