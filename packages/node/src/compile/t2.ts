/** T2: the vectors tier (spec/30) — deterministic chunking, embedding, LanceDB.
 *
 * The chunker is normative: both engines must produce byte-identical
 * t2/chunks.jsonl. Everything here is char-based — no tokenizer dependency —
 * where "char" means Unicode code point (Python `len`/slicing), NOT UTF-16
 * code units; the cp* helpers below carry that difference.
 */
import { join } from "node:path";

import type { Config, EmbeddingConfig } from "../config";
import { canonicalJson, canonicalJsonl, cmpStr, sha256Hex, type JsonValue } from "../core/canonical";
import { readTextOrNull, writeIfChanged } from "../core/fs";
import { PY_SPACE_CLASS, pyStrip } from "../core/pyfmt";
import { DEFAULT_LOCAL_MODEL, makeEmbedder } from "../embed";
import { lancedbAvailable, VectorStore, type ChunkRow } from "../vectorstore";

export const MAX_CHUNK = 3200; // chars, hard budget per chunk (overlap counts toward it)
export const OVERLAP = 320; // chars of the previous chunk prefixed onto the next

// `[^\n]*$` instead of `.*$`: unlike Python's `.`, JS `.` refuses `\r`, which
// would unmatch headings in CRLF bodies.
const HEADING = /^(#{1,3}) ([^\n]*)$/;
const FENCE = /^(`{3,}|~{3,})/;
const SLUG_RUNS = /[^\p{L}\p{N}]+/gu; // non-alphanumeric runs (spec/30: `_` too)

/** lowercase; every run of non-alphanumerics → `-`; trimmed of `-` (spec/30). */
export function slugify(title: string): string {
  return title.toLowerCase().replace(SLUG_RUNS, "-").replace(/^-+|-+$/g, "");
}

/** A fence closes on the same char, at least as long, nothing else on the line. */
function fenceCloseRe(opening: string): RegExp {
  return new RegExp(`^${opening[0]}{${opening.length},}[${PY_SPACE_CLASS}]*$`, "u");
}

/** Python `len(s)` — code points, not UTF-16 units. */
function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Python `s[-n:]` — the last n code points. */
function cpTail(s: string, n: number): string {
  const arr = [...s];
  return arr.length <= n ? s : arr.slice(arr.length - n).join("");
}

/** Python `s[:n]` — the first n code points. */
export function cpHead(s: string, n: number): string {
  const arr = [...s];
  return arr.length <= n ? s : arr.slice(0, n).join("");
}

interface Section {
  headingPath: string[];
  lines: string[];
}

/** [(heading_path, content lines)] — split at ATX headings 1–3 outside fences.
 *
 * The heading line itself is not part of the section's content: the titles
 * travel in heading_path (metadata), the text stays prose. */
function splitSections(text: string): Section[] {
  const levels = new Map<number, string>();
  const sections: Section[] = [{ headingPath: [], lines: [] }];
  let fenceClose: RegExp | null = null;
  for (const line of text.split("\n")) {
    if (fenceClose !== null) {
      sections[sections.length - 1]!.lines.push(line);
      if (fenceClose.test(line)) fenceClose = null;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      fenceClose = fenceCloseRe(fence[1]!);
      sections[sections.length - 1]!.lines.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      for (const lv of [...levels.keys()]) {
        if (lv >= level) levels.delete(lv);
      }
      levels.set(level, pyStrip(heading[2]!));
      const path = [...levels.keys()].sort((a, b) => a - b).map((lv) => levels.get(lv)!);
      sections.push({ headingPath: path, lines: [] });
      continue;
    }
    sections[sections.length - 1]!.lines.push(line);
  }
  return sections;
}

/** Blank-line separated paragraphs; blank lines inside fences do not split. */
function splitParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fenceClose: RegExp | null = null;
  for (const line of lines) {
    if (fenceClose !== null) {
      current.push(line);
      if (fenceClose.test(line)) fenceClose = null;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      fenceClose = fenceCloseRe(fence[1]!);
      current.push(line);
      continue;
    }
    if (pyStrip(line) === "") {
      if (current.length > 0) {
        paragraphs.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) paragraphs.push(current.join("\n"));
  return paragraphs;
}

/** Greedy packing to MAX_CHUNK; chunks after the first reserve OVERLAP chars
 * for the incoming prefix; a paragraph over the budget is hard-split. */
function pack(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let parts: string[] = [];

  const budget = (): number => (chunks.length === 0 ? MAX_CHUNK : MAX_CHUNK - OVERLAP);

  for (const paragraph of paragraphs) {
    if (parts.length > 0 && cpLen([...parts, paragraph].join("\n\n")) > budget()) {
      chunks.push(parts.join("\n\n"));
      parts = [];
    }
    if (parts.length === 0 && cpLen(paragraph) > budget()) {
      let rest = [...paragraph]; // code points
      while (rest.length > budget()) {
        const cut = budget(); // 3200 for a section's first chunk, 2880 after
        chunks.push(rest.slice(0, cut).join(""));
        rest = rest.slice(cut);
      }
      parts = rest.length > 0 ? [rest.join("")] : [];
    } else {
      parts.push(paragraph);
    }
  }
  if (parts.length > 0) chunks.push(parts.join("\n\n"));
  return chunks;
}

export interface Chunk {
  doc: string;
  heading_path: string[];
  id: string;
  ord: number;
  sha256: string;
  text: string;
}

export interface ChunkSource {
  path: string;
  text: string;
  reserved: boolean;
}

/** spec/30's normative chunker over one docs.jsonl record (never a reserved doc). */
export function chunkDocument(record: Pick<ChunkSource, "path" | "text">): Chunk[] {
  const doc = record.path;
  const result: Chunk[] = [];
  let ordCounter = 0;
  for (const { headingPath, lines } of splitSections(record.text)) {
    const base = pack(splitParagraphs(lines));
    const emitted: string[] = [];
    for (let i = 0; i < base.length; i++) {
      emitted.push(i === 0 ? base[i]! : cpTail(emitted[emitted.length - 1]!, OVERLAP) + base[i]!);
    }
    const slugPath = headingPath.map(slugify).join("/");
    let n = 0;
    for (const text of emitted) {
      if (pyStrip(text) === "") continue; // spec/30 step 4: blank chunks are dropped
      result.push({
        doc,
        heading_path: [...headingPath],
        id: `${doc}#${slugPath}~${n}`,
        ord: ordCounter,
        sha256: sha256Hex(text),
        text,
      });
      n += 1;
      ordCounter += 1;
    }
  }
  return result;
}

