/** brainpick.toml (spec/80): defaults when absent, env overrides, unknown keys warn.
 * Layering: brainpick.local.toml (machine-local endpoints) deep-merges over the
 * shared file — precedence CLI > env > local.toml > toml > defaults. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export interface BundleConfig {
  root: string;
  include: string[];
  exclude: string[];
}

export interface IndexConfig {
  mode: string;
  file: string;
}

export interface ServeConfig {
  host: string;
  port: number;
  transports: string[];
  watch: boolean;
  writes: string;
  token: string;
  max_asset_bytes: number; // 8 MiB default — the POST /api/assets upload cap (spec/50)
}

export interface ValidateConfig {
  henxels: string;
}

export interface UiConfig {
  max_nodes_mobile: number; // node cap the web UI applies on mobile/weak GPUs
  default_mode: string; // cosmos | brain — the view the UI opens in (spec/80)
}

export interface ModulesConfig {
  vectors: string; // auto | on | off — T2 (spec/30)
  graph: string; // auto | on | off — T3 (M3)
  ui: boolean;
}

export interface EmbeddingConfig {
  kind: string; // ollama | openai-compatible | openai | fastembed | mock (test hook)
  endpoint: string;
  model: string;
  dim: number; // 0 = unknown; discovered from the first embedding response
}

export interface ExtractionConfig {
  kind: string; // ollama | openai-compatible — T3's model, doubles as the merge resolver
  endpoint: string;
  model: string;
  api_key_env: string; // names an env var, never a key (spec/80)
}

export interface ModelsConfig {
  embedding: EmbeddingConfig;
  extraction: ExtractionConfig;
}

export interface Config {
  spec: string;
  bundle: BundleConfig;
  index: IndexConfig;
  modules: ModulesConfig;
  models: ModelsConfig;
  serve: ServeConfig;
  ui: UiConfig;
  validate: ValidateConfig;
}

export function defaultConfig(): Config {
  return {
    spec: "0.1",
    bundle: { root: ".", include: ["**/*.md"], exclude: [] },
    index: { mode: "section", file: "index.md" },
    modules: { vectors: "auto", graph: "off", ui: true },
    models: {
      embedding: { kind: "", endpoint: "", model: "", dim: 0 },
      extraction: { kind: "", endpoint: "", model: "", api_key_env: "" },
    },
    serve: {
      host: "127.0.0.1",
      port: 4747,
      transports: ["streamable-http"],
      watch: true,
      writes: "guarded",
      token: "",
      max_asset_bytes: 8388608,
    },
    ui: { max_nodes_mobile: 8000, default_mode: "cosmos" },
    validate: { henxels: "auto" },
  };
}

const SECTIONS = ["bundle", "index", "modules", "serve", "ui", "validate"] as const;
// [models.*] tables are nested and handled separately below.
const KNOWN_TOP = new Set(["spec", "models", ...SECTIONS]);

type SectionValue = string | number | boolean | string[];
type Warn = (message: string) => void;

/** Python `str()` over the plausible TOML scalar types. */
function pyStrOf(value: unknown): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

/** Nudge a TOML value toward the default's type; forgiving, never raising. */
function coerce(current: SectionValue, value: unknown): SectionValue {
  if (typeof current === "boolean") {
    if (typeof value === "boolean") return value;
    return TRUTHY.has(pyStrOf(value).trim().toLowerCase());
  }
  if (typeof current === "number") {
    // Python int(): numbers truncate, bools are 0/1, strings must be integer literals.
    if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : current;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
    return current;
  }
  if (Array.isArray(current)) {
    if (Array.isArray(value)) return value.map(pyStrOf);
    return [pyStrOf(value)];
  }
  return pyStrOf(value);
}

