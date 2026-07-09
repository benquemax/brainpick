/** Shared serve state: held artifacts, the delta ring buffer, and subscriber fan-out.
 *
 * Everything the REST routes, the SSE stream, the watcher, and the MCP tools agree
 * on lives here — one graph, one seq, one broadcast path (spec/60). Ports
 * serve/state.py; Node's single event loop makes the Python thread-safety
 * plumbing (loop handoff) unnecessary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DocRecord, Graph, GraphEdge } from "../compile/t1";
import { runCompile, type CompileResult } from "../compile/pipeline";
import type { Config } from "../config";
import { canonicalJsonl, cmpStr, type JsonValue } from "../core/canonical";
import { getCloseMatches, SequenceMatcher } from "../core/difflib";
import { pyStrip } from "../core/pyfmt";
import { YamlFloat, YamlTimestamp } from "../core/yaml11";
import { diffGraphs, type GraphDelta } from "../deltas";
import { graphSearch, loadKg, normalizeEntityId, type KnowledgeGraph } from "../kg";
import { semanticSearch } from "../query/vectors";
import type { GraphFn, SemanticFn } from "../query/router";

export const RING_SIZE = 512; // spec/60 wants >= 256 replayable deltas

/** (event name, SSE id, JSON data) — the unit every subscriber receives. */
export type ServeEvent = [name: string, id: number | null, data: string];

/** json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True). */
export function dumps(obj: unknown): string {
  // canonicalJsonl renders exactly that shape, one record per line.
  return canonicalJsonl([obj as JsonValue]).slice(0, -1);
}

/** Frontmatter straight out of YAML may hold timestamps; JSON wants strings. */
export function jsonable(value: unknown): JsonValue {
  if (value instanceof YamlTimestamp) return value.normalized();
  if (value instanceof YamlFloat) return value.value;
  if (Array.isArray(value)) return value.map(jsonable);
  if (value instanceof Map) {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of value) out[String(k)] = jsonable(v);
    return out;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonable(v);
    return out;
  }
  if (value === null || value === undefined) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return value as JsonValue;
  if (kind === "bigint") {
    const big = value as bigint;
    // Python keeps arbitrary ints as JSON numbers; JSON.stringify cannot —
    // safe integers pass through, the rest become strings.
    return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(big)
      : big.toString();
  }
  return String(value);
}

function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

/** The record fields resolution and suggestions read — DocRecord in practice. */
export interface ResolvableRecord {
  path: string;
  title: string;
}

/** <= `limit` fuzzy path suggestions for a miss (spec/50 docs 404 shape). */
export function suggestPaths(records: readonly ResolvableRecord[], needle: string, limit = 5): string[] {
  const needleL = pyStrip(needle).toLowerCase();
  const candidates = new Map<string, string>();
  for (const record of records) {
    for (const key of [record.path.toLowerCase(), stem(record.path).toLowerCase(), String(record.title).toLowerCase()]) {
      if (!candidates.has(key)) candidates.set(key, record.path);
    }
  }
  const keys = [...candidates.keys()];
  let matches = getCloseMatches(needleL, keys, limit * 3, 0.4);
  if (matches.length === 0) {
    // even for a wild miss, naming the least-far paths beats an empty list
    matches = getCloseMatches(needleL, keys, limit * 3, 0.1);
  }
  const suggestions: string[] = [];
  for (const match of matches) {
    const path = candidates.get(match)!;
    if (!suggestions.includes(path)) suggestions.push(path);
    if (suggestions.length === limit) break;
  }
  return suggestions;
}

export type Resolution<R extends ResolvableRecord> =
  | ["ok", R]
  | ["ambiguous", R[]]
  | ["miss", string[]];

