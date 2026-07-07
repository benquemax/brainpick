/**
 * Pure mapping from the T3 entity layer into the SAME render model the doc
 * graph uses (GraphNode / GraphEdge maps), so entities flow through the exact
 * budget + runtime + scene path — no forked renderer (spec/40, the UI task).
 *
 *   - entities: the entity graph alone (namespaced render ids).
 *   - overlay:  doc nodes + entity nodes in one set, plus WEAK virtual edges
 *     (entity → each of its source docs that is on screen) so an entity drifts
 *     toward the docs that mention it.
 *   - links / unavailable: the doc maps, untouched (byte-identical passthrough).
 *
 * activeRenderGraph is memoized (one slot, like budget.ts/tree.ts): the runtime
 * and the HUD read the same object, and `version` gives budget's memo a stable,
 * change-only key.
 */
import type { GraphEdge, GraphNode } from '../graph/types';
import { edgeKey } from '../graph/types';
import type { EntityGraph, EntityGraphNode, EntityRelation, GraphLayer } from '../graph/entities';
import { entityRenderId } from '../graph/entities';

export interface RenderGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

/** Weak pull + dim tint for the entity→source-doc gravitation edges (overlay). */
export const VIRTUAL_WEIGHT = 0.18;

/** An entity as a render node: degree drives radius + budget ranking (in+out). */
export function entityNodeToGraphNode(entity: EntityGraphNode): GraphNode {
  return {
    id: entityRenderId(entity.id),
    title: entity.name,
    description: entity.description,
    type: entity.type,
    tags: [],
    timestamp: null,
    in: 0,
    out: entity.degree,
    orphan: false,
    reserved: false,
  };
}

/** A T3 relation as a render edge (kind `relation`, weight → brightness). */
export function relationToGraphEdge(rel: EntityRelation): GraphEdge {
  return {
    source: entityRenderId(rel.src),
    target: entityRenderId(rel.dst),
    kind: 'relation',
    label: null,
    count: 1,
    weight: rel.weight,
  };
}

/** A weak entity→doc gravitation edge (overlay only). */
export function virtualEdge(entityId: string, docPath: string): GraphEdge {
  return {
    source: entityRenderId(entityId),
    target: docPath,
    kind: 'virtual',
    label: null,
    count: 1,
    weight: VIRTUAL_WEIGHT,
  };
}

/** The entity graph alone as render maps. */
export function entityRenderGraph(graph: EntityGraph): RenderGraph {
  const nodes = new Map<string, GraphNode>();
  for (const entity of graph.nodes) {
    const node = entityNodeToGraphNode(entity);
    nodes.set(node.id, node);
  }
  const edges = new Map<string, GraphEdge>();
  for (const rel of graph.edges) {
    // Skip dangling relations (an endpoint not in the entity set).
    if (!nodes.has(entityRenderId(rel.src)) || !nodes.has(entityRenderId(rel.dst))) continue;
    const edge = relationToGraphEdge(rel);
    edges.set(edgeKey(edge), edge);
  }
  return { nodes, edges };
}

/** Doc graph + entity graph merged, with entity→source-doc virtual edges. */
export function overlayRenderGraph(
  docNodes: ReadonlyMap<string, GraphNode>,
  docEdges: ReadonlyMap<string, GraphEdge>,
  graph: EntityGraph,
  grounding: ReadonlyMap<string, string[]>,
): RenderGraph {
  const nodes = new Map<string, GraphNode>(docNodes);
  const edges = new Map<string, GraphEdge>(docEdges);
  const entity = entityRenderGraph(graph);
  for (const [id, node] of entity.nodes) nodes.set(id, node);
  for (const [key, edge] of entity.edges) edges.set(key, edge);
  // Virtual gravitation edges — only toward docs that are actually on screen.
  for (const e of graph.nodes) {
    for (const doc of grounding.get(e.id) ?? []) {
      if (!docNodes.has(doc)) continue;
      const edge = virtualEdge(e.id, doc);
      edges.set(edgeKey(edge), edge);
    }
  }
  return { nodes, edges };
}

