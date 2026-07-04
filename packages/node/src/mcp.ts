/** MCP tools (spec/70): five verbs, small-model ergonomics, budgets, guarded writes.
 *
 * The payload builders are plain functions over ServeState so they unit-test
 * without a transport; createMcpServer() wraps them in an McpServer (official
 * TS SDK) for stdio and /mcp alike. Ports mcp_server.py — plus the spec/70
 * optimistic-concurrency addition: brain_write's base_sha conflict DETECTION
 * (the `merged` proposal is a later chunk, Python-first).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { BEGIN_PREFIX, END_MARKER } from "./compile/t1";
import type { DocRecord, GraphStats } from "./compile/t1";
import { ALWAYS_EXCLUDED_DIRS, posixDirname, posixNormpath } from "./core/bundle";
import { cmpStr, sha256Hex } from "./core/canonical";
import { splitFrontmatter } from "./core/frontmatter";
import { atomicWrite } from "./core/fs";
import { cpLen, PY_SPACE_CLASS, pyFloatRepr, pyRstrip, pySplitLines, pyStrip } from "./core/pyfmt";
import { which } from "./detect";
import { KNOWN_MODES, runSearch } from "./query/router";
import type { SearchHit } from "./query/keyword";
import { bfsNeighborhood, jsonable, resolveDoc, type ServeState } from "./serve/state";
import { recompileAndBroadcast } from "./serve/watcher";
import { VERSION } from "./version";

export const WRITES_OFF_REFUSAL =
  'writes are disabled here — set [serve] writes = "guarded" in brainpick.toml to enable brain_write';

const HEADING = new RegExp(`^(#{1,6}) +([^\\n]+?)[${PY_SPACE_CLASS}]*$`, "u");
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TS_LINE = /^timestamp:[^\n]*$/m;

// -- the budget yardstick ------------------------------------------------------------

/** Python json.dumps(obj, ensure_ascii=False) — default ", " / ": " separators. */
function pyJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isInteger(value) && !Object.is(value, -0) ? String(value) : pyFloatRepr(value);
    case "bigint":
      return value.toString();
    default:
      break;
  }
  if (Array.isArray(value)) return "[" + value.map(pyJson).join(", ") + "]";
  if (typeof value === "object") {
    return (
      "{" +
      Object.entries(value)
        .map(([k, v]) => JSON.stringify(k) + ": " + pyJson(v))
        .join(", ") +
      "}"
    );
  }
  return JSON.stringify(String(value));
}

/** The budget yardstick: JSON characters / 4 (spec/70). */
export function tokensOf(obj: unknown): number {
  return Math.floor(cpLen(pyJson(obj)) / 4);
}

// -- brain_overview ----------------------------------------------------------------

export function overviewPayload(state: ServeState, budgetTokens?: number | null): Record<string, unknown> {
  const budget = budgetTokens || 800;
  const stats = (state.graph.stats ?? {}) as Partial<GraphStats>;
  const counts: Record<string, number> = {};
  for (const key of ["docs", "edges", "tags", "orphans", "ghosts"] as const) counts[key] = stats[key] ?? 0;

  const groups = new Map<string, DocRecord[]>();
  for (const record of state.records) {
    if (record.reserved) continue;
    const dir = posixDirname(record.path);
    let members = groups.get(dir);
    if (!members) groups.set(dir, (members = []));
    members.push(record);
  }
  const tree: Array<{ group: string; docs: Array<{ path: string; title: string; description: string | null }> }> = [];
  const ordered = [...groups.entries()].sort(
    (a, b) => Number(a[0] !== "") - Number(b[0] !== "") || cmpStr(a[0], b[0]),
  );
  for (const [directory, members] of ordered) {
    const docs = [...members]
      .sort((m, n) => cmpStr(String(m.title), String(n.title)) || cmpStr(m.path, n.path))
      .map((m) => ({ path: m.path, title: m.title, description: m.description }));
    tree.push({ group: directory || "concepts", docs });
  }

  const result: Record<string, unknown> = {
    bundle: basename(state.root),
    counts,
    tiers: state.tiers(),
    tree,
    truncated: false,
    hint: "brain_search finds docs by keyword; brain_read opens one by path, stem, or title.",
  };
  while (tokensOf(result) > budget && tree.some((group) => group.docs.length > 0)) {
    for (let i = tree.length - 1; i >= 0; i--) {
      if (tree[i]!.docs.length > 0) {
        tree[i]!.docs.pop();
        break;
      }
    }
    result["truncated"] = true;
  }
  if (result["truncated"]) {
    result["tree"] = tree.filter((group) => group.docs.length > 0);
    result["hint"] = "tree trimmed to fit budget_tokens — raise it for the full listing.";
  }
  return result;
}

