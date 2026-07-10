#!/usr/bin/env node
/** brainpickd — the daemon CLI (_todo.md): "the service IS the
 * product." `start` runs everything (registry, supervisor, git sync, control
 * API); `token` shows the control-API bearer token (minting it on first
 * run) without starting anything. */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { DEFAULT_DAEMON_PORT, startDaemon } from "./daemon";
import { ensureDaemonToken } from "./daemonToken";
import { VERSION } from "./version";

const program = new Command();

program
  .name("brainpickd")
  .description("the brainpick daemon — git sync, supervision, and a small control API behind one process")
  .version(`brainpickd ${VERSION}`, "--version", "show the version and exit");

program
  .command("start", { isDefault: true })
  .description("start the daemon (default command — a bare `brainpickd` does this too)")
  .option("--port <port>", "control API port (default: 4748, or BRAINPICK_DAEMON_PORT)", (v) => parseInt(v, 10))
  .option("--host <host>", "control API bind host (default: 127.0.0.1, or BRAINPICK_DAEMON_HOST)")
  .action(async (opts: { port?: number; host?: string }) => {
    const daemon = await startDaemon({
      port: opts.port,
      host: opts.host,
      onSyncError: (message) => console.error(`git sync: ${message}`),
    });
    console.log(
      `brainpickd listening at ${daemon.base} — control API, no brain routes here ` +
        `(each brain serves its own port). Auth token: brainpickd token`,
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => void daemon.stop().then(resolve));
      process.once("SIGTERM", () => void daemon.stop().then(resolve));
    });
  });

program
  .command("token")
  .description("print the control-API bearer token (mints one on first run)")
  .action(() => {
    console.log(ensureDaemonToken());
  });

/** True only when this file is the actual entry script (not imported for its
 * exports) — symlink-safe, so unit tests can import from this module without
 * triggering a parse of the test runner's own argv (mirrors packages/node's
 * cli.ts). */
function invokedAsScript(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  await program.parseAsync();
}

export { DEFAULT_DAEMON_PORT };
