/** Federation (spec/75): many brains behind one MCP server.
 *
 * A BrainSet is an ordered list of Brains — {alias, root, role, here} —
 * assembled from explicit --root flags or the shared registry (brains.toml)
 * ∪ the working directory's own bundle. Brains load lazily into ServeStates;
 * the MCP payload builders in mcp.ts accept a BrainSet in place of a
 * ServeState and fan out, merge and qualify (alias:path) when the set holds
 * more than one brain. Ports federation.py.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { parse as parseToml } from "smol-toml";

import { generateBundleId, loadConfig } from "./config";
import { atomicWrite } from "./core/fs";
import { findRepoRoot } from "./detect";
import { brainpickCommand } from "./scaffold";
import type { DocRecord } from "./compile/t1";
import { resolveDoc, resolveDocExact, resolveDocFuzzy, ServeState } from "./serve/state";

export const RESERVED_ALIASES = ["all", "here", "me"] as const;
const QUALIFIED = /^([a-z0-9][a-z0-9-]*):(.+)$/;
const KEY_ORDER = ["id", "repo", "bundle_path", "port", "enabled", "host", "alias", "role"] as const;
export const DEFAULT_PORT_BASE = 4750; // mirrors the daemon's registry (packages/desktop)
export const DEFAULT_HOST = "127.0.0.1";

export type Env = Record<string, string | undefined>;

/** One identity for a path everywhere in federation: absolute AND with symlinks
 * resolved — Python's Path.resolve() semantics, so macOS's /var → /private/var
 * or a symlinked wiki compares equal whether it came from the registry, --root
 * or the working directory. A path that does not exist stays lexical. */
export function canonical(...parts: string[]): string {
  const lexical = resolve(...parts);
  try {
    return realpathSync(lexical);
  } catch {
    return lexical;
  }
}
export type RegistryEntry = Record<string, unknown> & {
  id: string;
  repo: string;
  bundle_path: string;
  port: number;
  enabled: boolean;
  host: string;
  alias?: string;
  role?: string;
};

// -- qualified paths -------------------------------------------------------------------

/** 'alias:path' → [alias, path]; a bare path → [null, path]. Only a lowercase
 * slug before the colon counts, so a Windows drive letter or a stray colon in a
 * title never reads as an alias. */
export function splitQualified(doc: unknown): [string | null, string] {
  const text = String(doc ?? "").trim();
  const match = QUALIFIED.exec(text);
  if (match && !match[2]!.includes("\\") && !match[2]!.startsWith("//")) return [match[1]!, match[2]!];
  return [null, text];
}

export function qualify(alias: string, path: string): string {
  return `${alias}:${path}`;
}

// -- aliases ---------------------------------------------------------------------------

export function slugifyAlias(text: string): string {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "brain";
}

/** The default alias: the git repo's name when the bundle sits in one, else the
 * bundle directory's own name (spec/75). */
export function aliasFor(root: string): string {
  const resolved = canonical(root);
  const repo = findRepoRoot(resolved);
  return slugifyAlias(basename(repo ?? resolved));
}

/** The alias of a registry `repo` value — a local path's repo name, or a remote
 * URL's basename without `.git`. */
export function aliasForRepo(repo: string): string {
  if (isLocalRepo(repo)) return aliasFor(repo);
  const stripped = repo.replace(/\/+$/, "");
  const tail = stripped.slice(stripped.lastIndexOf("/") + 1).split(":").pop()!;
  return slugifyAlias(tail.endsWith(".git") ? tail.slice(0, -4) : tail);
}

/** Reserved words and collisions take -2, -3, … in set order — deterministic. */
export function dedupeAliases(wanted: Array<string | null>, roots: string[]): string[] {
  const taken = new Set<string>(RESERVED_ALIASES);
  const result: string[] = [];
  wanted.forEach((want, i) => {
    const base = want ? slugifyAlias(want) : aliasFor(roots[i]!);
    let alias = base;
    let n = 1;
    while (taken.has(alias)) {
      n += 1;
      alias = `${base}-${n}`;
    }
    taken.add(alias);
    result.push(alias);
  });
  return result;
}

