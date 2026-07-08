import { describe, expect, it } from 'vitest';
import { radiusForDegree } from './runtime';

describe('radiusForDegree (degree conveys relevance — pronounced, not subtle)', () => {
  it('grows monotonically with degree', () => {
    let prev = -1;
    for (const d of [0, 1, 4, 6, 9, 12, 20, 30, 42, 54, 111]) {
      const r = radiusForDegree(d);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('makes a hub REMARKABLY bigger than a leaf, while the bulk stays calm', () => {
    const leaf = radiusForDegree(1);
    const median = radiusForDegree(9); // the docs-brain median degree
    const hub = radiusForDegree(54); // a big hub (reference-config)
    expect(hub / leaf).toBeGreaterThan(3.5); // legible hub structure at a glance
    expect(median / leaf).toBeGreaterThan(1.4);
    expect(median / leaf).toBeLessThan(2.6); // …but the mass of the graph is not blown up
  });

  it('saturates instead of blowing out — a super-hub is bounded and clamped past 60', () => {
    expect(radiusForDegree(111)).toBeLessThanOrEqual(27);
    expect(radiusForDegree(10_000)).toBeLessThanOrEqual(27);
    expect(radiusForDegree(60)).toBeCloseTo(radiusForDegree(111), 5); // degree clamp at 60
  });
});
