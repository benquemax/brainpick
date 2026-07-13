/** Orchestration (_todo.md): loads the registry + bootstraps
 * users, resumes supervising every enabled brain on startup, starts the git
 * poll loop, and serves the control API — the thing `brainpickd start`
 * actually runs. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { startDaemon } from "../src/daemon";
import { loadUsers } from "../src/users";
import { addBrain, clonedRepoDir, createRegistryStore, DEMO_BRAIN, loadRegistry } from "../src/registry";
import type { Env } from "../src/paths";

const dirs: string[] = [];
const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolatedEnv(): Env {
  const configDir = mkdtempSync(join(tmpdir(), "bp-desktop-daemon-config-"));
  const dataDir = mkdtempSync(join(tmpdir(), "bp-desktop-daemon-data-"));
  dirs.push(configDir, dataDir);
  // Hermetic by default: suppress the first-run demo seed so tests never reach
  // out to clone the public repo. The one seed test opts back in explicitly.
  return { BRAINPICK_DAEMON_CONFIG_DIR: configDir, BRAINPICK_DAEMON_DATA_DIR: dataDir, BRAINPICK_NO_DEMO: "1" };
}

function makeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-daemon-bundle-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.md"), '---\nokf_version: "0.1"\n---\n\n# Index\n', "utf8");
  return dir;
}

async function call(base: string, path: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

test("startDaemon listens, mints a token, and answers /daemon/health", async () => {
  const env = isolatedEnv();
  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  expect(daemon.token.startsWith("bpd_")).toBe(true);
  const result = await call(daemon.base, "/daemon/health", daemon.token);
  expect(result.body.ok).toBe(true);
  expect(typeof result.body.version).toBe("string");
});

test("startDaemon bootstraps users.toml on first run", async () => {
  const env = isolatedEnv();
  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  const users = loadUsers(env);
  expect(users.users).toHaveLength(1);
  expect(users.users[0]!.name).toBe("local");
});

test("startDaemon seeds the demo brain on a truly fresh install", async () => {
  const env = { ...isolatedEnv(), BRAINPICK_NO_DEMO: undefined }; // opt back INTO the seed
  // Pre-stage the clone so the supervise loop never touches the network: a
  // ready `.git` makes cloneIfMissing skip, and a minimal docs bundle serves.
  const cloneDir = clonedRepoDir(DEMO_BRAIN, env);
  mkdirSync(join(cloneDir, ".git"), { recursive: true });
  mkdirSync(join(cloneDir, "docs"), { recursive: true });
  writeFileSync(join(cloneDir, "docs", "index.md"), '---\nokf_version: "0.1"\n---\n\n# Demo\n', "utf8");

  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  // The registry now carries the demo brain (and startup persisted it, so it
  // is a one-time event — a subsequent removal would stick). Supervising the
  // brain is covered by the resume test; here we only prove the seed wiring.
  expect(loadRegistry(env).brains.map((b) => b.id)).toContain(DEMO_BRAIN.id);
});

test("startDaemon resumes supervising every enabled brain already in the registry", async () => {
  const env = isolatedEnv();
  const bundle = makeBundle();
  const registryStore = createRegistryStore(env);
  registryStore.set(
    addBrain(registryStore.get(), { id: "resumed", repo: bundle, bundle_path: "", port: 58101, enabled: true, host: "127.0.0.1" }),
  );

  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  expect(daemon.supervisor.status("resumed")).toBe("running");
});

test("startDaemon never supervises a disabled brain", async () => {
  const env = isolatedEnv();
  const bundle = makeBundle();
  const registryStore = createRegistryStore(env);
  registryStore.set(
    addBrain(registryStore.get(), { id: "off", repo: bundle, bundle_path: "", port: 58102, enabled: false, host: "127.0.0.1" }),
  );

  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  expect(daemon.supervisor.status("off")).toBeUndefined();
});

test("stop() tears down the server and every supervised brain", async () => {
  const env = isolatedEnv();
  const bundle = makeBundle();
  const registryStore = createRegistryStore(env);
  registryStore.set(
    addBrain(registryStore.get(), { id: "a", repo: bundle, bundle_path: "", port: 58103, enabled: true, host: "127.0.0.1" }),
  );
  const daemon = await startDaemon({ env, port: 0 });
  await daemon.stop();
  expect(daemon.supervisor.status("a")).toBe("stopped");
  await expect(fetch(`${daemon.base}/daemon/health`)).rejects.toThrow();
});
