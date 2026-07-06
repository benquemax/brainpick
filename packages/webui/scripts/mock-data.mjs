/**
 * Mock data for the standalone dev server, hand-derived from
 * spec/fixtures/bundles/kotiaurinko/ and kept in lockstep with its golden
 * t1/graph.json (10 documents, 20 edges, saaret island, one ghost link to
 * olematon.md, yksinainen.md as the only orphan). Reserved index.md edges
 * count in edges/in/out; only `orphan` treats reserved-source links as
 * navigation, per the normative orphan rule (spec/20).
 *
 * Plain ESM, no dependencies — consumed by scripts/mock-server.mjs (node)
 * and by the vitest suite (typed via mock-data.d.mts).
 */

export const BASE_SEQ = 4212;
export const STEP_COUNT = 6;

const node = (id, title, over = {}) => ({
  id,
  title,
  description: null,
  type: 'Concept',
  tags: [],
  timestamp: null,
  in: 0,
  out: 0,
  orphan: false,
  reserved: false,
  ...over,
});

const edge = (source, target, label, over = {}) => ({
  source,
  target,
  kind: 'link',
  label,
  count: 1,
  ...over,
});

const edgeSort = (a, b) =>
  a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind);

/** Recompute the tag map (tag -> sorted node ids, keys sorted) from nodes. */
function tagsFromNodes(nodes) {
  const map = new Map();
  for (const n of nodes) {
    for (const t of n.tags) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(n.id);
    }
  }
  const out = {};
  for (const key of [...map.keys()].sort()) out[key] = map.get(key).sort();
  return out;
}

export function initialGraph() {
  const nodes = [
    node('aurinko.md', 'Aurinko', {
      description: 'The star everything in this bundle orbits.',
      tags: ['tähti'],
      in: 4,
      out: 3,
    }),
    node('index.md', 'Kotiaurinko', { type: null, reserved: true, in: 0, out: 8 }),
    node('komeetta.md', 'Komeetta', {
      description: 'A visitor with a tail, seen only every few decades — pöllämystynyt matkalainen.',
      tags: ['vierailija'],
      in: 2,
      out: 1,
    }),
    node('kuu.md', 'Kuu', { tags: ['kuu'], timestamp: '2026-06-15T08:30:00Z', in: 3, out: 1 }),
    node('log.md', 'Update log', { type: null, reserved: true }),
    node('maa.md', 'Maa', {
      description: 'The blue world with a companion and a home.',
      tags: ['planeetta', 'koti'],
      timestamp: '2026-06-10T12:00:00Z',
      in: 3,
      out: 2,
    }),
    node('planeetat.md', 'Planeetat', {
      description: 'The catalogue of worlds around the star.',
      tags: ['luettelo'],
      timestamp: '2026-06-01T00:00:00Z',
      in: 3,
      out: 2,
    }),
    node('saaret/atolli.md', 'Atolli', {
      description: 'A ring of coral in the island sea.',
      tags: ['saari'],
      in: 2,
      out: 1,
    }),
    node('saaret/laguuni.md', 'Laguuni', {
      description: 'The calm water inside the ring.',
      tags: ['saari'],
      in: 2,
      out: 1,
    }),
    node('yksinainen.md', 'Yksinäinen', {
      description: 'A wanderer no other concept links to.',
      tags: ['mysteeri'],
      in: 1,
      out: 1,
      orphan: true,
    }),
  ];

  // index.md links each concept twice — the hand-written preamble plus the
  // generated section — hence count: 2 on every index edge (golden parity).
  const edges = [
    edge('aurinko.md', 'komeetta.md', 'Komeetta'),
    edge('aurinko.md', 'kuu.md', 'kuu', { kind: 'wikilink' }),
    edge('aurinko.md', 'planeetat.md', 'Planeetat'),
    edge('index.md', 'aurinko.md', 'Aurinko', { count: 2 }),
    edge('index.md', 'komeetta.md', 'Komeetta', { count: 2 }),
    edge('index.md', 'kuu.md', 'Kuu', { count: 2 }),
    edge('index.md', 'maa.md', 'Maa', { count: 2 }),
    edge('index.md', 'planeetat.md', 'Planeetat', { count: 2 }),
    edge('index.md', 'saaret/atolli.md', 'Atolli', { count: 2 }),
    edge('index.md', 'saaret/laguuni.md', 'Laguuni', { count: 2 }),
    edge('index.md', 'yksinainen.md', 'Yksinäinen', { count: 2 }),
    edge('komeetta.md', 'aurinko.md', 'Aurinko', { count: 2 }),
    edge('kuu.md', 'maa.md', 'Maa'),
    edge('maa.md', 'kuu.md', 'Kuu'),
    edge('maa.md', 'planeetat.md', 'Planeetat'),
    edge('planeetat.md', 'aurinko.md', 'Aurinko'),
    edge('planeetat.md', 'maa.md', 'Maa'),
    edge('saaret/atolli.md', 'saaret/laguuni.md', 'Laguuni'),
    edge('saaret/laguuni.md', 'saaret/atolli.md', 'Atolli'),
    edge('yksinainen.md', 'aurinko.md', 'Aurinko itse', { kind: 'wikilink' }),
  ].sort(edgeSort);

  return {
    nodes,
    edges,
    ghosts: [{ source: 'saaret/laguuni.md', target: 'olematon.md' }],
    islands: [['saaret/atolli.md', 'saaret/laguuni.md']],
    stats: { docs: 10, edges: 20, ghosts: 1, islands: 1, orphans: 1, tags: 8 },
    tags: tagsFromNodes(nodes),
  };
}

