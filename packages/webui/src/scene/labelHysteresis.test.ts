import { describe, expect, it } from 'vitest';
import { labelAdmits, labelCandidateOrder, LABEL_STICKY_MARGIN } from './labelHysteresis';

describe('labelCandidateOrder', () => {
  it('places forced first, then the previously-shown by priority, then the rest', () => {
    const labelOrder = [10, 11, 12, 13, 14]; // degree priority
    const forced = [13]; // selection / hover always labelled
    const shownPrev = new Set([12, 14]); // settled labels from last frame
    expect(labelCandidateOrder(forced, labelOrder, shownPrev)).toEqual([13, 12, 14, 10, 11]);
  });

  it('is stable frame to frame while the shown set is stable — the anti-churn property', () => {
    const labelOrder = [1, 2, 3, 4];
    const shownPrev = new Set([2, 3]);
    const a = labelCandidateOrder([], labelOrder, shownPrev);
    const b = labelCandidateOrder([], labelOrder, shownPrev);
    expect(a).toEqual(b);
    expect(a).toEqual([2, 3, 1, 4]); // settled 2,3 keep their slots ahead of newcomers 1,4
  });
});

describe('labelAdmits', () => {
  it('lets a fresh label in only within the budget', () => {
    expect(labelAdmits({ used: 5, budget: 6, isForced: false, isSticky: false })).toBe(true);
    expect(labelAdmits({ used: 6, budget: 6, isForced: false, isSticky: false })).toBe(false);
  });

  it('lets forced/settled labels persist a small margin past the budget (hysteresis)', () => {
    expect(labelAdmits({ used: 6, budget: 6, isForced: false, isSticky: true })).toBe(true);
    expect(labelAdmits({ used: 6, budget: 6, isForced: true, isSticky: false })).toBe(true);
    // …but not without bound — the margin is finite.
    expect(labelAdmits({ used: 6 + LABEL_STICKY_MARGIN, budget: 6, isForced: false, isSticky: true })).toBe(false);
  });
});
