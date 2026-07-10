/** brains.toml (_todo.md): the daemon's brain registry. Hand-editable
 * TOML, one `[[brain]]` table per brain — id, repo (a git URL or a local
 * filesystem path), bundle_path (relative to the repo/dir root; "" = the
 * repo root itself), port, enabled. Loading is forgiving (a malformed entry
 * is dropped, not fatal — the rest of the registry still loads); writing is
 * atomic and canonical, so `git diff`-ing a hand edit stays readable. */
import { generateBundleId } from "brainpick";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { dataDir, configDir, type Env } from "./paths";

export const REGISTRY_FILE = "brains.toml";
export const DEFAULT_PORT_BASE = 4750; // one above the engine's own default (spec/80 serve.port)

export interface BrainRecord {
  id: string;
  repo: string;
  bundle_path: string;
  port: number;
  enabled: boolean;
}

export interface Registry {
  brains: BrainRecord[];
}

export function registryPath(env: Env = process.env): string {
  return join(configDir(env), REGISTRY_FILE);
}

function isBrainRecord(value: unknown): value is BrainRecord {
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
    typeof v["enabled"] === "boolean"
  );
}

/** Absent file → an empty registry (a fresh daemon has no brains yet). A
 * malformed `[[brain]]` entry is dropped — never brings down the whole file. */
export function loadRegistry(env: Env = process.env): Registry {
  let text: string;
  try {
    text = readFileSync(registryPath(env), "utf8");
  } catch {
    return { brains: [] };
  }
  let data: unknown;
  try {
    data = parseToml(text);
  } catch {
    return { brains: [] }; // unparseable — treated like absent, never a crash
  }
  const raw = (data as Record<string, unknown>)["brain"];
  const brains = Array.isArray(raw) ? raw.filter(isBrainRecord) : [];
  return { brains };
}

/** Atomic write (tmp file + rename) so a crash mid-write never corrupts the
 * registry a running daemon depends on. */
export function saveRegistry(registry: Registry, env: Env = process.env): void {
  const path = registryPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const text = stringifyToml({ brain: registry.brains as unknown as Record<string, unknown>[] });
  const tmp = join(dirname(path), `.brains-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

// -- pure helpers (no I/O) -------------------------------------------------------------

/** A local filesystem path (absolute or relative), as opposed to a git remote
 * (scp-like `user@host:path` SSH syntax, or any `scheme://` URL). */
export function isLocalRepo(repo: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo)) return false; // scheme://...
  if (/^[^/\s]+@[^/\s]+:/.test(repo)) return false; // git@host:path (scp-like)
  return true;
}

export interface BrainInput {
  id?: string;
  repo?: string;
  bundle_path?: string;
  port?: number;
  enabled?: boolean;
}

export type ValidationResult = { ok: true; brain: BrainRecord } | { ok: false; error: string };

function nextFreePort(registry: Registry): number {
  const used = new Set(registry.brains.map((b) => b.port));
  let port = DEFAULT_PORT_BASE;
  while (used.has(port)) port++;
  return port;
}

/** Everything `POST /daemon/brains` needs before touching disk or a process:
 * repo is required; id/port are minted/assigned when absent; duplicates (id
 * or port) are rejected against the CURRENT registry, not the input alone. */
export function validateBrainInput(input: BrainInput, registry: Registry): ValidationResult {
  const repo = input.repo?.trim() ?? "";
  if (repo === "") return { ok: false, error: "repo is required (a git URL or a local path)" };

  const id = input.id?.trim() || generateBundleId();
  if (registry.brains.some((b) => b.id === id)) {
    return { ok: false, error: `a brain with id '${id}' already exists` };
  }

  const port = input.port ?? nextFreePort(registry);
  if (!Number.isInteger(port) || port <= 0) {
    return { ok: false, error: `port must be a positive integer, got ${port}` };
  }
  if (registry.brains.some((b) => b.port === port)) {
    return { ok: false, error: `port ${port} is already used by another brain` };
  }

  return {
    ok: true,
    brain: {
      id,
      repo,
      bundle_path: input.bundle_path ?? "",
      port,
      enabled: input.enabled ?? true,
    },
  };
}

export function addBrain(registry: Registry, brain: BrainRecord): Registry {
  return { brains: [...registry.brains, brain] };
}

export function removeBrain(registry: Registry, id: string): Registry {
  return { brains: registry.brains.filter((b) => b.id !== id) };
}

export function findBrain(registry: Registry, id: string): BrainRecord | null {
  return registry.brains.find((b) => b.id === id) ?? null;
}

/** Where a remote-repo brain gets cloned (git sync, Supervisor) — never
 * touched for a local-path brain, which serves its `repo` path directly. */
export function clonedRepoDir(brain: BrainRecord, env: Env = process.env): string {
  return join(dataDir(env), "brains", brain.id);
}

/** The bundle root to pass as `--root` to `brainpick serve`: the brain's own
 * path if `repo` is already a local directory, else its clone plus
 * `bundle_path` (the subdirectory within the repo the wiki lives in, ""
 * meaning the repo root itself). */
export function brainBundleRoot(brain: BrainRecord, env: Env = process.env): string {
  const root = isLocalRepo(brain.repo) ? brain.repo : clonedRepoDir(brain, env);
  return brain.bundle_path ? join(root, brain.bundle_path) : root;
}

/** An in-memory registry snapshot backed by the file — every mutation the
 * control API makes goes through `set`, which persists before returning, so
 * a crash right after a response never leaves the in-memory view ahead of
 * disk. */
export interface RegistryStore {
  get(): Registry;
  set(next: Registry): void;
}

export function createRegistryStore(env: Env = process.env): RegistryStore {
  let current = loadRegistry(env);
  return {
    get: () => current,
    set: (next) => {
      saveRegistry(next, env);
      current = next;
    },
  };
}
