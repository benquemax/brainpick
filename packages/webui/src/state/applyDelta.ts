/**
 * Pure graph-state reducer for spec/60-live-deltas.md semantics.
 *
 * Deltas arrive strictly in order over SSE. A delta whose seq is not exactly
 * current+1 cannot be applied: stale ones (seq <= current) are ignored, and a
 * gap (seq > current+1) raises `needsSnapshot` — SSE has no request channel,
 * so the connection layer reacts to that flag by refetching GET /api/graph.
 */
import type { GhostEdge, GraphDelta, GraphEdge, GraphNode, GraphPayload, GraphStats } from '../graph/types';
import { edgeKey } from '../graph/types';

/** Join/exit/activity bookkeeping older than this is pruned on apply. */
export const ANIMATION_TTL_MS = 8_000;

export interface JoinInfo {
  /** Timestamp (ms) the node joined — drives the scale-in entrance. */
  at: number;
  /** A linked neighbor that already existed — the entrance position. */
  neighborId: string | null;
}

export interface ExitInfo {
  /** Timestamp (ms) the node left — drives the fade-out. */
  at: number;
}

export interface GraphSlice {
  /** Manifest seq of the graph currently held (0 = nothing loaded). */
  seq: number;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  /** Broken links toward paths that do not exist (phantom nodes). Deltas do
   * not carry ghosts (spec/60) — the list refreshes on snapshots only. */
  ghosts: GhostEdge[];
  stats: GraphStats | null;
  tags: Record<string, string[]>;
  /** Raised on a seq gap; the connection layer refetches and clears it. */
  needsSnapshot: boolean;
  /** Bumped on every applied delta/snapshot — scene rebuild trigger. */
  epoch: number;
  joins: Map<string, JoinInfo>;
  exits: Map<string, ExitInfo>;
  /** Node id -> last change timestamp (ms) — drives the activity pulse. */
  activity: Map<string, number>;
}

export function emptyGraphSlice(): GraphSlice {
  return {
    seq: 0,
    nodes: new Map(),
    edges: new Map(),
    ghosts: [],
    stats: null,
    tags: {},
    needsSnapshot: false,
    epoch: 0,
    joins: new Map(),
    exits: new Map(),
    activity: new Map(),
  };
}

function prune<V extends { at: number } | number>(map: Map<string, V>, now: number): Map<string, V> {
  const next = new Map<string, V>();
  for (const [k, v] of map) {
    const at = typeof v === 'number' ? v : v.at;
    if (now - at <= ANIMATION_TTL_MS) next.set(k, v);
  }
  return next;
}

/** Pick an entrance neighbor: an edge endpoint that already existed. */
function findJoinNeighbor(id: string, addedEdges: GraphEdge[], existing: ReadonlyMap<string, GraphNode>): string | null {
  for (const e of addedEdges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (other !== null && existing.has(other)) return other;
  }
  return null;
}

export function applyDelta(state: GraphSlice, delta: GraphDelta, now: number): GraphSlice {
  if (delta.seq <= state.seq) return state; // stale replay — ignore
  if (delta.seq > state.seq + 1) {
    // Gap: we missed deltas and cannot request them over SSE. Flag for the
    // connection layer to resync via a fresh GET /api/graph.
    if (state.needsSnapshot) return state;
    return { ...state, needsSnapshot: true };
  }

  const nodes = new Map(state.nodes);
  const edges = new Map(state.edges);
  const joins = prune(state.joins, now);
  const exits = prune(state.exits, now);
  const activity = prune(state.activity, now);

  // Removals first: an edge whose count/label changed arrives as
  // removed + added of the same (source, target, kind) triple.
  for (const id of delta.removed.nodes) {
    if (nodes.delete(id)) exits.set(id, { at: now });
  }
  for (const ref of delta.removed.edges) {
    edges.delete(edgeKey(ref));
  }

  for (const node of delta.added.nodes) {
    if (!state.nodes.has(node.id)) {
      joins.set(node.id, { at: now, neighborId: findJoinNeighbor(node.id, delta.added.edges, state.nodes) });
    }
    nodes.set(node.id, node);
    activity.set(node.id, now);
  }
  for (const edge of delta.added.edges) {
    edges.set(edgeKey(edge), edge);
  }

  // Updated records are full node records — replace wholesale. Upsert
  // defensively if the id is unknown (should not happen on a contiguous seq).
  for (const node of delta.updated.nodes) {
    nodes.set(node.id, node);
    activity.set(node.id, now);
  }

  return {
    ...state,
    seq: delta.seq,
    nodes,
    edges,
    stats: delta.stats,
    epoch: state.epoch + 1,
    joins,
    exits,
    activity,
  };
}

export function applySnapshot(state: GraphSlice, graph: GraphPayload, seq: number, now: number): GraphSlice {
  const nodes = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodes.set(n.id, n);
  const edges = new Map<string, GraphEdge>();
  for (const e of graph.edges) edges.set(edgeKey(e), e);

  const joins = prune(state.joins, now);
  const exits = prune(state.exits, now);
  const activity = prune(state.activity, now);

  // Only a resync (previous graph non-empty) animates the difference; the
  // initial load must not scale-in the whole cosmos.
  if (state.nodes.size > 0) {
    for (const n of graph.nodes) {
      if (!state.nodes.has(n.id)) {
        joins.set(n.id, { at: now, neighborId: findJoinNeighbor(n.id, graph.edges, state.nodes) });
        activity.set(n.id, now);
      }
    }
    for (const id of state.nodes.keys()) {
      if (!nodes.has(id)) exits.set(id, { at: now });
    }
  }

  return {
    ...state,
    seq,
    nodes,
    edges,
    ghosts: graph.ghosts,
    stats: graph.stats,
    tags: graph.tags,
    needsSnapshot: false,
    epoch: state.epoch + 1,
    joins,
    exits,
    activity,
  };
}