/**
 * A synthetic LARGER graph (66 docs in 6 directory clusters) used only to make
 * the holographic brain's VOLUME obvious in screenshots / manual review — the
 * 10-doc kotiaurinko brain is genuinely volumetric but small. Gated behind
 * MOCK_BIG in the mock server so the default surface stays byte-identical.
 *
 * Deterministic (index arithmetic, no Math.random): each cluster is a ring so
 * community detection resolves it to one lobe, plus a few cross-cluster bridges
 * so the whole thing is one connected brain across all 6 → 7 lobes.
 */
export function bigGraph(clusters = 6, per = 11) {
  const nodes = [];
  const edges = [];
  const names = ['cortex', 'limbic', 'stem', 'lobe', 'sulcus', 'gyrus', 'nucleus', 'tract'];
  const clusterIds = [];
  for (let c = 0; c < clusters; c++) {
    const ids = [];
    for (let k = 0; k < per; k++) {
      const id = `${names[c % names.length]}/n${k}.md`;
      ids.push(id);
      nodes.push(node(id, `${names[c % names.length]} ${k}`, { tags: [names[c % names.length]], in: 0, out: 0 }));
    }
    clusterIds.push(ids);
    // ring the cluster so it is one community
    for (let k = 0; k < ids.length; k++) edges.push(edge(ids[k], ids[(k + 1) % ids.length], 'link'));
    // a couple of chords thicken the lobe
    for (let k = 0; k < ids.length; k += 3) edges.push(edge(ids[k], ids[(k + 2) % ids.length], 'link'));
  }
  // sparse bridges between consecutive clusters — connected, still 6 communities
  for (let c = 0; c < clusters; c++) {
    const a = clusterIds[c][0];
    const b = clusterIds[(c + 1) % clusters][1];
    edges.push(edge(a, b, 'bridge'));
  }
  // recompute in/out degree from the edge list
  const deg = new Map(nodes.map((n) => [n.id, { in: 0, out: 0 }]));
  for (const e of edges) {
    deg.get(e.source).out += 1;
    deg.get(e.target).in += 1;
  }
  for (const n of nodes) {
    n.in = deg.get(n.id).in;
    n.out = deg.get(n.id).out;
  }
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  return {
    nodes: sorted,
    edges: [...edges].sort(edgeSort),
    ghosts: [],
    islands: [],
    stats: { docs: sorted.length, edges: edges.length, ghosts: 0, islands: 0, orphans: 0, tags: clusters },
    tags: tagsFromNodes(sorted),
  };
}

