/** Federation (spec/75): many brains behind one MCP server.
 *
 * A BrainSet is an ordered list of Brains — {alias, root, role, here} —
 * assembled from explicit --root flags or the shared registry (brains.toml)
 * ∪ the working directory's own bundle. Brains load lazily into ServeStates;
 * the MCP payload builders in mcp.ts accept a BrainSet in place of a
 * ServeState and fan out, merge and qualify (alias:path) when the set holds
 * more than one brain. Ports federation.py.
 */
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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
/** The agent's own brain — at most one per set (spec/75). */
export const CORTEX = "cortex";
/** An attached repository bundle — any number. */
export const IMPLANT = "implant";
const LEGACY_CORTEX = "user"; // the former name of "cortex"; still read, never written

/** True for the cortex role, including its deprecated spelling `user` (spec/75). */
export function isCortex(role: string | null | undefined): boolean {
  return role === CORTEX || role === LEGACY_CORTEX;
}

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
/** spec/105: mount-level access control. A read-only brain is a mirror of its
 * upstream — writes redirect, sync fast-forwards only, push refuses. */
export const READ_ONLY = "read-only";
export const READ_WRITE = "read-write";

export function normalizeAccess(value: unknown): string {
  if (value === READ_ONLY) return READ_ONLY;
  return READ_WRITE; // absent / unknown → read-write (spec/105)
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
  access?: string;
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

/** spec/105: the brain:// link for a doc in a brain — null when the bundle has no id. */
export function brainLinkFor(brain: Brain, rel: string): string | null {
  try {
    const id = loadConfig(brain.root).bundle.id;
    if (!id) return null;
    return `brain://${brain.alias}-${id}/${rel}`;
  } catch {
    return null;
  }
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
  /** Deprecated spelling of `role: "cortex"` (spec/75). */
  user?: boolean;
  role?: string | null;
  /** spec/105: mount-level access control. read-only = mirror, never push. */
  access?: string | null;
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
  const role = options.role ?? (options.user ? CORTEX : null); // --user is the deprecated --cortex
  if (role) {
    entry.role = role;
    if (role === CORTEX) {
      for (const other of entries) {
        if (other !== existing && isCortex(other.role)) delete other.role; // one cortex — the newest claim wins
      }
    }
  }
  // spec/105: access is a mount fact — read-only written, read-write pops the key
  if (options.access === READ_ONLY) entry.access = READ_ONLY;
  else if (options.access === READ_WRITE || options.access === "") delete entry.access;

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
  access?: string;
}

export class Brain {
  alias: string;
  readonly root: string;
  readonly role: string | null;
  readonly here: boolean;
  readonly access: string;
  state: ServeState | null = null;

  constructor(init: BrainInit) {
    this.alias = init.alias ?? "";
    this.root = canonical(init.root);
    this.role = init.role ?? null;
    this.here = init.here ?? false;
    this.access = normalizeAccess(init.access);
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

  /** The agent's own brain — scope `me`, and the fallback for an unqualified write. */
  get cortex(): Brain | null {
    return this.brains.find((b) => isCortex(b.role)) ?? null;
  }

  /** Deprecated alias of `cortex` (spec/75). */
  get user(): Brain | null {
    return this.cortex;
  }

  get implants(): Brain[] {
    return this.brains.filter((b) => b.role === IMPLANT);
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

  /** `stateFor`, but a brain that cannot be read degrades instead of throwing
   * (spec/100 *An implant that cannot be read*): → [state, null] or [null, reason].
   * One unreadable implant must never take the set down with it — the cortex it
   * would hide is the knowledge needed to fix it. */
  async readableStateFor(brain: Brain): Promise<[ServeState | null, string | null]> {
    const reason = this.unreadableReason(brain);
    if (reason !== null) return [null, reason];
    try {
      return [await this.stateFor(brain), null];
    } catch (error) {
      return [null, describeUnreadable(error)];
    }
  }

  /** Why this brain cannot be read, in words an agent can act on — or null when it
   * is fine. Checked before any compile, because compiling an absent or unreadable
   * root is what used to invent a phantom brain. */
  unreadableReason(brain: Brain): string | null {
    if (brain.state !== null) return null;
    try {
      const stat = statSync(brain.root);
      if (!stat.isDirectory()) return "the bundle root is not a directory";
      accessSync(brain.root, constants.R_OK | constants.X_OK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return "the bundle root does not exist";
      return describeUnreadable(error);
    }
    let raw: string;
    try {
      raw = readFileSync(join(brain.root, ".brainpick", "manifest.json"), "utf8");
    } catch (error) {
      // never compiled here — stateFor compiles it, legitimately
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return describeUnreadable(error);
    }
    try {
      JSON.parse(raw);
    } catch {
      return "manifest.json is not valid JSON";
    }
    return null;
  }

  /** Manifest only — what brain_overview's `brains` needs without loading.
   * Callers MUST consult `unreadableReason` first: an empty object here means "no
   * manifest yet", never "unreadable" (spec/100 forbids reporting a brain that
   * could not be read as an empty one). */
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
    brains.push(new Brain({ alias, root, role: entry.role ?? null, here: isHere, access: entry.access }));
  }
  if (here !== null && !brains.some((b) => b.here)) brains.unshift(new Brain({ alias: null, root: here, here: true }));
  if (brains.length === 0) return new BrainSet([new Brain({ alias: null, root: cwd, here: true })]);
  const rank = (b: Brain) => (b.here ? 0 : isCortex(b.role) ? 1 : 2);
  const ordered = brains.map((b, i) => [b, i] as const).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]);
  return new BrainSet(ordered.map(([b]) => b));
}

const PATH_KEYS = new Set(["path", "source", "target", "center"]);
const NESTED_KEYS = new Set([
  "in", "out", "nodes", "edges", "docs", "tree", "neighbors", "top_ghosts", "disambiguation",
  "skills", "skill", "depends_on", "dependents", "tools",
]);
const PATH_LIST_KEYS = new Set(["depends_on", "tools"]); // skills' plain path lists (spec/70)

/** Prefix every path-bearing field in a nested payload with alias: (spec/75). */
export function qualifyPaths<T>(alias: string, obj: T): T {
  if (Array.isArray(obj)) return obj.map((item) => qualifyPaths(alias, item)) as unknown as T;
  if (typeof obj === "object" && obj !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (PATH_KEYS.has(key) && typeof value === "string" && value !== "") out[key] = qualify(alias, value);
      else if (PATH_LIST_KEYS.has(key) && Array.isArray(value) && value.every((v) => typeof v === "string")) {
        out[key] = (value as string[]).map((v) => (v ? qualify(alias, v) : v));
      } else if (NESTED_KEYS.has(key)) out[key] = qualifyPaths(alias, value);
      else out[key] = value;
    }
    return out as T;
  }
  return obj;
}