/** The forgiving ladder (spec/70): exact path -> unique stem -> fuzzy title. */
export function resolveDoc<R extends ResolvableRecord>(records: readonly R[], needle: unknown): Resolution<R> {
  const cleaned = pyStrip(String(needle ?? "")).replace(/^\/+/, "");
  const byPath = new Map(records.map((r) => [r.path, r]));
  const direct = byPath.get(cleaned);
  if (direct !== undefined) return ["ok", direct];
  const withMd = byPath.get(cleaned + ".md");
  if (withMd !== undefined) return ["ok", withMd];

  const stemHits = records.filter((r) => stem(r.path).toLowerCase() === cleaned.toLowerCase());
  if (stemHits.length === 1) return ["ok", stemHits[0]!];
  if (stemHits.length > 1) return ["ambiguous", stemHits];

  const byTitle = new Map<string, R>();
  for (const r of records) byTitle.set(String(r.title).toLowerCase(), r); // last wins, like the dict comp
  const matcher = new SequenceMatcher();
  const scored: Array<[number, string]> = [];
  for (const title of byTitle.keys()) {
    matcher.setSeqs(cleaned.toLowerCase(), title);
    scored.push([matcher.ratio(), title]);
  }
  // Python sorted(..., reverse=True) over (score, title) tuples
  scored.sort((p, q) => q[0] - p[0] || cmpStr(q[1], p[1]));
  const close = scored.filter(([score]) => score >= 0.6);
  if (close.length === 1 || (close.length > 1 && close[0]![0] - close[1]![0] >= 0.15)) {
    return ["ok", byTitle.get(close[0]![1])!];
  }
  if (close.length > 0) return ["ambiguous", close.slice(0, 5).map(([, title]) => byTitle.get(title)!)];
  return ["miss", suggestPaths(records, cleaned)];
}

/** One presentation token → a graph id, or null when nothing matches (spec/95).
 * Doc paths resolve via the same forgiving ladder brain_read uses; on a miss, an
 * entity name resolves to its render-id (its slug) over the T3 export. Docs win
 * ties — the spec lists doc paths before entity names. */
export function resolvePresentationId(state: ServeState, token: unknown): string | null {
  const text = pyStrip(String(token ?? ""));
  if (text === "") return null;
  const [outcome, payload] = resolveDoc(state.records, text);
  if (outcome === "ok") return (payload as DocRecord).path;
  if (state.kg !== null) {
    const slug = normalizeEntityId(text);
    if (slug !== "" && state.kg.entities.has(slug)) return slug;
    const lowered = text.toLowerCase();
    for (const eid of [...state.kg.entities.keys()].sort(cmpStr)) {
      if (pyStrip(String(state.kg.entities.get(eid)!.name)).toLowerCase() === lowered) return eid;
    }
  }
  return null;
}

/** Resolve presentation node tokens to graph ids (spec/95). Order preserved,
 * duplicates dropped, unresolved tokens collected (never thrown) so the caller
 * can report them back to the model. */
export function resolvePresentationIds(state: ServeState, tokens: readonly unknown[]): [string[], string[]] {
  const resolved: string[] = [];
  const dropped: string[] = [];
  for (const token of tokens) {
    const text = pyStrip(String(token ?? ""));
    if (text === "") continue; // blank tokens are noise, not a drop worth reporting
    const gid = resolvePresentationId(state, text);
    if (gid === null) dropped.push(text);
    else if (!resolved.includes(gid)) resolved.push(gid);
  }
  return [resolved, dropped];
}

/** Undirected BFS over the link graph: {id: distance} plus the induced edges. */
export function bfsNeighborhood(graph: Graph, center: string, depth: number): [Map<string, number>, GraphEdge[]] {
  const adjacency = new Map<string, Set<string>>();
  const neighborsOf = (id: string): Set<string> => {
    let set = adjacency.get(id);
    if (!set) adjacency.set(id, (set = new Set()));
    return set;
  };
  for (const edge of graph.edges) {
    neighborsOf(edge.source).add(edge.target);
    neighborsOf(edge.target).add(edge.source);
  }
  const distance = new Map<string, number>([[center, 0]]);
  let frontier = [center];
  for (let hop = 1; hop <= depth; hop++) {
    const reached: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!distance.has(neighbor)) {
          distance.set(neighbor, hop);
          reached.push(neighbor);
        }
      }
    }
    frontier = reached;
  }
  const edges = graph.edges.filter((e) => distance.has(e.source) && distance.has(e.target));
  return [distance, edges];
}

interface ManifestFileEntry {
  bytes?: number;
  sha256?: string;
}

function changedPaths(
  oldFiles: Record<string, ManifestFileEntry>,
  newFiles: Record<string, ManifestFileEntry>,
): string[] {
  const paths = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)]);
  return [...paths].filter((p) => oldFiles[p]?.sha256 !== newFiles[p]?.sha256).sort(cmpStr);
}

/** One SSE consumer's mailbox: awaitable pops with a ping timeout. */
export class EventQueue {
  private items: ServeEvent[] = [];
  private waiter: ((value: ServeEvent | "timeout" | null) => void) | null = null;
  private closed = false;

