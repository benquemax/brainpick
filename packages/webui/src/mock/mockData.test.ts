import { describe, expect, it } from 'vitest';
import { BASE_SEQ, applyDeltaToGraph, initialGraph, mockDocs, nextDelta, STEP_COUNT } from '../../scripts/mock-data.mjs';
import type { GraphPayload } from '../graph/types';
import { applyDelta, applySnapshot, emptyGraphSlice } from '../state/applyDelta';

function checkInvariants(graph: GraphPayload): void {
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    expect(ids.has(e.source), `edge source ${e.source} exists`).toBe(true);
    expect(ids.has(e.target), `edge target ${e.target} exists`).toBe(true);
    expect(e.count).toBeGreaterThanOrEqual(1);
  }
  // in/out must match the edge list
  const inC = new Map<string, number>();
  const outC = new Map<string, number>();
  for (const e of graph.edges) {
    outC.set(e.source, (outC.get(e.source) ?? 0) + 1);
    inC.set(e.target, (inC.get(e.target) ?? 0) + 1);
  }
  for (const n of graph.nodes) {
    expect(n.in, `in-degree of ${n.id}`).toBe(inC.get(n.id) ?? 0);
    expect(n.out, `out-degree of ${n.id}`).toBe(outC.get(n.id) ?? 0);
  }
  expect(graph.stats.docs).toBe(graph.nodes.length);
  expect(graph.stats.edges).toBe(graph.edges.length);
}

describe('mock graph (kotiaurinko-derived)', () => {
  it('is a plausible ~10 node bundle graph with sound degrees and stats', () => {
    const graph = initialGraph();
    expect(graph.nodes.length).toBeGreaterThanOrEqual(9);
    expect(graph.nodes.length).toBeLessThanOrEqual(12);
    checkInvariants(graph);
    expect(graph.ghosts.length).toBeGreaterThanOrEqual(1); // olematon.md
    expect(graph.islands.length).toBeGreaterThanOrEqual(1); // saaret pair
  });

  it('has complete node records (graph.schema.json required keys)', () => {
    for (const n of initialGraph().nodes) {
      for (const key of ['description', 'id', 'in', 'orphan', 'out', 'reserved', 'tags', 'timestamp', 'title', 'type']) {
        expect(Object.keys(n)).toContain(key);
      }
    }
  });

  it('backs every node with a doc record for /api/docs and /api/search', () => {
    const nodeIds = initialGraph().nodes.map((n) => n.id).sort();
    const docPaths = mockDocs().map((d) => d.path).sort();
    expect(docPaths).toEqual(nodeIds);
  });

  it('matches the current kotiaurinko golden: aurinko→komeetta exists, 20 edges, 1 orphan', () => {
    const graph = initialGraph();
    expect(graph.stats).toEqual({ docs: 10, edges: 20, ghosts: 1, islands: 1, orphans: 1, tags: 8 });
    const link = graph.edges.find((e) => e.source === 'aurinko.md' && e.target === 'komeetta.md');
    expect(link).toMatchObject({ kind: 'link', label: 'Komeetta' });
    const komeetta = graph.nodes.find((n) => n.id === 'komeetta.md');
    expect(komeetta?.orphan).toBe(false); // aurinko links back since the fixture fix
    expect(komeetta?.in).toBe(2);
    const aurinko = graph.nodes.find((n) => n.id === 'aurinko.md');
    expect(aurinko?.out).toBe(3);
    const orphans = graph.nodes.filter((n) => n.orphan).map((n) => n.id);
    expect(orphans).toEqual(['yksinainen.md']);
    // the compiled index links each concept twice (preamble + generated section)
    for (const e of graph.edges.filter((x) => x.source === 'index.md')) {
      expect(e.count).toBe(2);
    }
  });

  it('keeps the aurinko doc text in step with the fixture (the komeetta sentence)', () => {
    const aurinko = mockDocs().find((d) => d.path === 'aurinko.md');
    expect(aurinko?.text).toContain('[Komeetta](komeetta.md)');
  });

  it('keeps the ghost link laguuni→olematon for the phantom-node rendering', () => {
    expect(initialGraph().ghosts).toEqual([{ source: 'saaret/laguuni.md', target: 'olematon.md' }]);
  });
});

describe('mock scripted deltas', () => {
  it('stream cleanly through the real reducer for two full cycles', () => {
    let graph = initialGraph();
    let slice = applySnapshot(emptyGraphSlice(), graph, BASE_SEQ, 0);
    for (let i = 0; i < STEP_COUNT * 2; i++) {
      const delta = nextDelta(graph, slice.seq + 1, i);
      expect(delta.seq).toBe(slice.seq + 1);
      slice = applyDelta(slice, delta, i * 1000);
      expect(slice.seq).toBe(delta.seq);
      graph = applyDeltaToGraph(graph, delta);
      checkInvariants(graph);
      // reducer and mock-side apply stay in lockstep
      expect([...slice.nodes.keys()].sort()).toEqual(graph.nodes.map((n) => n.id).sort());
      expect(slice.edges.size).toBe(graph.edges.length);
    }
  });

  it('exercises add, update, remove and edge-count replacement across a cycle', () => {
    let graph = initialGraph();
    let seq = BASE_SEQ;
    let sawAdd = false;
    let sawRemove = false;
    let sawUpdate = false;
    let sawEdgeReplace = false;
    for (let i = 0; i < STEP_COUNT; i++) {
      const delta = nextDelta(graph, ++seq, i);
      if (delta.added.nodes.length > 0) sawAdd = true;
      if (delta.removed.nodes.length > 0) sawRemove = true;
      if (delta.updated.nodes.length > 0) sawUpdate = true;
      const removedKeys = new Set(delta.removed.edges.map((e) => `${e.source}|${e.target}|${e.kind}`));
      if (delta.added.edges.some((e) => removedKeys.has(`${e.source}|${e.target}|${e.kind}`))) sawEdgeReplace = true;
      graph = applyDeltaToGraph(graph, delta);
    }
    expect(sawAdd).toBe(true);
    expect(sawRemove).toBe(true);
    expect(sawUpdate).toBe(true);
    expect(sawEdgeReplace).toBe(true);
  });

  it('returns the graph to its initial shape after a full cycle (loopable demo)', () => {
    let graph = initialGraph();
    let seq = BASE_SEQ;
    for (let i = 0; i < STEP_COUNT; i++) {
      graph = applyDeltaToGraph(graph, nextDelta(graph, ++seq, i));
    }
    const a = initialGraph();
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(a.nodes.map((n) => n.id).sort());
    expect(graph.edges.length).toBe(a.edges.length);
  });
});
