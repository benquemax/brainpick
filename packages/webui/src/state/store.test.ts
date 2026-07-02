import { describe, expect, it } from 'vitest';
import type { GraphDelta, GraphNode, GraphPayload, SearchHit } from '../graph/types';
import { createUIStore } from './store';

function makeNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    title: id,
    description: null,
    type: null,
    tags: [],
    timestamp: null,
    in: 0,
    out: 0,
    orphan: false,
    reserved: false,
    ...over,
  };
}

const payload: GraphPayload = {
  nodes: [makeNode('a.md'), makeNode('b.md')],
  edges: [{ source: 'a.md', target: 'b.md', kind: 'link', label: null, count: 1 }],
  ghosts: [],
  islands: [],
  stats: { docs: 2, edges: 1, ghosts: 0, islands: 0, orphans: 0, tags: 0 },
  tags: {},
};

function delta(seq: number, parts: Partial<GraphDelta> = {}): GraphDelta {
  return {
    seq,
    added: { nodes: [], edges: [] },
    removed: { nodes: [], edges: [] },
    updated: { nodes: [] },
    stats: payload.stats,
    cause: { paths: [], tier: 't1' },
    ...parts,
  };
}

describe('UI store', () => {
  it('ingestHello records tiers and the server seq without touching graph seq', () => {
    const store = createUIStore();
    store.getState().ingestHello({ seq: 4212, spec_version: '0.1', tiers: { t1: 'fresh', t2: 'off', t3: 'off' } });
    const s = store.getState();
    expect(s.tiers).toEqual({ t1: 'fresh', t2: 'off', t3: 'off' });
    expect(s.serverSeq).toBe(4212);
    expect(s.seq).toBe(0); // graph state untouched — no snapshot yet
  });

  it('ingestSnapshot replaces the graph and clears needsSnapshot', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 4212);
    const s = store.getState();
    expect(s.seq).toBe(4212);
    expect(s.nodes.size).toBe(2);
    expect(s.needsSnapshot).toBe(false);
  });

  it('ingestDelta applies through the reducer and bumps the epoch', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    const epoch = store.getState().epoch;
    store.getState().ingestDelta(delta(11, { added: { nodes: [makeNode('c.md')], edges: [] } }));
    const s = store.getState();
    expect(s.seq).toBe(11);
    expect(s.nodes.has('c.md')).toBe(true);
    expect(s.epoch).toBe(epoch + 1);
  });

  it('ingestDelta with a seq gap raises needsSnapshot', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestDelta(delta(15));
    expect(store.getState().needsSnapshot).toBe(true);
    expect(store.getState().seq).toBe(10);
  });

  it('select() sets the selection and queues a camera flight for known nodes', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().select('a.md');
    const s = store.getState();
    expect(s.selection).toBe('a.md');
    expect(s.flyTo?.id).toBe('a.md');
    const nonce = s.flyTo?.nonce ?? -1;
    store.getState().select('b.md');
    expect(store.getState().flyTo?.nonce).toBe(nonce + 1);
  });

  it('select(null) clears the selection without queueing a flight', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().select('a.md');
    const flight = store.getState().flyTo;
    store.getState().select(null);
    expect(store.getState().selection).toBeNull();
    expect(store.getState().flyTo).toBe(flight); // unchanged
  });

  it('search hits drive the highlight set; clearSearch releases it', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    const hits: SearchHit[] = [
      { path: 'a.md', title: 'A', description: null, score: 2, snippet: null, source: 'keyword' },
      { path: 'b.md', title: 'B', description: null, score: 1, snippet: null, source: 'keyword' },
    ];
    store.getState().openSearch();
    store.getState().setSearchHits(hits);
    expect(store.getState().highlight.has('a.md')).toBe(true);
    expect(store.getState().highlight.has('b.md')).toBe(true);
    store.getState().clearSearch();
    const s = store.getState();
    expect(s.highlight.size).toBe(0);
    expect(s.searchOpen).toBe(false);
    expect(s.searchQuery).toBe('');
    expect(s.searchHits).toEqual([]);
  });

  it('focusHit selects, flies and closes the overlay but keeps the hit highlighted', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().openSearch();
    store.getState().setSearchHits([
      { path: 'b.md', title: 'B', description: null, score: 1, snippet: null, source: 'keyword' },
    ]);
    store.getState().focusHit('b.md');
    const s = store.getState();
    expect(s.selection).toBe('b.md');
    expect(s.flyTo?.id).toBe('b.md');
    expect(s.searchOpen).toBe(false);
    expect(s.highlight.has('b.md')).toBe(true);
  });

  it('previewNode queues a flight without changing the selection', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().previewNode('a.md');
    expect(store.getState().flyTo?.id).toBe('a.md');
    expect(store.getState().selection).toBeNull();
    const nonce = store.getState().flyTo?.nonce ?? -1;
    store.getState().previewNode('missing.md'); // unknown node: no flight
    expect(store.getState().flyTo?.nonce).toBe(nonce);
  });

  it('tracks connection and compile status', () => {
    const store = createUIStore();
    store.getState().setConnection('reconnecting');
    store.getState().setCompile({ seq: 12, state: 'running', tier: 't1' });
    expect(store.getState().connection).toBe('reconnecting');
    expect(store.getState().compile?.state).toBe('running');
  });
});