const findNode = (graph, id) => graph.nodes.find((n) => n.id === id);

/**
 * The scripted mutation cycle (mirrors spec/fixtures/scenarios/live-edit-01):
 *   0 add uusi.md linked to kuu.md      3 remove uusi.md
 *   1 retitle kuu.md -> Kuutamo         4 restore kuu.md's title
 *   2 komeetta edge count 2 -> 3        5 restore the edge count
 * A full cycle returns the graph to its initial shape, so the demo loops.
 */
export function nextDelta(graph, seq, stepIndex) {
  const step = ((stepIndex % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
  const stats = { ...graph.stats };
  const delta = {
    seq,
    added: { nodes: [], edges: [] },
    removed: { nodes: [], edges: [] },
    updated: { nodes: [] },
    stats,
    cause: { paths: [], tier: 't1' },
  };
  const kuu = findNode(graph, 'kuu.md');

  switch (step) {
    case 0: {
      delta.added.nodes.push(
        node('uusi.md', 'Uusi', {
          description: 'A freshly discovered rock.',
          tags: ['uusi'],
          timestamp: '2026-07-02T09:00:00Z',
          in: 0,
          out: 1,
          orphan: true,
        }),
      );
      delta.added.edges.push(edge('uusi.md', 'kuu.md', 'Kuu'));
      delta.updated.nodes.push({ ...kuu, in: kuu.in + 1 });
      delta.stats = { ...stats, docs: stats.docs + 1, edges: stats.edges + 1, orphans: stats.orphans + 1, tags: stats.tags + 1 };
      delta.cause.paths = ['uusi.md'];
      break;
    }
    case 1: {
      delta.updated.nodes.push({ ...kuu, title: 'Kuutamo', timestamp: '2026-06-16T08:30:00Z' });
      delta.cause.paths = ['kuu.md'];
      break;
    }
    case 2: {
      const old = graph.edges.find((e) => e.source === 'komeetta.md' && e.target === 'aurinko.md');
      delta.removed.edges.push({ source: old.source, target: old.target, kind: old.kind });
      delta.added.edges.push({ ...old, count: old.count + 1 });
      delta.cause.paths = ['komeetta.md'];
      break;
    }
    case 3: {
      delta.removed.nodes.push('uusi.md');
      delta.removed.edges.push({ source: 'uusi.md', target: 'kuu.md', kind: 'link' });
      delta.updated.nodes.push({ ...kuu, in: kuu.in - 1 });
      delta.stats = { ...stats, docs: stats.docs - 1, edges: stats.edges - 1, orphans: stats.orphans - 1, tags: stats.tags - 1 };
      delta.cause.paths = ['uusi.md'];
      break;
    }
    case 4: {
      delta.updated.nodes.push({ ...kuu, title: 'Kuu', timestamp: '2026-06-15T08:30:00Z' });
      delta.cause.paths = ['kuu.md'];
      break;
    }
    case 5: {
      const old = graph.edges.find((e) => e.source === 'komeetta.md' && e.target === 'aurinko.md');
      delta.removed.edges.push({ source: old.source, target: old.target, kind: old.kind });
      delta.added.edges.push({ ...old, count: old.count - 1 });
      delta.cause.paths = ['komeetta.md'];
      break;
    }
  }
  return delta;
}

/** Apply a delta to a full payload — keeps /api/graph in sync with /api/live. */
export function applyDeltaToGraph(graph, delta) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of delta.removed.nodes) nodes.delete(id);
  const edgeKeyOf = (e) => `${e.source}|${e.target}|${e.kind}`;
  const edges = new Map(graph.edges.map((e) => [edgeKeyOf(e), e]));
  for (const ref of delta.removed.edges) edges.delete(edgeKeyOf(ref));
  for (const n of delta.added.nodes) nodes.set(n.id, n);
  for (const e of delta.added.edges) edges.set(edgeKeyOf(e), e);
  for (const n of delta.updated.nodes) nodes.set(n.id, n);

  const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    nodes: nodeList,
    edges: [...edges.values()].sort(edgeSort),
    ghosts: graph.ghosts,
    islands: graph.islands, // static: the scripted cycle never touches saaret
    stats: delta.stats,
    tags: tagsFromNodes(nodeList),
  };
}

