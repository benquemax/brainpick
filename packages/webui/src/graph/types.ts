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

export type EdgeKind = 'link' | 'wikilink';

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  label: string | null;
  count: number;
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
