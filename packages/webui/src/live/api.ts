/**
 * REST fetchers for the spec/50-rest-api.md surface. All same-origin: the
 * dev server proxies /api to 127.0.0.1:4747, production is served by the
 * engine itself.
 */
import type { DocResponse, GraphPayload, SearchMode, SearchResponse } from '../graph/types';
import type { EntityGraph, GraphLayer, NeighborsResponse } from '../graph/entities';
import { EMPTY_TIMELINE, type Timeline } from '../time/timeline';

export interface GraphFetchResult {
  graph: GraphPayload;
  seq: number;
}

/** ETag on /api/graph is `"<seq>"` (spec/50) — that is the seq baseline. */
function seqFromETag(etag: string | null): number | null {
  if (!etag) return null;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(etag.trim());
  return m && m[1] !== undefined ? Number(m[1]) : null;
}

/**
 * Fetch the full graph snapshot. `bustCache` appends a unique query param so
 * a resync fetch cannot be satisfied by the service worker's
 * stale-while-revalidate cache (a stale snapshot would immediately re-flag
 * needsSnapshot and loop).
 */
export async function fetchGraph(bustCache = false, fallbackSeq = 0): Promise<GraphFetchResult> {
  const url = bustCache ? `/api/graph?layer=links&fresh=${Date.now()}` : '/api/graph?layer=links';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/graph -> ${res.status}`);
  const graph = (await res.json()) as GraphPayload;
  const seq = seqFromETag(res.headers.get('ETag')) ?? fallbackSeq;
  return { graph, seq };
}

/**
 * The T3 entity layer (spec/40). Versioned by seq via ETag like layer=links.
 * A 404 means T3 is not compiled — an availability signal, not an error, so it
 * comes back as `{ ok: false, status: 404 }` for the caller to degrade on.
 */
export type EntityGraphFetch =
  | { ok: true; graph: EntityGraph; seq: number }
  | { ok: false; status: number };

export async function fetchEntityGraph(bustCache = false, fallbackSeq = 0): Promise<EntityGraphFetch> {
  const url = bustCache
    ? `/api/graph?layer=entities&fresh=${Date.now()}`
    : '/api/graph?layer=entities';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return { ok: false, status: res.status };
  const graph = (await res.json()) as EntityGraph;
  const seq = seqFromETag(res.headers.get('ETag')) ?? fallbackSeq;
  return { ok: true, graph, seq };
}

/**
 * A doc's entity neighborhood (spec/40 brain_neighbors). Unlike the graph
 * layer, each entity here carries `source_docs` — the doc↔entity grounding the
 * UI reconstructs from. Returns null on any transport/HTTP failure (grounding
 * is best-effort; a miss just leaves that doc's ties undiscovered).
 */
export async function fetchNeighbors(
  id: string,
  layer: GraphLayer = 'entities',
  depth = 1,
  signal?: AbortSignal,
): Promise<NeighborsResponse | null> {
  const encoded = encodeURIComponent(id);
  try {
    const res = await fetch(`/api/neighbors?id=${encoded}&layer=${layer}&depth=${depth}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as NeighborsResponse;
  } catch {
    return null;
  }
}

/**
 * The advisory git-history timeline (spec/90). ETag by seq like /api/graph. A
 * non-repo bundle serves the empty shape `{commits:[],docs:{},span:null}` (200,
 * not 404) — the Time Machine hides on it. A missing route / transport error is
 * treated the same way (an empty timeline), so the feature degrades to hidden
 * rather than throwing.
 */
export async function fetchTimeline(bustCache = false): Promise<Timeline> {
  const url = bustCache ? `/api/timeline?fresh=${Date.now()}` : '/api/timeline';
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return EMPTY_TIMELINE;
    return (await res.json()) as Timeline;
  } catch {
    return EMPTY_TIMELINE;
  }
}

export async function fetchSearch(
  query: string,
  mode: SearchMode = 'auto',
  limit = 12,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=${limit}`, { signal });
  if (!res.ok) throw new Error(`GET /api/search -> ${res.status}`);
  return (await res.json()) as SearchResponse;
}

export interface DocFetchError {
  error: string;
  suggestions?: string[];
}

export type DocFetchResult = { ok: true; doc: DocResponse } | { ok: false; status: number; body: DocFetchError };

export async function fetchDoc(path: string, signal?: AbortSignal): Promise<DocFetchResult> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`/api/docs/${encoded}`, { signal });
  if (res.ok) return { ok: true, doc: (await res.json()) as DocResponse };
  let body: DocFetchError = { error: `GET /api/docs/${path} -> ${res.status}` };
  try {
    body = (await res.json()) as DocFetchError;
  } catch {
    // non-JSON error body — keep the fallback message
  }
  return { ok: false, status: res.status, body };
}