/**
 * The T3 entity layer (spec/40), hand-derived from
 * spec/fixtures/expected/kotiaurinko/t3/{entities,relations}.jsonl so the mock
 * server can drive the UI's entity/overlay layers with no backend.
 */
const ENTITIES = [
  { id: 'aurinko', name: 'Aurinko', type: 'star', description: 'The star at the center that everything orbits.', source_docs: ['aurinko.md', 'komeetta.md', 'planeetat.md'] },
  { id: 'komeetta', name: 'Komeetta', type: 'comet', description: 'A visitor with a tail that falls toward the star and races away.', source_docs: ['komeetta.md'] },
  { id: 'kuu', name: 'Kuu', type: 'moon', description: 'The moon that raises the tides of the earth.', source_docs: ['aurinko.md', 'kuu.md', 'maa.md'] },
  { id: 'maa', name: 'Maa', type: 'planet', description: 'The blue world with a companion, belonging to the worlds.', source_docs: ['kuu.md', 'maa.md', 'planeetat.md'] },
  { id: 'planeetat', name: 'Planeetat', type: 'catalogue', description: 'The catalogue of worlds around the star.', source_docs: ['aurinko.md', 'maa.md', 'planeetat.md'] },
  { id: 'vuorovesi', name: 'Vuorovesi', type: 'phenomenon', description: 'The tidal pull of the moon on the sea.', source_docs: ['kuu.md'] },
];

const RELATIONS = [
  { src: 'kuu', dst: 'vuorovesi', weight: 0.7 },
  { src: 'komeetta', dst: 'aurinko', weight: 0.6 },
  { src: 'kuu', dst: 'maa', weight: 0.9 },
  { src: 'maa', dst: 'planeetat', weight: 0.8 },
  { src: 'planeetat', dst: 'aurinko', weight: 0.9 },
];

/** GET /api/graph?layer=entities — nodes {id,name,type,description,degree}. */
export function entityGraph() {
  const degree = new Map(ENTITIES.map((e) => [e.id, new Set()]));
  for (const r of RELATIONS) {
    degree.get(r.src)?.add(r.dst);
    degree.get(r.dst)?.add(r.src);
  }
  return {
    nodes: ENTITIES.map((e) => ({ id: e.id, name: e.name, type: e.type, description: e.description, degree: degree.get(e.id)?.size ?? 0 })),
    edges: [...RELATIONS].sort((a, b) => a.src.localeCompare(b.src) || a.dst.localeCompare(b.dst)).map((r) => ({ src: r.src, dst: r.dst, weight: r.weight })),
  };
}

/** GET /api/neighbors?id=<doc>&layer=entities — carries source_docs (grounding). */
export function entityNeighbors(doc, depth = 1) {
  const byId = new Map(ENTITIES.map((e) => [e.id, e]));
  const adj = new Map(ENTITIES.map((e) => [e.id, []]));
  for (const r of RELATIONS) {
    adj.get(r.src)?.push(r.dst);
    adj.get(r.dst)?.push(r.src);
  }
  const distance = new Map();
  for (const e of ENTITIES) if (e.source_docs.includes(doc)) distance.set(e.id, 0);
  let frontier = [...distance.keys()];
  for (let hop = 1; hop <= depth; hop++) {
    const reached = [];
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!distance.has(n)) { distance.set(n, hop); reached.push(n); }
    frontier = reached;
  }
  const nodes = [...distance.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([id, dist]) => {
      const e = byId.get(id);
      return { id, name: e.name, description: e.description, distance: dist, source_docs: [...e.source_docs] };
    });
  const edges = RELATIONS.filter((r) => distance.has(r.src) && distance.has(r.dst)).map((r) => ({ src: r.src, dst: r.dst }));
  return { center: doc, nodes, edges };
}

