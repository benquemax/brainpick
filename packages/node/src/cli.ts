#!/usr/bin/env node
/** brainpick CLI — same verbs, same lines as the Python engine (spec parity). */
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, Option } from "commander";

import { checkFresh, runCompile, type CompileResult, type Tier } from "./compile/pipeline";
import { loadConfig } from "./config";
import { VERSION } from "./version";

function printCompiled(result: CompileResult): void {
  const s = result.stats;
  console.log(
    `compiled: ${s.docs} docs · ${s.edges} links · ${s.ghosts} ghosts` +
      ` · ${s.orphans} orphans · seq ${result.seq}`,
  );
}

function intOption(value: string): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`not an integer: ${value}`);
  return parsed;
}

/** T3 LLM extraction is Python-only (spec/40): the Node engine never runs
 * LightRAG. With `graph = "lightrag"`, `compile --only t3` delegates to an
 * installed Python sibling via uvx, or skips with the exact enabling command.
 * The ALGORITHMIC backend (the default) never reaches this path — it compiles
 * natively. Query over the neutral export stays native in both engines. */
export interface T3Delegate {
  /** The uvx argv to run, or null to skip (prerequisites missing). */
  argv: string[] | null;
  /** The line the CLI prints — the delegating notice or the enabling instruction. */
  message: string;
}

export function planT3Delegate(root: string, hasUv: boolean, hasPython: boolean): T3Delegate {
  if (!hasUv || !hasPython) {
    return {
      argv: null,
      message:
        "T3 extraction is Python-only (spec/40) — the Node engine delegates it. " +
        "Install uv + Python, then: " +
        `uvx --from 'brainpick[graph]' brainpick compile --only t3 --root ${root}`,
    };
  }
  return {
    argv: ["uvx", "--from", "brainpick[graph]", "brainpick", "compile", "--only", "t3", "--root", root],
    message: "delegating T3 extraction to the Python sibling (uvx --from 'brainpick[graph]')",
  };
}

/** True when `cmd` resolves on PATH — probed with `--version`, ENOENT means absent. */
export function commandExists(cmd: string): boolean {
  try {
    const probe = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    return !probe.error;
  } catch {
    return false;
  }
}

/** Run the T3 delegation for `compile --only t3`: print the plan, and when the
 * sibling is present, spawn it inheriting stdio. Returns the process exit code. */
function runT3Delegate(root: string): number {
  const hasUv = commandExists("uvx") || commandExists("uv");
  const hasPython = commandExists("python3") || commandExists("python");
  const plan = planT3Delegate(root, hasUv, hasPython);
  console.log(plan.message);
  if (plan.argv === null) return 0; // an instructive skip is not a failure
  const proc = spawnSync(plan.argv[0], plan.argv.slice(1), { stdio: "inherit" });
  if (proc.error) {
    console.log(`T3 delegation failed to launch (${proc.error.message}) — is uv installed?`);
    return 0;
  }
  return proc.status ?? 0;
}

export interface ShowResult {
  result?: Record<string, unknown>;
  error?: string;
}

/** POST a presentation body to a running server's /api/show (spec/95). The CLI is
 * a client here, never resolving locally: the live server resolves and broadcasts
 * to open UIs. Returns the parsed response or a clear instruction (never throws). */
export async function postShow(
  baseUrl: string,
  body: Record<string, unknown>,
  token?: string | null,
): Promise<ShowResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/show`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `no brainpick server at ${baseUrl} — start one with 'brainpick serve' (${reason})` };
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* non-JSON error body — keep the raw text */
    }
    return { error: `the server rejected the presentation (${res.status}): ${message}` };
  }
  return { result: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

export interface ShowOptions {
  nodes: string[];
  focus?: string;
  mode?: string;
  annotate?: string;
  clear?: boolean;
  host?: string;
  port?: number;
  token?: string;
  json?: boolean;
}

/** brainpick show: build the /api/show body from config + flags, POST it, format.
 * Returns what to print (out/err) and the process exit code. */
export async function showAction(
  root: string,
  opts: ShowOptions,
): Promise<{ out?: string; err?: string; code: number }> {
  const { presentShow, toJson } = await import("./query/present");
  const config = loadConfig(root);
  const host = opts.host ?? config.serve.host;
  const port = opts.port ?? config.serve.port;
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const baseUrl = `http://${displayHost}:${port}`;
  const token = opts.token ?? (config.serve.token || null);

  const body: Record<string, unknown> = { nodes: opts.nodes };
  if (opts.focus) body["focus"] = opts.focus;
  if (opts.mode) body["mode"] = opts.mode;
  if (opts.annotate !== undefined) body["annotation"] = opts.annotate;
  if (opts.clear) body["clear"] = true;

  const { result, error } = await postShow(baseUrl, body, token);
  if (error !== undefined) {
    return opts.json
      ? { out: toJson({ error, hint: "start the server with: brainpick serve" }), code: 1 }
      : { err: error, code: 1 };
  }
  return { out: opts.json ? toJson(result) : presentShow(result!), code: 0 };
}

