import { describe, expect, it } from 'vitest';
import { computeBrainLayout } from './brainLayout';
import { sdf, type Vec3 } from '../scene/brainSDF';
import { communityLobes, type CommunityEdge } from '../state/communities';
import { BRAIN } from '../scene/tuning';

/** A synthetic multi-community graph: 6 clusters of a few linked nodes each. */
function sampleGraph(): { ids: string[]; edges: CommunityEdge[]; pairs: Array<[number, number]> } {
  const ids: string[] = [];
  const edges: CommunityEdge[] = [];
  const pairs: Array<[number, number]> = [];
  const index = new Map<string, number>();
  const add = (id: string) => {
    index.set(id, ids.length);
    ids.push(id);
  };
  for (let c = 0; c < 6; c++) {
    const members: string[] = [];
    for (let k = 0; k < 5 + c; k++) {
      const id = `c${c}/n${k}.md`;
      add(id);
      members.push(id);
    }
    // link each cluster into a ring so it is one community
    for (let k = 0; k < members.length; k++) {
      const a = members[k]!;
      const b = members[(k + 1) % members.length]!;
      edges.push({ source: a, target: b });
      pairs.push([index.get(a)!, index.get(b)!]);
    }
  }
  return { ids, edges, pairs };
}

function seedsFor(ids: string[], edges: CommunityEdge[]): Vec3[] {
  const { centroidOf } = communityLobes(ids, edges);
  return ids.map((id) => centroidOf.get(id) ?? ([0, -0.1, 0] as Vec3));
}

describe('computeBrainLayout containment', () => {
  it('places EVERY node inside the brain SDF (within tolerance)', () => {
    const { ids, edges, pairs } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const pos = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: 1, scale: 1 });
    let worst = -Infinity;
    for (let i = 0; i < ids.length; i++) {
      const d = sdf(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(0.02); // all inside (or a hair off the surface)
  });

  it('keeps containment even when every node seeds at ONE lobe (dense pile)', () => {
    const n = 120;
    const seeds: Vec3[] = Array.from({ length: n }, () => [-0.34, 0.18, 0.52]);
    const pos = computeBrainLayout({ count: n, edges: [], seeds, seed: 5, scale: 1 });
    for (let i = 0; i < n; i++) {
      expect(sdf(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!)).toBeLessThan(0.02);
    }
  });
});

describe('computeBrainLayout determinism', () => {
  it('is byte-identical for the same input + seed, and differs for another seed', () => {
    const { ids, edges, pairs } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const a = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: 7 });
    const b = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: 7 });
    const c = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: 8 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe('computeBrainLayout structure', () => {
  it('returns a 3-float-per-node array aligned to the node order', () => {
    const { ids, edges, pairs } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const pos = computeBrainLayout({ count: ids.length, edges: pairs, seeds });
    expect(pos.length).toBe(ids.length * 3);
    expect(Array.from(pos).every(Number.isFinite)).toBe(true);
  });

  it('seeds each node near its lobe centroid (0 rounds = pure seeding), scaled', () => {
    const { ids, edges } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const scale = 100;
    const pos = computeBrainLayout({ count: ids.length, edges: [], seeds, seed: 3, scale, iterations: 0 });
    for (let i = 0; i < ids.length; i++) {
      const c = seeds[i]!;
      const dx = pos[i * 3]! / scale - c[0];
      const dy = pos[i * 3 + 1]! / scale - c[1];
      const dz = pos[i * 3 + 2]! / scale - c[2];
      // Within the seed jitter box (+ a little slack for surface projection).
      expect(Math.hypot(dx, dy, dz)).toBeLessThan(BRAIN.layoutSeedJitter * Math.sqrt(3) + 0.12);
    }
  });

  it('applies the world scale', () => {
    const seeds: Vec3[] = [[0, 0, 0]];
    const unit = computeBrainLayout({ count: 1, edges: [], seeds, seed: 2, iterations: 0, scale: 1 });
    const big = computeBrainLayout({ count: 1, edges: [], seeds, seed: 2, iterations: 0, scale: 50 });
    expect(big[0]).toBeCloseTo(unit[0]! * 50, 4);
    expect(big[1]).toBeCloseTo(unit[1]! * 50, 4);
  });

  it('copes with an empty graph', () => {
    expect(computeBrainLayout({ count: 0, edges: [], seeds: [] }).length).toBe(0);
  });
});