// -- brain_search ------------------------------------------------------------------

function why(hit: SearchHit, query: string): string {
  const lowered = query.toLowerCase();
  if (String(hit.title).toLowerCase().includes(lowered)) return `title matches '${query}'`;
  if (hit.description && hit.description.toLowerCase().includes(lowered)) {
    return `description mentions '${query}'`;
  }
  if (hit.source === "semantic") return `semantically close to '${query}'`;
  if (hit.source === "graph") return `connected in the entity graph to '${query}'`;
  return hit.snippet ? `body mentions '${query}'` : "keyword match";
}

export async function searchPayload(
  state: ServeState,
  query: string,
  mode: unknown = "auto",
  limit: unknown = 8,
  budgetTokens?: number | null,
): Promise<Record<string, unknown>> {
  const budget = budgetTokens || 1200;
  let requested = String(mode || "auto");
  let note: string | null = null;
  if (!(KNOWN_MODES as readonly string[]).includes(requested)) {
    note = `unknown mode '${requested}' fell back to auto. `;
    requested = "auto";
  }
  let boundedLimit: number;
  if (typeof limit === "number" && Number.isFinite(limit)) {
    boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
  } else if (typeof limit === "string" && /^[+-]?\d+$/.test(limit.trim())) {
    boundedLimit = Math.max(1, Math.min(parseInt(limit.trim(), 10), 50));
  } else {
    boundedLimit = 8;
  }

  const body = await runSearch(
    state.records,
    state.tiers(),
    String(query || ""),
    requested,
    boundedLimit,
    state.semanticFn(),
    state.graphFn(),
    state.graph,
  );
  const raw = body.hits;
  const hits = raw.map((h) => ({
    path: h.path,
    title: h.title,
    description: h.description,
    score: h.score,
    why: why(h, query),
  }));
  const result: Record<string, unknown> = {
    hits,
    used_modes: body.used_modes,
    degraded_from: body.degraded_from,
    truncated: false,
    hint: "",
  };
  while (tokensOf(result) > budget && hits.length > 1) {
    hits.pop();
    result["truncated"] = true;
  }
  let hint: string;
  if (result["truncated"]) {
    hint = `${raw.length - hits.length} hits trimmed — raise budget_tokens or sharpen the query.`;
  } else if (hits.length > 0) {
    hint = `brain_read '${hits[0]!.path}' opens the best hit.`;
  } else {
    hint = "no hits — brain_overview lists every doc in the brain.";
  }
  result["hint"] = (note ?? "") + hint;
  return result;
}

// -- brain_read --------------------------------------------------------------------

function loadDoc(state: ServeState, record: DocRecord): [Record<string, unknown>, string] {
  const path = join(state.root, record.path);
  let isFile = false;
  try {
    isFile = statSync(path).isFile();
  } catch {
    isFile = false;
  }
  if (isFile) return splitFrontmatter(readFileSync(path, "utf8"));
  const meta: Record<string, unknown> = {};
  for (const key of ["type", "title", "description", "tags", "timestamp"] as const) {
    const value = record[key];
    if (value && !(Array.isArray(value) && value.length === 0)) meta[key] = value;
  }
  return [meta, record.text];
}

