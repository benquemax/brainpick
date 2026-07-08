/** Keyword retrieval: BM25 over docs.jsonl records (spec/50 — normative for
 * conformance). Depends on nothing beyond T1, so search works everywhere. */
import { cmpStr } from "../core/canonical";
import { pySplitWhitespace } from "../core/pyfmt";
import type { DocRecord } from "../compile/t1";

// Python [^\W_]+ with re.UNICODE: word characters minus the underscore —
// letters and numbers (\p{N} covers Nd/Nl/No like str.isalnum()).
const TOKEN = /[\p{L}\p{N}]+/gu;
export const K1 = 1.2;
export const B = 0.75;
export const SNIPPET_WINDOW = 240;

/** The retriever that produced a hit (spec/50; under fusion, the
 * highest-contributing one). `title` is the deterministic navigational match that
 * guarantees a page the query names surfaces in every mode. */
export type HitSource = "keyword" | "semantic" | "graph" | "title";

export interface SearchHit {
  description: string | null;
  path: string;
  score: number;
  snippet: string | null;
  source: HitSource;
  title: string;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

function searchable(record: DocRecord): string {
  const title = record.title;
  const description = record.description || "";
  return [title, title, title, description, description, record.text].join("\n");
}

export function search(records: DocRecord[], query: string, limit = 8): SearchHit[] {
  const corpus = records.filter((r) => !r.reserved);
  if (corpus.length === 0) return [];

  const termFreqs = corpus.map((r) => {
    const tf = new Map<string, number>();
    for (const token of tokenize(searchable(r))) tf.set(token, (tf.get(token) ?? 0) + 1);
    return tf;
  });
  const docLengths = termFreqs.map((tf) => {
    let total = 0;
    for (const count of tf.values()) total += count;
    return total;
  });
  const avgLength = docLengths.reduce((a, b) => a + b, 0) / docLengths.length;

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || avgLength === 0) return [];

  const docCount = corpus.length;
  const docFreq = new Map<string, number>();
  for (const t of new Set(queryTerms)) {
    docFreq.set(t, termFreqs.filter((tf) => (tf.get(t) ?? 0) > 0).length);
  }

  const hits: SearchHit[] = [];
  for (let i = 0; i < corpus.length; i++) {
    const record = corpus[i]!;
    const tfMap = termFreqs[i]!;
    const dl = docLengths[i]!;
    let score = 0;
    for (const term of queryTerms) {
      const tf = tfMap.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term)!;
      const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
      score += (idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + (B * dl) / avgLength));
    }
    if (score > 0) {
      hits.push({
        description: record.description,
        path: record.path,
        score: round6(score),
        snippet: snippet(record.text, queryTerms),
        source: "keyword",
        title: record.title,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || cmpStr(a.path, b.path));
  return hits.slice(0, limit);
}

/** Python round(score, 6). (Ties-to-even differences at the 7th decimal are
 * unobservable here — conformance compares result sets, not scores.) */
function round6(x: number): number {
  return Number(x.toFixed(6));
}

function snippet(text: string, queryTerms: string[]): string | null {
  const lowered = text.toLowerCase();
  let first = -1;
  for (const t of queryTerms) {
    const i = lowered.indexOf(t);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  if (first === -1) return null;
  const start = Math.max(0, first - 60);
  return pySplitWhitespace(text.slice(start, start + SNIPPET_WINDOW)).join(" ");
}

/** Does a TITLE token account for a query token? Exact, or a short prefix-stem so a
 * simple inflection reaches its stem ('agents'→'agent', 'connects'→'connect') without
 * stemming machinery — bounded to a ±2 length prefix so it never over-fires (e.g.
 * 'auth' does NOT swallow 'authentication'). Byte-parallel with query/keyword.py. */
function covers(queryToken: string, titleToken: string): boolean {
  if (queryToken === titleToken) return true;
  if (queryToken.length >= 4 && titleToken.length >= 4 && Math.abs(queryToken.length - titleToken.length) <= 2) {
    return queryToken.startsWith(titleToken) || titleToken.startsWith(queryToken);
  }
  return false;
}

/** Docs whose TITLE the query names — a deterministic T1 navigational signal so typing
 * an article's name always finds that article (in every mode). A doc qualifies only when
 * EVERY query token is covered by some title token (exact or short prefix-stem), so
 * 'cli'→'CLI reference' and 'agents'→'Agent integrations' match while an unrelated word
 * does not. Ranked exact-title first, then the tightest (fewest extra title tokens),
 * then path — deterministic across engines. */
export function titleSearch(records: DocRecord[], query: string, limit = 8): SearchHit[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const qUnique = [...new Set(qTokens)];
  const scored: Array<{ exact: number; ntok: number; record: DocRecord }> = [];
  for (const record of records) {
    if (record.reserved) continue;
    const tTokens = tokenize(record.title);
    if (tTokens.length === 0) continue;
    if (!qUnique.every((q) => tTokens.some((t) => covers(q, t)))) continue;
    const exact = tTokens.length === qTokens.length && tTokens.every((t, i) => t === qTokens[i]) ? 1 : 0;
    scored.push({ exact, ntok: tTokens.length, record });
  }
  scored.sort((a, b) => b.exact - a.exact || a.ntok - b.ntok || cmpStr(a.record.path, b.record.path));
  return scored.slice(0, limit).map(({ exact, record }) => ({
    description: record.description,
    path: record.path,
    score: round6(1.0 + exact), // 2.0 for an exact title, 1.0 otherwise
    snippet: null,
    source: "title" as HitSource,
    title: record.title,
  }));
}
