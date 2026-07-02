/**
 * REST fetchers for the spec/50-rest-api.md surface. All same-origin: the
 * dev server proxies /api to 127.0.0.1:4747, production is served by the
 * engine itself.
 */
import type { DocResponse, GraphPayload, SearchResponse } from '../graph/types';

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

export async function fetchSearch(query: string, limit = 12, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=auto&limit=${limit}`, { signal });
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
