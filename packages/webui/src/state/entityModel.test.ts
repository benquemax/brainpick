import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../graph/types';
import type { EntityGraph } from '../graph/entities';
import { bareEntityId, entityRenderId, isEntityRenderId } from '../graph/entities';
import {
  activeRenderGraph,
  effectiveLayer,
  entitiesForDoc,
  entityRenderGraph,
  entityRenderIdsForDoc,
  entitySourceDocs,
  overlayRenderGraph,
  VIRTUAL_WEIGHT,
} from './entityModel';
import { budgetedGraph } from './budget';

const ENTITY_GRAPH: EntityGraph = {
  nodes: [
    { id: 'aurinko', name: 'Aurinko', type: 'star', description: 'The star.', degree: 2 },
    { id: 'kuu', name: 'Kuu', type: 'moon', description: 'The moon.', degree: 2 },
    { id: 'vuorovesi', name: 'Vuorovesi', type: 'phenomenon', description: 'Tides.', degree: 1 },
  ],
  edges: [
    { src: 'kuu', dst: 'vuorovesi', weight: 0.7 },
    { src: 'kuu', dst: 'aurinko', weight: 0.9 },
    { src: 'kuu', dst: 'olematon', weight: 0.5 }, // dangling — no such entity
  ],
};

function docNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return { id, title: id, description: null, type: null, about: null, tags: [], timestamp: null, in: 0, out: 0, orphan: false, reserved: false, ...over };
}
const DOC_NODES = new Map<string, GraphNode>([
  ['aurinko.md', docNode('aurinko.md', { out: 1 })],
  ['kuu.md', docNode('kuu.md', { in: 1 })],
]);
const DOC_EDGES = new Map<string, GraphEdge>([
  ['aurinko.mdkuu.mdlink', { source: 'aurinko.md', target: 'kuu.md', kind: 'link', label: null, count: 1 }],
]);
const GROUNDING = new Map<string, string[]>([
  ['aurinko', ['aurinko.md', 'komeetta.md']], // komeetta.md not on screen
  ['kuu', ['aurinko.md', 'kuu.md']],
  ['vuorovesi', ['kuu.md']],
]);

describe('entity render-id namespacing', () => {
  it('round-trips and never collides with a doc path', () => {
    const rid = entityRenderId('aurinko');
    expect(isEntityRenderId(rid)).toBe(true);
    expect(bareEntityId(rid)).toBe('aurinko');
    expect(isEntityRenderId('aurinko.md')).toBe(false);
    expect(rid).not.toBe('aurinko.md');
    expect(bareEntityId('aurinko.md')).toBe('aurinko.md'); // passthrough for docs
  });
});

describe('entityRenderGraph', () => {
  it('maps entities to render nodes with degree as out-degree, name as title', () => {
    const { nodes } = entityRenderGraph(ENTITY_GRAPH);
    expect(nodes.size).toBe(3);
    const aurinko = nodes.get(entityRenderId('aurinko'))!;
    expect(aurinko.title).toBe('Aurinko');
    expect(aurinko.type).toBe('star');
    expect(aurinko.out).toBe(2); // degree drives radius/budget
  });

  it('keeps relations as `relation` edges carrying weight, dropping dangling ones', () => {
    const { edges } = entityRenderGraph(ENTITY_GRAPH);
    expect(edges.size).toBe(2); // kuu→olematon dropped (no olematon entity)
    const edge = [...edges.values()].find((e) => e.target === entityRenderId('vuorovesi'))!;
    expect(edge.kind).toBe('relation');
    expect(edge.weight).toBe(0.7);
    expect(edge.source).toBe(entityRenderId('kuu'));
  });
});

describe('overlayRenderGraph', () => {
  it('merges doc + entity nodes and adds virtual edges only toward on-screen docs', () => {
    const { nodes, edges } = overlayRenderGraph(DOC_NODES, DOC_EDGES, ENTITY_GRAPH, GROUNDING);
    // 2 docs + 3 entities
    expect(nodes.size).toBe(5);
    expect(nodes.has('aurinko.md')).toBe(true);
    expect(nodes.has(entityRenderId('aurinko'))).toBe(true);

    const virtual = [...edges.values()].filter((e) => e.kind === 'virtual');
    // aurinko→aurinko.md (komeetta.md is off screen, dropped), kuu→aurinko.md, kuu→kuu.md, vuorovesi→kuu.md
    expect(virtual).toHaveLength(4);
    expect(virtual.every((e) => e.weight === VIRTUAL_WEIGHT)).toBe(true);
    for (const e of virtual) {
      expect(isEntityRenderId(e.source)).toBe(true);
      expect(DOC_NODES.has(e.target)).toBe(true);
    }
    // original doc + relation edges survive
    expect([...edges.values()].some((e) => e.kind === 'link')).toBe(true);
    expect([...edges.values()].some((e) => e.kind === 'relation')).toBe(true);
  });
});

