/** Supervisor (_todo.md): one `serve` child process per enabled
 * brain, restart on crash with bounded backoff, stop on remove. Spawns a
 * tiny real Node script instead of the engine (heavy, irrelevant here) —
 * `spawn`/`child_process` behavior is exercised for real, just against a
 * cheap stand-in. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { Supervisor } from "../src/supervisor";

const dirs: string[] = [];
function scriptDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-supervisor-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function brain(id: string, extra: Partial<{ port: number }> = {}) {
  return { id, repo: "/nowhere", bundle_path: "", port: extra.port ?? 1, enabled: true };
}

/** A script that just stays alive until killed. */
function longRunningScript(): string {
  const dir = scriptDir();
  const script = join(dir, "run.js");
  writeFileSync(script, "setInterval(() => {}, 1000);\n", "utf8");
  return script;
}

/** A script that exits with `code` shortly after starting. */
function exitingScript(code: number, delayMs = 5): string {
  const dir = scriptDir();
  const script = join(dir, "run.js");
  writeFileSync(script, `setTimeout(() => process.exit(${code}), ${delayMs});\n`, "utf8");
  return script;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("start spawns a process and status reports running", async () => {
  const supervisor = new Supervisor({ command: () => ({ node: process.execPath, cliPath: longRunningScript() }) });
  supervisor.start(brain("a"));
  await waitFor(() => supervisor.status("a") === "running");
  expect(supervisor.status("a")).toBe("running");
  supervisor.stop("a");
});

test("start is idempotent — calling it twice does not spawn a second process", async () => {
  const spawnCalls: number[] = [];
  const script = longRunningScript();
  const supervisor = new Supervisor({
    command: () => ({ node: process.execPath, cliPath: script }),
    onSpawn: () => spawnCalls.push(1),
  });
  supervisor.start(brain("a"));
  supervisor.start(brain("a"));
  await waitFor(() => supervisor.status("a") === "running");
  expect(spawnCalls).toHaveLength(1);
  supervisor.stop("a");
});

test("stop kills the process and status reports stopped, no restart follows", async () => {
  const supervisor = new Supervisor({ command: () => ({ node: process.execPath, cliPath: longRunningScript() }) });
  supervisor.start(brain("a"));
  await waitFor(() => supervisor.status("a") === "running");
  supervisor.stop("a");
  await waitFor(() => supervisor.status("a") === "stopped");
  await new Promise((r) => setTimeout(r, 100));
  expect(supervisor.status("a")).toBe("stopped"); // never flips back to running on its own
});

test("a crash triggers a restart after the (tiny, test-configured) backoff", async () => {
  const script = exitingScript(1);
  let spawns = 0;
  const supervisor = new Supervisor({
    command: () => ({ node: process.execPath, cliPath: script }),
    backoffMs: [5, 5, 5],
    onSpawn: () => spawns++,
  });
  supervisor.start(brain("a"));
  await waitFor(() => spawns >= 2, 3000);
  expect(spawns).toBeGreaterThanOrEqual(2);
  supervisor.stop("a");
});

test("gives up after exhausting the bounded backoff schedule — crashed, not an infinite loop", async () => {
  const script = exitingScript(1);
  const supervisor = new Supervisor({
    command: () => ({ node: process.execPath, cliPath: script }),
    backoffMs: [1, 1], // only two retries allowed
  });
  supervisor.start(brain("a"));
  await waitFor(() => supervisor.status("a") === "crashed", 3000);
  expect(supervisor.status("a")).toBe("crashed");
});

test("status is undefined for a brain never started", () => {
  const supervisor = new Supervisor();
  expect(supervisor.status("never-started")).toBeUndefined();
});

test("stop on an unmanaged id is a harmless no-op", () => {
  const supervisor = new Supervisor();
  expect(() => supervisor.stop("nope")).not.toThrow();
});

test("stopAll stops every managed brain", async () => {
  const supervisor = new Supervisor({ command: () => ({ node: process.execPath, cliPath: longRunningScript() }) });
  supervisor.start(brain("a", { port: 1 }));
  supervisor.start(brain("b", { port: 2 }));
  await waitFor(() => supervisor.status("a") === "running" && supervisor.status("b") === "running");
  supervisor.stopAll();
  await waitFor(() => supervisor.status("a") === "stopped" && supervisor.status("b") === "stopped");
});
