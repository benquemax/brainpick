/** Semantic retrieval (spec/30): embed the query with the recorded backend,
 * cosine top-k over the chunk store, dedupe to documents (best chunk wins). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DocRecord } from "../compile/t1";
import { cpHead } from "../compile/t2";
import { pySplitWhitespace } from "../core/pyfmt";
import { makeEmbedder } from "../embed";
import { VectorStore } from "../vectorstore";
import { SNIPPET_WINDOW, type SearchHit } from "./keyword";

const OVERFETCH = 4; // chunks per requested doc — several chunks may share a document

/** T2 artifacts are missing or unreadable — callers degrade to keyword. */
export class SemanticUnavailable extends Error {}

export function loadEmbeddingRecord(bp: string): Record<string, unknown> {
  const path = join(bp, "t2", "embedding.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new SemanticUnavailable("t2/embedding.json is missing — run: brainpick compile");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Python round(score, 6) — ties-to-even differences at the 7th decimal are
 * unobservable here (conformance compares result sets, not scores). */
function round6(x: number): number {
  return Number(x.toFixed(6));
}

/** spec/50-shaped hits with source "semantic". Query-time embedding MUST use
 * the t2/embedding.json record — that is how one engine searches vectors the
 * other compiled. */
export async function semanticSearch(
  bp: string,
  records: readonly DocRecord[],
  query: string,
  limit = 8,
): Promise<SearchHit[]> {
  const record = loadEmbeddingRecord(bp);
  const embedder = makeEmbedder(
    String(record["kind"] ?? ""),
    String(record["endpoint"] ?? ""),
    String(record["model"] ?? ""),
    process.env["OPENAI_API_KEY"] ?? "",
  );
  const [vector] = await embedder.embed([query]);
  if (!vector!.some((x) => x !== 0)) {
    return []; // an all-zero query vector has no cosine neighborhood
  }

  const rows = await new VectorStore(join(bp, "t2", "lancedb")).queryVectors(
    vector!,
    Math.max(limit * OVERFETCH, 32),
  );
  const byPath = new Map(records.filter((r) => !r.reserved).map((r) => [r.path, r]));
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // nearest first; the first chunk of a doc is its best chunk
    const doc = String(row["doc"]);
    if (seen.has(doc)) continue;
    seen.add(doc);
    const meta = byPath.get(doc);
    if (meta === undefined) continue; // a vector for a doc that no longer exists — stale store, skip
    const snippet = pySplitWhitespace(cpHead(String(row["text"]), SNIPPET_WINDOW)).join(" ");
    hits.push({
      description: meta.description,
      path: doc,
      score: round6(1.0 - Number(row["_distance"] ?? 0.0)),
      snippet: snippet !== "" ? snippet : null,
      source: "semantic",
      title: meta.title,
    });
    if (hits.length === limit) break;
  }
  return hits;
}
