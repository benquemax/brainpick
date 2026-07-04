import { describe, expect, it } from 'vitest';
import { communityLobes, detectCommunities, LOBE_REGIONS, type CommunityEdge } from './communities';
import { isInside } from '../scene/brainSDF';

/** Two disconnected triangles — two unambiguous communities. */
const TWO_TRIANGLES: CommunityEdge[] = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'c', target: 'a' },
  { source: 'x', target: 'y' },
  { source: 'y', target: 'z' },
  { source: 'z', target: 'x' },
];
const TWO_TRIANGLE_IDS = ['a', 'b', 'c', 'x', 'y', 'z'];

describe('detectCommunities', () => {
  it('groups a tightly-linked triangle into one community, apart from another', () => {
    const c = detectCommunities(TWO_TRIANGLE_IDS, TWO_TRIANGLES);
    expect(c.get('a')).toBe(c.get('b'));
    expect(c.get('b')).toBe(c.get('c'));
    expect(c.get('x')).toBe(c.get('y'));
    expect(c.get('y')).toBe(c.get('z'));
    expect(c.get('a')).not.toBe(c.get('x'));
  });

  it('is deterministic and independent of node/edge insertion order', () => {
    const forward = detectCommunities(TWO_TRIANGLE_IDS, TWO_TRIANGLES);
    const shuffledIds = [...TWO_TRIANGLE_IDS].reverse();
    const shuffledEdges = [...TWO_TRIANGLES].reverse().map((e) => ({ source: e.target, target: e.source }));
    const reverse = detectCommunities(shuffledIds, shuffledEdges);
    expect([...reverse.entries()].sort()).toEqual([...forward.entries()].sort());
    // and a second identical run is byte-identical
    expect([...detectCommunities(TWO_TRIANGLE_IDS, TWO_TRIANGLES).entries()]).toEqual([...forward.entries()]);
  });

  it('re-indexes communities by size: 0 is the largest', () => {
    // one big component (5 nodes in a path) + one small (2 nodes)
    const edges: CommunityEdge[] = [
      { source: 'n0', target: 'n1' },
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4' },
      { source: 's0', target: 's1' },
    ];
    const c = detectCommunities(['n0', 'n1', 'n2', 'n3', 'n4', 's0', 's1'], edges);
    // the path collapses to one label under LPA; it must be community 0 (largest)
    expect(c.get('n0')).toBe(0);
    expect(c.get('s0')).toBe(c.get('s1'));
    expect(c.get('s0')).not.toBe(0);
  });

  it('handles isolated nodes (orphans) as their own singleton communities', () => {
    const c = detectCommunities(['lonely', 'a', 'b'], [{ source: 'a', target: 'b' }]);
    expect(c.get('lonely')).not.toBe(c.get('a'));
    expect(c.get('a')).toBe(c.get('b'));
  });

  it('copes with an empty graph', () => {
    expect(detectCommunities([], []).size).toBe(0);
    const one = detectCommunities(['solo'], []);
    expect(one.get('solo')).toBe(0);
  });
});

describe('communityLobes', () => {
  it('maps the largest community to the first lobe region (frontal-L)', () => {
    const { centroidOf, communityOf } = communityLobes(TWO_TRIANGLE_IDS, TWO_TRIANGLES);
    // whichever nodes are community 0 sit at LOBE_REGIONS[0]
    for (const [id, community] of communityOf) {
      if (community === 0) expect(centroidOf.get(id)).toEqual(LOBE_REGIONS[0]!.centroid);
    }
  });

  it('assigns every node a centroid; nodes share their community centroid', () => {
    const { centroidOf } = communityLobes(TWO_TRIANGLE_IDS, TWO_TRIANGLES);
    expect(centroidOf.size).toBe(TWO_TRIANGLE_IDS.length);
    expect(centroidOf.get('a')).toEqual(centroidOf.get('b')); // same community → same lobe
    expect(centroidOf.get('a')).not.toEqual(centroidOf.get('x'));
  });

  it('wraps communities beyond the 7 regions back over the lobes', () => {
    // 9 disconnected singletons → 9 communities, indices 7 and 8 wrap to 0 and 1
    const ids = Array.from({ length: 9 }, (_, i) => `iso${i}`);
    const { lobeOf, communityCount } = communityLobes(ids, []);
    expect(communityCount).toBe(9);
    const regions = new Set([...lobeOf.values()]);
    expect(regions.size).toBe(LOBE_REGIONS.length); // all 7 regions used
    for (const r of lobeOf.values()) expect(r).toBeLessThan(LOBE_REGIONS.length);
  });

  it('is graceful on a tiny 2-node graph (few lobes lit)', () => {
    const { centroidOf } = communityLobes(['p', 'q'], [{ source: 'p', target: 'q' }]);
    expect(centroidOf.get('p')).toEqual(LOBE_REGIONS[0]!.centroid);
    expect(centroidOf.get('q')).toEqual(LOBE_REGIONS[0]!.centroid);
  });
});

describe('lobe centroids live inside the brain', () => {
  it('every anatomical region centroid is inside the SDF', () => {
    for (const region of LOBE_REGIONS) {
      expect(isInside(region.centroid), `${region.name} must be inside`).toBe(true);
    }
  });
});