/** Open the UI in the platform browser — the CLI must not block on it. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* no opener — the printed URL is enough */
  }
}

const program = new Command();
program
  .name("brainpick")
  .description("pick your agent's brain — compile and serve OKF knowledge bundles")
  .version(`brainpick ${VERSION}`, "--version", "show the version and exit");

program
  .command("compile")
  .description("compile the bundle into .brainpick/ artifacts")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--full", "ignore the manifest, rebuild all")
  .option("--check-fresh", "verify freshness without writing (exit 1 when stale)")
  .addOption(
    new Option(
      "--only <tier>",
      "compile a single tier (t2/t3 reuse the compiled docs substrate; t3 with graph=lightrag " +
        "delegates to the Python sibling)",
    ).choices(["t1", "t2", "t3"]),
  )
  .option("--watch", "stay running and recompile on changes")
  .action(
    async (opts: { root: string; full?: boolean; checkFresh?: boolean; only?: string; watch?: boolean }) => {
      const root = resolve(opts.root);
      if (opts.checkFresh) {
        const verdict = checkFresh(root);
        console.log(verdict.fresh ? "fresh" : verdict.reason);
        process.exitCode = verdict.fresh ? 0 : 1;
        return;
      }
      if (opts.only === "t3") {
        const { resolveGraphBackend } = await import("./config");
        if (resolveGraphBackend(loadConfig(root)) === "lightrag") {
          // LLM extraction is Python-only (spec/40) — hand this compile step to the sibling.
          process.exitCode = runT3Delegate(root);
          return;
        }
        // the algorithmic default (and "off") compiles natively below
      }
      const only = opts.only ? ([opts.only] as Tier[]) : null;
      const result = await runCompile(root, opts.full ?? false, only);
      if (result.changed) printCompiled(result);
      else console.log(`fresh — nothing to do (seq ${result.seq})`);
      for (const warning of result.warnings) console.log(warning);

      if (opts.watch) {
        const { watch } = await import("chokidar");
        const { DEBOUNCE_MS, sourceFilter, watchIgnored } = await import("./serve/watcher");

        console.log(`watching ${root} — Ctrl-C stops`);
        const allow = sourceFilter(root);
        const watcher = watch(root, { ignored: watchIgnored(root), ignoreInitial: true });
        let timer: NodeJS.Timeout | null = null;
        let queue: Promise<void> = Promise.resolve();
        const flush = (): void => {
          timer = null;
          queue = queue.then(async () => {
            try {
              const next = await runCompile(root, false, only);
              if (next.changed) printCompiled(next);
              for (const warning of next.warnings) console.log(warning);
            } catch (error) {
              console.error(error instanceof Error ? error.message : String(error));
            }
          });
        };
        const onEvent = (path: string): void => {
          if (!allow(path)) return;
          if (timer === null) timer = setTimeout(flush, DEBOUNCE_MS);
        };
        watcher.on("add", onEvent).on("change", onEvent).on("unlink", onEvent);
        await new Promise<void>((stop) => {
          process.once("SIGINT", () => {
            void watcher.close().then(stop);
          });
        });
      }
    },
  );

