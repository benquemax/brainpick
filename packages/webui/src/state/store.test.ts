import { describe, expect, it } from 'vitest';
import type { GraphDelta, GraphEdge, GraphNode, GraphPayload, SearchHit } from '../graph/types';
import { createUIStore } from './store';
import { budgetedGraph, isClusterId } from './budget';
import { treeForGraph, type TreeDir } from './tree';
import { tierFor } from '../scene/gpuTier';
import { GPU_BUDGET } from '../scene/tuning';

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

describe('navigator', () => {
  it('starts closed; toggleNavigator flips it open and shut', () => {
    const store = createUIStore();
    expect(store.getState().navigatorOpen).toBe(false);
    store.getState().toggleNavigator();
    expect(store.getState().navigatorOpen).toBe(true);
    store.getState().toggleNavigator();
    expect(store.getState().navigatorOpen).toBe(false);
  });

  it('the tree derives from the graph state and is memoized between deltas', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(
      { ...payload, nodes: [makeNode('kuu.md', { title: 'Kuu' }), makeNode('saaret/atolli.md', { title: 'Atolli' })] },
      10,
    );
    const s = store.getState();
    const tree = treeForGraph(s.nodes, s.seq);
    expect(tree.docCount).toBe(2);
    expect(tree.children.map((e) => e.name)).toEqual(['saaret', 'kuu.md']);
    // no graph change -> the same object (no rebuild between renders)
    expect(treeForGraph(store.getState().nodes, store.getState().seq)).toBe(tree);
  });

  it('a join delta grows the tree in the right dir; a leave delta shrinks it', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(
      { ...payload, nodes: [makeNode('kuu.md', { title: 'Kuu' }), makeNode('saaret/atolli.md', { title: 'Atolli' })] },
      10,
    );
    const before = treeForGraph(store.getState().nodes, store.getState().seq);

    store.getState().ingestDelta(
      delta(11, { added: { nodes: [makeNode('saaret/uusi.md', { title: 'Uusi' })], edges: [] } }),
    );
    let s = store.getState();
    let tree = treeForGraph(s.nodes, s.seq);
    expect(tree).not.toBe(before); // the delta invalidated the memo
    let saaret = tree.children.find((e) => e.name === 'saaret') as TreeDir;
    expect(saaret.docCount).toBe(2);
    expect(saaret.children.map((e) => e.name)).toEqual(['atolli.md', 'uusi.md']);

    store.getState().ingestDelta(delta(12, { removed: { nodes: ['saaret/uusi.md'], edges: [] } }));
    s = store.getState();
    tree = treeForGraph(s.nodes, s.seq);
    saaret = tree.children.find((e) => e.name === 'saaret') as TreeDir;
    expect(saaret.docCount).toBe(1);
    expect(saaret.children.map((e) => e.name)).toEqual(['atolli.md']);
  });
});

/** A synthetic graph across a few dirs, degrees rising with index. */
function bigPayload(n: number): GraphPayload {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    const dir = i % 4 === 0 ? '' : `dir${i % 4}`;
    const id = dir === '' ? `root${i}.md` : `${dir}/n${i}.md`;
    nodes.push(makeNode(id, { in: i % 5, out: i % 3 }));
  }
  for (let i = 1; i < n; i++) {
    const a = nodes[i - 1] as GraphNode;
    const b = nodes[i] as GraphNode;
    edges.push({ source: a.id, target: b.id, kind: 'link', label: null, count: 1 });
  }
  return {
    nodes,
    edges,
    ghosts: [],
    islands: [],
    stats: { docs: n, edges: edges.length, ghosts: 0, islands: 0, orphans: 0, tags: 0 },
    tags: {},
  };
}

describe('GPU budget', () => {
  it('starts on the default (high) tier so nothing is capped by accident', () => {
    const store = createUIStore();
    const s = store.getState();
    expect(s.gpu.tier).toBe('high');
    expect(s.nodeBudget).toBe(GPU_BUDGET.nodeBudget.high);
    expect(s.expandedDirs.size).toBe(0);
  });

  it('initGpu adopts a detected tier and its node budget', () => {
    const store = createUIStore();
    store.getState().initGpu(tierFor('low'));
    const s = store.getState();
    expect(s.gpu.tier).toBe('low');
    expect(s.nodeBudget).toBe(GPU_BUDGET.nodeBudget.low);
  });

  it('setNodeBudget clamps to [1, ceiling]; raiseBudget grows by the factor', () => {
    const store = createUIStore();
    store.getState().setNodeBudget(0);
    expect(store.getState().nodeBudget).toBe(1);
    store.getState().setNodeBudget(10_000_000);
    expect(store.getState().nodeBudget).toBe(GPU_BUDGET.budgetCeiling);
    store.getState().setNodeBudget(100);
    store.getState().raiseBudget();
    expect(store.getState().nodeBudget).toBe(100 * GPU_BUDGET.showMoreFactor);
  });

  it('a small brain is never capped: the budgeted view is a pure passthrough', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10); // 2 docs
    const s = store.getState();
    const view = budgetedGraph(s.nodes, s.edges, s.seq, s.nodeBudget, s.expandedDirs);
    expect(view.aggregated.size).toBe(0);
    expect(view.renderNodes).toHaveLength(2);
    expect(s.nodeBudget).toBeGreaterThanOrEqual(s.nodes.size);
  });

  it('a 500-node graph under a small budget aggregates; "show more" un-caps it', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(bigPayload(500), 1);
    store.getState().setNodeBudget(50);
    let s = store.getState();
    let view = budgetedGraph(s.nodes, s.edges, s.seq, s.nodeBudget, s.expandedDirs);
    expect(view.totalNodes).toBe(500);
    expect(view.shownNodes).toBe(50); // top-50 by degree
    expect(view.aggregated.size).toBeGreaterThan(0); // per-dir proxies
    expect(view.renderNodes.some((node) => isClusterId(node.id))).toBe(true);

    // Raise the cap above the node count -> honesty restored, no proxies.
    store.getState().setNodeBudget(1000);
    s = store.getState();
    view = budgetedGraph(s.nodes, s.edges, s.seq, s.nodeBudget, s.expandedDirs);
    expect(view.aggregated.size).toBe(0);
    expect(view.shownNodes).toBe(500);
  });

  it('expandDir reveals a dir and drops its proxy; collapseDir puts it back', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(bigPayload(500), 1);
    store.getState().setNodeBudget(50);
    const proxyDir = 'dir1';

    let s = store.getState();
    let view = budgetedGraph(s.nodes, s.edges, s.seq, s.nodeBudget, s.expandedDirs);
    const proxyId = [...view.aggregated.keys()].find((id) => id.startsWith(proxyDir));
    expect(proxyId).toBeDefined();

    store.getState().expandDir(proxyDir);
    s = store.getState();
    expect(s.expandedDirs.has(proxyDir)).toBe(true);
    view = budgetedGraph(s.nodes, s.edges, s.seq, s.nodeBudget, s.expandedDirs);
    // every dir1 doc is now rendered as a real node; no dir1 proxy remains
    const dir1Real = view.renderNodes.filter((node) => node.id.startsWith(`${proxyDir}/`) && !isClusterId(node.id));
    expect(dir1Real.length).toBeGreaterThan(0);
    expect([...view.aggregated.keys()].some((id) => id.startsWith(proxyDir) && isClusterId(id))).toBe(false);

    store.getState().collapseDir(proxyDir);
    expect(store.getState().expandedDirs.has(proxyDir)).toBe(false);
  });
});