/**
 * A SYNTHETIC git history for the Time Machine (spec/90). Eight commits, oldest
 * first, that visibly GROW the kotiaurinko graph from a single star to the full
 * ten-doc brain — a couple of modifies along the way so a node pulses when the
 * scrub crosses them. The `docs` lifecycle is derived from the commits exactly
 * as the engine derives it, so the mock matches the real timeline.json shape.
 * Reserved index.md / log.md are excluded (spec/90) — they read as "always
 * present" in the UI, the frame the concepts grow inside.
 */
const commitSort = (a, b) => a.localeCompare(b);
const TIMELINE_COMMITS = [
  { sha: 'a1c0533', date: '2026-07-01T09:12:00Z', author: 'Tom', message: 'Founding commit — the home star', added: ['aurinko.md'], modified: [], deleted: [] },
  { sha: 'b2d1a4e', date: '2026-07-01T18:40:00Z', author: 'Tom', message: 'Catalogue the worlds', added: ['planeetat.md'], modified: ['aurinko.md'], deleted: [] },
  { sha: 'c3e2b5f', date: '2026-07-02T10:05:00Z', author: 'Tom', message: 'The blue world, Maa', added: ['maa.md'], modified: ['planeetat.md'], deleted: [] },
  { sha: 'd4f3c60', date: '2026-07-03T09:30:00Z', author: 'Tom', message: 'The Moon and its tides', added: ['kuu.md'], modified: ['maa.md'], deleted: [] },
  { sha: 'e5a4d71', date: '2026-07-03T20:15:00Z', author: 'Tom', message: 'A visiting comet', added: ['komeetta.md'], modified: ['aurinko.md'], deleted: [] },
  { sha: 'f6b5e82', date: '2026-07-04T11:00:00Z', author: 'Tom', message: 'Chart the islands', added: ['saaret/atolli.md', 'saaret/laguuni.md'], modified: [], deleted: [] },
  { sha: '07c6f93', date: '2026-07-05T14:20:00Z', author: 'Tom', message: 'A lonely wanderer', added: ['yksinainen.md'], modified: [], deleted: [] },
  { sha: '18d70a4', date: '2026-07-06T14:03:00Z', author: 'Tom', message: 'Refine the moon and the star', added: [], modified: ['aurinko.md', 'kuu.md'], deleted: [] },
];

/** Derive per-doc lifecycle from commits (spec/90): created / modified / deleted. */
function lifecycleFromCommits(commits) {
  const docs = {};
  for (const c of commits) {
    for (const p of c.added) if (!docs[p]) docs[p] = { created: c.date, modified: [], deleted: null };
    for (const p of c.modified) {
      if (!docs[p]) docs[p] = { created: c.date, modified: [], deleted: null };
      else docs[p].modified.push(c.date);
    }
    for (const p of c.deleted) if (docs[p]) docs[p].deleted = c.date;
  }
  return docs;
}

/** GET /api/timeline — the advisory git-history timeline (spec/90). */
export function timeline() {
  const commits = TIMELINE_COMMITS.map((c) => ({
    ...c,
    added: [...c.added].sort(commitSort),
    modified: [...c.modified].sort(commitSort),
    deleted: [...c.deleted].sort(commitSort),
  }));
  return {
    commits,
    docs: lifecycleFromCommits(commits),
    span: { commits: commits.length, first: commits[0].date, last: commits[commits.length - 1].date },
  };
}

