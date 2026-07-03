/** Environment detection for init/doctor (docs/embedding-detection.md, docs/onboarding.md).
 *
 * Detect rather than interrogate: bundle shape and link style come from reading the
 * markdown, backends from parallel 300 ms probes. A probe that fails is a silent miss —
 * detection never raises and never stalls the choreography. Ports detect.py.
 */
import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import { ALWAYS_EXCLUDED_DIRS } from "./core/bundle";
import { cmpStr } from "./core/canonical";
import { splitFrontmatter } from "./core/frontmatter";
import { extractLinks } from "./core/links";

export const PROBE_TIMEOUT_MS = 300; // a miss must never make init feel slow
export const PREFERRED_EMBEDDING_MODELS = [
  "nomic-embed-text",
  "mxbai-embed-large",
  "snowflake-arctic-embed2",
  "bge-m3",
] as const;
export const DEFAULT_OLLAMA = "http://127.0.0.1:11434";
export const DEFAULT_OPENAI_COMPATIBLE: ReadonlyArray<readonly [string, string]> = [
  ["lm studio", "http://127.0.0.1:1234"],
  ["llama.cpp", "http://127.0.0.1:8080"],
];
export const MIN_TYPED_DOCS = 3; // density scan: this many `type:` frontmatters look like a bundle

export type Env = Record<string, string | undefined>;

export interface Backend {
  kind: string; // "ollama" | "openai-compatible" | "openai"
  endpoint: string;
  model: string | null; // null: the endpoint answered but offers no embedding model
}

export interface BundleInfo {
  kind: string; // "okf" | "density" | "none"
  docs: number; // markdown files seen (excluded dirs skipped)
  typed: number; // of those, files with `type:` frontmatter
}

export interface LinkStyle {
  style: string; // "markdown" | "wikilinks" | "mixed" | "none"
  markdown: number;
  wikilinks: number;
}

export type ProbeResult = readonly [label: string, backend: Backend | null];

// -- bundle ------------------------------------------------------------------------

function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!ALWAYS_EXCLUDED_DIRS.has(entry.name)) walk(join(dir, entry.name), childRel);
      } else if (entry.name.endsWith(".md")) {
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            isFile = statSync(join(dir, entry.name)).isFile();
          } catch {
            isFile = false;
          }
        }
        if (isFile) out.push(childRel);
      }
    }
  };
  walk(root, "");
  return out.sort(cmpStr);
}

/** okf (index.md declares okf_version) > density (>= 3 typed docs) > none. */
export function detectBundle(root: string): BundleInfo {
  const files = markdownFiles(root);
  let okf = false;
  let typed = 0;
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const [meta] = splitFrontmatter(text);
    if (rel === "index.md" && meta["okf_version"] !== null && meta["okf_version"] !== undefined) {
      okf = true;
    }
    if (meta["type"] !== null && meta["type"] !== undefined) typed += 1;
  }
  if (okf) return { kind: "okf", docs: files.length, typed };
  if (typed >= MIN_TYPED_DOCS) return { kind: "density", docs: files.length, typed };
  return { kind: "none", docs: files.length, typed };
}

/** Informational in 0.1: how this bundle links, counted from the bodies. */
export function detectLinkStyle(root: string): LinkStyle {
  let markdown = 0;
  let wikilinks = 0;
  for (const rel of markdownFiles(root)) {
    let text: string;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const [, body] = splitFrontmatter(text);
    for (const link of extractLinks(body)) {
      if (link.kind === "wikilink") wikilinks += 1;
      else markdown += 1;
    }
  }
  let style: string;
  if (markdown === 0 && wikilinks === 0) style = "none";
  else if (wikilinks === 0) style = "markdown";
  else if (markdown === 0) style = "wikilinks";
  else style = "mixed";
  return { style, markdown, wikilinks };
}

// -- backends ----------------------------------------------------------------------

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null; // a miss is silent — down, slow, or gibberish all mean "not here"
  }
}

