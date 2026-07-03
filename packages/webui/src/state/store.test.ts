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

describe('search modes', () => {
  it('defaults to auto and switches on setSearchMode', () => {
    const store = createUIStore();
    expect(store.getState().searchMode).toBe('auto');
    store.getState().setSearchMode('semantic');
    expect(store.getState().searchMode).toBe('semantic');
  });

  it('setSearchHits records the response meta (used modes + degradation)', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().openSearch();
    store.getState().setSearchHits(
      [{ path: 'a.md', title: 'A', description: null, score: 2, snippet: null, source: 'keyword' }],
      { usedModes: ['keyword'], degradedFrom: 'semantic' },
    );
    expect(store.getState().searchMeta).toEqual({ usedModes: ['keyword'], degradedFrom: 'semantic' });
  });

  it('clearSearch drops hits and meta but the chosen mode is sticky', () => {
    const store = createUIStore();
    store.getState().setSearchMode('keyword');
    store.getState().openSearch();
    store.getState().setSearchHits(
      [{ path: 'a.md', title: 'A', description: null, score: 2, snippet: null, source: 'keyword' }],
      { usedModes: ['keyword'], degradedFrom: null },
    );
    store.getState().clearSearch();
    const s = store.getState();
    expect(s.searchMeta).toBeNull();
    expect(s.searchMode).toBe('keyword');
  });
});

describe('lenses', () => {
  const lensPayload: GraphPayload = {
    nodes: [
      makeNode('a.md', { tags: ['star'] }),
      makeNode('b.md', { tags: ['star'] }),
      makeNode('c.md', { orphan: true }),
    ],
    edges: [],
    ghosts: [],
    islands: [],
    stats: { docs: 3, edges: 0, ghosts: 0, islands: 0, orphans: 1, tags: 1 },
    tags: { star: ['a.md', 'b.md'] },
  };

  it('toggleLens(orphans) highlights orphans and dims the rest; toggling again releases', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(lensPayload, 10);
    store.getState().toggleLens({ kind: 'orphans' });
    let s = store.getState();
    expect(s.lens).toEqual({ kind: 'orphans' });
    expect([...s.highlight]).toEqual(['c.md']);
    expect(s.dimOthers).toBe(true);
    store.getState().toggleLens({ kind: 'orphans' });
    s = store.getState();
    expect(s.lens).toEqual({ kind: 'none' });
    expect(s.highlight.size).toBe(0);
    expect(s.dimOthers).toBe(false);
  });

  it('tag lens highlights the tagged nodes; switching tags swaps the set', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(lensPayload, 10);
    store.getState().toggleLens({ kind: 'tag', tag: 'star' });
    expect([...store.getState().highlight].sort()).toEqual(['a.md', 'b.md']);
    store.getState().toggleLens({ kind: 'tag', tag: 'nope' });
    const s = store.getState();
    expect(s.lens).toEqual({ kind: 'tag', tag: 'nope' });
    expect(s.highlight.size).toBe(0);
    expect(s.dimOthers).toBe(true); // an empty lens still dims: "nothing matches" is honest
  });

  it('an active search overrides the lens highlight; clearing search restores it', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(lensPayload, 10);
    store.getState().toggleLens({ kind: 'orphans' });
    store.getState().openSearch();
    store.getState().setSearchHits([
      { path: 'a.md', title: 'A', description: null, score: 2, snippet: null, source: 'keyword' },
    ]);
    expect([...store.getState().highlight]).toEqual(['a.md']);
    expect(store.getState().dimOthers).toBe(true);
    store.getState().clearSearch();
    expect([...store.getState().highlight]).toEqual(['c.md']); // lens takes back over
    expect(store.getState().dimOthers).toBe(true);
  });

  it('lens membership recomputes when a delta changes the graph', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(lensPayload, 10);
    store.getState().toggleLens({ kind: 'orphans' });
    store.getState().ingestDelta(
      delta(11, { added: { nodes: [makeNode('d.md', { orphan: true })], edges: [] } }),
    );
    expect([...store.getState().highlight].sort()).toEqual(['c.md', 'd.md']);
  });
});

