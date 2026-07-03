#!/usr/bin/env node
/** brainpick CLI — same verbs, same lines as the Python engine (spec parity). */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

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
    new Option("--only <tier>", "compile a single tier (t2 reuses the compiled docs substrate)").choices([
      "t1",
      "t2",
    ]),
  )
  .option("--watch", "stay running and recompile on changes")
  .action(
    async (opts: { root: string; full?: boolean; checkFresh?: boolean; only?: Tier; watch?: boolean }) => {
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

await program.parseAsync();
