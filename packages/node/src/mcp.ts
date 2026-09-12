/** MCP tools (spec/70): five verbs, small-model ergonomics, budgets, guarded writes.
 *
 * The payload builders are plain functions over ServeState so they unit-test
 * without a transport; createMcpServer() wraps them in an McpServer (official
 * TS SDK) for stdio and /mcp alike. Ports mcp_server.py — including the spec/70
 * base_sha optimistic concurrency and the stale-write merge ladder (a `merged`
 * three-way / LLM proposal on the 409, at parity with the Python engine).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { BEGIN_PREFIX, END_MARKER, topGhosts } from "./compile/t1";
import type { DocRecord, GraphStats } from "./compile/t1";
import { ALWAYS_EXCLUDED_DIRS, posixDirname, posixNormpath } from "./core/bundle";
import { cmpStr, sha256Hex } from "./core/canonical";
import { splitFrontmatter } from "./core/frontmatter";
import { BrainSet, isCortex, parseScope, qualify, qualifyPaths, relativeRoot, splitQualified } from "./federation";
import type { Brain } from "./federation";
import { atomicWrite } from "./core/fs";
import { cpLen, PY_SPACE_CLASS, pyFloatRepr, pyRstrip, pySplitLines, pyStrip } from "./core/pyfmt";
import { detectHenxels, findHenxels, needsShellForScript } from "./detect";
import { makeChat } from "./llm";
import { findBase, resolve as resolveMerge } from "./merge";
import { KNOWN_MODES, runSearch } from "./query/router";
import type { SearchHit } from "./query/keyword";
import { bfsNeighborhood, jsonable, resolveDoc, type ServeState } from "./serve/state";
import { recompileAndBroadcast } from "./serve/watcher";
import { connectableHost, postShow } from "./show-client";
import { VERSION } from "./version";

export const WRITES_OFF_REFUSAL =
  'writes are disabled here — set [serve] writes = "guarded" in brainpick.toml to enable brain_write';
export const CONFLICT_INSTRUCTION =
  "the doc changed since you read it — re-read, reconcile, retry with the new base_sha";

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

/** spec/45 — always present, 0 when off/absent, never budget-trimmed (same
 * posture as top_ghosts). */
function similarityGapsOpenCount(root: string): number {
  let data: { pairs?: Array<{ status?: string }> };
  try {
    data = JSON.parse(readFileSync(join(root, ".brainpick", "t1", "similarity-gaps.json"), "utf8"));
  } catch {
    return 0;
  }
  return (data.pairs ?? []).filter((p) => p.status === "open").length;
}

