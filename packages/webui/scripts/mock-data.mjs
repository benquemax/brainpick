/**
 * Mock data for the standalone dev server, hand-derived from
 * spec/fixtures/bundles/kotiaurinko/ (10 documents, saaret island, one
 * ghost link to olematon.md).
 *
 * Spec note (reported upstream): 20-t1-artifacts.md prose says edges come
 * from every document body, but its example shows aurinko.md with in:3,
 * which would exclude index.md's navigation links. This mock includes the
 * reserved index.md edges and counts them in in/out; only `orphan` treats
 * reserved-source links as navigation, per the normative orphan rule.
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
      out: 2,
    }),
    node('index.md', 'Kotiaurinko', { type: null, reserved: true, in: 0, out: 8 }),
    node('komeetta.md', 'Komeetta', {
      description: 'A visitor with a tail, seen only every few decades — pöllämystynyt matkalainen.',
      tags: ['vierailija'],
      in: 1,
      out: 1,
      orphan: true,
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

  const edges = [
    edge('aurinko.md', 'kuu.md', 'kuu', { kind: 'wikilink' }),
    edge('aurinko.md', 'planeetat.md', 'Planeetat'),
    edge('index.md', 'aurinko.md', 'Aurinko'),
    edge('index.md', 'komeetta.md', 'Komeetta'),
    edge('index.md', 'kuu.md', 'Kuu'),
    edge('index.md', 'maa.md', 'Maa'),
    edge('index.md', 'planeetat.md', 'Planeetat'),
    edge('index.md', 'saaret/atolli.md', 'Atolli'),
    edge('index.md', 'saaret/laguuni.md', 'Laguuni'),
    edge('index.md', 'yksinainen.md', 'Yksinäinen'),
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
    stats: { docs: 10, edges: 19, ghosts: 1, islands: 1, orphans: 2, tags: 8 },
    tags: tagsFromNodes(nodes),
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
      text: '# Aurinko\n\nThe sun sits at the center. The [Planeetat](planeetat.md) circle it, and\neven the [[kuu]] answers to its light.\n',
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
