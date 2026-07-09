/** `brainpick init` and `brainpick doctor` (docs/onboarding.md): detect, propose,
 * compile, glow — and never interrogate.
 *
 * Henxels-family voice: a box banner and colors on a TTY, plain lines in pipes, and
 * every error is an instruction. init never rewrites what it does not own — existing
 * configs and henxels.yaml get paste-able fragments, not edits. The two things init
 * DOES own are brainpick.local.toml (spec/80 layering: detected endpoints are
 * machine-local, written there, and kept out of git) and the .brainpick-auth.json
 * gitignore line (spec/80 auth: secrets must never enter git).
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import { AUTH_FILE, authActive, ensureGitignored, loadAuth } from "./auth";
import { checkFresh, runCompile } from "./compile/pipeline";
import { CONFIG_FILE, generateBundleId, LOCAL_CONFIG_FILE, loadConfig } from "./config";
import {
  detectBundle,
  detectHenxels,
  detectLinkStyle,
  findRepoRoot,
  henxelsOnPath,
  openaiKeyPresent,
  probeBackends,
  type Backend,
  type BundleInfo,
  type Env,
  type ProbeResult,
} from "./detect";
import { resolveUiDir } from "./serve/app";
import { lancedbAvailable } from "./vectorstore";
import { PACKAGE_ROOT } from "./version";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export const BANNER = `   ╭──────────────────╮
   │    ◉ ─── ◉       │   brainpick
   │     ╲   ╱        │   pick your agent's brain
   │  ◉ ─── ◉ ─── ◉   │   compile · serve · glow
   ╰──────────────────╯`;

export const OPENAI_ENDPOINT = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
export const PULL_HINT = "ollama pull nomic-embed-text";

const CONFIG_TEMPLATE = `# brainpick.toml — written by \`brainpick init\`; every key is optional (spec 0.1).
# SHARED bundle policy — machine-local endpoints live in brainpick.local.toml.
# Env overrides: BRAINPICK_<SECTION>_<KEY>. CLI flags override both.
spec = "0.1"

[bundle]
root = "."                        # the bundle lives right here
include = ["**/*.md"]
exclude = []                      # .brainpick/, .git/, _temp/, node_modules/ always excluded
id = "{id}"                       # minted once — an address for this brain, never a credential

[index]
mode = "section"                  # manage | section | off — how index.md is maintained
file = "index.md"

[modules]                         # T1 always compiles; the deeper tiers are switchable
vectors = "auto"                  # auto | on | off — T2 semantic search (embedding backend required)
graph = "algorithmic"             # algorithmic (default) | lightrag | auto | off — T3 entity graph
ui = true

[serve]
host = "127.0.0.1"
port = 4747
transports = ["streamable-http"]  # add "sse" for the legacy transport
watch = true                      # recompile when bundle files change
writes = "guarded"                # guarded | off — agent writes are validated, never blind
token = ""                        # required for non-localhost binds

[validate]
henxels = "auto"                  # auto | always | never — honor a henxels contract when present
`;

const LOCAL_CONFIG_TEMPLATE = `# brainpick.local.toml — machine-local overrides written by \`brainpick init\`.
# Deep-merges over brainpick.toml (spec/80 layering); keep it out of version control.

