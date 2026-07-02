import { describe, expect, it } from 'vitest';
import { buildSeeds, diffGraph } from './simShared';

describe('diffGraph', () => {
  it('reports added and removed ids and edge-structure changes', () => {
    const d = diffGraph(['a', 'b'], ['b', 'c'], ['a→b'], ['b→c']);
    expect(d.addedIds).toEqual(['c']);
    expect(d.removedIds).toEqual(['a']);
    expect(d.structural).toBe(true);
  });

  it('is non-structural when ids and edges are identical', () => {
    const d = diffGraph(['a', 'b'], ['a', 'b'], ['a→b'], ['a→b']);
    expect(d.addedIds).toEqual([]);
    expect(d.removedIds).toEqual([]);
    expect(d.structural).toBe(false);
  });

  it('flags edge-only changes as structural (reheat the sim)', () => {
    const d = diffGraph(['a', 'b'], ['a', 'b'], ['a→b'], []);
    expect(d.structural).toBe(true);
  });
});

describe('buildSeeds', () => {
  const prevIndex = new Map([
    ['a', 0],
    ['b', 1],
  ]);
  // a at (5, -5), b at (40, 12)
  const prevPositions = new Float32Array([5, -5, 40, 12]);

  it('keeps existing nodes at their previous position', () => {
    const seeds = buildSeeds(['a', 'b'], new Map(), prevIndex, prevPositions, 100, () => 0.5);
    expect(seeds[0]).toBeCloseTo(5);
    expect(seeds[1]).toBeCloseTo(-5);
    expect(seeds[2]).toBeCloseTo(40);
    expect(seeds[3]).toBeCloseTo(12);
  });

  it('seeds a joining node beside its linked neighbor (entrance position)', () => {
    const joins = new Map([['c', { at: 1, neighborId: 'b' }]]);
    const seeds = buildSeeds(['a', 'b', 'c'], joins, prevIndex, prevPositions, 100, () => 0.5);
    const dx = (seeds[4] ?? 0) - 40;
    const dy = (seeds[5] ?? 0) - 12;
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(8); // beside, with a little jitter
  });

  it('scatters unknown nodes inside the graph radius', () => {
    const seeds = buildSeeds(['a', 'b', 'x'], new Map(), prevIndex, prevPositions, 100, () => 0.25);
    const r = Math.hypot(seeds[4] ?? 0, seeds[5] ?? 0);
    expect(r).toBeLessThanOrEqual(100 + 8);
    expect(Number.isFinite(seeds[4])).toBe(true);
    expect(Number.isFinite(seeds[5])).toBe(true);
  });
});