program
  .command("serve")
  .description("serve REST + live deltas + web UI + MCP in one process")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--host <host>", "bind host (default: config or 127.0.0.1)")
  .option("--port <port>", "bind port (default: config or 4747)", intOption)
  .option("--no-watch", "serve without the file watcher")
  .option("--open", "open the UI in a browser")
  .action(async (opts: { root: string; host?: string; port?: number; watch: boolean; open?: boolean }) => {
    const { buildApp } = await import("./serve/app");

    const root = resolve(opts.root);
    const config = loadConfig(root);
    if (opts.host !== undefined) config.serve.host = opts.host;
    if (opts.port !== undefined) config.serve.port = opts.port;
    if (!opts.watch) config.serve.watch = false;

    const handles = await buildApp(root, config);
    const displayHost = config.serve.host === "0.0.0.0" || config.serve.host === "::"
      ? "127.0.0.1"
      : config.serve.host;
    const url = `http://${displayHost}:${config.serve.port}/`;
    const server = handles.app.listen(config.serve.port, config.serve.host, () => {
      console.log(
        `serving ${handles.state.root} at ${url} — UI /, REST /api, live /api/live, MCP /mcp (Ctrl-C stops)`,
      );
    });
    await handles.start();
    if (opts.open) setTimeout(() => openBrowser(url), 800).unref();

    await new Promise<void>((stop) => {
      process.once("SIGINT", () => {
        void handles.close().then(() => {
          server.closeAllConnections();
          server.close(() => stop());
        });
      });
    });
  });

program
  .command("mcp")
  .description("speak MCP over stdio (for agent hosts)")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (opts: { root: string }) => {
    // stdio is the protocol channel: nothing may print to stdout here
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { createMcpServer, WRITES_OFF_REFUSAL } = await import("./mcp");
    const { ServeState } = await import("./serve/state");

    const root = resolve(opts.root);
    const config = loadConfig(root);
    const state = new ServeState(root, config);
    await state.load();
    const refusal = config.serve.writes === "off" ? WRITES_OFF_REFUSAL : null;
    const server = createMcpServer(state, refusal);
    await server.connect(new StdioServerTransport());
    await new Promise<void>((stop) => {
      server.server.onclose = () => stop();
      process.once("SIGINT", () => stop());
    });
  });

// -- the four query mirrors (spec/70 payloads in the terminal) ---------------------

/** Print a mirror's result: `out` to stdout (results / JSON), `err` to stderr. */
function emit(result: { out?: string; err?: string }): void {
  if (result.err) console.error(result.err);
  if (result.out !== undefined) console.log(result.out);
}

program
  .command("search <query>")
  .description("search the compiled brain (the brain_search tool, in the terminal)")
  .option("--mode <mode>", "auto | keyword | semantic | graph (unknown falls back to auto)", "auto")
  .option("--limit <n>", "max hits (default: 8)", intOption, 8)
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--json", "print the raw MCP payload as JSON")
  .action(async (query: string, opts: { mode: string; limit: number; root: string; json?: boolean }) => {
    const { searchMirror } = await import("./query/mirrors");
    emit(await searchMirror(resolve(opts.root), query, opts.mode, opts.limit, Boolean(opts.json)));
  });

program
  .command("read <doc>")
  .description("read one doc from the brain (path, stem, or approximate title)")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--json", "print the raw MCP payload as JSON")
  .action(async (doc: string, opts: { root: string; json?: boolean }) => {
    const { readMirror } = await import("./query/mirrors");
    emit(await readMirror(resolve(opts.root), doc, Boolean(opts.json)));
  });

program
  .command("neighbors <doc>")
  .description("walk the link graph around a doc")
  .option("--depth <n>", "hops to walk, 1–3 (default: 1)", intOption, 1)
  .option("--layer <layer>", "links | entities | both (entities degrades to links until T3)", "links")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--json", "print the raw MCP payload as JSON")
  .action(async (doc: string, opts: { depth: number; layer: string; root: string; json?: boolean }) => {
    const { neighborsMirror } = await import("./query/mirrors");
    emit(await neighborsMirror(resolve(opts.root), doc, opts.depth, opts.layer, Boolean(opts.json)));
  });

program
  .command("overview")
  .description("one screen of the whole brain: counts, tiers, every doc")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--json", "print the raw MCP payload as JSON")
  .action(async (opts: { root: string; json?: boolean }) => {
    const { overviewMirror } = await import("./query/mirrors");
    emit(await overviewMirror(resolve(opts.root), Boolean(opts.json)));
  });