function singleOverview(state: ServeState, budgetTokens?: number | null): Record<string, unknown> {
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

  // skills first (spec/85): the procedures the brain already holds, listed apart
  // from the folder tree so an agent sees them before it improvises one
  const skills = state.skills.map((s) => ({
    path: s.path,
    title: s.title,
    description: s.description,
    depends_on: [...s.depends_on],
    tools: [...s.tools],
  }));
  let hint = "brain_search finds docs by keyword; brain_read opens one by path, stem, or title.";
  if (skills.length) {
    hint =
      `${skills.length} skills — read the matching one before improvising a procedure; ` +
      "brain_read on a skill lists its prerequisites and tools. " +
      hint;
  }
  const result: Record<string, unknown> = {
    bundle: basename(state.root),
    counts,
    tiers: state.tiers(),
    skills,
    tree,
    top_ghosts: topGhosts(state.graph),
    similarity_gaps_open_count: similarityGapsOpenCount(state.root),
    truncated: false,
    hint,
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

async function singleSearch(
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

function singleRead(
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
  const skill = state.skillFor(record.path);
  if (skill !== null) {
    // spec/70: prerequisites first, tools are the agent's to run
    result["skill"] = skill;
    const parts: string[] = [];
    if (skill.depends_on.length) parts.push("read depends_on first: " + skill.depends_on.map((d) => d.path).join(", "));
    if (skill.tools.length) {
      parts.push(
        "tools: " + skill.tools.map((t) => t.path).join(", ") + " — run them yourself; brainpick never executes a tool",
      );
    }
    if (parts.length) result["hint"] = parts.join("; ") + ".";
  }
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

function singleNeighbors(
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
  // The contract may sit at the bundle root OR at the repo root above it
  // (the brain-template layout: henxels.yaml beside _brain/). Run the check
  // from the contract's own directory so henxels resolves the same rules
  // the pre-commit hook would.
  const contract = detectHenxels(root);
  let hasContract = contract !== null;
  if (!hasContract) {
    try {
      statSync(join(root, ".henxels"));
      hasContract = true;
    } catch {
      hasContract = false;
    }
  }
  if (mode !== "always" && !hasContract) return [null, null];
  const executable = findHenxels();
  if (executable === null) {
    if (mode === "always") {
      return ['[validate] henxels = "always" but the henxels CLI is not installed', null];
    }
    return [null, "henxels not installed — write accepted without contract validation"];
  }
  const cwd = contract !== null ? dirname(contract) : root;
  const target = relative(cwd, join(root, rel));
  const proc = spawnSync(executable, ["check", target], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    // .bat/.cmd henxels shims (and the win32 test fixture) hit Node's
    // CVE-2024-27980 EINVAL guard without a shell; argv here is fixed.
    shell: needsShellForScript(executable),
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

/** The spec/70 conflict shape — nothing was written. `merged`, when the
 * resolution ladder produced one, is a PROPOSAL and is never auto-applied.
 * Port of mcp_server.conflict_payload; key order matches so tokensOf agrees. */
export async function conflictPayload(
  state: ServeState,
  rel: string,
  previous: Buffer,
  yours: string,
  baseSha: string,
  budgetTokens: number | null,
): Promise<Record<string, unknown>> {
  const budget = budgetTokens || 2000;
  const theirs = previous.toString("utf8");
  const currentSha = sha256Hex(previous);
  const result: Record<string, unknown> = {
    ok: false,
    conflict: true,
    current_sha: currentSha,
    theirs,
    truncated: false,
    instruction: CONFLICT_INSTRUCTION,
    hint: `reconcile against theirs, then brain_write again with base_sha '${currentSha}'.`,
  };
  const proposal = await resolveMerge(
    findBase(state.root, rel, baseSha),
    theirs,
    yours,
    makeChat(state.config.models.extraction),
  );
  if (proposal !== null) {
    result["merged"] = proposal;
    result["hint"] =
      `merged is a ${proposal.strategy} proposal, NOT applied — review it, ` +
      `then brain_write it with base_sha '${currentSha}'.`;
  }
  // Only theirs is budget-shaped; a trimmed merged proposal would be a corrupted write-back.
  if (tokensOf(result) > budget) {
    const overhead = tokensOf({ ...result, theirs: "" });
    const allowed = Math.max(160, (budget - overhead) * 4);
    if (cpLen(theirs) > allowed) {
      result["theirs"] = headToLastSpace(theirs, allowed) + " …";
      result["truncated"] = true;
    }
  }
  return result;
}

export interface WritePayloadOptions {
  baseSha?: string | null;
  budgetTokens?: number | null;
  refusal?: string | null;
}

export type WriteStatus = "ok" | "badpath" | "conflict" | "violation" | "exists";

/** The one guarded write path (spec/70): resolve → atomic write → henxels referee
 * → rollback-or-recompile → live delta, plus base_sha optimistic concurrency.
 * Returns [status, payload]:
 *
 *   "ok"        → {path, seq, sha, warning?}  (sha = new content sha256)
 *   "badpath"   → {instruction}               (traversal / non-kebab / reserved)
 *   "conflict"  → the spec/70 conflict dict (ok/conflict/current_sha/theirs/…)
 *   "violation" → {instruction}               (henxels rejected it; rolled back)
 *   "exists"    → {instruction}               (create mode, target present)
 *
 * Both brain_write (MCP, via writePayload) and PUT /api/docs (REST) call this —
 * one source of truth, mapped onto each surface's shape. On a stale base_sha the
 * conflict carries a `merged` proposal (three-way / LLM) when the ladder resolves
 * one — the same shape the Python engine returns. */
export async function guardedWrite(
  state: ServeState,
  doc: string,
  content: string,
  mode: unknown = "create",
  baseSha: string | null = null,
  budgetTokens: number | null = null,
): Promise<[WriteStatus, Record<string, unknown>]> {
  let writeMode = String(mode ?? "create");
  if (!["create", "replace", "append_section"].includes(writeMode)) {
    writeMode = "create"; // forgiving enums (spec/70)
  }

  const [rel, problem] = resolveWritePath(state, doc);
  if (problem !== null) return ["badpath", { instruction: problem }];
  const target = join(state.root, rel!);
  let previous: Buffer | null = null;
  try {
    if (statSync(target).isFile()) previous = readFileSync(target);
  } catch {
    previous = null;
  }

  let text = content.endsWith("\n") ? content : content + "\n";

  // spec/70 optimistic concurrency + the merge ladder. A mismatched base_sha
  // means the writer's knowledge is stale — the server MUST NOT write; it returns
  // the conflict plus, when the ladder resolves one, a merged PROPOSAL (never
  // auto-applied). An omitted base_sha keeps today's last-write-wins.
  const base = typeof baseSha === "string" ? baseSha.trim().toLowerCase() : "";
  if (base !== "") {
    if (previous === null) {
      // deleted-since-read (spec/70 edge semantics: current_sha and theirs are null)
      return [
        "conflict",
        { ok: false, conflict: true, current_sha: null, theirs: null, instruction: CONFLICT_INSTRUCTION },
      ];
    }
    if (sha256Hex(previous) !== base) {
      return ["conflict", await conflictPayload(state, rel!, previous, text, base, budgetTokens)];
    }
  }

  if (writeMode === "create" && previous !== null) {
    return ["exists", { instruction: `'${rel}' already exists — use mode 'replace' or 'append_section'` }];
  }

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
    return ["violation", { instruction: violation }];
  }

  const now = utcNowSeconds();
  const stamped = bumpTimestamp(readFileSync(target, "utf8"), now);
  const stampedBytes = Buffer.from(stamped, "utf8");
  atomicWrite(target, stampedBytes);

  const result = await recompileAndBroadcast(state);
  const payload: Record<string, unknown> = { path: rel, seq: result.seq, sha: sha256Hex(stampedBytes) };
  if (warning !== null) payload["warning"] = warning;
  return ["ok", payload];
}

async function singleWrite(
  state: ServeState,
  doc: string,
  content: string,
  mode: unknown = "create",
  options: WritePayloadOptions = {},
): Promise<Record<string, unknown>> {
  const { baseSha = null, budgetTokens = null, refusal = null } = options;
  if (refusal) return { ok: false, instruction: refusal };
  const [status, payload] = await guardedWrite(state, doc, content, mode, baseSha, budgetTokens);
  if (status === "ok") {
    const out: Record<string, unknown> = {
      ok: true,
      path: payload["path"],
      seq: payload["seq"],
      hint: `brain_read '${payload["path"]}' to verify — connected UIs already got the delta.`,
    };
    if ("warning" in payload) out["warning"] = payload["warning"];
    return out;
  }
  if (status === "conflict") return payload;
  return { ok: false, instruction: payload["instruction"] };
}

// -- brain_show ----------------------------------------------------------------------

export const NO_SERVER_CAVEAT =
  " No brainpick serve is running for this bundle, so nothing is actually " +
  "visible yet — start one with `brainpick serve --root <bundle>`.";

/** The 'what to do next' line for brain_show (spec/95 small-LLM ergonomics).
 * `serverReachable` is false only for the local-fallback path (no running
 * `brainpick serve` answered) — the one case where "live in every open UI"
 * would otherwise be a flat lie, so it earns an honest caveat. */
export function showHint(
  shown: number,
  dropped: string[],
  cleared: boolean,
  serverReachable = true,
): string {
  let base: string;
  if (cleared) {
    base = "cleared — every open UI dropped its spotlight and caption.";
  } else if (shown === 0 && dropped.length > 0) {
    base =
      "nothing resolved — no name matched a doc or entity; " +
      "check them with brain_search, then brain_show again.";
  } else {
    base =
      `showing ${shown} node(s) live in every open UI — ` +
      "call brain_show again to change it, or with clear:true to dismiss.";
    if (dropped.length > 0) base += ` (dropped ${dropped.length}: ${dropped.join(", ")})`;
  }
  if (!serverReachable) base += NO_SERVER_CAVEAT;
  return base;
}

/** Try to hand this presentation to an already-running `brainpick serve` for the
 * same bundle root, the same way `brainpick show` (the CLI) already does — it
 * broadcasts to a REAL UI, unlike the stdio MCP process's own private,
 * unattached ServeState. Returns the server's result (with our hint attached),
 * an error object if a server answered but rejected the request, or null if no
 * server answered at all — the caller's cue to fall back to the local, UI-less
 * presentation (spec/95 follow-up, mirrors the Python engine). */
async function proxyShow(
  state: ServeState,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const baseUrl = `http://${connectableHost(state.config.serve.host)}:${state.config.serve.port}`;
  const token = state.config.serve.token || null;
  const { result, error, unreachable } = await postShow(baseUrl, body, token);
  if (result !== undefined) {
    const shown = (result["shown"] as number) ?? 0;
    const dropped = (result["dropped"] as string[]) ?? [];
    result["hint"] = showHint(shown, dropped, Boolean(body["clear"]));
    return result;
  }
  if (unreachable) return null;
  return {
    ok: false,
    dropped: [],
    error,
    hint: "a brainpick serve is running but rejected the presentation — fix the error above, then try again.",
  };
}

/** brain_show's MCP result (spec/95): proxy to a running `brainpick serve` when
 * one answers (it does the real resolving + broadcasting); otherwise fall back
 * to resolving + broadcasting on this process's own orphaned state, honestly
 * caveated since nothing is actually watching it. Never writes — not behind
 * [serve] writes, only the normal auth. Forgiving: unresolved nodes are
 * dropped, listed. */
async function singleShow(
  state: ServeState,
  nodes?: string[] | null,
  focus?: string | null,
  mode?: string | null,
  annotation?: string | null,
  clear = false,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (nodes != null) body["nodes"] = nodes;
  if (focus != null) body["focus"] = focus;
  if (mode != null) body["mode"] = mode;
  if (annotation != null) body["annotation"] = annotation;
  if (clear) body["clear"] = true;
  const proxied = await proxyShow(state, body);
  if (proxied !== null) return proxied;

  const [presentation, dropped] = state.present(
    nodes ?? null,
    focus ?? null,
    mode ?? null,
    annotation ?? null,
    clear,
  );
  const presentedNodes = presentation["nodes"] as string[];
  const cleared =
    presentedNodes.length === 0 &&
    presentation["focus"] === null &&
    presentation["mode"] === null &&
    presentation["annotation"] === null;
  return {
    ok: true,
    shown: presentedNodes.length,
    dropped,
    seq: presentation["seq"],
    hint: showHint(presentedNodes.length, dropped, cleared, false),
  };
}

// -- federation (spec/75): route, fan out, merge, qualify ------------------------------
//
// Every public payload builder takes a ServeState (one brain — the pre-federation
// shapes, byte-for-byte, synchronously) OR a BrainSet (a promise: brains load
// lazily). A single-brain set behaves as its state, except that qualified
// `alias:path` docs are still accepted; a federated set fans out / routes and
// qualifies every path it returns.

type Payload = Record<string, unknown>;

function stripAlias(set: BrainSet, doc: string): string {
  const [alias, rel] = splitQualified(doc);
  return alias !== null && set.byAlias(alias) !== null ? rel : doc;
}

function brainsListing(set: BrainSet): Payload[] {
  return set.brains.map((brain) => {
    const manifest = set.manifestOf(brain);
    return {
      alias: brain.alias,
      role: brain.role,
      here: brain.here,
      root: relativeRoot(brain.root),
      docs: Object.keys((manifest["files"] ?? {}) as Record<string, unknown>).length, // = counts.docs
      tiers: manifest["tiers"] ?? {},
    };
  });
}

function aliasList(set: BrainSet): string {
  return set.brains.map((b) => b.alias).join(", ");
}

export function overviewPayload(state: ServeState, budgetTokens?: number | null, scope?: string | null): Payload;
export function overviewPayload(set: BrainSet, budgetTokens?: number | null, scope?: string | null): Promise<Payload>;
export function overviewPayload(
  target: ServeState | BrainSet,
  budgetTokens?: number | null,
  scope?: string | null,
): Payload | Promise<Payload> {
  if (!(target instanceof BrainSet)) return singleOverview(target, budgetTokens);
  return federatedOverview(target, budgetTokens, scope);
}

async function federatedOverview(set: BrainSet, budgetTokens?: number | null, scope?: string | null): Promise<Payload> {
  if (!set.federated) return singleOverview(await set.stateFor(set.brains[0]!), budgetTokens);
  const [chosen, dropped] = parseScope(set, scope);
  const focus = scope && chosen.length > 0 && chosen.length < set.brains.length ? chosen[0]! : set.focus;
  const single = qualifyPaths(focus.alias, singleOverview(await set.stateFor(focus), budgetTokens));
  const note = dropped.length > 0 ? `unknown scope '${dropped.join(", ")}' ignored. ` : "";
  let hint =
    note +
    `${set.brains.length} brains (${aliasList(set)}) — tree shows '${focus.alias}'; ` +
    "brain_search searches all of them (scope narrows: here, me, or aliases); paths are alias:path.";
  if (single["truncated"]) hint += " Tree trimmed to fit budget_tokens.";
  const ghosts = (single["top_ghosts"] as Array<Record<string, unknown>>).map((g) => ({
    ...g,
    target: qualify(focus.alias, String(g["target"])),
  }));
  return { brains: brainsListing(set), ...single, bundle: focus.alias, top_ghosts: ghosts, hint };
}

export function searchPayload(
  state: ServeState,
  query: string,
  mode?: unknown,
  limit?: unknown,
  budgetTokens?: number | null,
  scope?: string | null,
): Promise<Payload>;
export function searchPayload(
  set: BrainSet,
  query: string,
  mode?: unknown,
  limit?: unknown,
  budgetTokens?: number | null,
  scope?: string | null,
): Promise<Payload>;
export async function searchPayload(
  target: ServeState | BrainSet,
  query: string,
  mode: unknown = "auto",
  limit: unknown = 8,
  budgetTokens?: number | null,
  scope?: string | null,
): Promise<Payload> {
  if (!(target instanceof BrainSet)) return singleSearch(target, query, mode, limit, budgetTokens);
  if (!target.federated) return singleSearch(await target.stateFor(target.brains[0]!), query, mode, limit, budgetTokens);

  const budget = budgetTokens || 1200;
  let bounded: number;
  if (typeof limit === "number" && Number.isFinite(limit)) bounded = Math.max(1, Math.min(Math.trunc(limit), 50));
  else if (typeof limit === "string" && /^[+-]?\d+$/.test(limit.trim())) {
    bounded = Math.max(1, Math.min(parseInt(limit.trim(), 10), 50));
  } else bounded = 8;
  const [chosen, dropped] = parseScope(target, scope);

  // key = (rank, set order, path) — never score: scores are not comparable across brains (spec/75)
  const merged: Array<{ key: [number, number, string]; hit: Payload }> = [];
  const used: string[] = [];
  let degraded: unknown = null;
  let modeNote = "";
  const contributing: string[] = [];
  for (let order = 0; order < chosen.length; order++) {
    const brain = chosen[order]!;
    const body = await singleSearch(await target.stateFor(brain), query, mode, bounded, 1e9);
    const hint = String(body["hint"]);
    if (hint.startsWith("unknown mode")) modeNote = hint.split(". ", 1)[0] + ". ";
    for (const m of body["used_modes"] as string[]) if (!used.includes(m)) used.push(m);
    degraded = degraded ?? body["degraded_from"];
    const hits = body["hits"] as Array<Record<string, unknown>>;
    if (hits.length > 0) contributing.push(brain.alias);
    hits.forEach((hit, rank) => {
      merged.push({
        key: [rank, order, String(hit["path"])],
        hit: {
          path: qualify(brain.alias, String(hit["path"])),
          brain: brain.alias,
          title: hit["title"],
          description: hit["description"],
          score: hit["score"],
          why: hit["why"],
        },
      });
    });
  }
  merged.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || cmpStr(a.key[2], b.key[2]));
  const all = merged.map((m) => m.hit).slice(0, bounded);
  const hits = [...all];
  const result: Payload = {
    hits,
    searched: chosen.map((b) => b.alias),
    contributing,
    used_modes: ["keyword", "semantic", "graph", "title"].filter((m) => used.includes(m)),
    degraded_from: degraded ?? null,
    truncated: false,
    hint: "",
  };
  while (tokensOf(result) > budget && hits.length > 1) {
    hits.pop();
    result["truncated"] = true;
  }
  const notes = modeNote + (dropped.length > 0 ? `unknown scope '${dropped.join(", ")}' ignored. ` : "");
  let hint: string;
  if (result["truncated"]) hint = `${all.length - hits.length} hits trimmed — raise budget_tokens or sharpen the query.`;
  else if (hits.length > 0) hint = `brain_read '${hits[0]!["path"]}' opens the best hit (paths are alias:path).`;
  else hint = `no hits in ${chosen.map((b) => b.alias).join(", ")} — brain_overview lists every brain.`;
  result["hint"] = notes + hint;
  return result;
}

/** [brain, rel path] or an error payload for read/neighbors. */
async function route(set: BrainSet, doc: string, verb: string): Promise<[Brain, string] | Payload> {
  const resolution = await set.resolve(doc);
  if (resolution.outcome === "ok") return [resolution.brain, resolution.payload.path];
  if (resolution.outcome === "unknown_brain") {
    const [alias] = splitQualified(doc);
    return {
      error: `no brain called '${alias}' — brains here: ${resolution.payload.join(", ")}`,
      hint: "brain_overview lists every brain and its alias.",
    };
  }
  if (resolution.outcome === "ambiguous") {
    return {
      disambiguation: resolution.payload,
      hint: `several docs match across brains — call ${verb} again with one alias:path.`,
    };
  }
  return {
    error: `nothing in any brain matches '${doc}'`,
    suggestions: resolution.payload,
    hint: "try brain_search (it searches every brain), or brain_overview for the brain list.",
  };
}

export function readPayload(
  state: ServeState,
  doc: string,
  sections?: readonly string[] | null,
  budgetTokens?: number | null,
): Payload;
export function readPayload(
  set: BrainSet,
  doc: string,
  sections?: readonly string[] | null,
  budgetTokens?: number | null,
): Promise<Payload>;
export function readPayload(
  target: ServeState | BrainSet,
  doc: string,
  sections?: readonly string[] | null,
  budgetTokens?: number | null,
): Payload | Promise<Payload> {
  if (!(target instanceof BrainSet)) return singleRead(target, doc, sections, budgetTokens);
  return federatedRead(target, doc, sections, budgetTokens);
}

async function federatedRead(
  set: BrainSet,
  doc: string,
  sections?: readonly string[] | null,
  budgetTokens?: number | null,
): Promise<Payload> {
  if (!set.federated) return singleRead(await set.stateFor(set.brains[0]!), stripAlias(set, doc), sections, budgetTokens);
  const routed = await route(set, doc, "brain_read");
  if (!Array.isArray(routed)) return routed;
  const [brain, rel] = routed;
  const result = qualifyPaths(brain.alias, singleRead(await set.stateFor(brain), rel, sections, budgetTokens));
  result["brain"] = brain.alias;
  if (!result["truncated"]) result["hint"] = `brain_neighbors '${result["path"]}' walks the links around this doc.`;
  return result;
}

export function neighborsPayload(
  state: ServeState,
  doc: string,
  depth?: unknown,
  layer?: unknown,
  budgetTokens?: number | null,
): Payload;
export function neighborsPayload(
  set: BrainSet,
  doc: string,
  depth?: unknown,
  layer?: unknown,
  budgetTokens?: number | null,
): Promise<Payload>;
export function neighborsPayload(
  target: ServeState | BrainSet,
  doc: string,
  depth: unknown = 1,
  layer: unknown = "links",
  budgetTokens?: number | null,
): Payload | Promise<Payload> {
  if (!(target instanceof BrainSet)) return singleNeighbors(target, doc, depth, layer, budgetTokens);
  return federatedNeighbors(target, doc, depth, layer, budgetTokens);
}

async function federatedNeighbors(
  set: BrainSet,
  doc: string,
  depth: unknown,
  layer: unknown,
  budgetTokens?: number | null,
): Promise<Payload> {
  if (!set.federated) {
    return singleNeighbors(await set.stateFor(set.brains[0]!), stripAlias(set, doc), depth, layer, budgetTokens);
  }
  const routed = await route(set, doc, "brain_neighbors");
  if (!Array.isArray(routed)) return routed;
  const [brain, rel] = routed;
  const result = qualifyPaths(brain.alias, singleNeighbors(await set.stateFor(brain), rel, depth, layer, budgetTokens));
  result["brain"] = brain.alias;
  result["hint"] = String(result["hint"]).replace(`'${rel}'`, `'${qualify(brain.alias, rel)}'`);
  return result;
}

export async function writePayload(
  target: ServeState | BrainSet,
  doc: string,
  content: string,
  mode: unknown = "create",
  options: WritePayloadOptions = {},
): Promise<Payload> {
  if (!(target instanceof BrainSet)) return singleWrite(target, doc, content, mode, options);
  if (!target.federated) {
    return singleWrite(await target.stateFor(target.brains[0]!), stripAlias(target, doc), content, mode, options);
  }
  const [alias, rel] = splitQualified(doc);
  let brain: Brain | null;
  if (alias === null) {
    // here, else the cortex — a write falls back to the agent's own memory and
    // never guesses between implants (spec/75)
    brain = target.here ?? target.cortex;
    if (brain === null) {
      return {
        ok: false,
        instruction: `qualify the target — brain_write writes to one brain: use alias:path with one of ${aliasList(target)}`,
      };
    }
  } else {
    brain = target.byAlias(alias);
    if (brain === null) return { ok: false, instruction: `no brain called '${alias}' — brains here: ${aliasList(target)}` };
  }
  const result = await singleWrite(await target.stateFor(brain), rel, content, mode, options);
  if (result["ok"]) {
    result["path"] = qualify(brain.alias, String(result["path"]));
    result["brain"] = brain.alias;
    result["hint"] = `brain_read '${result["path"]}' to verify — connected UIs already got the delta.`;
  }
  return result;
}

export function showPayload(
  target: ServeState | BrainSet,
  nodes?: string[] | null,
  focus?: string | null,
  mode?: string | null,
  annotation?: string | null,
  clear = false,
): Promise<Payload> {
  if (!(target instanceof BrainSet)) return singleShow(target, nodes, focus, mode, annotation, clear);
  return federatedShow(target, nodes, focus, mode, annotation, clear);
}

async function federatedShow(
  set: BrainSet,
  nodes?: string[] | null,
  focus?: string | null,
  mode?: string | null,
  annotation?: string | null,
  clear = false,
): Promise<Payload> {
  if (!set.federated) {
    const only = await set.stateFor(set.brains[0]!);
    const stripped = nodes ? nodes.map((n) => stripAlias(set, n)) : nodes;
    return await singleShow(only, stripped, focus ? stripAlias(set, focus) : focus, mode, annotation, clear);
  }
  // A presentation is one UI: the brain of the first resolved node (else here, else
  // the first brain) hosts it; nodes from other brains are dropped and listed.
  let brain: Brain | null = null;
  for (const token of [...(nodes ?? []), ...(focus ? [focus] : [])]) {
    const resolution = await set.resolve(token);
    if (resolution.outcome === "ok") {
      brain = resolution.brain;
      break;
    }
  }
  brain = brain ?? set.focus;
  const kept: string[] = [];
  const foreign: string[] = [];
  for (const token of nodes ?? []) {
    const [alias, rel] = splitQualified(token);
    if (alias === null || alias === brain.alias) kept.push(rel);
    else foreign.push(token);
  }
  const focusRel = focus ? splitQualified(focus)[1] : focus;
  const result = await singleShow(await set.stateFor(brain), nodes != null ? kept : nodes, focusRel, mode, annotation, clear);
  result["dropped"] = [...foreign, ...(result["dropped"] as string[])];
  result["brain"] = brain.alias;
  if (foreign.length > 0) {
    result["hint"] = `${result["hint"]} (a presentation shows one brain — '${brain.alias}'; other brains' nodes dropped)`;
  }
  return result;
}

function instructionsFor(target: ServeState | BrainSet): string {
  const base =
    "A compiled knowledge bundle (an agent's brain). Start with brain_overview, " +
    "find docs with brain_search, open them with brain_read, walk links with " +
    "brain_neighbors, and add knowledge with brain_write.";
  if (!(target instanceof BrainSet) || !target.federated) return base;
  const aliases = target.brains
    .map((b) => b.alias + (b.here ? " (here)" : isCortex(b.role) ? " (me)" : ""))
    .join(", ");
  return (
    `${target.brains.length} brains behind one server: ${aliases}. brain_search searches ` +
    "all of them by default (scope narrows to here, me, or aliases); every path is " +
    "alias:path and brain_read/brain_neighbors/brain_write take it. " +
    base
  );
}

// -- the McpServer wrapper -------------------------------------------------------------

function textResult(payload: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

/** One McpServer over a shared ServeState. Stdio holds a single instance;
 * the streamable-HTTP mount calls this factory per request (stateless). */
export function createMcpServer(state: ServeState | BrainSet, writeRefusal: string | null = null): McpServer {
  const server = new McpServer({ name: "brainpick", version: VERSION }, { instructions: instructionsFor(state) });

  const budgetTokens = z.number().int().optional();
  const scope = z.string().optional();
  // a single-brain server keeps its synchronous, pre-federation payloads; a
  // BrainSet answers through the routing layer above (spec/75)
  const target = state as ServeState & BrainSet;

  server.registerTool(
    "brain_overview",
    {
      description:
        "One screen of the whole brain: doc/edge counts, tier status, and every doc " +
        "grouped by folder with its one-line description. Call this first to orient. " +
        "With several brains behind this server, `brains` lists them and scope " +
        "(all|here|me|alias,alias) picks which one the tree shows.",
      inputSchema: { scope, budget_tokens: budgetTokens },
    },
    async ({ scope: s, budget_tokens }) => textResult(await overviewPayload(target, budget_tokens ?? null, s ?? null)),
  );

  server.registerTool(
    "brain_search",
    {
      description:
        "Find docs by keyword. Returns paths, titles, and descriptions — never full " +
        "bodies. Follow up with brain_read on the best hit's path. With several brains " +
        "behind this server every brain is searched and hits are merged (paths become " +
        "alias:path); scope = all (default) | here | me | a comma-separated alias list.",
      inputSchema: {
        query: z.string(),
        mode: z.string().optional(),
        limit: z.number().int().optional(),
        scope,
        budget_tokens: budgetTokens,
      },
    },
    async ({ query, mode, limit, scope: s, budget_tokens }) =>
      textResult(await searchPayload(target, query, mode ?? "auto", limit ?? 8, budget_tokens ?? null, s ?? null)),
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
      textResult(await readPayload(target, doc, sections ?? null, budget_tokens ?? null)),
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
      textResult(await neighborsPayload(target, doc, depth ?? 1, layer ?? "links", budget_tokens ?? null)),
  );

  server.registerTool(
    "brain_write",
    {
      description:
        "Write a markdown doc into the bundle, guarded by its henxels contract. mode is " +
        "create (default, never overwrites), replace, or append_section. Pass base_sha " +
        "(the sha256 of the content you last read) to catch concurrent edits: on a " +
        "mismatch nothing is written and the result returns the current content, its " +
        "current_sha to retry with, and — when resolvable — a merged proposal. On a " +
        "contract violation nothing changes and instruction says exactly what to fix.",
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
        await writePayload(target, doc, content, mode ?? "create", {
          baseSha: base_sha ?? null,
          budgetTokens: budget_tokens ?? null,
          refusal: writeRefusal,
        }),
      ),
  );

  server.registerTool(
    "brain_show",
    {
      description:
        "Spotlight a subgraph live in every open UI: highlight nodes, fly the camera " +
        "to focus, switch mode (cosmos|brain), and show a caption — how an agent turns " +
        "'let me explain' into 'let me show you'. Every arg is optional. nodes accept " +
        "doc paths (like brain_read) and entity names; unknown ones are dropped and " +
        "listed. focus defaults to the first node. An empty call, or clear=true, " +
        "dismisses the presentation. This is ephemeral and advisory — it never writes " +
        "the brain.",
      inputSchema: {
        nodes: z.array(z.string()).optional(),
        focus: z.string().optional(),
        mode: z.string().optional(),
        annotation: z.string().optional(),
        clear: z.boolean().optional(),
      },
    },
    async ({ nodes, focus, mode, annotation, clear }) =>
      textResult(
        await showPayload(target, nodes ?? null, focus ?? null, mode ?? null, annotation ?? null, clear ?? false),
      ),
  );

  server.registerResource(
    "brain-index",
    "brain://index",
    { description: "The generated index block — the bundle's table of contents." },
    async (uri) => {
      const focusState = state instanceof BrainSet ? await state.stateFor(state.focus) : state;
      const path = join(focusState.root, "index.md");
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
    { description: "Raw document content by bundle-relative path (alias:path across brains)." },
    async (uri, variables) => {
      let path = String(variables["path"] ?? "");
      let held: ServeState;
      if (state instanceof BrainSet) {
        const [alias, rel] = splitQualified(path);
        const brain = alias !== null ? state.byAlias(alias) : state.focus;
        if (brain === null) throw new Error(`no brain called '${alias}'`);
        held = await state.stateFor(brain);
        path = rel;
      } else held = state;
      const record = held.recordFor(path);
      if (record === null) throw new Error(`no doc at '${path}'`);
      const filePath = join(held.root, path);
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
