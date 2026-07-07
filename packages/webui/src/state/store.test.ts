import { describe, expect, it } from 'vitest';
import type { GraphDelta, GraphEdge, GraphNode, GraphPayload, Presentation, SearchHit } from '../graph/types';
import type { EntityGraph } from '../graph/entities';
import { entityRenderId } from '../graph/entities';
import { createUIStore, presentationRenderId } from './store';
import { EMPTY_TIMELINE as EMPTY_TIMELINE_FIXTURE, type Timeline } from '../time/timeline';
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

describe('view mode (holographic brain)', () => {
  it('starts in cosmos with the morph inactive', () => {
    const s = createUIStore().getState();
    expect(s.mode).toBe('cosmos');
    expect(s.morphActive).toBe(false);
  });

  it('setMode(brain) enters the brain and marks the morph active immediately', () => {
    const store = createUIStore();
    store.getState().setMode('brain');
    expect(store.getState().mode).toBe('brain');
    expect(store.getState().morphActive).toBe(true); // rig/shell mount at once
  });

  it('toggleMode flips cosmos ⇄ brain', () => {
    const store = createUIStore();
    store.getState().toggleMode();
    expect(store.getState().mode).toBe('brain');
    store.getState().toggleMode();
    expect(store.getState().mode).toBe('cosmos');
  });

  it('leaving the brain keeps morphActive until the morph settles', () => {
    const store = createUIStore();
    store.getState().setMode('brain');
    store.getState().setMode('cosmos'); // toggled back
    expect(store.getState().mode).toBe('cosmos');
    expect(store.getState().morphActive).toBe(true); // still transitioning
    store.getState().setMorphActive(false); // MorphController, once uMorph hits 0
    expect(store.getState().morphActive).toBe(false);
  });

  it('setMode ignores a no-op and never bumps state needlessly', () => {
    const store = createUIStore();
    store.getState().setMorphActive(true);
    store.getState().setMode('cosmos'); // already cosmos
    expect(store.getState().morphActive).toBe(true); // untouched
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

const ENTITY_GRAPH: EntityGraph = {
  nodes: [
    { id: 'aurinko', name: 'Aurinko', type: 'star', description: 'The star.', degree: 1 },
    { id: 'kuu', name: 'Kuu', type: 'moon', description: 'The moon.', degree: 1 },
  ],
  edges: [{ src: 'kuu', dst: 'aurinko', weight: 0.9 }],
};

describe('entity layer', () => {
  it('defaults to the links layer with entities not yet available', () => {
    const s = createUIStore().getState();
    expect(s.layer).toBe('links');
    expect(s.entityAvailability).toBe('unknown');
    expect(s.entityGraph).toBeNull();
    expect(s.entitySelection).toBeNull();
  });

  it('setLayer switches layers; back to links clears entity chrome', () => {
    const store = createUIStore();
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 7);
    store.getState().setLayer('entities');
    store.getState().selectEntity('aurinko');
    expect(store.getState().layer).toBe('entities');
    expect(store.getState().entitySelection).toBe('aurinko');
    store.getState().setLayer('links');
    expect(store.getState().layer).toBe('links');
    expect(store.getState().entitySelection).toBeNull();
    expect(store.getState().docEntityFocus).toBeNull();
  });

  it('ingestEntityGraph marks the layer available and bumps the entity epoch', () => {
    const store = createUIStore();
    const before = store.getState().entityEpoch;
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 42);
    const s = store.getState();
    expect(s.entityAvailability).toBe('available');
    expect(s.entityGraph?.nodes.length).toBe(2);
    expect(s.entitySeq).toBe(42);
    expect(s.entityEpoch).toBe(before + 1);
  });

  it('setEntityUnavailable degrades honestly — no graph, falls back to links', () => {
    const store = createUIStore();
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 5);
    store.getState().setLayer('entities');
    store.getState().setEntityUnavailable();
    const s = store.getState();
    expect(s.entityAvailability).toBe('unavailable');
    expect(s.entityGraph).toBeNull();
    expect(s.entitySelection).toBeNull();
    expect(s.layer).toBe('links'); // the view falls back
  });

  it('setLayer refuses to enter an entity layer once it is unavailable', () => {
    const store = createUIStore();
    store.getState().setEntityUnavailable();
    store.getState().setLayer('entities');
    expect(store.getState().layer).toBe('links');
    store.getState().setLayer('overlay');
    expect(store.getState().layer).toBe('links');
  });

  it('selectEntity opens the entity panel and flies to the entity render node', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 10);
    store.getState().select('a.md'); // a doc is selected first
    store.getState().selectEntity('kuu');
    const s = store.getState();
    expect(s.entitySelection).toBe('kuu');
    expect(s.selection).toBeNull(); // doc selection closed
    expect(s.flyTo?.id).toBe(entityRenderId('kuu'));
  });

  it('select() clears a lingering entity selection', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 10);
    store.getState().selectEntity('kuu');
    store.getState().select('a.md');
    expect(store.getState().entitySelection).toBeNull();
    expect(store.getState().selection).toBe('a.md');
  });

  it('overlay: selecting a doc lights up the entities grounded in it', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 10);
    store.getState().ingestGrounding(new Map([['kuu', ['a.md']], ['aurinko', ['b.md']]]));
    store.getState().setLayer('overlay');
    store.getState().selectDocInOverlay('a.md');
    const s = store.getState();
    expect(s.docEntityFocus).toBe('a.md');
    expect(s.dimOthers).toBe(true);
    expect(s.highlight.has(entityRenderId('kuu'))).toBe(true); // grounded in a.md
    expect(s.highlight.has('a.md')).toBe(true); // the doc itself stays lit
    expect(s.highlight.has(entityRenderId('aurinko'))).toBe(false); // grounded elsewhere
  });

  it('grounding arriving after a doc focus refreshes the lit entity set', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 10);
    store.getState().setLayer('overlay');
    store.getState().selectDocInOverlay('a.md');
    expect(store.getState().highlight.has(entityRenderId('kuu'))).toBe(false); // no grounding yet
    store.getState().ingestGrounding(new Map([['kuu', ['a.md']]]));
    expect(store.getState().highlight.has(entityRenderId('kuu'))).toBe(true);
  });

  it('an open search overrides the overlay doc focus, then hands it back', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 10);
    store.getState().ingestGrounding(new Map([['kuu', ['a.md']]]));
    store.getState().setLayer('overlay');
    store.getState().selectDocInOverlay('a.md');
    store.getState().openSearch();
    store.getState().setSearchHits([
      { path: 'b.md', title: 'B', description: null, score: 1, snippet: null, source: 'keyword' },
    ]);
    expect([...store.getState().highlight]).toEqual(['b.md']); // search wins
    store.getState().clearSearch();
    expect(store.getState().highlight.has(entityRenderId('kuu'))).toBe(true); // doc focus restored
  });

  it('selectSourceDoc jumps to the doc layer (overlay) and flies to the doc', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().ingestEntityGraph(ENTITY_GRAPH, 10);
    store.getState().setLayer('entities');
    store.getState().selectEntity('kuu');
    store.getState().selectSourceDoc('a.md');
    const s = store.getState();
    expect(s.layer).toBe('overlay');
    expect(s.selection).toBe('a.md');
    expect(s.entitySelection).toBeNull();
    expect(s.flyTo?.id).toBe('a.md');
  });
});

