/** brains.toml (_todo.md): the daemon's brain registry — id, repo
 * (git URL or local path), bundle_path, port, enabled. Loader/saver round-trip
 * plus add/remove/validate as pure functions over the in-memory shape. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  addBrain,
  brainBundleRoot,
  clonedRepoDir,
  isLocalHost,
  isLocalRepo,
  loadRegistry,
  registryPath,
  removeBrain,
  saveRegistry,
  validateBrainInput,
  type Registry,
} from "../src/registry";

const dirs: string[] = [];
function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-registry-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("registryPath is brains.toml under the config dir", () => {
  const configDir = tempConfigDir();
  expect(registryPath({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toBe(join(configDir, "brains.toml"));
});

test("loadRegistry is empty when absent", () => {
  const configDir = tempConfigDir();
  expect(loadRegistry({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toEqual({ brains: [] });
});

test("save then load round-trips", () => {
  const configDir = tempConfigDir();
  const registry: Registry = {
    brains: [
      { id: "kotiaurinko", repo: "git@github.com:x/y.git", bundle_path: "docs", port: 4750, enabled: true, host: "127.0.0.1" },
      { id: "local-one", repo: "/home/x/wiki", bundle_path: "", port: 4751, enabled: false, host: "127.0.0.1" },
    ],
  };
  saveRegistry(registry, { BRAINPICK_DAEMON_CONFIG_DIR: configDir });
  expect(loadRegistry({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toEqual(registry);
});

test("saveRegistry writes canonical, hand-editable TOML", () => {
  const configDir = tempConfigDir();
  saveRegistry(
    { brains: [{ id: "a", repo: "r", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" }] },
    { BRAINPICK_DAEMON_CONFIG_DIR: configDir },
  );
  const text = readFileSync(join(configDir, "brains.toml"), "utf8");
  expect(text).toContain("[[brain]]");
  expect(text).toContain('id = "a"');
});

test("loadRegistry skips a malformed entry and keeps the rest", () => {
  const configDir = tempConfigDir();
  saveRegistry(
    {
      brains: [
        { id: "good", repo: "r", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" },
        { id: "", repo: "r", bundle_path: "", port: 2, enabled: true, host: "127.0.0.1" }, // empty id: malformed
      ],
    },
    { BRAINPICK_DAEMON_CONFIG_DIR: configDir },
  );
  expect(loadRegistry({ BRAINPICK_DAEMON_CONFIG_DIR: configDir }).brains).toEqual([
    { id: "good", repo: "r", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" },
  ]);
});

// -- pure helpers ---------------------------------------------------------------------

test("isLocalRepo recognizes filesystem paths vs git remotes", () => {
  expect(isLocalRepo("/home/x/wiki")).toBe(true);
  expect(isLocalRepo("./relative/wiki")).toBe(true);
  expect(isLocalRepo("../relative/wiki")).toBe(true);
  expect(isLocalRepo("git@github.com:x/y.git")).toBe(false);
  expect(isLocalRepo("https://github.com/x/y.git")).toBe(false);
  expect(isLocalRepo("ssh://git@example.com/x/y.git")).toBe(false);
});

test("validateBrainInput requires repo, defaults bundle_path/enabled, mints an id", () => {
  const result = validateBrainInput({ repo: "git@github.com:x/y.git" }, { brains: [] });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.brain.repo).toBe("git@github.com:x/y.git");
    expect(result.brain.bundle_path).toBe("");
    expect(result.brain.enabled).toBe(true);
    expect(result.brain.id).toMatch(/^[a-z0-9]{21}$/);
    expect(result.brain.port).toBeGreaterThan(0);
  }
});

test("validateBrainInput rejects a missing repo", () => {
  const result = validateBrainInput({}, { brains: [] });
  expect(result.ok).toBe(false);
});

test("validateBrainInput rejects a duplicate id", () => {
  const existing: Registry = { brains: [{ id: "dup", repo: "r", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" }] };
  const result = validateBrainInput({ id: "dup", repo: "r2" }, existing);
  expect(result.ok).toBe(false);
});

test("validateBrainInput rejects a duplicate port", () => {
  const existing: Registry = { brains: [{ id: "a", repo: "r", bundle_path: "", port: 4750, enabled: true, host: "127.0.0.1" }] };
  const result = validateBrainInput({ repo: "r2", port: 4750 }, existing);
  expect(result.ok).toBe(false);
});

test("validateBrainInput auto-assigns the next free port when none is given", () => {
  const existing: Registry = { brains: [{ id: "a", repo: "r", bundle_path: "", port: 4750, enabled: true, host: "127.0.0.1" }] };
  const result = validateBrainInput({ repo: "r2" }, existing);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.brain.port).toBe(4751);
});

test("validateBrainInput defaults host to 127.0.0.1", () => {
  const result = validateBrainInput({ repo: "r" }, { brains: [] });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.brain.host).toBe("127.0.0.1");
});

test("validateBrainInput accepts an explicit LAN host", () => {
  const result = validateBrainInput({ repo: "r", host: "0.0.0.0" }, { brains: [] });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.brain.host).toBe("0.0.0.0");
});

test("isLocalHost recognizes loopback forms; 0.0.0.0 and a LAN IP are not local", () => {
  expect(isLocalHost("127.0.0.1")).toBe(true);
  expect(isLocalHost("localhost")).toBe(true);
  expect(isLocalHost("::1")).toBe(true);
  expect(isLocalHost("")).toBe(true);
  expect(isLocalHost("0.0.0.0")).toBe(false);
  expect(isLocalHost("192.168.1.5")).toBe(false);
});

test("addBrain appends, removeBrain drops by id", () => {
  const registry: Registry = { brains: [] };
  const withOne = addBrain(registry, { id: "a", repo: "r", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" });
  expect(withOne.brains).toHaveLength(1);
  const withNone = removeBrain(withOne, "a");
  expect(withNone.brains).toHaveLength(0);
  // original untouched — pure functions
  expect(registry.brains).toHaveLength(0);
});

test("removeBrain on an unknown id is a no-op", () => {
  const registry: Registry = { brains: [{ id: "a", repo: "r", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" }] };
  expect(removeBrain(registry, "nope")).toEqual(registry);
});

// -- bundle root resolution ------------------------------------------------------------

test("brainBundleRoot for a local repo serves the path directly", () => {
  const brain = { id: "a", repo: "/home/x/wiki", bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" };
  expect(brainBundleRoot(brain, { HOME: "/home/x" })).toBe("/home/x/wiki");
});

test("brainBundleRoot for a local repo with a bundle_path subdirectory", () => {
  const brain = { id: "a", repo: "/home/x/monorepo", bundle_path: "docs", port: 1, enabled: true, host: "127.0.0.1" };
  expect(brainBundleRoot(brain, { HOME: "/home/x" })).toBe(join("/home/x/monorepo", "docs"));
});

test("brainBundleRoot for a remote repo resolves under its clone", () => {
  const brain = { id: "abc", repo: "git@github.com:x/y.git", bundle_path: "wiki", port: 1, enabled: true, host: "127.0.0.1" };
  const env = { HOME: "/home/x", BRAINPICK_DAEMON_DATA_DIR: "/data" };
  expect(brainBundleRoot(brain, env)).toBe(join(clonedRepoDir(brain, env), "wiki"));
  expect(clonedRepoDir(brain, env)).toBe(join("/data", "brains", "abc"));
});