  push(event: ServeEvent): void {
    if (this.closed) return;
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(event);
    } else {
      this.items.push(event);
    }
  }

  /** The next event, "timeout" after `timeoutMs`, or null once closed and drained. */
  next(timeoutMs: number): Promise<ServeEvent | "timeout" | null> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve("timeout");
      }, timeoutMs);
      timer.unref?.();
      this.waiter = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
    });
  }

  /** Synchronous drain — the test-side mirror of pytest's `drain(queue)`. */
  drain(): ServeEvent[] {
    return this.items.splice(0);
  }

  close(): void {
    this.closed = true;
    if (this.waiter !== null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(null);
    }
  }
}

/** Current graph + seq, the delta ring, and the subscriber registry. */
export class ServeState {
  readonly root: string;
  readonly config: Config;
  graph: Graph = { edges: [], ghosts: [], islands: [], nodes: [], stats: {} as Graph["stats"], tags: {} };
  manifest: Record<string, unknown> = {};
  records: DocRecord[] = [];
  kg: KnowledgeGraph | null = null; // the T3 export, when one is staged (spec/40)
  seq = 0;
  watching: boolean;
  ring: Array<[number, string]> = [];
  // Presentations (spec/95): a monotonic counter distinct from the manifest seq,
  // and the LATEST presentation replayed to every new SSE client. Empty until an
  // agent calls brain_show / POST /api/show.
  presentationSeq = 0;
  presentation: Record<string, unknown> | null = null;
  private subscribers = new Set<EventQueue>();

  constructor(root: string, config: Config) {
    this.root = root;
    this.config = config;
    this.watching = Boolean(config.serve.watch);
  }

  // -- loading -----------------------------------------------------------------

  /** Compile if stale (a serve is a compile), then hold the artifacts. */
  async load(): Promise<void> {
    const result = await runCompile(this.root, false, null, this.config);
    if (result.changed) this.applyCompileResult(result);
    else this.reloadArtifacts();
  }

  reloadArtifacts(): void {
    const bp = join(this.root, ".brainpick");
    this.manifest = JSON.parse(readFileSync(join(bp, "manifest.json"), "utf8")) as Record<string, unknown>;
    this.graph = JSON.parse(readFileSync(join(bp, "t1", "graph.json"), "utf8")) as Graph;
    const lines = readFileSync(join(bp, "t1", "docs.jsonl"), "utf8").split("\n");
    this.records = lines.filter((line) => line !== "").map((line) => JSON.parse(line) as DocRecord);
    this.kg = loadKg(bp); // null when no T3 export is present — query degrades
    this.seq = this.manifest["seq"] as number;
  }

  tiers(): Record<string, unknown> {
    return (this.manifest["tiers"] ?? {}) as Record<string, unknown>;
  }

  // -- state transitions -------------------------------------------------------

  /** Adopt an in-process compile: refresh held artifacts, ring + broadcast the delta. */
  applyCompileResult(result: CompileResult): void {
    if (!result.changed) return;
    this.reloadArtifacts();
    if (result.delta !== null) {
      this.emitDelta(result.delta);
    } else {
      // the very first compile has no old graph to diff — resync via snapshot
      this.fanout(["graph.snapshot", this.seq, dumps({ graph: this.graph, seq: this.seq })]);
    }
  }

