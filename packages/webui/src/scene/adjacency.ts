/**
 * Undirected adjacency over the rendered edge set — built once per graph rebuild so
 * a hover/selection can light a node's incident edges and lift its neighbours in
 * O(degree), not O(edges), every frame. Pure (no three/DOM), unit-tested.
 *
 * `edgePairs` is the flat [srcA, tgtA, srcB, tgtB, …] index buffer the runtime feeds
 * the GPU; `incident[i]` are the EDGE indices touching node i, `neighbors[i]` the
 * distinct node indices on the far end. Self-loops contribute an incident edge but
 * no neighbour.
 */
export interface Adjacency {
  /** incident[node] → edge indices touching that node. */
  incident: number[][];
  /** neighbors[node] → distinct adjacent node indices (no self, deduped). */
  neighbors: number[][];
}

export function buildAdjacency(edgePairs: ArrayLike<number>, edgeCount: number, nodeCount: number): Adjacency {
  const incident: number[][] = Array.from({ length: nodeCount }, () => []);
  const neighborSets: Array<Set<number>> = Array.from({ length: nodeCount }, () => new Set<number>());
  for (let e = 0; e < edgeCount; e++) {
    const s = edgePairs[e * 2] ?? 0;
    const t = edgePairs[e * 2 + 1] ?? 0;
    if (s < nodeCount && s >= 0) {
      incident[s]!.push(e);
      if (t !== s) neighborSets[s]!.add(t);
    }
    if (t < nodeCount && t >= 0 && t !== s) {
      incident[t]!.push(e);
      neighborSets[t]!.add(s);
    }
  }
  const neighbors = neighborSets.map((set) => [...set]);
  return { incident, neighbors };
}
