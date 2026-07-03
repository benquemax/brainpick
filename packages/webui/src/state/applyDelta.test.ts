import { describe, expect, it } from 'vitest';
import type { GraphDelta, GraphEdge, GraphNode, GraphStats } from '../graph/types';
import { edgeKey } from '../graph/types';
import {
  ANIMATION_TTL_MS,
  applyDelta,
  applySnapshot,
  emptyGraphSlice,
  type GraphSlice,
} from './applyDelta';

function makeNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    title: id.replace(/\.md$/, ''),
    description: null,
    type: 'Concept',
    tags: [],
    timestamp: null,
    in: 0,
    out: 0,
    orphan: false,
    reserved: false,
    ...over,
  };
}

function makeEdge(source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return { source, target, kind: 'link', label: null, count: 1, ...over };
}

function makeStats(over: Partial<GraphStats> = {}): GraphStats {
  return { docs: 0, edges: 0, ghosts: 0, islands: 0, orphans: 0, tags: 0, ...over };
}

function makeDelta(seq: number, parts: Partial<GraphDelta> = {}): GraphDelta {
  return {
    seq,
    added: { nodes: [], edges: [] },
    removed: { nodes: [], edges: [] },
    updated: { nodes: [] },
    stats: makeStats(),
    cause: { paths: [], tier: 't1' },
    ...parts,
  };
}

/** A small baseline graph at seq 100: a -> b. */
function baseState(): GraphSlice {
  const s = emptyGraphSlice();
  return applySnapshot(
    s,
    {
      nodes: [makeNode('a.md', { out: 1 }), makeNode('b.md', { in: 1 })],
      edges: [makeEdge('a.md', 'b.md', { label: 'B' })],
      ghosts: [],
      islands: [],
      stats: makeStats({ docs: 2, edges: 1 }),
      tags: {},
    },
    100,
    1_000,
  );
}

describe('applyDelta', () => {
  it('applies added nodes and edges at seq+1', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      added: {
        nodes: [makeNode('c.md', { out: 1 })],
        edges: [makeEdge('c.md', 'a.md', { label: 'A' })],
      },
      stats: makeStats({ docs: 3, edges: 2 }),
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.seq).toBe(101);
    expect(next.nodes.size).toBe(3);
    expect(next.nodes.get('c.md')?.out).toBe(1);
    expect(next.edges.size).toBe(2);
    expect(next.edges.get(edgeKey({ source: 'c.md', target: 'a.md', kind: 'link' }))?.label).toBe('A');
    expect(next.epoch).toBe(state.epoch + 1);
  });

  it('removes nodes by id and edges by triple', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      removed: {
        nodes: ['b.md'],
        edges: [{ source: 'a.md', target: 'b.md', kind: 'link' }],
      },
      updated: { nodes: [makeNode('a.md', { out: 0 })] },
      stats: makeStats({ docs: 1, edges: 0 }),
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.nodes.has('b.md')).toBe(false);
    expect(next.edges.size).toBe(0);
    expect(next.nodes.get('a.md')?.out).toBe(0);
  });

  it('replaces updated node records wholesale', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      updated: {
        nodes: [makeNode('b.md', { title: 'Kuutamo', in: 1, tags: ['kuu'], timestamp: '2026-06-16T08:30:00Z' })],
      },
      stats: makeStats({ docs: 2, edges: 1 }),
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.nodes.get('b.md')?.title).toBe('Kuutamo');
    expect(next.nodes.get('b.md')?.tags).toEqual(['kuu']);
    expect(next.nodes.size).toBe(2);
  });

  it('lands an edge count change (removed+added same triple) as the new record', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      removed: { nodes: [], edges: [{ source: 'a.md', target: 'b.md', kind: 'link' }] },
      added: { nodes: [], edges: [makeEdge('a.md', 'b.md', { count: 3, label: 'B' })] },
      stats: makeStats({ docs: 2, edges: 1 }),
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.edges.size).toBe(1);
    expect(next.edges.get(edgeKey({ source: 'a.md', target: 'b.md', kind: 'link' }))?.count).toBe(3);
  });

  it('ignores a delta whose seq is not newer than the current one', () => {
    const state = baseState();
    expect(applyDelta(state, makeDelta(100), 2_000)).toBe(state);
    expect(applyDelta(state, makeDelta(42), 2_000)).toBe(state);
  });

  it('flags needsSnapshot on a seq gap without applying the delta', () => {
    const state = baseState();
    const delta = makeDelta(105, {
      added: { nodes: [makeNode('z.md')], edges: [] },
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.needsSnapshot).toBe(true);
    expect(next.seq).toBe(100);
    expect(next.nodes.has('z.md')).toBe(false);
    expect(next.nodes).toBe(state.nodes); // untouched maps
  });

  it('keeps needsSnapshot raised across later contiguous deltas until a snapshot lands', () => {
    const state = baseState();
    const flagged = applyDelta(state, makeDelta(105), 2_000);
    const next = applyDelta(flagged, makeDelta(101), 2_500);
    expect(next.seq).toBe(101);
    expect(next.needsSnapshot).toBe(true);
  });

  it('records a join with a pre-existing neighbor for the entrance animation', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      added: {
        nodes: [makeNode('c.md', { out: 1 })],
        edges: [makeEdge('c.md', 'b.md')],
      },
    });
    const next = applyDelta(state, delta, 2_000);
    const join = next.joins.get('c.md');
    expect(join).toBeDefined();
    expect(join?.at).toBe(2_000);
    expect(join?.neighborId).toBe('b.md');
  });

  it('records a null join neighbor when no added edge touches a pre-existing node', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      added: { nodes: [makeNode('island.md')], edges: [] },
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.joins.get('island.md')).toEqual({ at: 2_000, neighborId: null });
  });

  it('does not record a join when the added id already existed', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      added: { nodes: [makeNode('a.md', { title: 'A again' })], edges: [] },
    });
    const next = applyDelta(state, delta, 2_000);
    expect(next.joins.has('a.md')).toBe(false);
    expect(next.nodes.get('a.md')?.title).toBe('A again');
  });

  it('records exits with a timestamp for removed nodes', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      removed: { nodes: ['b.md'], edges: [{ source: 'a.md', target: 'b.md', kind: 'link' }] },
    });
    const next = applyDelta(state, delta, 3_000);
    expect(next.exits.get('b.md')).toEqual({ at: 3_000 });
  });

  it('stamps activity for added and updated nodes', () => {
    const state = baseState();
    const delta = makeDelta(101, {
      added: { nodes: [makeNode('c.md')], edges: [] },
      updated: { nodes: [makeNode('a.md')] },
    });
    const next = applyDelta(state, delta, 5_000);
    expect(next.activity.get('c.md')).toBe(5_000);
    expect(next.activity.get('a.md')).toBe(5_000);
    expect(next.activity.has('b.md')).toBe(false);
  });

  it('prunes join/exit/activity bookkeeping older than the animation TTL', () => {
    const state = baseState();
    const first = applyDelta(
      state,
      makeDelta(101, { added: { nodes: [makeNode('c.md')], edges: [] } }),
      1_000,
    );
    const later = applyDelta(
      first,
      makeDelta(102, { updated: { nodes: [makeNode('a.md')] } }),
      1_000 + ANIMATION_TTL_MS + 1,
    );
    expect(later.joins.has('c.md')).toBe(false);
    expect(later.activity.has('c.md')).toBe(false);
    expect(later.activity.get('a.md')).toBeDefined();
  });

  it('replaces stats from the delta', () => {
    const state = baseState();
    const stats = makeStats({ docs: 9, edges: 4, orphans: 2 });
    const next = applyDelta(state, makeDelta(101, { stats }), 2_000);
    expect(next.stats).toEqual(stats);
  });

  it('upserts an updated node that was unknown (defensive against desync)', () => {
    const state = baseState();
    const delta = makeDelta(101, { updated: { nodes: [makeNode('ghost.md')] } });
    const next = applyDelta(state, delta, 2_000);
    expect(next.nodes.has('ghost.md')).toBe(true);
  });
});