  /** Adopt an out-of-process compile: diff the held graph against the new artifacts. */
  rescanFromManifest(): void {
    const path = join(this.root, ".brainpick", "manifest.json");
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return;
    }
    if (manifest["seq"] === this.seq) return;
    const oldGraph = this.graph;
    const oldFiles = (this.manifest["files"] ?? {}) as Record<string, ManifestFileEntry>;
    this.reloadArtifacts();
    const delta = diffGraphs(oldGraph, this.graph);
    delta.cause = {
      paths: changedPaths(oldFiles, (this.manifest["files"] ?? {}) as Record<string, ManifestFileEntry>),
      tier: "t1",
    };
    delta.seq = this.seq;
    this.emitDelta(delta);
  }

  // -- broadcasting ------------------------------------------------------------

  subscribe(): EventQueue {
    const queue = new EventQueue();
    this.subscribers.add(queue);
    return queue;
  }

  unsubscribe(queue: EventQueue): void {
    this.subscribers.delete(queue);
    queue.close();
  }

  broadcastStatus(status: string, seq: number): void {
    this.fanout(["compile.status", null, dumps({ seq, state: status, tier: "t1" })]);
  }

  /** Resolve, store, and broadcast a presentation (spec/95). Ephemeral and
   * advisory: no write, no compile, no delta — its own monotonic seq. An empty
   * call or clear=true broadcasts the cleared shape. Returns [presentation,
   * dropped]; the caller shapes {ok, shown, dropped, seq} for its surface.
   *
   * The brain.show event carries the PRESENTATION seq (never a manifest seq),
   * sets no SSE id (so it stays out of the delta ring / Last-Event-ID replay),
   * and overwrites the held presentation replayed to new clients. */
  present(
    nodes?: readonly unknown[] | null,
    focus?: unknown,
    mode?: unknown,
    annotation?: unknown,
    clear = false,
  ): [Record<string, unknown>, string[]] {
    const tokens = (nodes ?? []).map((t) => pyStrip(String(t ?? ""))).filter((t) => t !== "");
    const focusText = focus === null || focus === undefined ? "" : pyStrip(String(focus));
    const annotationText = annotation === null || annotation === undefined ? "" : pyStrip(String(annotation));
    const modeValue = mode === "cosmos" || mode === "brain" ? mode : null; // forgiving enum (spec/95)

    const cleared =
      Boolean(clear) ||
      !(tokens.length > 0 || focusText !== "" || annotationText !== "" || modeValue !== null);
    let resolved: string[];
    let dropped: string[];
    let body: Record<string, unknown>;
    if (cleared) {
      resolved = [];
      dropped = [];
      body = { annotation: null, focus: null, mode: null, nodes: [] };
    } else {
      [resolved, dropped] = resolvePresentationIds(this, tokens);
      let focusId = focusText !== "" ? resolvePresentationId(this, focusText) : null;
      if (focusId === null) focusId = resolved.length > 0 ? resolved[0]! : null; // default focus (spec/95)
      body = {
        annotation: annotationText !== "" ? annotationText : null,
        focus: focusId,
        mode: modeValue,
        nodes: resolved,
      };
    }
    this.presentationSeq += 1;
    const presentation = { ...body, seq: this.presentationSeq };
    this.presentation = presentation;
    this.fanout(["brain.show", null, dumps(presentation)]);
    return [presentation, dropped];
  }

  private emitDelta(delta: GraphDelta): void {
    const data = dumps(delta);
    this.ring.push([delta.seq!, data]);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    this.fanout(["graph.delta", delta.seq!, data]);
  }

  private fanout(event: ServeEvent): void {
    for (const queue of [...this.subscribers]) queue.push(event);
  }

  // -- replay ------------------------------------------------------------------

  /** Deltas after `lastId`, or null when only a graph.snapshot can resync (spec/60). */
  replayEvents(lastId: number): ServeEvent[] | null {
    if (lastId === this.seq) return [];
    if (lastId > this.seq) return null;
    let expected = lastId + 1;
    const events: ServeEvent[] = [];
    for (const [seq, data] of this.ring) {
      if (seq <= lastId) continue;
      if (seq !== expected) return null;
      events.push(["graph.delta", seq, data]);
      expected += 1;
    }
    if (expected !== this.seq + 1) return null;
    return events;
  }

  // -- lookups -----------------------------------------------------------------

  /** The vector retriever over this bundle's T2 artifacts (query/vectors),
   * shaped for query/router runSearch's semanticFn hook. */
  semanticFn(): SemanticFn {
    const bp = join(this.root, ".brainpick");
    return (query: string, limit: number) => semanticSearch(bp, this.records, query, limit);
  }

  /** The T3 entity-graph retriever (kg.graphSearch) over this bundle's export,
   * shaped for runSearch's graphFn hook — null when T3 is absent OR empty (zero
   * entities walk nowhere; the link-walk degrade answers better than a
   * guaranteed-empty result). */
  graphFn(): GraphFn | null {
    if (this.kg === null || this.kg.entities.size === 0) return null;
    const kg = this.kg;
    const records = this.records;
    return (query: string, limit: number) => graphSearch(kg, records, query, limit);
  }

  recordFor(path: string): DocRecord | null {
    return this.records.find((r) => r.path === path) ?? null;
  }

  /** {"in": [{path,title}], "out": [...]} from the held link graph (spec/50). */
  neighborsOf(path: string): { in: Array<{ path: string; title: string }>; out: Array<{ path: string; title: string }> } {
    const titles = new Map(this.graph.nodes.map((node) => [node.id, node.title]));
    const incoming = [...new Set(this.graph.edges.filter((e) => e.target === path).map((e) => e.source))].sort(cmpStr);
    const outgoing = [...new Set(this.graph.edges.filter((e) => e.source === path).map((e) => e.target))].sort(cmpStr);
    const entry = (p: string) => ({ path: p, title: titles.get(p) ?? p });
    return { in: incoming.map(entry), out: outgoing.map(entry) };
  }
}