function pickEmbeddingModel(names: string[]): string | null {
  const embeddable = names.filter((name) => name.toLowerCase().includes("embed"));
  for (const preferred of PREFERRED_EMBEDDING_MODELS) {
    for (const name of embeddable) {
      if (name.includes(preferred)) return name;
    }
  }
  return embeddable[0] ?? null;
}

function normalizeHost(value: string): string {
  let host = value.trim().replace(/\/+$/, "");
  if (!host.includes("://")) host = `http://${host}`;
  return host;
}

export async function probeOllama(env: Env = process.env): Promise<Backend | null> {
  const base = normalizeHost(env["OLLAMA_HOST"] || DEFAULT_OLLAMA);
  const data = await getJson(`${base}/api/tags`);
  if (data === null) return null;
  const models = Array.isArray(data["models"]) ? (data["models"] as unknown[]) : [];
  const names = models
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null && !Array.isArray(m))
    .map((m) => String(m["name"] ?? ""));
  return { kind: "ollama", endpoint: base, model: pickEmbeddingModel(names) };
}

export async function probeOpenaiCompatible(base: string): Promise<Backend | null> {
  const host = normalizeHost(base);
  const data = await getJson(`${host}/v1/models`);
  if (data === null) return null;
  const models = Array.isArray(data["data"]) ? (data["data"] as unknown[]) : [];
  const ids = models
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null && !Array.isArray(m))
    .map((m) => String(m["id"] ?? ""));
  return { kind: "openai-compatible", endpoint: `${host}/v1`, model: pickEmbeddingModel(ids) };
}

/** All probes in parallel, ladder order preserved: ollama, then OpenAI-compatible. */
export async function probeBackends(
  env: Env = process.env,
  openaiCompatible: ReadonlyArray<readonly [string, string]> = DEFAULT_OPENAI_COMPATIBLE,
): Promise<ProbeResult[]> {
  const first = probeOllama(env);
  const rest = openaiCompatible.map(
    async ([label, base]) => [label, await probeOpenaiCompatible(base)] as const,
  );
  return [["ollama", await first] as const, ...(await Promise.all(rest))];
}

/** The first backend that actually has an embedding model — the ladder's answer. */
export function pickBackend(results: readonly ProbeResult[]): Backend | null {
  for (const [, backend] of results) {
    if (backend !== null && backend.model !== null) return backend;
  }
  return null;
}

export function openaiKeyPresent(env: Env = process.env): boolean {
  return Boolean(env["OPENAI_API_KEY"]);
}

// -- surroundings ------------------------------------------------------------------

/** The nearest ancestor (or self) holding a .git — where .gitignore would live. */
export function findRepoRoot(start: string): string | null {
  let candidate = resolve(start);
  for (;;) {
    try {
      statSync(join(candidate, ".git"));
      return candidate;
    } catch {
      /* keep climbing */
    }
    const parent = resolve(candidate, "..");
    if (parent === candidate) return null;
    candidate = parent;
  }
}

/** henxels.yaml at the bundle root, or at the repo root above it. */
export function detectHenxels(root: string): string | null {
  const resolved = resolve(root);
  const local = join(resolved, "henxels.yaml");
  try {
    if (statSync(local).isFile()) return local;
  } catch {
    /* not here */
  }
  const repo = findRepoRoot(resolved);
  if (repo !== null && repo !== resolved) {
    const contract = join(repo, "henxels.yaml");
    try {
      if (statSync(contract).isFile()) return contract;
    } catch {
      /* not there either */
    }
  }
  return null;
}

/** shutil.which, minimally: scan PATH for an executable regular file. */
export function which(cmd: string, env: Env = process.env): string | null {
  if (cmd.includes("/") || cmd.includes("\\")) {
    return isExecutableFile(cmd) ? cmd : null;
  }
  const paths = (env["PATH"] ?? "").split(delimiter);
  const exts =
    process.platform === "win32" ? (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of paths) {
    if (dir === "") continue;
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext.toLowerCase());
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function henxelsOnPath(env: Env = process.env): boolean {
  return which("henxels", env) !== null;
}