/** An exception, as a phrase about the BUNDLE rather than about the engine
 * (spec/100): the agent reading it has to fix a repository, not debug a stack. */
export function describeUnreadable(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM") return "permission denied reading the bundle";
  if (code === "ENOENT") return "the bundle root does not exist";
  if (code === "ENOTDIR") return "the bundle root is not a directory";
  if (error instanceof SyntaxError) return "manifest.json is not valid JSON";
  if (code) return `the bundle could not be read (${code})`;
  return "the bundle could not be read";
}

/** The `MAJOR.MINOR.PATCH` core as a comparable tuple, or null when it does not
 * parse — unknown is never treated as behind. */
function versionCore(version: string): number[] | null {
  const parts = version.trim().split(".").slice(0, 3);
  const nums = parts.map((p) => Number(p));
  return nums.length > 0 && nums.every((n) => Number.isInteger(n)) ? nums : null;
}

function compareCore(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** spec/100: the version/format disagreement across a SET, or null when uniform.
 * A null value is unknown, not behind — a wiki has no format, an uncompiled brain
 * no version — and an unreadable brain is excluded (a louder problem, reported
 * separately). */
export function skewOf(entries: Record<string, unknown>[]): Record<string, unknown> | null {
  const rows = entries.filter((e) => e.unreadable !== true);
  const result: Record<string, unknown> = {};

  const formats = rows
    .filter((e) => typeof e.format === "number")
    .map((e) => ({ alias: String(e.alias), format: e.format as number }));
  if (formats.length > 0) {
    const latest = Math.max(...formats.map((f) => f.format));
    const behind = formats
      .filter((f) => f.format < latest)
      .sort((x, y) => x.format - y.format || x.alias.localeCompare(y.alias));
    if (behind.length > 0) result.format = { latest, behind };
  }

  const versions = rows
    .filter((e) => typeof e.version === "string")
    .map((e) => ({ alias: String(e.alias), version: e.version as string, core: versionCore(e.version as string) }))
    .filter((v): v is { alias: string; version: string; core: number[] } => v.core !== null);
  if (versions.length > 0) {
    const top = versions.reduce((best, v) => (compareCore(v.core, best.core) > 0 ? v : best), versions[0]!);
    const behind = versions
      .filter((v) => compareCore(v.core, top.core) < 0)
      .sort((x, y) => compareCore(x.core, y.core) || x.alias.localeCompare(y.alias))
      .map(({ alias, version }) => ({ alias, version }));
    if (behind.length > 0) result.version = { latest: top.version, behind };
  }

  if (Object.keys(result).length === 0) return null;
  const parts: string[] = [];
  if (result.format) {
    const f = result.format as { latest: number; behind: { alias: string; format: number }[] };
    const names = f.behind.map((b) => b.alias).join(", ");
    const at = f.behind.length === 1 ? `is at ${f.behind[0]!.format}` : "are behind";
    parts.push(
      `brain format skew: ${names} ${at}, this set is at ${f.latest} — conventions and journal paths ` +
        `differ between them; verify where a doc belongs before writing to ${names} ` +
        `(brainpick migrate --to ${f.latest})`,
    );
  }
  if (result.version) {
    const v = result.version as { latest: string; behind: { alias: string }[] };
    const names = v.behind.map((b) => b.alias).join(", ");
    parts.push(
      `engine skew: ${names} last compiled by an older brainpick than ${v.latest} — ` +
        `recompile with the current engine (brainpick compile)`,
    );
  }
  result.hint = `${parts.join("; ")}.`;
  return result;
}

/** spec/100: the loud half. Names every brain that could not be read, and the one
 * command that fixes it. */
export function unreadableHint(unreadable: { alias: string; root: string; reason: string }[]): string {
  const names = unreadable.map((u) => `${u.alias} (${u.reason})`).join(", ");
  const root = unreadable.slice(0, 1).map((u) => `--root ${u.root}`).join(" ");
  return (
    `${unreadable.length} brain${unreadable.length === 1 ? "" : "s"} could not be read: ${names}. ` +
    `Other brains still answer; fix with \`brainpick compile ${root}\`.`
  );
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
    const brain = name === "here" ? set.here : name === "me" ? set.cortex : set.byAlias(name);
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

/** `brainpick register [PATH] [--alias A] [--cortex|--implant] [--remove]` — no PATH lists. */
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
        (isCortex(entry.role) ? " (me)" : entry.role === IMPLANT ? " (implant)" : "") +
        (entry.access === READ_ONLY ? " (read-only)" : "") +
        (entry.enabled ? "" : " (disabled)") + (root ? "" : " (missing)");
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
  const entry = registerBrain(root, registry, {
    alias: options.alias ?? null,
    user: options.user ?? false,
    role: options.role ?? null,
    access: options.access ?? null,
  });
  let mark = isCortex(entry.role) ? " (me)" : entry.role === IMPLANT ? " (implant)" : "";
  if (entry.access === READ_ONLY) mark += " (read-only)";
  print(`registered ${shownAlias(entry)}${mark} → ${root}`);
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