/** Every chunk of every non-reserved document, sorted by (doc, ord). */
export function buildChunks(records: readonly ChunkSource[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const record of [...records].sort((a, b) => cmpStr(a.path, b.path))) {
    if (record.reserved) continue;
    chunks.push(...chunkDocument(record));
  }
  return chunks;
}

// -- the compile stage ---------------------------------------------------------------

export interface T2Result {
  status: "fresh" | "stale"; // tiers.t2 for the manifest
  changed: boolean; // chunks.jsonl or embedding.json bytes changed
  warning: string | null;
}

/** First 16 hex chars of sha256 over `kind|endpoint|model|dim` (spec/30). */
export function fingerprint(kind: string, endpoint: string, model: string, dim: number): string {
  return sha256Hex(`${kind}|${endpoint}|${model}|${dim}`).slice(0, 16);
}

/** (enabled, instruction) per [modules] vectors: auto lights up when an
 * embedding backend is configured AND lancedb is importable; otherwise the
 * instruction names exactly what is missing (spec/30 detection ladder, rung 6). */
export async function t2Gate(config: Config): Promise<[boolean, string | null]> {
  if (config.modules.vectors === "off") return [false, null]; // the user chose off — no nagging
  if (!config.models.embedding.kind) {
    return [
      false,
      "T2 vectors off — no [models.embedding] in brainpick.toml; " +
        "`brainpick init` detects local backends (ollama pull nomic-embed-text)",
    ];
  }
  if (!(await lancedbAvailable())) {
    return [
      false,
      "T2 vectors off — the vector store is missing: npm install @lancedb/lancedb",
    ];
  }
  return [true, null];
}