describe('UI store — the Time Machine', () => {
  const tl: Timeline = {
    commits: [
      { sha: 'aaa0000', date: '2026-07-01T00:00:00Z', author: 'Tom', message: 'born', added: ['a.md'], modified: [], deleted: [] },
      { sha: 'bbb1111', date: '2026-07-02T00:00:00Z', author: 'Tom', message: 'grow', added: ['b.md'], modified: ['a.md'], deleted: [] },
      { sha: 'ccc2222', date: '2026-07-03T00:00:00Z', author: 'Tom', message: 'more', added: ['c.md'], modified: [], deleted: [] },
    ],
    docs: {
      'a.md': { created: '2026-07-01T00:00:00Z', modified: ['2026-07-02T00:00:00Z'], deleted: null },
      'b.md': { created: '2026-07-02T00:00:00Z', modified: [], deleted: null },
      'c.md': { created: '2026-07-03T00:00:00Z', modified: [], deleted: null },
    },
    span: { commits: 3, first: '2026-07-01T00:00:00Z', last: '2026-07-03T00:00:00Z' },
  };

  it('enterTimeTravel needs history — a no-op on the empty timeline', () => {
    const store = createUIStore();
    store.getState().enterTimeTravel();
    expect(store.getState().timeTravel).toBe(false);
  });

  it('enter opens at the present (last commit); exit stops and restores live', () => {
    const store = createUIStore();
    store.getState().ingestTimeline(tl);
    store.getState().enterTimeTravel();
    let s = store.getState();
    expect(s.timeTravel).toBe(true);
    expect(s.timeTravelActive).toBe(true);
    expect(s.scrubIndex).toBe(2); // last commit = the present
    store.getState().exitTimeTravel();
    s = store.getState();
    expect(s.timeTravel).toBe(false);
    expect(s.playing).toBe(false);
  });

  it('setScrubIndex clamps to [0, commits-1] and a manual scrub stops playback', () => {
    const store = createUIStore();
    store.getState().ingestTimeline(tl);
    store.getState().enterTimeTravel(0);
    store.getState().setPlaying(true);
    expect(store.getState().playing).toBe(true);
    store.getState().setScrubIndex(99); // manual scrub → clamp + stop
    expect(store.getState().scrubIndex).toBe(2);
    expect(store.getState().playing).toBe(false);
    store.getState().setScrubIndex(-5);
    expect(store.getState().scrubIndex).toBe(0);
  });

  it('a play tick (fromPlay) advances without stopping playback', () => {
    const store = createUIStore();
    store.getState().ingestTimeline(tl);
    store.getState().enterTimeTravel(0);
    store.getState().setPlaying(true);
    store.getState().setScrubIndex(1.2, true);
    expect(store.getState().scrubIndex).toBeCloseTo(1.2, 6);
    expect(store.getState().playing).toBe(true);
  });

  it('stepCommit rounds then steps whole commits', () => {
    const store = createUIStore();
    store.getState().ingestTimeline(tl);
    store.getState().enterTimeTravel(0);
    store.getState().setScrubIndex(1.4);
    store.getState().stepCommit(1);
    expect(store.getState().scrubIndex).toBe(2); // round(1.4)=1, +1 → 2
    store.getState().stepCommit(-1);
    expect(store.getState().scrubIndex).toBe(1);
  });

  it('pressing play at the end restarts the growth movie from the start', () => {
    const store = createUIStore();
    store.getState().ingestTimeline(tl);
    store.getState().enterTimeTravel(); // at the last commit (2)
    store.getState().setPlaying(true);
    expect(store.getState().scrubIndex).toBe(0); // rewound to play forward
    expect(store.getState().playing).toBe(true);
  });

  it('ingestTimeline re-clamps the scrub and drops travel when history vanishes', () => {
    const store = createUIStore();
    store.getState().ingestTimeline(tl);
    store.getState().enterTimeTravel(2);
    store.getState().ingestTimeline(EMPTY_TIMELINE_FIXTURE);
    const s = store.getState();
    expect(s.timeTravel).toBe(false); // no history → travel drops
    expect(s.scrubIndex).toBe(0);
  });
});