[models.embedding]                # detected at init; T2 embeds with it
kind = "{kind}"
endpoint = "{endpoint}"
model = "{model}"
`;

export type Print = (line: string) => void;

export function isFancy(env: Env = process.env, stream: { isTTY?: boolean } = process.stdout): boolean {
  if (env["NO_COLOR"] || env["CI"] || env["BRAINPICK_PLAIN"]) return false;
  return Boolean(stream.isTTY);
}

/** ✓/○/✗ lines — colored on a TTY, identical but plain in pipes. */
export class Voice {
  readonly fancy: boolean;
  private readonly print: Print;

  constructor(env: Env, print: Print) {
    this.fancy = isFancy(env);
    this.print = print;
  }

  private c(text: string, code: string): string {
    return this.fancy ? `${code}${text}${RESET}` : text;
  }

  banner(): void {
    if (this.fancy) {
      this.print(this.c(BANNER, CYAN));
      this.print("");
    }
  }

  line(mark: string, text: string): void {
    const color = mark === "✓" ? GREEN : mark === "✗" ? RED : mark === "○" ? DIM : "";
    this.print(`${this.c(mark, color)} ${text}`);
  }

  arrow(text: string): void {
    this.print(`    ${this.c("→ " + text, CYAN)}`);
  }

  step(text: string): void {
    this.print(`    ${text}`);
  }

  raw(text = ""): void {
    this.print(text);
  }
}

// -- paths and paste-ables ---------------------------------------------------------

/** This checkout's packages/node — src/ is present in dev, absent in installed tarballs. */
export function packageProjectDir(): string | null {
  const project = resolve(PACKAGE_ROOT);
  try {
    if (statSync(join(project, "src", "cli.ts")).isFile()) return project;
  } catch {
    /* installed package — no src/ */
  }
  return null;
}

/** A brainpick invocation that works from anywhere, for this installation. */
export function brainpickCommand(): string[] {
  const project = packageProjectDir();
  if (project !== null) return ["node", join(project, "dist", "cli.js")];
  return ["npx", "brainpick"]; // published: npx resolves it from the registry
}

/** The shared brainpick.toml — bundle policy only, endpoint-free by design.
 * `bundleId` is baked in fresh (spec/80 `[bundle] id`) so a newly scaffolded
 * bundle is identifiable from the first commit. */
export function renderConfig(bundleId: string): string {
  return CONFIG_TEMPLATE.replace("{id}", bundleId);
}

/** A paste-able `[bundle] id` line for an EXISTING config that lacks one —
 * init never rewrites a config it does not own (see module docstring). */
export function bundleIdFragment(bundleId: string): string {
  return `  [bundle]\n  id = "${bundleId}"`;
}

export function renderLocalConfig(backend: Backend): string {
  return LOCAL_CONFIG_TEMPLATE.replace("{kind}", backend.kind)
    .replace("{endpoint}", backend.endpoint)
    .replace("{model}", backend.model ?? "");
}

function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

export function mcpSnippets(bundle: string): string {
  const command = [...brainpickCommand(), "mcp", "--root", bundle];
  const generic = { mcpServers: { brainpick: { command: command[0], args: command.slice(1) } } };
  const opencode = { mcp: { brainpick: { type: "local", command, enabled: true } } };
  const parts = [
    "Hand these keys to your agents:",
    "",
    "  Claude Code",
    `    claude mcp add brainpick -- ${command.join(" ")}`,
    "",
    "  any MCP host (stdio JSON)",
    indent(JSON.stringify(generic, null, 2)),
    "",
    "  opencode (opencode.json)",
    indent(JSON.stringify(opencode, null, 2)),
  ];
  if (packageProjectDir() !== null) {
    parts.push("", `  ○ once published this shrinks to: npx brainpick mcp --root ${bundle}`);
  }
  return parts.join("\n");
}

/** The freshness gate, paste-able into an existing contract — never applied for you. */
export function henxelsFragment(contract: string, bundle: string): string {
  const root = relative(resolve(contract, ".."), bundle) || ".";
  const command = [...brainpickCommand(), "compile", "--check-fresh", "--root", root].join(" ");
  return (
    '  - henxel: "The compiled brain is fresh before every commit"\n' +
    "    why: agents navigate the compiled artifacts — stale artifacts lie to them\n" +
    `    run_before_commit: "${command}"`
  );
}

/** The repo .gitignore that should learn `.brainpick/` — or null if covered/absent. */
/** The `[bundle] id` an existing config already carries, or null (absent,
 * empty, or the file fails to parse — a broken config gets its own doctor
 * line elsewhere, init just skips the suggestion rather than pile on). */
function existingBundleId(configPath: string): string | null {
  let data: unknown;
  try {
    data = parseToml(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
  const bundle = (data as Record<string, unknown>)?.["bundle"];
  const id = bundle !== null && typeof bundle === "object" ? (bundle as Record<string, unknown>)["id"] : undefined;
  return typeof id === "string" && id !== "" ? id : null;
}

export function gitignoreSuggestion(bundle: string): string | null {
  const repo = findRepoRoot(bundle);
  if (repo === null) return null;
  const gitignore = join(repo, ".gitignore");
  let text: string;
  try {
    if (!statSync(gitignore).isFile()) return null;
    text = readFileSync(gitignore, "utf8");
  } catch {
    return null;
  }
  return text.includes(".brainpick") ? null : gitignore;
}

/** spec/80: brainpick.local.toml is machine-local — init adds it to the repo
 * .gitignore itself (when one exists). Returns the path it edited, or null. */
function gitignoreLocalConfig(bundle: string): string | null {
  const repo = findRepoRoot(bundle);
  if (repo === null) return null;
  const gitignore = join(repo, ".gitignore");
  let text: string;
  try {
    if (!statSync(gitignore).isFile()) return null;
    text = readFileSync(gitignore, "utf8");
  } catch {
    return null;
  }
  if (text.includes(LOCAL_CONFIG_FILE)) return null;
  const glue = text === "" || text.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignore, text + glue + LOCAL_CONFIG_FILE + "\n", "utf8");
  return gitignore;
}

// -- init --------------------------------------------------------------------------

function handOffToHenxels(voice: Voice, root: string, bundle: BundleInfo): number {
  if (bundle.docs === 0) {
    voice.line("✗", `no bundle at ${root} — the directory holds no markdown yet`);
  } else {
    voice.line(
      "✗",
      `no bundle at ${root} — ${bundle.docs} .md files but only ${bundle.typed} ` +
        "carry OKF `type:` frontmatter (3+ needed, or an index.md with okf_version)",
    );
  }
  voice.step("brainpick never scaffolds wikis — its sibling henxels owns the template:");
  voice.step("  uv tool install henxels");
  voice.step(`  cd ${root} && henxels init --template okf-llm-wiki --wiki-dir .`);
  voice.step(`then come back: brainpick init --root ${root}`);
  return 1;
}

/** Print the probe verdicts; return the backend worth recording (or null). */
function reportBackends(voice: Voice, results: readonly ProbeResult[], env: Env, yes: boolean): Backend | null {
  const found = results.find(([, b]) => b !== null && b.model !== null);
  if (found !== undefined) {
    const [label, backend] = found;
    voice.line(
      "✓",
      `embeddings: ${backend!.model} via ${label} at ${backend!.endpoint}` +
        " — T2 embeds with it on the next compile",
    );
    return backend;
  }

  const ollama = results.find(([label, b]) => label === "ollama" && b !== null)?.[1] ?? null;
  if (ollama !== null) {
    // up, but modelless — offer the exact pull
    voice.line("○", `embeddings: ollama is up at ${ollama.endpoint} but has no embedding model`);
    voice.arrow(`${PULL_HINT}  (then rerun brainpick init)`);
  } else {
    voice.line("○", "embeddings: no local backend found — T1 shines without one");
    voice.arrow(`light it up later: ${PULL_HINT}  (then rerun brainpick init)`);
  }

  if (openaiKeyPresent(env)) {
    if (yes) {
      voice.line(
        "✓",
        `embeddings: OPENAI_API_KEY accepted (--yes) — recording ${OPENAI_DEFAULT_MODEL} for T2`,
      );
      return { kind: "openai", endpoint: OPENAI_ENDPOINT, model: OPENAI_DEFAULT_MODEL };
    }
    voice.line(
      "○",
      "OPENAI_API_KEY detected — a paid API stays opt-in (local-first):" +
        " rerun with --yes to record it",
    );
  }
  return null;
}

export interface InitOptions {
  yes?: boolean;
  dryRun?: boolean;
  env?: Env;
  probes?: readonly ProbeResult[];
  print?: Print;
}

export async function runInit(root: string, options: InitOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const yes = options.yes ?? false;
  const voice = new Voice(env, options.print ?? ((line) => console.log(line)));
  voice.banner();

  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    voice.line("✗", `${root} is not a directory`);
    voice.arrow(`create it (mkdir -p ${root}) or point --root at your bundle`);
    return 1;
  }
  root = resolve(root);

  // 1 — the bundle
  const bundle = detectBundle(root);
  if (bundle.kind === "none") return handOffToHenxels(voice, root, bundle);
  if (bundle.kind === "okf") {
    voice.line("✓", `bundle: OKF at ${root} — index.md declares okf_version (${bundle.docs} docs)`);
  } else {
    voice.line("✓", `bundle: ${bundle.typed} typed concept docs at ${root} (density scan)`);
  }

  // 2 — link style (informational in 0.1)
  const style = detectLinkStyle(root);
  if (style.style === "none") {
    voice.line("○", "links: none yet — write [title](path.md) links and the graph appears");
  } else {
    voice.line(
      "○",
      `links: ${style.style} style (${style.markdown} markdown · ${style.wikilinks} wikilinks)`,
    );
  }

  // 3 — backends (parallel 300 ms probes; failures are silent misses)
  const results = options.probes ?? (await probeBackends(env));
  const backend = reportBackends(voice, results, env, yes);

  // 4 — henxels
  const contract = detectHenxels(root);
  if (contract !== null) {
    voice.line("✓", `henxels: contract at ${contract} — freshness gate offered below`);
  } else {
    voice.line("○", "henxels: no contract governs this bundle (optional) — uv tool install henxels");
  }

  if (options.dryRun) {
    voice.raw();
    voice.raw("dry run — nothing written. init would:");
    if (fileExists(join(root, CONFIG_FILE))) {
      voice.step(`• keep the existing ${CONFIG_FILE} (never rewritten)`);
      if (existingBundleId(join(root, CONFIG_FILE)) === null) {
        voice.step("• suggest a [bundle] id fragment to paste in yourself");
      }
    } else {
      voice.step(`• write ${CONFIG_FILE} at the bundle root`);
      voice.step("• mint a [bundle] id — a stable address for this brain");
    }
    if (backend !== null) {
      voice.step(
        `• record the detected embedding backend in ${LOCAL_CONFIG_FILE} (machine-local, git-ignored)`,
      );
    }
    voice.step("• compile T1 into .brainpick/ and manage the index.md section");
    voice.step("• print the MCP snippets and the serve command");
    return 0;
  }

  // 5 — config (written once; an existing config is the user's, not ours).
  // The shared file carries bundle policy; detected endpoints are machine-local
  // and go to brainpick.local.toml (spec/80 layering).
  const configPath = join(root, CONFIG_FILE);
  if (fileExists(configPath)) {
    voice.line("○", `config: ${CONFIG_FILE} exists — left untouched`);
    if (existingBundleId(configPath) === null) {
      // the one thing init suggests but never writes into an owned file —
      // same treatment as the henxels fragment and the gitignore lines below.
      voice.line("○", "no [bundle] id yet (spec/80) — paste this in yourself:");
      voice.raw(bundleIdFragment(generateBundleId()));
    }
  } else {
    writeFileSync(configPath, renderConfig(generateBundleId()), "utf8");
    voice.line("✓", `config: ${CONFIG_FILE} written`);
  }
  if (backend !== null) {
    const localPath = join(root, LOCAL_CONFIG_FILE);
    if (fileExists(localPath)) {
      voice.line("○", `config: ${LOCAL_CONFIG_FILE} exists — left untouched`);
      voice.step(
        `pin the detected backend yourself: [models.embedding] ` +
          `kind = "${backend.kind}", model = "${backend.model}"`,
      );
    } else {
      writeFileSync(localPath, renderLocalConfig(backend), "utf8");
      voice.line("✓", `config: ${LOCAL_CONFIG_FILE} written ([models.embedding] recorded — machine-local)`);
      const ignored = gitignoreLocalConfig(root);
      if (ignored !== null) {
        voice.line("✓", `gitignore: ${LOCAL_CONFIG_FILE} added to ${ignored} (endpoints stay off the record)`);
      }
    }
  }

  const gitignore = gitignoreSuggestion(root);
  if (gitignore !== null) {
    voice.line("○", `compiled artifacts are disposable — add to ${gitignore} yourself:`);
    voice.step(".brainpick/");
  }

  // spec/80: secrets must never enter git — the auth commands append this line
  // themselves, and init pre-teaches it (like the brainpick.local.toml line above).
  const authIgnored = ensureGitignored(root);
  if (authIgnored !== null) {
    voice.line("✓", `gitignore: ${AUTH_FILE} added to ${authIgnored} (secrets stay off the record)`);
  }

  // 6 — compile T1
  const result = await runCompile(root);
  const stats = result.stats;
  voice.line(
    "✓",
    `compiled: ${stats.docs} docs · ${stats.edges} links · ` +
      `${stats.orphans} orphans — your brain, compiled`,
  );

  // 7 — hand out the keys
  voice.raw();
  voice.raw(mcpSnippets(root));

  // 8 — the henxels freshness gate
  if (contract !== null) {
    voice.raw();
    voice.raw(`Gate commits on a fresh brain — paste into ${contract}:`);
    voice.raw();
    voice.raw(henxelsFragment(contract, root));
  }

  // 9 — glow
  const serve = [...brainpickCommand(), "serve", "--root", root, "--open"].join(" ");
  voice.raw();
  voice.raw(`Serve the brain: ${serve}`);
  return 0;
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// -- doctor ------------------------------------------------------------------------

export interface DoctorOptions {
  env?: Env;
  probes?: readonly ProbeResult[];
  print?: Print;
  /** Test hook mirroring pytest's lancedb_available monkeypatch. */
  lancedb?: () => Promise<boolean>;
}

export async function runDoctor(root: string, options: DoctorOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const voice = new Voice(env, options.print ?? ((line) => console.log(line)));
  root = resolve(root);
  let failed = false;

  const emit = (mark: string, text: string, fix?: string): void => {
    voice.line(mark, text);
    if (fix) voice.arrow(fix);
    if (mark === "✗") failed = true;
  };

  // config parses (or defaults) — both layers get a line when present
  const configPath = join(root, CONFIG_FILE);
  if (!fileExists(configPath)) {
    emit("✓", "config: none — defaults apply (a bundle needs zero config)");
  } else {
    try {
      parseToml(readFileSync(configPath, "utf8"));
      emit("✓", `config: ${CONFIG_FILE} parses`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      emit(
        "✗",
        `config: ${CONFIG_FILE} is not valid TOML (${msg})`,
        `fix the syntax in ${configPath} — the engine falls back to defaults meanwhile`,
      );
    }
  }
  const localPath = join(root, LOCAL_CONFIG_FILE);
  if (fileExists(localPath)) {
    try {
      parseToml(readFileSync(localPath, "utf8"));
      emit("✓", `config: ${LOCAL_CONFIG_FILE} parses (machine-local overrides)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      emit(
        "✗",
        `config: ${LOCAL_CONFIG_FILE} is not valid TOML (${msg})`,
        `fix the syntax in ${localPath} — its overrides are ignored meanwhile`,
      );
    }
  }

  // bundle
  const bundle = isDirectory(root) ? detectBundle(root) : { kind: "none", docs: 0, typed: 0 };
  if (bundle.kind === "okf") {
    emit("✓", `bundle: OKF (${bundle.docs} docs)`);
  } else if (bundle.kind === "density") {
    emit("✓", `bundle: ${bundle.typed} typed concept docs of ${bundle.docs} (density scan)`);
  } else {
    emit("✗", `bundle: nothing OKF-shaped at ${root}`,
      `cd ${root} && henxels init --template okf-llm-wiki --wiki-dir .`);
  }

  // artifacts
  const verdict = checkFresh(root);
  if (verdict.fresh) {
    const manifest = JSON.parse(readFileSync(join(root, ".brainpick", "manifest.json"), "utf8")) as {
      seq: number;
    };
    emit("✓", `artifacts: fresh (seq ${manifest.seq})`);
  } else {
    const reason = verdict.reason.split(" — ")[0]!;
    emit("✗", `artifacts: ${reason}`, `run: brainpick compile --root ${root}`);
  }

  // auth (spec/80): optional, open by default — stdio MCP is never gated either way
  let authStore = null;
  let authCorrupt = false;
  try {
    authStore = loadAuth(root);
  } catch {
    authCorrupt = true;
    emit("✗", `auth: ${AUTH_FILE} is not valid JSON`,
      "fix or delete it — the server fails closed meanwhile");
  }
  if (!authCorrupt) {
    if (authActive(authStore)) {
      const count = authStore!.tokens.length;
      const plural = count === 1 ? "" : "s";
      const passwordState = authStore!.password !== null ? "set" : "absent";
      emit("✓", `auth: ${count} token${plural} · password ${passwordState} — stdio MCP stays ungated`);
    } else {
      emit("○", "auth: open — no auth configured (brainpick token create / password set lock it)");
    }
  }

  // T2 vectors: store installed, backend configured, tier state (spec/30) — optional, never ✗
  const embedding = loadConfig(root, env, () => undefined).models.embedding; // config problems already have their own line above
  let tiers: Record<string, unknown> = {};
  try {
    const manifest = JSON.parse(readFileSync(join(root, ".brainpick", "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    tiers = (manifest["tiers"] ?? {}) as Record<string, unknown>;
  } catch {
    tiers = {};
  }
  const t2State = String(tiers["t2"] ?? "off");
  const lancedbOk = await (options.lancedb ?? lancedbAvailable)();
  if (!embedding.kind) {
    emit("○", "vectors: no [models.embedding] configured — brainpick init detects backends");
  } else if (!lancedbOk) {
    emit("○", "vectors: lancedb missing — npm install @lancedb/lancedb");
  } else if (t2State === "fresh") {
    const model = embedding.model ? ` · ${embedding.model}` : "";
    emit("✓", `vectors: t2 fresh — ${embedding.kind}${model}`);
  } else {
    emit("○", `vectors: configured (${embedding.kind}) but t2 is ${t2State}`,
      `run: brainpick compile --root ${root}`);
  }

  // backend probes
  const results = options.probes ?? (await probeBackends(env));
  for (const [label, backend] of results) {
    if (backend === null) {
      emit("○", `${label}: not reachable`);
    } else if (backend.model === null) {
      const hint = label === "ollama" ? ` — ${PULL_HINT}` : "";
      emit("○", `${label}: up at ${backend.endpoint}, no embedding model${hint}`);
    } else {
      emit("✓", `${label}: ${backend.model} at ${backend.endpoint}`);
    }
  }
  if (openaiKeyPresent(env)) {
    emit("○", "OPENAI_API_KEY: set — a paid API stays opt-in (brainpick init --yes records it)");
  } else {
    emit("○", "OPENAI_API_KEY: not set");
  }

  // henxels
  const onPath = henxelsOnPath(env);
  const contract = detectHenxels(root);
  if (onPath && contract !== null) {
    emit("✓", `henxels: on PATH · contract at ${contract}`);
  } else if (onPath) {
    emit("○", `henxels: on PATH · no contract governs ${root}`);
  } else if (contract !== null) {
    emit("○", `henxels: contract at ${contract} but the CLI is missing — uv tool install henxels`);
  } else {
    emit("○", "henxels: not installed (optional) — uv tool install henxels");
  }

  // UI assets
  const uiDir = resolveUiDir();
  if (uiDir !== null) {
    emit("✓", `ui: ${uiDir}`);
  } else {
    emit("○", "ui: not built — the fallback page serves; build once:" +
      " cd packages/webui && npm run build");
  }

  // the python sibling engine
  const project = packageProjectDir();
  const pyProject = project !== null ? join(project, "..", "python", "pyproject.toml") : null;
  if (pyProject !== null && fileExists(pyProject)) {
    emit("✓", `python engine: ${resolve(pyProject, "..")}`);
  } else {
    emit("○", "python engine: no pip sibling next to this checkout — either engine serves the same spec");
  }

  return failed ? 1 : 0;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
