import { describe, expect, it } from 'vitest';
import { computeBrainLayout } from './brainLayout';
import { sdf, type Vec3 } from '../scene/brainSDF';
import { communityLobes, type CommunityEdge } from '../state/communities';
import { BRAIN } from '../scene/tuning';

/** A synthetic multi-community graph: `clusters` rings of `per` linked nodes. */
function ringGraph(clusters: number, per: number): { ids: string[]; edges: CommunityEdge[]; pairs: Array<[number, number]> } {
  const ids: string[] = [];
  const edges: CommunityEdge[] = [];
  const pairs: Array<[number, number]> = [];
  const index = new Map<string, number>();
  const add = (id: string) => {
    index.set(id, ids.length);
    ids.push(id);
  };
  for (let c = 0; c < clusters; c++) {
    const members: string[] = [];
    for (let k = 0; k < per; k++) {
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

/** A "large" 6-community graph of 45 nodes (clusters of 5..10). */
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

/**
 * Principal-axis variances (covariance eigenvalues, descending) of the point
 * cloud — the honest measure of how volumetric it is. A flat sheet collapses the
 * smallest to ≈0; a genuine 3D volume keeps all three comparable.
 */
function principalVariances(pos: Float32Array, n: number): [number, number, number] {
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    mx += pos[i * 3]!;
    my += pos[i * 3 + 1]!;
    mz += pos[i * 3 + 2]!;
  }
  mx /= n; my /= n; mz /= n;
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3]! - mx, dy = pos[i * 3 + 1]! - my, dz = pos[i * 3 + 2]! - mz;
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  const a = [
    [cxx / n, cxy / n, cxz / n],
    [cxy / n, cyy / n, cyz / n],
    [cxz / n, cyz / n, czz / n],
  ];
  // Jacobi eigenvalue iteration for a symmetric 3x3.
  for (let sweep = 0; sweep < 60; sweep++) {
    let p = 0, q = 1, max = Math.abs(a[0]![1]!);
    if (Math.abs(a[0]![2]!) > max) { max = Math.abs(a[0]![2]!); p = 0; q = 2; }
    if (Math.abs(a[1]![2]!) > max) { max = Math.abs(a[1]![2]!); p = 1; q = 2; }
    if (max < 1e-12) break;
    const app = a[p]![p]!, aqq = a[q]![q]!, apq = a[p]![q]!;
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let k = 0; k < 3; k++) { const akp = a[k]![p]!, akq = a[k]![q]!; a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p]![k]!, aqk = a[q]![k]!; a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk; }
  }
  const e = [a[0]![0]!, a[1]![1]!, a[2]![2]!].sort((x, y) => y - x);
  return [e[0]!, e[1]!, e[2]!];
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

describe('computeBrainLayout fills a 3D VOLUME (not a flat sheet)', () => {
  // The guardrail Tom's feedback demands: the cloud must occupy the brain volume,
  // never collapse to a plane. We assert the smallest principal-axis variance is a
  // healthy fraction of the largest — a spinning 2D disc would fail hard (≈0).
  const MIN_RATIO = 0.25;

  it('a SMALL graph (16 nodes, 2 communities) is volumetric, not planar', () => {
    const { ids, edges, pairs } = ringGraph(2, 8);
    const seeds = seedsFor(ids, edges);
    const pos = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: BRAIN.seed, scale: BRAIN.scale });
    const [e0, e1, e2] = principalVariances(pos, ids.length);
    expect(e2 / e0).toBeGreaterThan(MIN_RATIO); // no axis collapsed
    expect(e1 / e0).toBeGreaterThan(MIN_RATIO); // middle axis healthy too
  });

  it('a TINY single-community graph (14 nodes) still fills the volume', () => {
    const { ids, edges, pairs } = ringGraph(1, 14);
    const seeds = seedsFor(ids, edges);
    const pos = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: BRAIN.seed, scale: BRAIN.scale });
    const [e0, , e2] = principalVariances(pos, ids.length);
    expect(e2 / e0).toBeGreaterThan(MIN_RATIO);
  });

  it('a LARGER graph (45 nodes, 6 communities) is volumetric across all three axes', () => {
    const { ids, edges, pairs } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const pos = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: BRAIN.seed, scale: BRAIN.scale });
    const [e0, e1, e2] = principalVariances(pos, ids.length);
    expect(e2 / e0).toBeGreaterThan(MIN_RATIO);
    expect(e1 / e0).toBeGreaterThan(MIN_RATIO);
  });

  it('the smallest axis is NOWHERE near a collapsed plane (a plane would be ≈0)', () => {
    // Explicit contrast: a deliberately planar cloud (z≈0) has ratio ≈0, ours does not.
    const { ids, edges, pairs } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const pos = computeBrainLayout({ count: ids.length, edges: pairs, seeds, seed: BRAIN.seed, scale: BRAIN.scale });
    const flat = pos.slice();
    for (let i = 0; i < ids.length; i++) flat[i * 3 + 2] = 0; // squash to the xy-plane
    const brainRatio = (() => { const [a, , c] = principalVariances(pos, ids.length); return c / a; })();
    const planeRatio = (() => { const [a, , c] = principalVariances(flat, ids.length); return c / a; })();
    expect(planeRatio).toBeLessThan(0.02); // the squashed control IS a plane
    expect(brainRatio).toBeGreaterThan(10 * planeRatio); // ours is emphatically not
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

  it('seeds a MANY-community graph inside its lobe neighbourhood (crisp lobes)', () => {
    // With the full set of lobes lit, each node's volumetric seed stays within its
    // lobe's sub-volume: seed radius (min, fill≈0) + the small core bias + a little
    // slack for surface projection. This guards the seed-respects-the-lobe property
    // without pinning it to a point (the spread is what makes it 3D).
    const { ids, edges } = sampleGraph();
    const seeds = seedsFor(ids, edges);
    const scale = 100;
    const pos = computeBrainLayout({ count: ids.length, edges: [], seeds, seed: 3, scale, iterations: 0 });
    const bound = BRAIN.layoutSeedSpreadMin + 0.3 /* core bias */ + BRAIN.layoutContainMargin + 0.12;
    for (let i = 0; i < ids.length; i++) {
      const c = seeds[i]!;
      const dx = pos[i * 3]! / scale - c[0];
      const dy = pos[i * 3 + 1]! / scale - c[1];
      const dz = pos[i * 3 + 2]! / scale - c[2];
      expect(Math.hypot(dx, dy, dz)).toBeLessThan(bound);
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
