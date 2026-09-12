#!/usr/bin/env node
/** brainpick CLI — same verbs, same lines as the Python engine (spec parity). */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, Option } from "commander";

import { checkFresh, runCompile, type CompileResult, type Tier } from "./compile/pipeline";
import { loadConfig } from "./config";
import { connectableHost, postShow, type ShowResult } from "./show-client";
import { VERSION } from "./version";

// re-exported so existing importers of `postShow`/`connectableHost` from "./cli"
// (mcp.ts's proxy attempt, tests) keep working — the implementation lives in
// show-client.ts to avoid a circular import (see that file's header comment).
export { connectableHost, postShow, type ShowResult };

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
  const baseUrl = `http://${connectableHost(host)}:${port}`;
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
      "compile a single tier (t2/t3 reuse the compiled docs substrate)",
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
  .option(
    "--root <[ALIAS=]DIR>",
    "bundle root — repeat to front several brains; default: every registered brain plus the current directory's (spec/75)",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .action(async (opts: { root: string[] }) => {
    // stdio is the protocol channel: nothing may print to stdout here
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { createMcpServer, WRITES_OFF_REFUSAL } = await import("./mcp");
    const { resolveBrainSet } = await import("./federation");

    // spec/75: explicit --root(s) win; else the registry ∪ the cwd's own bundle; a
    // lone brain serves exactly as before (the plain single-brain payloads).
    const brainSet = resolveBrainSet(opts.root);
    let refusal: string | null;
    let target;
    if (brainSet.federated) {
      target = brainSet;
      refusal = brainSet.brains.every((b) => loadConfig(b.root).serve.writes === "off") ? WRITES_OFF_REFUSAL : null;
    } else {
      target = await brainSet.stateFor(brainSet.brains[0]!);
      refusal = target.config.serve.writes === "off" ? WRITES_OFF_REFUSAL : null;
    }
    const server = createMcpServer(target, refusal);
    await server.connect(new StdioServerTransport());
    await new Promise<void>((stop) => {
      server.server.onclose = () => stop();
      process.once("SIGINT", () => stop());
    });
  });

// -- the four query mirrors (spec/70 payloads in the terminal) ---------------------

/** Print a mirror's result: `out` to stdout (results / JSON), `err` to stderr. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

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

const skill = program.command("skill").description("procedural memory: list the brain's skills or scaffold a new one");
skill
  .command("list")
  .description("every skill with its prerequisites and tools")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--json", "print {skills: [...]} as JSON")
  .action(async (opts: { root: string; json?: boolean }) => {
    const { skillList } = await import("./skill");
    const result = await skillList(resolve(opts.root), Boolean(opts.json));
    emit(result);
    process.exitCode = result.code;
  });
skill
  .command("new <name>")
  .description("scaffold a compliant skill doc and compile")
  .option("--title <title>", "frontmatter title (default: the name)")
  .option("--description <text>", 'the trigger, "Use when …" — what search and the overview show')
  .option("--depends-on <path>", "a prerequisite skill's bundle-relative path (repeatable)", collect, [])
  .option("--tool <path>", "a tool the skill drives, bundle-relative (repeatable)", collect, [])
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .action(
    async (
      name: string,
      opts: { title?: string; description?: string; dependsOn: string[]; tool: string[]; root: string },
    ) => {
      const { skillNew } = await import("./skill");
      const result = await skillNew(resolve(opts.root), name, {
        title: opts.title ?? null,
        description: opts.description ?? null,
        dependsOn: opts.dependsOn,
        tools: opts.tool,
      });
      emit(result);
      process.exitCode = result.code;
    },
  );

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

program
  .command("register")
  .description("add a brain to the federation registry (or list/remove)")
  .argument("[path]", "bundle root to register (omit to list the registry)")
  .option("--alias <alias>", "the brain's address in tool payloads")
  .option("--cortex", "mark it as the agent's own brain — at most one (scope 'me')")
  .option("--implant", "mark it as an attached repository bundle — any number")
  .option("--user", "deprecated spelling of --cortex")
  .option("--remove", "drop PATH from the registry")
  .option("--from-hosts", "register every `mcp --root DIR` found in agent host configs (spec/75 migration)")
  .option("--dry-run", "with --from-hosts: report, don't write")
  .action(
    async (
      path: string | undefined,
      opts: {
        alias?: string;
        cortex?: boolean;
        implant?: boolean;
        user?: boolean;
        remove?: boolean;
        fromHosts?: boolean;
        dryRun?: boolean;
      },
    ) => {
      const { runRegister } = await import("./federation");
      process.exitCode = runRegister(path ?? null, {
        alias: opts.alias ?? null,
        role: opts.cortex || opts.user ? "cortex" : opts.implant ? "implant" : null,
        remove: opts.remove,
        fromHosts: opts.fromHosts,
        dryRun: opts.dryRun,
      });
    },
  );

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
