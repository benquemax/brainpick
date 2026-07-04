/**
 * Shapes mirrored from spec/schemas/graph.schema.json and
 * spec/schemas/delta.schema.json (spec_version 0.1).
 */

export interface GraphNode {
  id: string;
  title: string;
  description: string | null;
  type: string | null;
  tags: string[];
  timestamp: string | null;
  in: number;
  out: number;
  orphan: boolean;
  reserved: boolean;
}

/**
 * `link`/`wikilink` are the T1 doc graph (spec/20). `relation`/`virtual` are
 * synthetic kinds the entity layer feeds through the same render path: a
 * `relation` is a T3 entity↔entity edge, a `virtual` is the weak entity→source-doc
 * tie that lets an entity gravitate toward the docs that mention it (overlay).
 */
export type EdgeKind = 'link' | 'wikilink' | 'relation' | 'virtual';

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  label: string | null;
  count: number;
  /** T3 relation weight in [0,1]; drives edge brightness. Absent = full (1). */
  weight?: number;
}

export interface EdgeRef {
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface GraphStats {
  docs: number;
  edges: number;
  ghosts: number;
  islands: number;
  orphans: number;
  tags: number;
}

export interface GhostEdge {
  source: string;
  target: string;
}

/** The full t1/graph.json payload (GET /api/graph). */
export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghosts: GhostEdge[];
  islands: string[][];
  stats: GraphStats;
  tags: Record<string, string[]>;
}

/** SSE `graph.delta` event payload (spec/60-live-deltas.md). */
export interface GraphDelta {
  seq: number;
  added: { nodes: GraphNode[]; edges: GraphEdge[] };
  removed: { nodes: string[]; edges: EdgeRef[] };
  updated: { nodes: GraphNode[] };
  stats: GraphStats;
  cause: { paths: string[]; tier: 't1' | 't2' | 't3' };
}

export type TierName = 't1' | 't2' | 't3';
export type TierState = string; // spec 0.1 names "fresh"/"off"; tolerate others
export type TierMap = Record<TierName, TierState>;

/** SSE `hello` event payload. */
export interface HelloEvent {
  seq: number;
  spec_version: string;
  tiers: TierMap;
}

/** SSE `graph.snapshot` event payload. */
export interface SnapshotEvent {
  seq: number;
  graph: GraphPayload;
}

/** SSE `compile.status` event payload. */
export interface CompileStatus {
  seq: number;
  state: string; // spec shows "running"; other values pass through
  tier: TierName;
}

/** GET /api/search hit. */
export interface SearchHit {
  path: string;
  title: string;
  description: string | null;
  score: number;
  snippet: string | null;
  source: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  used_modes: string[];
  degraded_from: string | null;
}

/**
 * GET /api/search `mode` values (spec/50). Unknown modes fall back to auto
 * server-side; `graph` answers keyword-degraded until T3 lands.
 */
export const SEARCH_MODES = ['auto', 'keyword', 'semantic', 'graph'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** GET /api/docs/{path} response. */
export interface DocResponse {
  path: string;
  frontmatter: Record<string, unknown>;
  title: string;
  text: string;
  neighbors: { in: unknown[]; out: unknown[] };
}

/** Canonical map key for an edge (source+target+kind triple). */
export function edgeKey(e: EdgeRef): string {
  return `${e.source}${e.target}${e.kind}`;
}