describe('applySnapshot', () => {
  it('replaces the graph wholesale, sets seq, clears needsSnapshot', () => {
    const flagged = applyDelta(baseState(), makeDelta(105), 2_000);
    expect(flagged.needsSnapshot).toBe(true);
    const next = applySnapshot(
      flagged,
      {
        nodes: [makeNode('x.md')],
        edges: [],
        ghosts: [],
        islands: [],
        stats: makeStats({ docs: 1 }),
        tags: { t: ['x.md'] },
      },
      200,
      3_000,
    );
    expect(next.seq).toBe(200);
    expect(next.needsSnapshot).toBe(false);
    expect([...next.nodes.keys()]).toEqual(['x.md']);
    expect(next.edges.size).toBe(0);
    expect(next.stats?.docs).toBe(1);
    expect(next.tags).toEqual({ t: ['x.md'] });
    expect(next.epoch).toBe(flagged.epoch + 1);
  });

  it('records no joins when snapshotting into an empty store (initial load)', () => {
    const next = applySnapshot(
      emptyGraphSlice(),
      {
        nodes: [makeNode('a.md'), makeNode('b.md')],
        edges: [makeEdge('a.md', 'b.md')],
        ghosts: [],
        islands: [],
        stats: makeStats({ docs: 2, edges: 1 }),
        tags: {},
      },
      100,
      1_000,
    );
    expect(next.joins.size).toBe(0);
    expect(next.exits.size).toBe(0);
  });

  it('on resync records joins for new ids (with a linked pre-existing neighbor) and exits for vanished ids', () => {
    const state = baseState(); // has a.md, b.md
    const next = applySnapshot(
      state,
      {
        nodes: [makeNode('a.md'), makeNode('c.md')],
        edges: [makeEdge('a.md', 'c.md')],
        ghosts: [],
        islands: [],
        stats: makeStats({ docs: 2, edges: 1 }),
        tags: {},
      },
      120,
      9_000,
    );
    expect(next.joins.get('c.md')).toEqual({ at: 9_000, neighborId: 'a.md' });
    expect(next.exits.get('b.md')).toEqual({ at: 9_000 });
    expect(next.joins.has('a.md')).toBe(false);
  });

  it('adopts the snapshot ghosts; deltas carry none and preserve the held list', () => {
    expect(emptyGraphSlice().ghosts).toEqual([]);
    const withGhosts = applySnapshot(
      emptyGraphSlice(),
      {
        nodes: [makeNode('a.md')],
        edges: [],
        ghosts: [{ source: 'a.md', target: 'olematon.md' }],
        islands: [],
        stats: makeStats({ docs: 1, ghosts: 1 }),
        tags: {},
      },
      100,
      1_000,
    );
    expect(withGhosts.ghosts).toEqual([{ source: 'a.md', target: 'olematon.md' }]);
    // spec/60 deltas do not carry ghosts — the held list survives a delta
    const afterDelta = applyDelta(withGhosts, makeDelta(101), 2_000);
    expect(afterDelta.ghosts).toEqual([{ source: 'a.md', target: 'olematon.md' }]);
  });
});