/** Config → the (kind, endpoint, model) recorded in embedding.json.
 *
 * `openai` (what init records for the paid API) is an openai-compatible
 * endpoint; embedding.json keeps the spec/30 enum. */
function normalizedBackend(embedding: EmbeddingConfig): [string, string, string] {
  const kind = embedding.kind === "openai" ? "openai-compatible" : embedding.kind;
  const model = embedding.model || (kind === "mock" ? "mock" : kind === "local" ? DEFAULT_LOCAL_MODEL : "");
  return [kind, embedding.endpoint, model];
}

/** Compile chunks + vectors under <bp>/t2; never throws (failures degrade). */
export async function runT2Stage(
  bp: string,
  records: readonly ChunkSource[],
  embedding: EmbeddingConfig,
  full = false,
): Promise<T2Result> {
  const chunks = buildChunks(records);
  const chunksChanged = writeIfChanged(
    join(bp, "t2", "chunks.jsonl"),
    canonicalJsonl(chunks as unknown as JsonValue[]),
  );
  let embeddingChanged: boolean;
  try {
    embeddingChanged = await syncVectors(bp, chunks, embedding, full);
  } catch (error) {
    // T2 failures never block T1 (spec/00 degradation ladder)
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "stale",
      changed: chunksChanged,
      warning:
        `T2 embedding failed (${msg}) — semantic search degrades to keyword; ` +
        "fix the backend and recompile",
    };
  }
  return { status: "fresh", changed: chunksChanged || embeddingChanged, warning: null };
}

function readJson(path: string): Record<string, unknown> | null {
  const text = readTextOrNull(path);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function syncVectors(
  bp: string,
  chunks: Chunk[],
  embedding: EmbeddingConfig,
  full: boolean,
): Promise<boolean> {
  const [kind, endpoint, model] = normalizedBackend(embedding);
  const embedder = makeEmbedder(kind, endpoint, model, process.env["OPENAI_API_KEY"] ?? "");
  const store = new VectorStore(join(bp, "t2", "lancedb"));

  const old = readJson(join(bp, "t2", "embedding.json"));
  let sameBackend =
    !full &&
    old !== null &&
    old["kind"] === kind &&
    old["endpoint"] === endpoint &&
    old["model"] === model;

  let toEmbed: Chunk[];
  let deleteIds: Set<string>;
  if (sameBackend) {
    const embedded = await store.existingShas();
    const newIds = new Set(chunks.map((c) => c.id));
    toEmbed = chunks.filter((c) => embedded.get(c.id) !== c.sha256);
    deleteIds = new Set<string>();
    for (const id of embedded.keys()) if (!newIds.has(id)) deleteIds.add(id);
    for (const c of toEmbed) if (embedded.has(c.id)) deleteIds.add(c.id);
  } else {
    toEmbed = chunks;
    deleteIds = new Set();
  }

  let vectors = toEmbed.length > 0 ? await embedder.embed(toEmbed.map((c) => c.text)) : [];
  let dim: number;
  if (toEmbed.length > 0) dim = vectors[0]!.length;
  else if (sameBackend) dim = Math.trunc(Number(old!["dim"]));
  else if (embedding.dim) dim = Math.trunc(embedding.dim);
  else dim = (await embedder.embed(["brainpick"]))[0]!.length; // discover once, even with no chunks

  if (sameBackend && dim !== Math.trunc(Number(old!["dim"]))) {
    // the backend answers with a new dimensionality — every old vector is invalid
    sameBackend = false;
    toEmbed = chunks;
    vectors = await embedder.embed(chunks.map((c) => c.text));
  }

  const rows: ChunkRow[] = toEmbed.map((c, i) => ({
    id: c.id,
    doc: c.doc,
    ord: c.ord,
    text: c.text,
    vector: vectors[i]!,
  }));
  if (sameBackend) {
    if (rows.length > 0 || deleteIds.size > 0) await store.upsert(rows, deleteIds, dim);
  } else {
    await store.replaceAll(rows, dim);
  }

  const record = {
    dim,
    endpoint,
    fingerprint: fingerprint(kind, endpoint, model, dim),
    kind,
    model,
  };
  return writeIfChanged(join(bp, "t2", "embedding.json"), canonicalJson(record));
}