describe('applyServerUi — the operator [ui] policy reaches the store', () => {
  it('the mobile cap wins over the GPU guess, and serverUi is captured', () => {
    const store = createUIStore();
    store.getState().initGpu(tierFor('high')); // 40_000
    store.getState().applyServerUi({ max_nodes_mobile: 1200, default_mode: 'cosmos' }, { isMobile: true });
    expect(store.getState().nodeBudget).toBe(1200);
    expect(store.getState().serverUi).toEqual({ max_nodes_mobile: 1200, default_mode: 'cosmos' });
  });

  it('desktop keeps the GPU-tier budget (the mobile cap does not apply)', () => {
    const store = createUIStore();
    store.getState().initGpu(tierFor('mid')); // 8_000
    store.getState().applyServerUi({ max_nodes_mobile: 1200 }, { isMobile: false });
    expect(store.getState().nodeBudget).toBe(8_000);
  });

  it('an absent [ui] block falls back to the GPU guess and leaves serverUi null', () => {
    const store = createUIStore();
    store.getState().initGpu(tierFor('low')); // 2_500
    store.getState().applyServerUi(null, { isMobile: true });
    expect(store.getState().nodeBudget).toBe(2_500);
    expect(store.getState().serverUi).toBeNull();
  });

  it('default_mode "brain" opens the hologram on first load', () => {
    const store = createUIStore();
    store.getState().applyServerUi({ default_mode: 'brain' }, { isMobile: false });
    expect(store.getState().mode).toBe('brain');
    expect(store.getState().morphActive).toBe(true);
  });

  it('default_mode is honored ONCE — a later status never yanks a user’s chosen view', () => {
    const store = createUIStore();
    store.getState().applyServerUi({ default_mode: 'cosmos' }, { isMobile: false });
    store.getState().toggleMode(); // the user goes to the brain
    expect(store.getState().mode).toBe('brain');
    store.getState().applyServerUi({ default_mode: 'cosmos' }, { isMobile: false }); // a second /api/status
    expect(store.getState().mode).toBe('brain'); // not pulled back to cosmos
  });
});

