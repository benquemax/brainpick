/**
 * Communities → lobes. We detect communities on the T1 link graph and map the
 * largest ones onto anatomical regions of the brain SDF, so a topic cluster
 * literally becomes a lobe when the cosmos morphs into the brain.
 *
 * Algorithm: LABEL PROPAGATION (async, deterministic). Every node starts in its
 * own community; in a fixed sorted order each node adopts the most frequent
 * label among its neighbours, ties broken toward its current label then the
 * smallest label id. We prefer it over Louvain deliberately: it is O(V+E) per
 * round, needs no modularity bookkeeping, and — with a fixed node order and a
 * deterministic tie-break — is perfectly reproducible without a PRNG (the
 * workflow's no-ambient-random rule). Communities are then re-indexed by size
 * (0 = largest) so the mapping onto lobes is stable.
 *
 * Pure and framework-free (unit-tested); the runtime feeds it the budgeted node
 * ids + edges and hands the centroids to the brain layout as lobe seeds.
 */
import type { Vec3 } from '../scene/brainSDF';

/** A structural edge — the subset of GraphEdge the community detector needs. */
export interface CommunityEdge {
  source: string;
  target: string;
}

/**
 * Anatomical lobe seeds in SDF natural units, in priority order: the biggest
 * community lands in the left frontal lobe, the next in the right frontal, and
 * so on. Every centroid is inside the SDF (asserted in the test).
 */
export interface LobeRegion {
  name: string;
  centroid: Vec3;
}

export const LOBE_REGIONS: readonly LobeRegion[] = [
  { name: 'frontal-L', centroid: [-0.34, 0.18, 0.52] },
  { name: 'frontal-R', centroid: [0.34, 0.18, 0.52] },
  { name: 'parietal', centroid: [0.0, 0.44, -0.06] },
  { name: 'temporal-L', centroid: [-0.44, -0.18, 0.14] },
  { name: 'temporal-R', centroid: [0.44, -0.18, 0.14] },
  { name: 'occipital', centroid: [0.0, 0.14, -0.74] },
  { name: 'cerebellum', centroid: [0.0, -0.54, -0.64] },
];

const MAX_ROUNDS = 40;

/**
 * Detect communities on the (undirected) link graph. Returns a map of node id →
 * community index, re-indexed so 0 is the largest community (ties broken by the
 * smallest member id). Deterministic: independent of node/edge insertion order.
 */
export function detectCommunities(
  nodeIds: Iterable<string>,
  edges: Iterable<CommunityEdge>,
): Map<string, number> {
  const ids = [...new Set(nodeIds)].sort();
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    const a = adj.get(e.source);
    const b = adj.get(e.target);
    if (a && b) {
      a.push(e.target);
      b.push(e.source);
    }
  }
  for (const id of ids) adj.get(id)!.sort();

  const label = new Map<string, string>();
  for (const id of ids) label.set(id, id);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const id of ids) {
      const neighbours = adj.get(id)!;
      if (neighbours.length === 0) continue;
      const counts = new Map<string, number>();
      for (const nb of neighbours) {
        const l = label.get(nb)!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      const current = label.get(id)!;
      // Most frequent neighbour label; ties broken toward the smallest label id.
      // The tie-break makes the result independent of Map iteration order.
      let best = current;
      let bestCount = -1;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l < best)) {
          best = l;
          bestCount = c;
        }
      }
      if (best !== current) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Re-index by community size (desc), tie-break by the smallest member id.
  const members = new Map<string, string[]>();
  for (const id of ids) {
    const l = label.get(id)!;
    let group = members.get(l);
    if (!group) {
      group = [];
      members.set(l, group);
    }
    group.push(id);
  }
  const ordered = [...members.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[1][0]! < b[1][0]! ? -1 : 1; // smallest member id first
  });
  const communityOf = new Map<string, number>();
  ordered.forEach(([, group], index) => {
    for (const id of group) communityOf.set(id, index);
  });
  return communityOf;
}

export interface CommunityLobes {
  /** node id → community index (0 = largest). */
  communityOf: Map<string, number>;
  /** node id → lobe region index (community index wrapped over the 7 regions). */
  lobeOf: Map<string, number>;
  /** node id → the lobe centroid it seeds at, in SDF natural units. */
  centroidOf: Map<string, Vec3>;
  /** How many distinct communities were found. */
  communityCount: number;
}

/**
 * Detect communities and assign each node the anatomical lobe centroid of its
 * community. The i-th largest community maps to LOBE_REGIONS[i % 7]; small
 * graphs (today's ~10-doc bundle) simply light up a few lobes, gracefully.
 */
export function communityLobes(
  nodeIds: Iterable<string>,
  edges: Iterable<CommunityEdge>,
): CommunityLobes {
  const communityOf = detectCommunities(nodeIds, edges);
  const lobeOf = new Map<string, number>();
  const centroidOf = new Map<string, Vec3>();
  let communityCount = 0;
  for (const [id, community] of communityOf) {
    communityCount = Math.max(communityCount, community + 1);
    const region = community % LOBE_REGIONS.length;
    lobeOf.set(id, region);
    centroidOf.set(id, LOBE_REGIONS[region]!.centroid);
  }
  return { communityOf, lobeOf, centroidOf, communityCount };
}
