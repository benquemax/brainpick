/** Orchestration (_todo.md): loads the registry + bootstraps
 * users, resumes supervising every enabled brain on startup, starts the git
 * poll loop, and serves the control API — the thing `brainpickd start`
 * actually runs. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { startDaemon } from "../src/daemon";
import { loadUsers } from "../src/users";
import { addBrain, createRegistryStore } from "../src/registry";
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
  return { BRAINPICK_DAEMON_CONFIG_DIR: configDir, BRAINPICK_DAEMON_DATA_DIR: dataDir };
}

function makeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-daemon-bundle-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.md"), '---\nokf_version: "0.1"\n---\n\n# Index\n', "utf8");
  return dir;
}

async function call(base: string, path: string, token: string) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

test("startDaemon listens, mints a token, and answers /daemon/health", async () => {
  const env = isolatedEnv();
  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  expect(daemon.token.startsWith("bpd_")).toBe(true);
  const result = await call(daemon.base, "/daemon/health", daemon.token);
  expect(result.body).toEqual({ ok: true });
});

test("startDaemon bootstraps users.toml on first run", async () => {
  const env = isolatedEnv();
  const daemon = await startDaemon({ env, port: 0 });
  stops.push(daemon.stop);
  const users = loadUsers(env);
  expect(users.users).toHaveLength(1);
  expect(users.users[0]!.name).toBe("local");
});

test("startDaemon resumes supervising every enabled brain already in the registry", async () => {
  const env = isolatedEnv();
  const bundle = makeBundle();
  const registryStore = createRegistryStore(env);
  registryStore.set(
    addBrain(registryStore.get(), { id: "resumed", repo: bundle, bundle_path: "", port: 58101, enabled: true }),
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
    addBrain(registryStore.get(), { id: "off", repo: bundle, bundle_path: "", port: 58102, enabled: false }),
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
    addBrain(registryStore.get(), { id: "a", repo: bundle, bundle_path: "", port: 58103, enabled: true }),
  );
  const daemon = await startDaemon({ env, port: 0 });
  await daemon.stop();
  expect(daemon.supervisor.status("a")).toBe("stopped");
  await expect(fetch(`${daemon.base}/daemon/health`)).rejects.toThrow();
});
