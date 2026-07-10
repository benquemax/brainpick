/** The daemon's own control-API token (_todo.md): generated on first
 * run, stored in the config dir, shown by `brainpickd token` — distinct from
 * both the per-brain engine tokens (users.ts provisioning) and per-user
 * passwords. Gates every /daemon/* route. */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { daemonTokenPath, ensureDaemonToken, loadDaemonToken, verifyDaemonToken } from "../src/daemonToken";

const dirs: string[] = [];
function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-token-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("daemonTokenPath is 'token' under the config dir", () => {
  const configDir = tempConfigDir();
  expect(daemonTokenPath({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toBe(join(configDir, "token"));
});

test("loadDaemonToken is null when absent — never mints one as a side effect", () => {
  const configDir = tempConfigDir();
  expect(loadDaemonToken({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toBeNull();
});

test("ensureDaemonToken generates one on first run and persists it 0600", () => {
  const configDir = tempConfigDir();
  const env = { BRAINPICK_DAEMON_CONFIG_DIR: configDir };
  const token = ensureDaemonToken(env);
  expect(token.length).toBeGreaterThan(20);
  expect(loadDaemonToken(env)).toBe(token);
  if (process.platform !== "win32") {
    expect(statSync(daemonTokenPath(env)).mode & 0o777).toBe(0o600);
  }
});

test("ensureDaemonToken is idempotent — a second call returns the SAME token", () => {
  const configDir = tempConfigDir();
  const env = { BRAINPICK_DAEMON_CONFIG_DIR: configDir };
  const first = ensureDaemonToken(env);
  const second = ensureDaemonToken(env);
  expect(second).toBe(first);
});

test("verifyDaemonToken accepts the real token and rejects everything else", () => {
  const configDir = tempConfigDir();
  const env = { BRAINPICK_DAEMON_CONFIG_DIR: configDir };
  const token = ensureDaemonToken(env);
  expect(verifyDaemonToken(token, env)).toBe(true);
  expect(verifyDaemonToken("wrong", env)).toBe(false);
  expect(verifyDaemonToken("", env)).toBe(false);
});

test("verifyDaemonToken is false when no token has ever been generated", () => {
  const configDir = tempConfigDir();
  expect(verifyDaemonToken("anything", { BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toBe(false);
});