export interface ActiveGraphInput {
  layer: GraphLayer;
  /** The entity layer is truly renderable (fetched + present). */
  available: boolean;
  docNodes: ReadonlyMap<string, GraphNode>;
  docEdges: ReadonlyMap<string, GraphEdge>;
  entityGraph: EntityGraph | null;
  grounding: ReadonlyMap<string, string[]>;
}

/** The layer actually rendered — falls back to links when entities can't show. */
export function effectiveLayer(layer: GraphLayer, available: boolean, entityGraph: EntityGraph | null): GraphLayer {
  if (layer === 'links') return 'links';
  if (!available || entityGraph === null) return 'links';
  return layer;
}

export interface ActiveRenderGraph extends RenderGraph {
  /** Monotonic change-only key for budget's memo. */
  version: number;
  /** The layer that was actually built (after the availability fallback). */
  layer: GraphLayer;
}

let memo: (ActiveGraphInput & ActiveRenderGraph) | null = null;
let version = 0;

/**
 * The render maps for the store's current layer + entity state — memoized.
 * links mode returns the doc maps unchanged (same identities), so it stays a
 * byte-identical passthrough.
 */
export function activeRenderGraph(input: ActiveGraphInput): ActiveRenderGraph {
  if (
    memo !== null &&
    memo.layer === effectiveLayer(input.layer, input.available, input.entityGraph) &&
    memo.docNodes === input.docNodes &&
    memo.docEdges === input.docEdges &&
    memo.entityGraph === input.entityGraph &&
    memo.grounding === input.grounding
  ) {
    return memo;
  }

  const layer = effectiveLayer(input.layer, input.available, input.entityGraph);
  let result: RenderGraph;
  if (layer === 'links' || input.entityGraph === null) {
    // Reuse the doc maps as-is — no copy, identical to links-only rendering.
    result = { nodes: input.docNodes as Map<string, GraphNode>, edges: input.docEdges as Map<string, GraphEdge> };
  } else if (layer === 'entities') {
    result = entityRenderGraph(input.entityGraph);
  } else {
    result = overlayRenderGraph(input.docNodes, input.docEdges, input.entityGraph, input.grounding);
  }

  version += 1;
  memo = { ...input, ...result, version, layer };
  return memo;
}

/** The source docs an entity is grounded in (from the neighbors-built map). */
export function docsForEntity(grounding: ReadonlyMap<string, string[]>, entityId: string): string[] {
  return grounding.get(entityId) ?? [];
}

/**
 * The source docs to show for a selected entity. The entity graph node now
 * carries `source_docs` directly (spec/50), so those are authoritative and
 * available immediately; they are unioned with any grounding reconstructed from
 * /api/neighbors so nothing already discovered is dropped. Sorted + de-duped;
 * empty when the entity has no known provenance (the panel degrades gracefully).
 */
export function entitySourceDocs(
  node: { source_docs?: string[] } | null,
  grounding: ReadonlyMap<string, string[]>,
  entityId: string,
): string[] {
  const union = new Set<string>(node?.source_docs ?? []);
  for (const doc of docsForEntity(grounding, entityId)) union.add(doc);
  return [...union].sort();
}

/** The entity ids grounded in a doc (inverse of the grounding map), sorted. */
export function entitiesForDoc(grounding: ReadonlyMap<string, string[]>, doc: string): string[] {
  const ids: string[] = [];
  for (const [id, docs] of grounding) if (docs.includes(doc)) ids.push(id);
  return ids.sort();
}

/** Entity render ids grounded in a doc — for the "highlight this doc's entities" path. */
export function entityRenderIdsForDoc(grounding: ReadonlyMap<string, string[]>, doc: string): string[] {
  return entitiesForDoc(grounding, doc).map(entityRenderId);
}