// -- the registry ----------------------------------------------------------------------

/** A local path, as opposed to a git remote (scheme:// or scp-like user@host:). */
export function isLocalRepo(repo: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo)) return false;
  if (/^[^/\s]+@[^/\s]+:/.test(repo)) return false;
  return true;
}

/** ~/.config/brainpick/brains.toml, XDG-aware; BRAINPICK_REGISTRY overrides the
 * file path outright (tests, isolated setups). */
export function registryPath(env: Env = process.env): string {
  const override = env["BRAINPICK_REGISTRY"];
  if (override) return override;
  const daemonDir = env["BRAINPICK_DAEMON_CONFIG_DIR"];
  if (daemonDir) return join(daemonDir, "brains.toml");
  const xdg = env["XDG_CONFIG_HOME"] || join(env["HOME"] ?? homedir(), ".config");
  return join(xdg, "brainpick", "brains.toml");
}

export function dataDir(env: Env = process.env): string {
  const override = env["BRAINPICK_DAEMON_DATA_DIR"];
  if (override) return override;
  const xdg = env["XDG_DATA_HOME"] || join(env["HOME"] ?? homedir(), ".local", "share");
  return join(xdg, "brainpick");
}

function isEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    v["id"] !== "" &&
    typeof v["repo"] === "string" &&
    v["repo"] !== "" &&
    typeof v["bundle_path"] === "string" &&
    typeof v["port"] === "number" &&
    Number.isInteger(v["port"]) &&
    v["port"] > 0 &&
    typeof v["enabled"] === "boolean" &&
    typeof v["host"] === "string" &&
    v["host"] !== ""
  );
}

/** Every well-formed [[brain]] entry, in file order. An absent or unparseable
 * file is an empty registry; a malformed entry is dropped, never fatal. */