describe('effectiveLayer (availability fallback)', () => {
  it('renders links when entities/overlay are picked but unavailable', () => {
    expect(effectiveLayer('entities', false, ENTITY_GRAPH)).toBe('links');
    expect(effectiveLayer('overlay', true, null)).toBe('links');
    expect(effectiveLayer('entities', true, ENTITY_GRAPH)).toBe('entities');
    expect(effectiveLayer('links', true, ENTITY_GRAPH)).toBe('links');
  });
});

describe('activeRenderGraph', () => {
  const base = { docNodes: DOC_NODES, docEdges: DOC_EDGES, entityGraph: ENTITY_GRAPH, grounding: GROUNDING };

  it('links mode is a passthrough: the very same doc maps, no copy', () => {
    const active = activeRenderGraph({ layer: 'links', available: true, ...base });
    expect(active.nodes).toBe(DOC_NODES);
    expect(active.edges).toBe(DOC_EDGES);
    expect(active.layer).toBe('links');
  });

  it('entities mode returns just the entity render nodes', () => {
    const active = activeRenderGraph({ layer: 'entities', available: true, ...base });
    expect(active.layer).toBe('entities');
    expect(active.nodes.size).toBe(3);
    expect([...active.nodes.keys()].every(isEntityRenderId)).toBe(true);
  });

  it('overlay merges both; unavailable falls back to links', () => {
    const overlay = activeRenderGraph({ layer: 'overlay', available: true, ...base });
    expect(overlay.layer).toBe('overlay');
    expect(overlay.nodes.size).toBe(5);

    const fallback = activeRenderGraph({ layer: 'entities', available: false, ...base });
    expect(fallback.layer).toBe('links');
    expect(fallback.nodes).toBe(DOC_NODES);
  });

  it('memoizes: the same inputs return the same object and bump version only on change', () => {
    const a = activeRenderGraph({ layer: 'entities', available: true, ...base });
    const b = activeRenderGraph({ layer: 'entities', available: true, ...base });
    expect(b).toBe(a);
    const c = activeRenderGraph({ layer: 'overlay', available: true, ...base });
    expect(c.version).toBeGreaterThan(a.version);
  });
});

describe('budget applies to entities too', () => {
  it('a large entity graph is degree-culled through budgetedGraph', () => {
    const nodes: EntityGraph['nodes'] = [];
    const edges: EntityGraph['edges'] = [];
    for (let i = 0; i < 200; i++) nodes.push({ id: `e${i}`, name: `E${i}`, type: 'concept', description: null, degree: i });
    for (let i = 1; i < 200; i++) edges.push({ src: `e${i - 1}`, dst: `e${i}`, weight: 0.5 });
    const active = activeRenderGraph({ layer: 'entities', available: true, docNodes: DOC_NODES, docEdges: DOC_EDGES, entityGraph: { nodes, edges }, grounding: GROUNDING });
    const view = budgetedGraph(active.nodes, active.edges, active.version, 50, new Set());
    expect(view.totalNodes).toBe(200);
    expect(view.shownNodes).toBe(50); // top-50 by degree
    expect(view.aggregated.size).toBeGreaterThan(0); // culled entities fold into a proxy
  });
});

describe('grounding helpers', () => {
  it('inverts the grounding map for a doc, sorted, and namespaces render ids', () => {
    expect(entitiesForDoc(GROUNDING, 'aurinko.md')).toEqual(['aurinko', 'kuu']);
    expect(entityRenderIdsForDoc(GROUNDING, 'kuu.md')).toEqual([entityRenderId('kuu'), entityRenderId('vuorovesi')]);
    expect(entitiesForDoc(GROUNDING, 'missing.md')).toEqual([]);
  });
});

describe('entitySourceDocs — provenance for the entity panel', () => {
  it('prefers the graph node’s own source_docs (available without a neighbors walk)', () => {
    const node = { source_docs: ['planeetat.md', 'aurinko.md'] };
    // node source_docs unioned with grounding, de-duped and sorted.
    expect(entitySourceDocs(node, new Map(), 'aurinko')).toEqual(['aurinko.md', 'planeetat.md']);
  });

  it('unions the node’s source_docs with any reconstructed grounding', () => {
    const node = { source_docs: ['aurinko.md'] };
    const grounding = new Map<string, string[]>([['aurinko', ['aurinko.md', 'komeetta.md']]]);
    expect(entitySourceDocs(node, grounding, 'aurinko')).toEqual(['aurinko.md', 'komeetta.md']);
  });

  it('falls back to the grounding when the node carries no source_docs', () => {
    const grounding = new Map<string, string[]>([['kuu', ['kuu.md', 'maa.md']]]);
    expect(entitySourceDocs({}, grounding, 'kuu')).toEqual(['kuu.md', 'maa.md']);
    expect(entitySourceDocs(null, grounding, 'kuu')).toEqual(['kuu.md', 'maa.md']);
  });

  it('is empty when neither source names the entity (graceful "no provenance")', () => {
    expect(entitySourceDocs({ source_docs: [] }, new Map(), 'ghost')).toEqual([]);
    expect(entitySourceDocs(null, new Map(), 'ghost')).toEqual([]);
  });
});