function extractSections(body: string, wanted: readonly unknown[]): string {
  const wantedL = new Set(wanted.map((w) => pyStrip(pyStrip(String(w)).replace(/^#+/, "")).toLowerCase()));
  const kept: string[] = [];
  let keep = false;
  let level = 0;
  for (const line of pySplitLines(body)) {
    const match = HEADING.exec(line);
    if (match) {
      if (wantedL.has(pyStrip(match[2]!).toLowerCase())) {
        keep = true;
        level = match[1]!.length;
      } else if (keep && match[1]!.length <= level) {
        keep = false;
      }
    }
    if (keep) kept.push(line);
  }
  return pyStrip(kept.join("\n")) + (kept.length > 0 ? "\n" : "");
}

/** Python `content[:allowed].rsplit(" ", 1)[0]` over code points. */
function headToLastSpace(content: string, allowed: number): string {
  const arr = [...content];
  const head = arr.length <= allowed ? content : arr.slice(0, allowed).join("");
  const cut = head.lastIndexOf(" ");
  return cut === -1 ? head : head.slice(0, cut);
}

export function readPayload(
  state: ServeState,
  doc: string,
  sections?: readonly string[] | null,
  budgetTokens?: number | null,
): Record<string, unknown> {
  const budget = budgetTokens || 2000;
  const [outcome, payload] = resolveDoc(state.records, doc);
  if (outcome === "ambiguous") {
    return {
      disambiguation: (payload as DocRecord[]).map((r) => ({ path: r.path, title: r.title })),
      hint: "several docs match — call brain_read again with one exact path.",
    };
  }
  if (outcome === "miss") {
    return {
      error: `nothing in the brain matches '${doc}'`,
      suggestions: payload,
      hint: "try brain_search, or brain_overview for the full tree.",
    };
  }

  const record = payload as DocRecord;
  const [frontmatter, body] = loadDoc(state, record);
  const outline = pySplitLines(body)
    .filter((line) => HEADING.test(line))
    .map((line) => pyRstrip(line));
  const content = sections && sections.length > 0 ? extractSections(body, sections) : body;
  const result: Record<string, unknown> = {
    path: record.path,
    frontmatter: jsonable(frontmatter),
    outline,
    content,
    neighbors: state.neighborsOf(record.path),
    truncated: false,
    hint: `brain_neighbors '${record.path}' walks the links around this doc.`,
  };
  if (tokensOf(result) > budget) {
    const overhead = tokensOf({ ...result, content: "" });
    const allowed = Math.max(160, (budget - overhead) * 4);
    if (cpLen(content) > allowed) {
      result["content"] = headToLastSpace(content, allowed) + " …";
      result["truncated"] = true;
      result["hint"] = "over budget_tokens — request sections=[…] from the outline for the rest.";
    }
  }
  return result;
}

// -- brain_neighbors ---------------------------------------------------------------

/** The T1 link layer: nearby docs {path,title,description,distance} + edges. */
function linkNeighbors(
  state: ServeState,
  center: string,
  depth: number,
): [Array<Record<string, unknown>>, Array<Record<string, unknown>>] {
  const [distance, rawEdges] = bfsNeighborhood(state.graph, center, depth);
  const info = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const nodes = [...distance.entries()]
    .sort((a, b) => a[1] - b[1] || cmpStr(a[0], b[0]))
    .map(([path, hops]) => ({
      path,
      title: info.get(path)!.title,
      description: info.get(path)!.description,
      distance: hops,
    }));
  const edges = rawEdges.map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
  return [nodes, edges];
}

/** Link nodes key on path, entity nodes on id (spec/40 overlay). */
function nodeKey(node: Record<string, unknown>): string {
  return (node["path"] ?? node["id"]) as string;
}

export function neighborsPayload(
  state: ServeState,
  doc: string,
  depth: unknown = 1,
  layer: unknown = "links",
  budgetTokens?: number | null,
): Record<string, unknown> {
  const budget = budgetTokens || 800;
  const [outcome, payload] = resolveDoc(state.records, doc);
  if (outcome === "ambiguous") {
    return {
      disambiguation: (payload as DocRecord[]).map((r) => ({ path: r.path, title: r.title })),
      hint: "several docs match — call brain_neighbors again with one exact path.",
    };
  }
  if (outcome === "miss") {
    return {
      error: `nothing in the brain matches '${doc}'`,
      suggestions: payload,
      hint: "try brain_search first.",
    };
  }
  const center = (payload as DocRecord).path;

  let boundedDepth: number;
  if (typeof depth === "number" && Number.isFinite(depth)) {
    boundedDepth = Math.max(1, Math.min(Math.trunc(depth), 3));
  } else if (typeof depth === "string" && /^[+-]?\d+$/.test(depth.trim())) {
    boundedDepth = Math.max(1, Math.min(parseInt(depth.trim(), 10), 3));
  } else {
    boundedDepth = 1;
  }
  let layerName = String(layer || "links");
  if (layerName !== "links" && layerName !== "entities" && layerName !== "both") layerName = "links";
  let wantEntities = layerName === "entities" || layerName === "both";
  let wantLinks = layerName === "links" || layerName === "both";
  let tagged = layerName === "both";

  let note: string | null = null;
  let degradedFrom: string | null = null;
  if (wantEntities && state.kg === null) {
    // T3 absent: degrade to links, said out loud (spec/70 keeps this behavior)
    degradedFrom = "entities";
    note = "the entities layer needs a T3 export — served links instead. ";
    wantLinks = true;
    wantEntities = false;
    tagged = false;
  }

  const nodes: Array<Record<string, unknown>> = [];
  let edges: Array<Record<string, unknown>> = [];
  if (wantLinks) {
    const [linkNodes, linkEdges] = linkNeighbors(state, center, boundedDepth);
    for (const node of linkNodes) nodes.push(tagged ? { ...node, layer: "links" } : node);
    for (const edge of linkEdges) edges.push(tagged ? { ...edge, layer: "links" } : edge);
  }
  if (wantEntities) {
    const [entityNodes, entityEdges] = state.kg!.neighborEntities(center, boundedDepth);
    for (const node of entityNodes) {
      nodes.push(tagged ? { ...node, layer: "entities" } : { ...node });
    }
    for (const edge of entityEdges) edges.push(tagged ? { ...edge, layer: "entities" } : { ...edge });
  }

  const result: Record<string, unknown> = {
    center,
    nodes,
    edges,
    degraded_from: degradedFrom,
    truncated: false,
    hint: "",
  };
  while (tokensOf(result) > budget && nodes.length > 1) {
    const dropped = nodeKey(nodes.pop()!); // farthest first — nodes are distance-sorted
    edges = edges.filter(
      (e) => ![e["source"], e["target"], e["src"], e["dst"]].includes(dropped),
    );
    result["edges"] = edges;
    result["truncated"] = true;
  }
  let hint: string;
  if (result["truncated"]) {
    hint = "trimmed to fit budget_tokens — raise it or lower depth.";
  } else if (wantEntities && nodes.length === 0) {
    hint = `no entities ground '${center}' — brain_read '${center}' for the doc itself.`;
  } else {
    hint = `brain_read '${center}' for the doc itself.`;
  }
  result["hint"] = (note ?? "") + hint;
  return result;
}

// -- brain_write -------------------------------------------------------------------

export function slugifyDocPath(doc: string): string {
  let base = pyStrip(String(doc)).toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");
  if (base.endsWith(".md")) base = base.slice(0, -3);
  const parts: string[] = [];
  for (const part of base.split("/")) {
    if (part === "" || part === "." || part === "..") continue;
    const slug = part
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) parts.push(slug);
  }
  return parts.length > 0 ? parts.join("/") + ".md" : "untitled.md";
}

/** (bundle-relative path, null) or (null, instruction) — traversal never escapes. */
export function resolveWritePath(state: ServeState, doc: unknown): [string | null, string | null] {
  const raw = pyStrip(String(doc ?? ""));
  if (!raw) return [null, "give doc a bundle-relative kebab-case path like 'kuun-vaiheet.md'"];
  if (raw.includes("\\")) return [null, `use forward slashes — try '${slugifyDocPath(raw)}'`];
  let rel = raw.replace(/^\/+/, "");
  if (!rel.endsWith(".md")) rel += ".md";
  rel = posixNormpath(rel);
  const parts = rel.split("/");
  if (rel.startsWith("/") || parts.includes("..") || rel === ".") {
    return [null, `'${doc}' escapes the bundle — paths stay inside the bundle root`];
  }
  const rootResolved = resolve(state.root);
  const targetResolved = resolve(state.root, rel);
  if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + sep)) {
    return [null, `'${doc}' escapes the bundle — paths stay inside the bundle root`];
  }
  if (ALWAYS_EXCLUDED_DIRS.has(parts[0]!)) {
    return [null, `'${parts[0]}/' belongs to the machinery — write concept docs elsewhere`];
  }
  const bad = parts.slice(0, -1).filter((p) => !KEBAB.test(p));
  if (!KEBAB.test(parts[parts.length - 1]!.slice(0, -3))) bad.push(parts[parts.length - 1]!);
  if (bad.length > 0) return [null, `'${doc}' is not kebab-case — try '${slugifyDocPath(String(doc))}'`];
  return [rel, null];
}

/** (violation instruction, warning) — respecting [validate] henxels = auto|always|never. */
function runHenxels(state: ServeState, rel: string): [string | null, string | null] {
  const mode = state.config.validate.henxels;
  if (mode === "never") return [null, null];
  const root = state.root;
  let hasContract = false;
  try {
    hasContract = statSync(join(root, "henxels.yaml")).isFile();
  } catch {
    hasContract = false;
  }
  if (!hasContract) {
    try {
      statSync(join(root, ".henxels"));
      hasContract = true;
    } catch {
      hasContract = false;
    }
  }
  if (mode !== "always" && !hasContract) return [null, null];
  const executable = which("henxels");
  if (executable === null) {
    if (mode === "always") {
      return ['[validate] henxels = "always" but the henxels CLI is not installed', null];
    }
    return [null, "henxels not installed — write accepted without contract validation"];
  }
  const proc = spawnSync(executable, ["check", rel], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (proc.error) {
    if ((proc.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      return ["henxels check timed out after 60s — the write was rolled back", null];
    }
    return [`henxels check failed (${proc.error.message})`, null];
  }
  if (proc.status !== 0) {
    const output = pyStrip((proc.stdout ?? "") + (proc.stderr ?? ""));
    return [output || `henxels check failed with exit ${proc.status}`, null];
  }
  return [null, null];
}

/** Refresh (or insert) the frontmatter timestamp without reformatting anything else. */
export function bumpTimestamp(text: string, now: string): string {
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 3);
    if (end !== -1) {
      let frontmatter = text.slice(4, end);
      if (TS_LINE.test(frontmatter)) frontmatter = frontmatter.replace(TS_LINE, `timestamp: ${now}`);
      else frontmatter = frontmatter + `\ntimestamp: ${now}`;
      return "---\n" + frontmatter + "\n---\n" + text.slice(end + 5);
    }
  }
  return `---\ntimestamp: ${now}\n---\n\n` + text;
}

function utcNowSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Shape the conflict's `theirs` to the budget, brain_read style. */
function shapeTheirs(result: Record<string, unknown>, theirs: string, budget: number): void {
  result["theirs"] = theirs;
  if (tokensOf(result) > budget) {
    const overhead = tokensOf({ ...result, theirs: "" });
    const allowed = Math.max(160, (budget - overhead) * 4);
    if (cpLen(theirs) > allowed) result["theirs"] = headToLastSpace(theirs, allowed) + " …";
  }
}

export interface WritePayloadOptions {
  baseSha?: string | null;
  budgetTokens?: number | null;
  refusal?: string | null;
}

export async function writePayload(
  state: ServeState,
  doc: string,
  content: string,
  mode: unknown = "create",
  options: WritePayloadOptions = {},
): Promise<Record<string, unknown>> {
  const { baseSha = null, budgetTokens = null, refusal = null } = options;
  if (refusal) return { ok: false, instruction: refusal };
  let writeMode = String(mode ?? "create");
  if (!["create", "replace", "append_section"].includes(writeMode)) {
    writeMode = "create"; // forgiving enums (spec/70)
  }

  const [rel, problem] = resolveWritePath(state, doc);
  if (problem !== null) return { ok: false, instruction: problem };
  const target = join(state.root, rel!);
  let previous: Buffer | null = null;
  try {
    if (statSync(target).isFile()) previous = readFileSync(target);
  } catch {
    previous = null;
  }

  // spec/70 optimistic concurrency: the DETECTION half — never write over a
  // doc the writer has not seen. (`merged` proposals land in a later chunk.)
  const base = typeof baseSha === "string" ? baseSha.trim().toLowerCase() : "";
  if (base !== "") {
    const currentSha = previous === null ? null : sha256Hex(previous);
    if (currentSha !== base) {
      const result: Record<string, unknown> = {
        ok: false,
        conflict: true,
        current_sha: currentSha,
        theirs: null,
        instruction: "the doc changed since you read it — re-read, reconcile, retry with the new base_sha",
      };
      if (previous !== null) shapeTheirs(result, previous.toString("utf8"), budgetTokens || 2000);
      return result;
    }
  }

  if (writeMode === "create" && previous !== null) {
    return { ok: false, instruction: `'${rel}' already exists — use mode 'replace' or 'append_section'` };
  }

  let text = content.endsWith("\n") ? content : content + "\n";
  if (writeMode === "append_section" && previous !== null) {
    text = previous.toString("utf8").replace(/\n+$/, "") + "\n\n" + text;
  }
  atomicWrite(target, Buffer.from(text, "utf8"));

  const [violation, warning] = runHenxels(state, rel!);
  if (violation !== null) {
    if (previous === null) {
      try {
        unlinkSync(target);
      } catch {
        /* already gone */
      }
    } else {
      atomicWrite(target, previous);
    }
    return { ok: false, instruction: violation };
  }

  const now = utcNowSeconds();
  const stamped = bumpTimestamp(readFileSync(target, "utf8"), now);
  atomicWrite(target, Buffer.from(stamped, "utf8"));

  const result = await recompileAndBroadcast(state);
  const out: Record<string, unknown> = {
    ok: true,
    path: rel,
    seq: result.seq,
    hint: `brain_read '${rel}' to verify — connected UIs already got the delta.`,
  };
  if (warning !== null) out["warning"] = warning;
  return out;
}

// -- the McpServer wrapper -------------------------------------------------------------

function textResult(payload: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

/** One McpServer over a shared ServeState. Stdio holds a single instance;
 * the streamable-HTTP mount calls this factory per request (stateless). */
export function createMcpServer(state: ServeState, writeRefusal: string | null = null): McpServer {
  const server = new McpServer(
    { name: "brainpick", version: VERSION },
    {
      instructions:
        "A compiled knowledge bundle (an agent's brain). Start with brain_overview, " +
        "find docs with brain_search, open them with brain_read, walk links with " +
        "brain_neighbors, and add knowledge with brain_write.",
    },
  );

  const budgetTokens = z.number().int().optional();

  server.registerTool(
    "brain_overview",
    {
      description:
        "One screen of the whole brain: doc/edge counts, tier status, and every doc " +
        "grouped by folder with its one-line description. Call this first to orient.",
      inputSchema: { budget_tokens: budgetTokens },
    },
    async ({ budget_tokens }) => textResult(overviewPayload(state, budget_tokens ?? null)),
  );

  server.registerTool(
    "brain_search",
    {
      description:
        "Find docs by keyword. Returns paths, titles, and descriptions — never full " +
        "bodies. Follow up with brain_read on the best hit's path.",
      inputSchema: {
        query: z.string(),
        mode: z.string().optional(),
        limit: z.number().int().optional(),
        budget_tokens: budgetTokens,
      },
    },
    async ({ query, mode, limit, budget_tokens }) =>
      textResult(await searchPayload(state, query, mode ?? "auto", limit ?? 8, budget_tokens ?? null)),
  );

  server.registerTool(
    "brain_read",
    {
      description:
        "Read one doc: frontmatter, outline, content, and linked neighbors. doc can be " +
        "a path (kuu.md), a bare stem (kuu), or an approximate title. Pass sections=[...] " +
        "with names from the outline to read only those parts.",
      inputSchema: {
        doc: z.string(),
        sections: z.array(z.string()).optional(),
        budget_tokens: budgetTokens,
      },
    },
    async ({ doc, sections, budget_tokens }) =>
      textResult(readPayload(state, doc, sections ?? null, budget_tokens ?? null)),
  );

  server.registerTool(
    "brain_neighbors",
    {
      description:
        "Walk the link graph around one doc, up to depth 3. Returns nearby docs with " +
        "their distance and the connecting edges.",
      inputSchema: {
        doc: z.string(),
        depth: z.number().int().optional(),
        layer: z.string().optional(),
        budget_tokens: budgetTokens,
      },
    },
    async ({ doc, depth, layer, budget_tokens }) =>
      textResult(neighborsPayload(state, doc, depth ?? 1, layer ?? "links", budget_tokens ?? null)),
  );

  server.registerTool(
    "brain_write",
    {
      description:
        "Write a markdown doc into the bundle, guarded by its henxels contract. mode is " +
        "create (default, never overwrites), replace, or append_section. Pass base_sha " +
        "(the sha256 of the doc you last read) to be told about concurrent edits instead " +
        "of overwriting them. On a contract violation nothing changes and instruction " +
        "says exactly what to fix.",
      inputSchema: {
        doc: z.string(),
        content: z.string(),
        mode: z.string().optional(),
        base_sha: z.string().optional(),
        budget_tokens: budgetTokens,
      },
    },
    async ({ doc, content, mode, base_sha, budget_tokens }) =>
      textResult(
        await writePayload(state, doc, content, mode ?? "create", {
          baseSha: base_sha ?? null,
          budgetTokens: budget_tokens ?? null,
          refusal: writeRefusal,
        }),
      ),
  );

  server.registerResource(
    "brain-index",
    "brain://index",
    { description: "The generated index block — the bundle's table of contents." },
    async (uri) => {
      const path = join(state.root, "index.md");
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return { contents: [{ uri: uri.href, text: "" }] };
      }
      const begin = text.indexOf(BEGIN_PREFIX);
      if (begin !== -1) {
        const end = text.indexOf(END_MARKER, begin);
        if (end !== -1) text = text.slice(begin, end + END_MARKER.length);
      }
      return { contents: [{ uri: uri.href, text }] };
    },
  );

  server.registerResource(
    "brain-doc",
    // single-segment {path} — parity with the Python engine's parked
    // {+path} limitation (nested docs read via the brain_read tool)
    new ResourceTemplate("brain://doc/{path}", { list: undefined }),
    { description: "Raw document content by bundle-relative path." },
    async (uri, variables) => {
      const path = String(variables["path"] ?? "");
      const record = state.recordFor(path);
      if (record === null) throw new Error(`no doc at '${path}'`);
      const filePath = join(state.root, path);
      let text: string;
      try {
        text = readFileSync(filePath, "utf8");
      } catch {
        text = record.text;
      }
      return { contents: [{ uri: uri.href, text }] };
    },
  );

  return server;
}
