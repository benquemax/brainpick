/** One search surface, four strategies (spec/30 + spec/50): keyword always,
 * semantic when T2 is fresh, RRF fusion under auto, honest degradation markers. */
import type { DocRecord } from "../compile/t1";
import { cmpStr } from "../core/canonical";
import { search as keywordSearch, type SearchHit } from "./keyword";

export const KNOWN_MODES = ["auto", "keyword", "semantic", "graph"] as const;
export const RRF_K = 60; // spec/30: reciprocal rank fusion constant

export type SemanticFn = (query: string, limit: number) => Promise<SearchHit[]> | SearchHit[];

export interface SearchBody {
  hits: SearchHit[];
  used_modes: string[];
  degraded_from: string | null;
}

/** Unknown modes fall back to auto — never an error (spec/50). */
export function resolveMode(mode: unknown): string {
  const resolved = String(mode || "auto");
  return (KNOWN_MODES as readonly string[]).includes(resolved) ? resolved : "auto";
}

/** Python round(x, 6) — see query/keyword.ts. */
function round6(x: number): number {
  return Number(x.toFixed(6));
}

/** RRF (k=60) across retrievers, deduped by document. A hit keeps the fields
 * of the retriever contributing its best rank — that retriever is its source. */
export function rrfFuse(rankings: Record<string, SearchHit[]>, limit: number): SearchHit[] {
  const scores = new Map<string, number>();
  const best = new Map<string, [number, SearchHit]>(); // path -> (best rank, that retriever's hit)
  for (const hits of Object.values(rankings)) {
    for (let i = 0; i < hits.length; i++) {
      const rank = i + 1;
      const hit = hits[i]!;
      scores.set(hit.path, (scores.get(hit.path) ?? 0.0) + 1.0 / (RRF_K + rank));
      const current = best.get(hit.path);
      if (current === undefined || rank < current[0]) best.set(hit.path, [rank, hit]);
    }
  }

  const fused: SearchHit[] = [];
  const ordered = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || cmpStr(a, b));
  for (const path of ordered) {
    const hit = { ...best.get(path)![1] };
    hit.score = round6(scores.get(path)!);
    fused.push(hit);
  }
  return fused.slice(0, limit);
}

/** The spec/50 response body: {"hits", "used_modes", "degraded_from"}.
 *
 * `semanticFn(query, limit)` runs the vector retriever; callers wire it to
 * query/vectors.semanticSearch. Any semantic failure degrades to keyword —
 * a missing tier downgrades the answer, never errors the call. */
export async function runSearch(
  records: DocRecord[],
  tiers: Record<string, unknown>,
  query: string,
  mode: unknown = "auto",
  limit = 8,
  semanticFn: SemanticFn | null = null,
): Promise<SearchBody> {
  const resolved = resolveMode(mode);
  const t2Fresh = tiers["t2"] === "fresh" && semanticFn !== null;

  if (resolved === "keyword") {
    return body(keywordSearch(records, query, limit), ["keyword"], null);
  }
  if (resolved === "graph") {
    // the entity layer lands with T3 — keyword meanwhile
    return body(keywordSearch(records, query, limit), ["keyword"], "graph");
  }

  let semanticHits: SearchHit[] | null = null;
  if (t2Fresh) {
    try {
      semanticHits = await semanticFn!(query, limit);
    } catch {
      semanticHits = null; // degrade below; T2 trouble must never error a search
    }
  }

  if (resolved === "semantic") {
    if (semanticHits === null) {
      return body(keywordSearch(records, query, limit), ["keyword"], "semantic");
    }
    return body(semanticHits, ["semantic"], null);
  }

  // auto: fuse whatever is available (spec/30: RRF k=60, dedupe by document)
  const keywordHits = keywordSearch(records, query, limit);
  if (semanticHits === null) return body(keywordHits, ["keyword"], "semantic");
  const fused = rrfFuse({ keyword: keywordHits, semantic: semanticHits }, limit);
  return body(fused, ["keyword", "semantic"], null);
}

function body(hits: SearchHit[], usedModes: string[], degradedFrom: string | null): SearchBody {
  return { hits, used_modes: usedModes, degraded_from: degradedFrom };
}