program
  .command("show [nodes...]")
  .description("present a subgraph live in every open UI (posts to a running server)")
  .option("--focus <id>", "a single id to fly the camera to (defaults to the first node)")
  .option("--mode <mode>", "cosmos | brain — switch the UI view")
  .option("--annotate <text>", "a short caption shown over the presentation")
  .option("--clear", "dismiss the current presentation")
  .option("--host <host>", "server host (default: config or 127.0.0.1)")
  .option("--port <port>", "server port (default: config or 4747)", intOption)
  .option("--token <token>", "bearer token for a guarded server")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--json", "print the raw server response as JSON")
  .action(
    async (
      nodes: string[],
      opts: {
        focus?: string;
        mode?: string;
        annotate?: string;
        clear?: boolean;
        host?: string;
        port?: number;
        token?: string;
        root: string;
        json?: boolean;
      },
    ) => {
      const result = await showAction(resolve(opts.root), {
        nodes: nodes ?? [],
        focus: opts.focus,
        mode: opts.mode,
        annotate: opts.annotate,
        clear: opts.clear,
        host: opts.host,
        port: opts.port,
        token: opts.token,
        json: opts.json,
      });
      emit(result);
      process.exitCode = result.code;
    },
  );

program
  .command("integrate <target>")
  .description("install brainpick into an agent harness (skill, MCP, report)")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--dry-run", "print what integrate would do without writing anything")
  .action(async (target: string, opts: { root: string; dryRun?: boolean }) => {
    const { runIntegrate } = await import("./integrate");
    process.exitCode = await runIntegrate(target, opts.root, { dryRun: opts.dryRun ?? false });
  });

const token = program.command("token").description("manage bearer tokens for agents (spec/80 auth)");

token
  .command("create")
  .description("mint a token — the secret prints exactly once")
  .option("--name <name>", "a label for the token (e.g. the agent's name)")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (opts: { name?: string; root: string }) => {
    const { runTokenCreate } = await import("./auth");
    process.exitCode = runTokenCreate(opts.root, { name: opts.name ?? null });
  });

token
  .command("list")
  .description("list tokens (ids and names — never secrets)")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (opts: { root: string }) => {
    const { runTokenList } = await import("./auth");
    process.exitCode = runTokenList(opts.root);
  });

token
  .command("revoke <id>")
  .description("revoke a token by id — it stops working immediately")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (id: string, opts: { root: string }) => {
    const { runTokenRevoke } = await import("./auth");
    process.exitCode = runTokenRevoke(opts.root, id);
  });

const password = program.command("password").description("manage the web UI password (spec/80 auth)");

password
  .command("set")
  .description("set the password (TTY prompt, or --stdin for pipes)")
  .option("--stdin", "read the password from stdin")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (opts: { stdin?: boolean; root: string }) => {
    const { promptHidden, readStdinLine, runPasswordSetValue } = await import("./auth");
    let value: string;
    if (opts.stdin) {
      value = await readStdinLine();
    } else {
      value = await promptHidden("new password: ");
      if ((await promptHidden("repeat it: ")) !== value) {
        console.log("the two entries differ — nothing changed");
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = runPasswordSetValue(opts.root, value);
  });

password
  .command("clear")
  .description("remove the password — the UI opens without a login")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (opts: { root: string }) => {
    const { runPasswordClear } = await import("./auth");
    process.exitCode = runPasswordClear(opts.root);
  });

program
  .command("init")
  .description("detect the bundle and backends, write config, compile T1")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--yes", "accept the opt-in choices (e.g. record OPENAI_API_KEY for T2)")
  .option("--dry-run", "print what init would do without writing anything")
  .action(async (opts: { root: string; yes?: boolean; dryRun?: boolean }) => {
    const { runInit } = await import("./scaffold");
    process.exitCode = await runInit(opts.root, { yes: opts.yes ?? false, dryRun: opts.dryRun ?? false });
  });

program
  .command("doctor")
  .description("diagnose config, bundle, artifacts, backends, and UI")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(async (opts: { root: string }) => {
    const { runDoctor } = await import("./scaffold");
    process.exitCode = await runDoctor(opts.root);
  });

/** True when this file is the process entry point (the bin), not an import.
 * Symlink-safe (npm bin shims resolve through realpath), so unit tests can import
 * the exported helpers above without triggering a parse of the test runner's argv. */
function invokedAsScript(): boolean {
  try {
    return (
      !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  await program.parseAsync();
}
