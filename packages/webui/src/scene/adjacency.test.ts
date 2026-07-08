import { describe, expect, it } from 'vitest';
import { buildAdjacency } from './adjacency';

describe('buildAdjacency', () => {
  it('collects incident edges and distinct neighbours (undirected)', () => {
    // A triangle over nodes 0,1,2 (edges 0:0-1, 1:1-2, 2:0-2) plus an isolated node 3.
    const pairs = new Uint32Array([0, 1, 1, 2, 0, 2]);
    const { incident, neighbors } = buildAdjacency(pairs, 3, 4);
    expect(new Set(incident[0])).toEqual(new Set([0, 2])); // edges 0 and 2 touch node 0
    expect(new Set(incident[1])).toEqual(new Set([0, 1]));
    expect(new Set(neighbors[0])).toEqual(new Set([1, 2]));
    expect(new Set(neighbors[2])).toEqual(new Set([0, 1]));
    expect(incident[3]).toEqual([]); // isolated node — nothing lights around it
    expect(neighbors[3]).toEqual([]);
  });

  it('dedupes multi-edges in neighbours but keeps every incident edge', () => {
    const pairs = new Uint32Array([0, 1, 0, 1]); // two parallel edges between 0 and 1
    const { incident, neighbors } = buildAdjacency(pairs, 2, 2);
    expect(incident[0]).toEqual([0, 1]); // both edges light on hover
    expect(neighbors[0]).toEqual([1]); // …but 1 is one neighbour
  });

  it('counts a self-loop as incident but never as a neighbour', () => {
    const pairs = new Uint32Array([0, 0]);
    const { incident, neighbors } = buildAdjacency(pairs, 1, 1);
    expect(incident[0]).toEqual([0]);
    expect(neighbors[0]).toEqual([]);
  });
});