/** Doc records backing /api/docs/{path} and /api/search. */
export function mockDocs() {
  const doc = (path, title, over = {}) => ({
    path,
    title,
    description: null,
    type: 'Concept',
    tags: [],
    timestamp: null,
    reserved: false,
    text: '',
    ...over,
  });
  return [
    doc('aurinko.md', 'Aurinko', {
      description: 'The star everything in this bundle orbits.',
      tags: ['tähti'],
      text: '# Aurinko\n\nThe sun sits at the center. The [Planeetat](planeetat.md) circle it, and\neven the [[kuu]] answers to its light. A [Komeetta](komeetta.md) visits\nwhen it pleases.\n',
    }),
    doc('index.md', 'Kotiaurinko', {
      type: null,
      reserved: true,
      text: '# Kotiaurinko\n\nA tiny knowledge bundle about a home star system.\n\n## Concepts\n\n* [Aurinko](aurinko.md) - the star everything orbits\n* [Planeetat](planeetat.md) - the catalogue of worlds\n* [Maa](maa.md) - the blue one\n* [Kuu](kuu.md) - the companion\n* [Komeetta](komeetta.md) - the visitor\n* [Yksinäinen](yksinainen.md) - the unlinked wanderer\n* [Atolli](saaret/atolli.md) - a ring in the sea\n* [Laguuni](saaret/laguuni.md) - the water inside the ring\n',
    }),
    doc('komeetta.md', 'Komeetta', {
      description: 'A visitor with a tail, seen only every few decades — pöllämystynyt matkalainen.',
      tags: ['vierailija'],
      text: '# Komeetta\n\nIt falls toward [Aurinko](aurinko.md), swings around, and races away. Years\nlater it returns to the same [Aurinko](aurinko.md), as visitors do.\n',
    }),
    doc('kuu.md', 'Kuu', {
      tags: ['kuu'],
      timestamp: '2026-06-15T08:30:00Z',
      text: '# Kuu\n\nThe moon pulls the tides of [Maa](maa.md).\n\n```markdown\nLinks inside code fences are not links: [ei](ei-ole.md)\n```\n',
    }),
    doc('log.md', 'Update log', {
      type: null,
      reserved: true,
      text: '# Update log\n\n## 2026-06-15\n\n- Updated: the moon gained its tide notes.\n\n## 2026-05-01\n\n- Created: the bundle was born with a star, worlds, and two islands.\n',
    }),
    doc('maa.md', 'Maa', {
      description: 'The blue world with a companion and a home.',
      tags: ['planeetta', 'koti'],
      timestamp: '2026-06-10T12:00:00Z',
      text: '# Maa\n\nThe earth keeps one companion, [Kuu](/kuu.md), and belongs to the\n[Planeetat](planeetat.md).\n',
    }),
    doc('planeetat.md', 'Planeetat', {
      description: 'The catalogue of worlds around the star.',
      tags: ['luettelo'],
      timestamp: '2026-06-01T00:00:00Z',
      text: '# Planeetat\n\nEvery world orbits [Aurinko](aurinko.md). The one we care most about is\n[Maa](maa.md).\n',
    }),
    doc('saaret/atolli.md', 'Atolli', {
      description: 'A ring of coral in the island sea.',
      tags: ['saari'],
      text: '# Atolli\n\nThe ring encloses the [Laguuni](laguuni.md) and speaks to nothing else.\n',
    }),
    doc('saaret/laguuni.md', 'Laguuni', {
      description: 'The calm water inside the ring.',
      tags: ['saari'],
      text: '# Laguuni\n\nHeld by the [Atolli](atolli.md). Old maps also name an\n[Olematon](olematon.md) shoal, but no page exists for it.\n',
    }),
    doc('yksinainen.md', 'Yksinäinen', {
      description: 'A wanderer no other concept links to.',
      tags: ['mysteeri'],
      text: '# Yksinäinen\n\nNothing points here. It still looks at [[aurinko|Aurinko itse]] from afar,\nwhich keeps it on the mainland of the graph.\n',
    }),
  ];
}