describe('ghost edges', () => {
  it('snapshot stores ghosts, deltas preserve them, toggleGhosts flips visibility', () => {
    const store = createUIStore();
    const ghostPayload: GraphPayload = { ...payload, ghosts: [{ source: 'a.md', target: 'olematon.md' }] };
    store.getState().ingestSnapshot(ghostPayload, 10);
    expect(store.getState().ghosts).toEqual([{ source: 'a.md', target: 'olematon.md' }]);
    store.getState().ingestDelta(delta(11));
    expect(store.getState().ghosts).toEqual([{ source: 'a.md', target: 'olematon.md' }]);
    expect(store.getState().showGhosts).toBe(true);
    store.getState().toggleGhosts();
    expect(store.getState().showGhosts).toBe(false);
    store.getState().toggleGhosts();
    expect(store.getState().showGhosts).toBe(true);
  });
});

describe('camera bookmarks and commands', () => {
  it('starts with three empty slots', () => {
    expect(createUIStore().getState().bookmarks).toEqual([null, null, null]);
  });

  it('saveBookmark stores a pose; recallBookmark issues a pose command with a fresh nonce', () => {
    const store = createUIStore();
    store.getState().saveBookmark(1, { x: 10, y: -4, zoom: 7 });
    expect(store.getState().bookmarks[1]).toEqual({ x: 10, y: -4, zoom: 7 });
    store.getState().recallBookmark(1);
    const cmd = store.getState().cameraCommand;
    expect(cmd).not.toBeNull();
    if (cmd?.kind !== 'pose') throw new Error('expected a pose command');
    expect(cmd.pose).toEqual({ x: 10, y: -4, zoom: 7 });
    const nonce = cmd.nonce;
    store.getState().recallBookmark(1);
    expect(store.getState().cameraCommand?.nonce).toBe(nonce + 1);
  });

  it('recalling an empty or out-of-range slot does nothing', () => {
    const store = createUIStore();
    store.getState().recallBookmark(0);
    store.getState().recallBookmark(7);
    expect(store.getState().cameraCommand).toBeNull();
  });

  it('saveBookmark ignores out-of-range slots', () => {
    const store = createUIStore();
    store.getState().saveBookmark(3, { x: 0, y: 0, zoom: 1 });
    store.getState().saveBookmark(-1, { x: 0, y: 0, zoom: 1 });
    expect(store.getState().bookmarks).toEqual([null, null, null]);
  });

  it('requestBookmarkSave bumps a nonce for the camera rig to answer', () => {
    const store = createUIStore();
    expect(store.getState().bookmarkSaveRequest).toBeNull();
    store.getState().requestBookmarkSave(2);
    const req = store.getState().bookmarkSaveRequest;
    expect(req?.slot).toBe(2);
    store.getState().requestBookmarkSave(0);
    expect(store.getState().bookmarkSaveRequest?.nonce).toBe((req?.nonce ?? 0) + 1);
  });

  it('requestOverview issues an overview command; nonces increase across command kinds', () => {
    const store = createUIStore();
    store.getState().requestOverview();
    const first = store.getState().cameraCommand;
    expect(first?.kind).toBe('overview');
    store.getState().saveBookmark(0, { x: 1, y: 2, zoom: 3 });
    store.getState().recallBookmark(0);
    expect(store.getState().cameraCommand?.nonce).toBe((first?.nonce ?? 0) + 1);
  });
});

describe('hud panel', () => {
  it('opens and closes the tags flyout', () => {
    const store = createUIStore();
    expect(store.getState().hudPanel).toBeNull();
    store.getState().setHudPanel('tags');
    expect(store.getState().hudPanel).toBe('tags');
    store.getState().setHudPanel(null);
    expect(store.getState().hudPanel).toBeNull();
  });
});