export function loadRegistry(path: string = registryPath()): RegistryEntry[] {
  let data: unknown;
  try {
    data = parseToml(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const raw = (data as Record<string, unknown>)["brain"];
  return Array.isArray(raw) ? raw.filter(isEntry).map((e) => ({ ...e })) : [];
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function tomlValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (Array.isArray(value)) return "[" + value.map(tomlValue).join(", ") + "]";
  return tomlString(String(value));
}

/** Canonical brains.toml: one [[brain]] table per entry, known keys in spec order
 * first, unknown keys after (sorted) so a hand edit survives a round trip. */
export function renderRegistry(entries: RegistryEntry[]): string {
  const tables: string[] = [];
  for (const entry of entries) {
    const lines = ["[[brain]]"];
    for (const key of KEY_ORDER) {
      if (entry[key] !== undefined && entry[key] !== null) lines.push(`${key} = ${tomlValue(entry[key])}`);
    }
    const known = new Set<string>(KEY_ORDER);
    for (const key of Object.keys(entry).filter((k) => !known.has(k)).sort()) {
      if (entry[key] !== undefined && entry[key] !== null) lines.push(`${key} = ${tomlValue(entry[key])}`);
    }
    tables.push(lines.join("\n") + "\n");
  }
  return tables.join("\n");
}

export function saveRegistry(entries: RegistryEntry[], path: string = registryPath()): void {
  atomicWrite(path, renderRegistry(entries));
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Where a registry entry's bundle lives on THIS machine: a local repo directly,
 * a remote one from its daemon clone — null when that clone does not exist
 * (federation never clones). */
export function entryRoot(entry: RegistryEntry, env: Env = process.env): string | null {
  const repo = entry.repo;
  const base = isLocalRepo(repo)
    ? repo.startsWith("~")
      ? join(homedir(), repo.slice(1))
      : repo
    : join(dataDir(env), "brains", entry.id);
  const root = entry.bundle_path ? join(base, entry.bundle_path) : base;
  const resolved = canonical(root);
  return isDir(resolved) ? resolved : null;
}

/** [repo, bundle_path] for a local bundle — the git repo above it when there is
 * one, so the registry entry matches what the daemon would write. */
function splitRoot(root: string): [string, string] {
  const repo = findRepoRoot(root);
  if (repo === null || repo === root) return [root, ""];
  return [repo, relative(repo, root).split(sep).join("/")];
}

function bundleId(root: string): string {
  return loadConfig(root).bundle.id || generateBundleId();
}

export interface RegisterOptions {
  alias?: string | null;
  user?: boolean;
}

/** Add the bundle at `root` to the registry (or update its entry in place when the
 * same root is already registered). Returns the entry written. */
export function registerBrain(root: string, path: string = registryPath(), options: RegisterOptions = {}): RegistryEntry {
  const resolved = canonical(root);
  const entries = loadRegistry(path);
  const [repo, bundlePath] = splitRoot(resolved);
  const existingIndex = entries.findIndex((e) => entryRoot(e) === resolved);
  const existing = existingIndex >= 0 ? entries[existingIndex]! : null;
  const usedPorts = new Set(entries.filter((e) => e !== existing).map((e) => e.port));
  let port = existing ? existing.port : DEFAULT_PORT_BASE;
  while (usedPorts.has(port)) port += 1;
  const entry: RegistryEntry = existing
    ? { ...existing }
    : { id: bundleId(resolved), repo, bundle_path: bundlePath, port, enabled: true, host: DEFAULT_HOST };
  if (options.alias) entry.alias = slugifyAlias(options.alias);
  if (options.user) {
    entry.role = "user";
    for (const other of entries) {
      if (other !== existing && other.role === "user") delete other.role; // one personal brain — the newest claim wins
    }
  }
  if (existing === null) entries.push(entry);
  else entries[existingIndex] = entry;
  saveRegistry(entries, path);
  return entry;
}

export function unregisterBrain(root: string, path: string = registryPath()): boolean {
  const resolved = canonical(root);
  const entries = loadRegistry(path);
  const kept = entries.filter((e) => entryRoot(e) !== resolved);
  if (kept.length === entries.length) return false;
  saveRegistry(kept, path);
  return true;
}

// -- the brain set ---------------------------------------------------------------------

export function isBundleRoot(path: string): boolean {
  try {
    if (statSync(join(path, "brainpick.toml")).isFile()) return true;
  } catch {
    /* not here */
  }
  return isDir(join(path, ".brainpick"));
}

/** The nearest ancestor-or-self of cwd that is a bundle root (spec/75). */
export function discoverHere(cwd: string): string | null {
  let candidate = canonical(cwd);
  for (;;) {
    if (isBundleRoot(candidate)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

export interface BrainInit {
  alias: string | null;
  root: string;
  role?: string | null;
  here?: boolean;
}

export class Brain {
  alias: string;
  readonly root: string;
  readonly role: string | null;
  readonly here: boolean;
  state: ServeState | null = null;

  constructor(init: BrainInit) {
    this.alias = init.alias ?? "";
    this.root = canonical(init.root);
    this.role = init.role ?? null;
    this.here = init.here ?? false;
  }

  get loaded(): boolean {
    return this.state !== null;
  }
}

export type Resolution =
  | { brain: Brain; outcome: "ok"; payload: DocRecord }
  | { brain: null; outcome: "ambiguous"; payload: Array<{ path: string; title: string }> }
  | { brain: null; outcome: "miss"; payload: string[] }
  | { brain: null; outcome: "unknown_brain"; payload: string[] };

/** An ordered set of brains with unique aliases; loads ServeStates lazily. */
export class BrainSet {
  readonly brains: Brain[];

  constructor(brains: Brain[]) {
    const aliases = dedupeAliases(
      brains.map((b) => b.alias || null),
      brains.map((b) => b.root),
    );
    brains.forEach((brain, i) => {
      brain.alias = aliases[i]!;
    });
    this.brains = [...brains];
  }

  get federated(): boolean {
    return this.brains.length > 1;
  }

  get here(): Brain | null {
    return this.brains.find((b) => b.here) ?? null;
  }

  get user(): Brain | null {
    return this.brains.find((b) => b.role === "user") ?? null;
  }

  /** The brain single-brain-shaped payloads describe: here, else the first. */
  get focus(): Brain {
    return this.here ?? this.brains[0]!;
  }

  byAlias(alias: string): Brain | null {
    return this.brains.find((b) => b.alias === alias) ?? null;
  }

  /** The brain's ServeState — compiled if stale, loaded once, then held. */
  async stateFor(brain: Brain): Promise<ServeState> {
    if (brain.state === null) {
      const state = new ServeState(brain.root, loadConfig(brain.root));
      await state.load();
      brain.state = state;
    }
    return brain.state;
  }

  /** Manifest only — what brain_overview's `brains` needs without loading. */
  manifestOf(brain: Brain): Record<string, unknown> {
    if (brain.state !== null) return brain.state.manifest;
    try {
      return JSON.parse(readFileSync(join(brain.root, ".brainpick", "manifest.json"), "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }

  /** Route a (possibly qualified) doc — spec/75's cross-brain ladder: a qualified
   * doc resolves in its brain only; a bare doc in every brain, one hit is a hit,
   * several is a disambiguation, none a miss. Payloads carry QUALIFIED paths when
   * the set is federated. */
  async resolve(doc: unknown): Promise<Resolution> {
    const [alias, rel] = splitQualified(doc);
    if (alias !== null) {
      const brain = this.byAlias(alias);
      if (brain === null) return { brain: null, outcome: "unknown_brain", payload: this.brains.map((b) => b.alias) };
      const [outcome, payload] = resolveDoc((await this.stateFor(brain)).records, rel);
      if (outcome === "ok") return { brain, outcome, payload: payload as DocRecord };
      if (outcome === "ambiguous") {
        const records = payload as DocRecord[];
        return {
          brain: null,
          outcome,
          payload: records.map((r) => ({ path: this.federated ? qualify(brain.alias, r.path) : r.path, title: r.title })),
        };
      }
      const paths = payload as string[];
      return { brain: null, outcome: "miss", payload: this.federated ? paths.map((p) => qualify(brain.alias, p)) : paths };
    }
    if (!this.federated) {
      const brain = this.brains[0]!;
      const [outcome, payload] = resolveDoc((await this.stateFor(brain)).records, rel);
      if (outcome === "ok") return { brain, outcome, payload: payload as DocRecord };
      if (outcome === "ambiguous") {
        return { brain: null, outcome, payload: (payload as DocRecord[]).map((r) => ({ path: r.path, title: r.title })) };
      }
      return { brain: null, outcome: "miss", payload: payload as string[] };
    }

    // tier by tier across the set: an exact hit anywhere beats a fuzzy title anywhere
    const suggestions: string[] = [];
    for (const tier of [resolveDocExact, resolveDocFuzzy]) {
      const hits: Array<[Brain, DocRecord]> = [];
      const ambiguous: Array<{ path: string; title: string }> = [];
      for (const brain of this.brains) {
        const [outcome, payload] = tier((await this.stateFor(brain)).records, rel);
        if (outcome === "ok") hits.push([brain, payload as DocRecord]);
        else if (outcome === "ambiguous") {
          for (const r of payload as DocRecord[]) ambiguous.push({ path: qualify(brain.alias, r.path), title: r.title });
        } else for (const p of payload as string[]) suggestions.push(qualify(brain.alias, p));
      }
      if (hits.length === 1 && ambiguous.length === 0) return { brain: hits[0]![0], outcome: "ok", payload: hits[0]![1] };
      if (hits.length === 0 && ambiguous.length === 0) continue;
      const listed = hits.map(([b, r]) => ({ path: qualify(b.alias, r.path), title: r.title })).concat(ambiguous);
      return { brain: null, outcome: "ambiguous", payload: listed };
    }
    return { brain: null, outcome: "miss", payload: suggestions.slice(0, 5) };
  }
}

/** `ALIAS=PATH` or `PATH` — an alias prefix is a slug followed by '='. */
function parseRootArg(arg: string): [string | null, string] {
  const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)=(.+)$/.exec(arg);
  if (match) return [match[1]!, match[2]!];
  return [null, arg];
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

export interface ResolveOptions {
  cwd?: string;
  registryPath?: string;
  env?: Env;
}

/** The spec/75 assembly: explicit roots win outright; else the registry ∪ here,
 * ordered here → user → the rest; an empty set is the cwd alone. */
export function resolveBrainSet(roots: string[], options: ResolveOptions = {}): BrainSet {
  const cwd = canonical(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  if (roots.length > 0) {
    const hereRoot = discoverHere(cwd);
    return new BrainSet(
      roots.map((arg) => {
        const [alias, path] = parseRootArg(arg);
        const root = canonical(cwd, path);
        return new Brain({ alias, root, here: root === hereRoot });
      }),
    );
  }

  const here = discoverHere(cwd);
  const brains: Brain[] = [];
  for (const entry of loadRegistry(options.registryPath ?? registryPath(env))) {
    if (entry.enabled === false) continue;
    const root = entryRoot(entry, env);
    if (root === null) continue;
    // a registry brain whose root contains cwd IS here (spec/75) — marker or not
    const isHere = here === null ? isWithin(cwd, root) : root === here || isWithin(here, root);
    const alias = entry.alias || aliasForRepo(entry.repo);
    brains.push(new Brain({ alias, root, role: entry.role ?? null, here: isHere }));
  }
  if (here !== null && !brains.some((b) => b.here)) brains.unshift(new Brain({ alias: null, root: here, here: true }));
  if (brains.length === 0) return new BrainSet([new Brain({ alias: null, root: cwd, here: true })]);
  const rank = (b: Brain) => (b.here ? 0 : b.role === "user" ? 1 : 2);
  const ordered = brains.map((b, i) => [b, i] as const).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]);
  return new BrainSet(ordered.map(([b]) => b));
}

const PATH_KEYS = new Set(["path", "source", "target", "center"]);
const NESTED_KEYS = new Set(["in", "out", "nodes", "edges", "docs", "tree", "neighbors", "top_ghosts", "disambiguation"]);

/** Prefix every path-bearing field in a nested payload with alias: (spec/75). */
export function qualifyPaths<T>(alias: string, obj: T): T {
  if (Array.isArray(obj)) return obj.map((item) => qualifyPaths(alias, item)) as unknown as T;
  if (typeof obj === "object" && obj !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (PATH_KEYS.has(key) && typeof value === "string" && value !== "") out[key] = qualify(alias, value);
      else if (NESTED_KEYS.has(key)) out[key] = qualifyPaths(alias, value);
      else out[key] = value;
    }
    return out as T;
  }
  return obj;
}

/** A short, human root for brain_overview's `brains` — relative to cwd when it
 * sits below it, else the directory name. */
export function relativeRoot(root: string, cwd: string = process.cwd()): string {
  const rel = relative(canonical(cwd), root);
  if (rel === "") return ".";
  if (rel.startsWith("..") || /^[A-Za-z]:/.test(rel) || rel.startsWith(sep)) return basename(root);
  return rel.split(sep).join("/");
}

/** `all` | `here` | `me` | a comma-separated alias list → [brains, dropped names].
 * Nothing surviving falls back to all — forgiving, never an error (spec/70). */
export function parseScope(set: BrainSet, scope: unknown): [Brain[], string[]] {
  const text = String(scope ?? "all").trim();
  let chosen: Brain[] = [];
  const dropped: string[] = [];
  for (const name of text
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "")) {
    if (name === "all") {
      chosen = [...set.brains];
      continue;
    }
    const brain = name === "here" ? set.here : name === "me" ? set.user : set.byAlias(name);
    if (brain === null) dropped.push(name);
    else if (!chosen.includes(brain)) chosen.push(brain);
  }
  if (chosen.length === 0) chosen = [...set.brains];
  return [set.brains.filter((b) => chosen.includes(b)), dropped];
}

export function registryExists(path: string = registryPath()): boolean {
  return existsSync(path);
}

// -- the `register` runner (CLI) -------------------------------------------------------

export interface RegisterRunOptions extends RegisterOptions {
  remove?: boolean;
  /** spec/75 migration: register every `mcp --root DIR` found in agent host configs. */
  fromHosts?: boolean;
  /** with fromHosts: report, don't write. */
  dryRun?: boolean;
  registryPath?: string;
  env?: Env;
  print?: (line: string) => void;
  printErr?: (line: string) => void;
}

// -- migrating per-project host entries (spec/75 --from-hosts) ------------------------

/** One `mcp --root DIR` found in agent host configs — DIR plus the hosts naming it. */
export interface HostRoot {
  root: string;
  hosts: string[];
}

function hostFiles(home: string): Array<[string, string]> {
  return [
    ["claude-code", join(home, ".claude.json")],
    ["opencode", join(home, ".config", "opencode", "opencode.json")],
    ["codex", join(home, ".codex", "config.toml")],
    ["cursor", join(home, ".cursor", "mcp.json")],
  ];
}

/** The command line of one MCP server entry: `command` string + `args`, or a
 * `command` array (OpenCode). Remote servers have neither and yield []. */
function serverArgv(server: unknown): string[] {
  if (typeof server !== "object" || server === null) return [];
  const s = server as Record<string, unknown>;
  if (Array.isArray(s["command"])) return s["command"].map(String);
  const argv = typeof s["command"] === "string" ? [s["command"]] : [];
  if (Array.isArray(s["args"])) argv.push(...s["args"].map(String));
  return argv;
}

/** `… mcp … --root DIR` (or `--root=DIR`) → DIR; anything else → null. */
function mcpRootOf(argv: string[]): string | null {
  const at = argv.indexOf("mcp");
  if (at < 0) return null;
  const tail = argv.slice(at + 1);
  for (let i = 0; i < tail.length; i++) {
    const part = tail[i]!;
    if (part === "--root" && i + 1 < tail.length) return tail[i + 1]!;
    if (part.startsWith("--root=")) return part.slice("--root=".length);
  }
  return null;
}

function values(obj: unknown): unknown[] {
  return typeof obj === "object" && obj !== null ? Object.values(obj as Record<string, unknown>) : [];
}

function serversIn(host: string, path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let data: unknown;
  try {
    data = host === "codex" ? parseToml(text) : JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof data !== "object" || data === null) return [];
  const d = data as Record<string, unknown>;
  if (host === "codex") return values(d["mcp_servers"]);
  if (host === "opencode") return values(d["mcp"]);
  const servers = values(d["mcpServers"]);
  for (const project of values(d["projects"])) {
    // Claude Code per-project scope
    if (typeof project === "object" && project !== null) {
      servers.push(...values((project as Record<string, unknown>)["mcpServers"]));
    }
  }
  return servers;
}

/** Every distinct `brainpick mcp --root DIR` across the known host configs
 * (spec/75), in discovery order. Pure read — never edits a host config. */
export function scanHosts(env: Env = process.env): HostRoot[] {
  const home = env["HOME"] ?? homedir();
  const found = new Map<string, string[]>();
  for (const [host, path] of hostFiles(home)) {
    for (const server of serversIn(host, path)) {
      const raw = mcpRootOf(serverArgv(server));
      if (raw === null) continue;
      const root = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
      const hosts = found.get(root) ?? [];
      if (!hosts.includes(host)) hosts.push(host);
      found.set(root, hosts);
    }
  }
  return [...found.entries()].map(([root, hosts]) => ({ root, hosts }));
}

/** spec/75: the one-command migration — every `mcp --root DIR` in the agent
 * host configs becomes a registry entry; then ONE replacement entry is shown.
 * Never edits a host config. */
function registerFromHosts(registry: string, options: RegisterRunOptions, print: (line: string) => void): number {
  const env = options.env ?? process.env;
  const found = scanHosts(env);
  if (found.length === 0) {
    print(
      "no per-project `brainpick mcp --root` entries found in ~/.claude.json, " +
        "opencode.json, ~/.codex/config.toml or ~/.cursor/mcp.json — nothing to migrate",
    );
    return 0;
  }
  const existing = new Set(loadRegistry(registry).map((e) => entryRoot(e, env)));
  const label = options.dryRun ? "dry run — would register" : "registered";
  let registered = 0;
  for (const item of found) {
    const via = item.hosts.join(", ");
    const root = canonical(item.root);
    if (existing.has(root)) {
      print(`  already registered ${root} (${via})`);
      continue;
    }
    if (!isDir(root) || !hasMarkdown(root)) {
      print(`  skipped ${root} (${via}) — not a bundle on this machine`);
      continue;
    }
    if (options.dryRun) {
      print(`  ${label} ${root} (${via})`);
      continue;
    }
    const entry = registerBrain(root, registry, { alias: null, user: false });
    print(`  ${label} ${shownAlias(entry)} → ${root} (${via})`);
    registered += 1;
  }
  print(`registry: ${registry}`);
  if (options.dryRun) {
    print("re-run without --dry-run to write the registry.");
    return 0;
  }
  if (registered > 0) {
    const cmd = brainpickCommand().join(" ");
    print(
      `\nreplace the per-project entries with ONE user-scope entry:\n` +
        `  claude mcp add brainpick --scope user -- ${cmd} mcp\n` +
        "(the old --root entries keep working until you remove them; " +
        "brainpick register ~/brain --user marks your personal brain.)",
    );
  }
  return 0;
}

/** `brainpick register [PATH] [--alias A] [--user] [--remove]` — no PATH lists. */
export function runRegister(path: string | null, options: RegisterRunOptions = {}): number {
  const print = options.print ?? ((line: string) => console.log(line));
  const printErr = options.printErr ?? ((line: string) => console.error(line));
  const registry = options.registryPath ?? registryPath(options.env);
  if (options.fromHosts) return registerFromHosts(registry, options, print);
  if (path === null) {
    const entries = loadRegistry(registry);
    if (entries.length === 0) {
      print(`no brains registered (${registry}) — brainpick register <bundle> adds one`);
      return 0;
    }
    for (const entry of entries) {
      const root = entryRoot(entry);
      const marks =
        (entry.role === "user" ? " (me)" : "") + (entry.enabled ? "" : " (disabled)") + (root ? "" : " (missing)");
      const shown = root ?? `${entry.repo}/${entry.bundle_path}`.replace(/\/+$/, "");
      print(`  ${shownAlias(entry).padEnd(20)} ${shown}${marks}`);
    }
    print(`registry: ${registry}`);
    return 0;
  }
  const root = canonical(path);
  if (options.remove) {
    if (unregisterBrain(root, registry)) {
      print(`removed ${root} from ${registry}`);
      return 0;
    }
    printErr(`${root} is not registered (${registry})`);
    return 1;
  }
  if (!isDir(root) || !hasMarkdown(root)) {
    printErr(`${root} holds no markdown — a brain is an OKF bundle of .md files`);
    return 1;
  }
  const entry = registerBrain(root, registry, { alias: options.alias ?? null, user: options.user ?? false });
  print(`registered ${shownAlias(entry)}${entry.role === "user" ? " (me)" : ""} → ${root}`);
  print(`registry: ${registry}`);
  print("brainpick mcp (no --root) now fronts every registered brain plus the one you're in.");
  return 0;
}

/** The address the tools use — never the opaque id. */
function shownAlias(entry: RegistryEntry): string {
  return entry.alias || aliasForRepo(entry.repo);
}

function hasMarkdown(root: string): boolean {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) return true;
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        stack.push(join(dir, entry.name));
      }
    }
  }
  return false;
}