function fromEnv(current: SectionValue, raw: string): SectionValue {
  if (typeof current === "boolean") {
    const lowered = raw.trim().toLowerCase();
    if (TRUTHY.has(lowered)) return true;
    if (FALSY.has(lowered)) return false;
    return current;
  }
  if (typeof current === "number") {
    if (/^[+-]?\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
    return current;
  }
  if (Array.isArray(current)) {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return raw;
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyTable(
  section: Record<string, SectionValue>,
  table: Record<string, unknown>,
  file: string,
  label: string,
  warn: Warn,
): void {
  for (const [key, value] of Object.entries(table)) {
    if (!Object.prototype.hasOwnProperty.call(section, key)) {
      warn(`${file}: unknown key ${label} ${key} — ignored`);
      continue;
    }
    section[key] = coerce(section[key]!, value);
  }
}

function applyEnv(
  section: Record<string, SectionValue>,
  prefix: string,
  env: Record<string, string | undefined>,
): void {
  for (const key of Object.keys(section)) {
    const raw = env[`${prefix}_${key.toUpperCase()}`];
    if (raw !== undefined) section[key] = fromEnv(section[key]!, raw);
  }
}

const defaultWarn: Warn = (message) => console.warn(message);

const MODEL_TABLES = ["embedding", "extraction"] as const;

/** The shared config plus the machine-local overlay, in merge order. */
export const CONFIG_FILE = "brainpick.toml";
export const LOCAL_CONFIG_FILE = "brainpick.local.toml";

function readToml(path: string, label: string, warn: Warn): Record<string, unknown> | null {
  let text: string | null = null;
  try {
    if (statSync(path).isFile()) text = readFileSync(path, "utf8");
  } catch {
    return null; // absent — this layer contributes nothing
  }
  if (text === null) return null;
  try {
    return parseToml(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const consequence = label === CONFIG_FILE ? "using defaults" : "ignoring it";
    warn(`${label} is not valid TOML (${msg}) — ${consequence}`);
    return null;
  }
}

function applyData(config: Config, data: Record<string, unknown>, label: string, warn: Warn): void {
  if ("spec" in data) config.spec = pyStrOf(data["spec"]);
  for (const key of Object.keys(data)) {
    if (!KNOWN_TOP.has(key)) warn(`${label}: unknown key '${key}' — ignored`);
  }

  for (const sectionName of SECTIONS) {
    const section = config[sectionName] as unknown as Record<string, SectionValue>;
    const table = data[sectionName];
    if (!isTable(table)) continue;
    applyTable(section, table, label, `[${sectionName}]`, warn);
  }

  const models = data["models"];
  if (isTable(models)) {
    for (const [tableName, table] of Object.entries(models)) {
      if (!(MODEL_TABLES as readonly string[]).includes(tableName)) {
        warn(`${label}: unknown table [models.${tableName}] — ignored`);
        continue;
      }
      if (!isTable(table)) continue;
      applyTable(
        config.models[tableName as (typeof MODEL_TABLES)[number]] as unknown as Record<string, SectionValue>,
        table,
        label,
        `[models.${tableName}]`,
        warn,
      );
    }
  }
}

/** Read <root>/brainpick.toml, deep-merge <root>/brainpick.local.toml over it
 * (spec/80 layering), then apply env overrides; absent files mean all defaults
 * (zero-config bundles). */
export function loadConfig(
  root: string,
  env: Record<string, string | undefined> = process.env,
  warn: Warn = defaultWarn,
): Config {
  const config = defaultConfig();

  for (const file of [CONFIG_FILE, LOCAL_CONFIG_FILE]) {
    const data = readToml(join(root, file), file, warn);
    if (data !== null) applyData(config, data, file, warn);
  }

  for (const sectionName of SECTIONS) {
    const section = config[sectionName] as unknown as Record<string, SectionValue>;
    applyEnv(section, `BRAINPICK_${sectionName.toUpperCase()}`, env);
  }
  for (const tableName of MODEL_TABLES) {
    applyEnv(
      config.models[tableName] as unknown as Record<string, SectionValue>,
      `BRAINPICK_MODELS_${tableName.toUpperCase()}`,
      env,
    );
  }

  return config;
}
