/** The proactive new-version notice (spec/80 `[update] check`).
 *
 * Agents never check for updates; the brain tells them. One registry lookup per
 * 24 h, probe-timed (a miss is silent), cached under ~/.cache/brainpick, opt-out
 * by config or `BRAINPICK_UPDATE_CHECK=false`. The result is surfaced — never
 * enforced — where agents already look: the AGENTS.md report (spec/20), the
 * `brain_overview` payload (spec/70) and one line of compile output. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CACHE_TTL_S = 24 * 3600;
export const PROBE_TIMEOUT_MS = 300; // spec/30's probe budget: never make a compile feel slow
export const ENV_SWITCH = "BRAINPICK_UPDATE_CHECK";
const FALSY = new Set(["0", "false", "no", "off"]);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export type Impl = "python" | "node";
export interface UpdateNotice {
  current: string;
  latest: string;
  hint: string;
}

const REGISTRY: Record<Impl, string> = {
  python: "https://pypi.org/pypi/brainpick/json",
  node: "https://registry.npmjs.org/brainpick/latest",
};
const UPGRADE_HINT: Record<Impl, string> = {
  python: "pip install -U brainpick",
  node: "npm install -g brainpick",
};

export function registryUrl(impl: Impl): string {
  return REGISTRY[impl];
}

export function defaultCacheDir(): string {
  return join(homedir(), ".cache", "brainpick");
}

function core(version: string): [number, number, number] | null {
  const m = SEMVER.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Semantic comparison on the MAJOR.MINOR.PATCH core; a pre-release or an
 * unparsable string never counts as newer (spec/80). */
export function isNewer(current: string, latest: string): boolean {
  const a = core(current);
  const b = core(latest ?? "");
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i]! !== a[i]!) return b[i]! > a[i]!;
  }
  return false;
}

export function noticeFor(impl: Impl, current: string, latest: string | null): UpdateNotice | null {
  if (latest === null || !isNewer(current, latest)) return null;
  return { current, latest, hint: UPGRADE_HINT[impl] };
}

/** One HTTPS GET within the probe budget; any failure is a silent miss. */
export async function fetchLatest(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const record = data as Record<string, unknown>;
    const info = record["info"];
    const version =
      typeof info === "object" && info !== null // PyPI shape
        ? (info as Record<string, unknown>)["version"]
        : record["version"]; // npm `/latest` shape
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export interface CheckOptions {
  env?: Record<string, string | undefined>;
  cacheDir?: string;
  fetch?: (url: string) => Promise<string | null>;
  enabled?: boolean;
}

/** The notice `{current, latest, hint}` when something newer is known, else
 * null. Opt-out (config or env) never touches the network or the cache. */
export async function checkForUpdate(impl: Impl, current: string, opts: CheckOptions = {}): Promise<UpdateNotice | null> {
  const env = opts.env ?? process.env;
  if (opts.enabled === false || FALSY.has((env[ENV_SWITCH] ?? "").trim().toLowerCase())) return null;
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const cache = join(cacheDir, "latest.json");
  const fetchFn = opts.fetch ?? fetchLatest;

  let latest: string | null = null;
  let fresh = false;
  try {
    const cached = JSON.parse(readFileSync(cache, "utf8")) as Record<string, unknown>;
    if (
      cached["impl"] === impl &&
      Date.now() / 1000 - Number(cached["checked_at"] ?? 0) < CACHE_TTL_S
    ) {
      latest = typeof cached["latest"] === "string" ? cached["latest"] : null;
      fresh = true;
    }
  } catch {
    // no cache yet, or unreadable: fetch
  }
  if (!fresh) {
    latest = await fetchFn(registryUrl(impl)); // a miss is cached as a miss: no retry storm
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cache, JSON.stringify({ impl, checked_at: Date.now() / 1000, latest }));
    } catch {
      // a read-only home never blocks a compile
    }
  }
  return noticeFor(impl, current, latest);
}