describe('presentations (brain_show, spec/95)', () => {
  const pres = (over: Partial<Presentation> & { seq: number }): Presentation => ({
    annotation: null,
    focus: null,
    mode: null,
    nodes: [],
    ...over,
  });

  it('maps presentation ids into the render-id space (docs pass through, entity slugs namespaced)', () => {
    expect(presentationRenderId('aurinko.md')).toBe('aurinko.md'); // doc path
    expect(presentationRenderId('saaret/atolli.md')).toBe('saaret/atolli.md'); // nested doc path
    expect(presentationRenderId('aurinko')).toBe(entityRenderId('aurinko')); // bare entity slug
    expect(presentationRenderId(entityRenderId('kuu'))).toBe(entityRenderId('kuu')); // already a render id
  });

  it('spotlights the nodes (dims the rest), flies to the focus, switches mode and captions the view', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(
      pres({ nodes: ['a.md'], focus: 'a.md', mode: 'brain', annotation: 'the sun and its worlds', seq: 1 }),
    );
    const s = store.getState();
    expect(s.presentationSeq).toBe(1);
    expect([...s.highlight]).toEqual(['a.md']); // spotlight = the shared highlight set
    expect(s.dimOthers).toBe(true); // the rest of the cosmos fades
    expect(s.mode).toBe('brain'); // the view switched
    expect(s.morphActive).toBe(true);
    expect(s.flyTo?.id).toBe('a.md'); // the camera flew to the focus
    expect(s.presentationCaptionVisible).toBe(true);
    expect(s.presentation?.annotation).toBe('the sun and its worlds');
  });

  it('maps a bare entity slug into its render id while doc paths pass through', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['a.md', 'aurinko'], seq: 1 }));
    const hl = store.getState().highlight;
    expect(hl.has('a.md')).toBe(true);
    expect(hl.has(entityRenderId('aurinko'))).toBe(true);
  });

  it('with no focus, frames the set by flying to its first node (the engine default)', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['b.md', 'a.md'], seq: 1 }));
    expect(store.getState().flyTo?.id).toBe('b.md');
  });

  it('ignores an older or duplicate seq — a later frame never regresses to an earlier one', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['a.md'], annotation: 'first', seq: 5 }));
    store.getState().applyPresentation(pres({ nodes: ['b.md'], annotation: 'stale', seq: 3 })); // older
    let s = store.getState();
    expect(s.presentationSeq).toBe(5);
    expect([...s.highlight]).toEqual(['a.md']);
    expect(s.presentation?.annotation).toBe('first');
    store.getState().applyPresentation(pres({ nodes: ['b.md'], annotation: 'dupe', seq: 5 })); // duplicate
    s = store.getState();
    expect(s.presentationSeq).toBe(5);
    expect([...s.highlight]).toEqual(['a.md']);
  });

  it('a higher seq replaces the previous presentation', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['a.md'], annotation: 'first', seq: 5 }));
    store.getState().applyPresentation(pres({ nodes: ['b.md'], annotation: 'second', seq: 6 }));
    const s = store.getState();
    expect(s.presentationSeq).toBe(6);
    expect([...s.highlight]).toEqual(['b.md']);
    expect(s.presentation?.annotation).toBe('second');
  });

  it('a cleared (empty) presentation removes the spotlight and the caption', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['a.md'], annotation: 'here', seq: 1 }));
    store.getState().applyPresentation(pres({ nodes: [], focus: null, mode: null, annotation: null, seq: 2 }));
    const s = store.getState();
    expect(s.presentationSeq).toBe(2);
    expect(s.highlight.size).toBe(0);
    expect(s.dimOthers).toBe(false);
    expect(s.presentation).toBeNull();
    expect(s.presentationCaptionVisible).toBe(false);
  });

  it('dismissCaption hides the caption but keeps the spotlight', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['a.md'], annotation: 'stay lit', seq: 1 }));
    store.getState().dismissCaption();
    const s = store.getState();
    expect(s.presentationCaptionVisible).toBe(false);
    expect([...s.highlight]).toEqual(['a.md']); // the spotlight remains
    expect(s.presentation).not.toBeNull();
  });

  it('an open search overrides the presentation spotlight; closing it restores the presentation', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    store.getState().applyPresentation(pres({ nodes: ['a.md'], seq: 1 }));
    expect([...store.getState().highlight]).toEqual(['a.md']);
    store.getState().openSearch();
    store.getState().setSearchHits([
      { path: 'b.md', title: 'B', description: null, score: 1, snippet: null, source: 'keyword' },
    ]);
    expect([...store.getState().highlight]).toEqual(['b.md']); // user intent wins
    store.getState().closeSearch();
    expect([...store.getState().highlight]).toEqual(['a.md']); // the presentation resurfaces
  });

  it('applies while time-travelling — the spotlight rides the present nodes, travel unaffected', () => {
    const store = createUIStore();
    store.getState().ingestSnapshot(payload, 10);
    const timeline: Timeline = {
      commits: [
        { sha: 'aaa', date: '2026-07-01T00:00:00Z', author: 'T', message: 'seed', added: ['a.md'], modified: [], deleted: [] },
        { sha: 'bbb', date: '2026-07-02T00:00:00Z', author: 'T', message: 'grow', added: ['b.md'], modified: [], deleted: [] },
      ],
      docs: {
        'a.md': { created: '2026-07-01T00:00:00Z', modified: [], deleted: null },
        'b.md': { created: '2026-07-02T00:00:00Z', modified: [], deleted: null },
      },
      span: { commits: 2, first: '2026-07-01T00:00:00Z', last: '2026-07-02T00:00:00Z' },
    };
    store.getState().ingestTimeline(timeline);
    store.getState().enterTimeTravel(0);
    expect(store.getState().timeTravel).toBe(true);
    store.getState().applyPresentation(pres({ nodes: ['a.md'], focus: 'a.md', annotation: 'in the past', seq: 1 }));
    const s = store.getState();
    expect(s.timeTravel).toBe(true); // a presentation never disturbs time travel
    expect([...s.highlight]).toEqual(['a.md']); // the spotlight still applies
    expect(s.presentationCaptionVisible).toBe(true);
  });
});
