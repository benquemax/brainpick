/** users.toml (_todo.md): the daemon's own user list — under the
 * hood, no UI yet. Bootstraps a single passwordless "local" user with "*"
 * access on first run (mirrors the engine's open-by-default auth stance).
 * Per-brain access is a provisioning concern (provisioning.ts), not stored
 * per-token here — this file just answers "can user X reach brain Y". */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  addUser,
  hasBrainAccess,
  listProvisionedTokens,
  loadUsers,
  provisionToken,
  removeUser,
  revokeProvisionedToken,
  saveUsers,
  setUserPassword,
  usersPath,
  verifyUserPassword,
  type Users,
} from "../src/users";
import type { BrainRecord } from "../src/registry";

const dirs: string[] = [];
function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-users-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("usersPath is users.toml under the config dir", () => {
  const configDir = tempConfigDir();
  expect(usersPath({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toBe(join(configDir, "users.toml"));
});

test("loadUsers bootstraps one passwordless 'local' user with '*' access on first run", () => {
  const configDir = tempConfigDir();
  const users = loadUsers({ BRAINPICK_DAEMON_CONFIG_DIR: configDir });
  expect(users.users).toHaveLength(1);
  const [local] = users.users;
  expect(local!.name).toBe("local");
  expect(local!.brains).toBe("*");
  expect(local!.password_hash).toBeUndefined();
  expect(local!.id).toMatch(/^[0-9a-f-]{36}$/); // a uuid
});

test("the bootstrap is persisted — a second load sees the SAME user, not a fresh one", () => {
  const configDir = tempConfigDir();
  const first = loadUsers({ BRAINPICK_DAEMON_CONFIG_DIR: configDir });
  const second = loadUsers({ BRAINPICK_DAEMON_CONFIG_DIR: configDir });
  expect(second).toEqual(first);
});

test("save then load round-trips", () => {
  const configDir = tempConfigDir();
  const users: Users = { users: [{ id: "u1", name: "tom", brains: ["a", "b"] }] };
  saveUsers(users, { BRAINPICK_DAEMON_CONFIG_DIR: configDir });
  expect(loadUsers({ BRAINPICK_DAEMON_CONFIG_DIR: configDir })).toEqual(users);
});

test("saveUsers writes canonical, hand-editable TOML", () => {
  const configDir = tempConfigDir();
  saveUsers({ users: [{ id: "u1", name: "tom", brains: "*" }] }, { BRAINPICK_DAEMON_CONFIG_DIR: configDir });
  const text = readFileSync(join(configDir, "users.toml"), "utf8");
  expect(text).toContain("[[user]]");
  expect(text).toContain('name = "tom"');
});

// -- password hashing (reuses the engine's scrypt record shape) -----------------------

test("setUserPassword then verifyUserPassword round-trips", () => {
  const users: Users = { users: [{ id: "u1", name: "tom", brains: "*" }] };
  const withPassword = setUserPassword(users, "u1", "s3cret");
  const [user] = withPassword.users;
  expect(user!.password_hash).toBeDefined();
  expect(verifyUserPassword(user!, "s3cret")).toBe(true);
  expect(verifyUserPassword(user!, "wrong")).toBe(false);
});

test("verifyUserPassword is false for a passwordless user regardless of input", () => {
  const user = { id: "u1", name: "tom", brains: "*" as const };
  expect(verifyUserPassword(user, "")).toBe(false);
  expect(verifyUserPassword(user, "anything")).toBe(false);
});

// -- access ------------------------------------------------------------------------

test("hasBrainAccess: '*' reaches every brain", () => {
  const user = { id: "u1", name: "tom", brains: "*" as const };
  expect(hasBrainAccess(user, "any-brain-id")).toBe(true);
});

test("hasBrainAccess: an explicit list only reaches listed brains", () => {
  const user = { id: "u1", name: "tom", brains: ["a", "b"] };
  expect(hasBrainAccess(user, "a")).toBe(true);
  expect(hasBrainAccess(user, "z")).toBe(false);
});

test("addUser appends, removeUser drops by id (pure)", () => {
  const users: Users = { users: [] };
  const withOne = addUser(users, { id: "u1", name: "tom", brains: "*" });
  expect(withOne.users).toHaveLength(1);
  const withNone = removeUser(withOne, "u1");
  expect(withNone.users).toHaveLength(0);
  expect(users.users).toHaveLength(0); // original untouched
});

// -- provisioning: mint/revoke a bearer token via the engine's own auth --------------

function localBrain(dataDir: string): BrainRecord {
  return { id: "a", repo: dataDir, bundle_path: "", port: 1, enabled: true };
}

test("provisionToken mints a token on the brain's own .brainpick-auth.json, tagged with the user's name", () => {
  const bundle = tempConfigDir();
  const brain = localBrain(bundle);
  const [tokenId] = provisionToken(brain, { id: "u1", name: "tom", brains: "*" }, {});
  const tokens = listProvisionedTokens(brain, {});
  expect(tokens).toHaveLength(1);
  expect(tokens[0]!.id).toBe(tokenId);
  expect(tokens[0]!.name).toBe("tom");
});

test("revokeProvisionedToken removes it — listProvisionedTokens no longer sees it", () => {
  const bundle = tempConfigDir();
  const brain = localBrain(bundle);
  const [tokenId] = provisionToken(brain, { id: "u1", name: "tom", brains: "*" }, {});
  expect(revokeProvisionedToken(brain, tokenId, {})).toBe(true);
  expect(listProvisionedTokens(brain, {})).toHaveLength(0);
});

test("revokeProvisionedToken on an unknown id is false, not a throw", () => {
  const bundle = tempConfigDir();
  const brain = localBrain(bundle);
  expect(revokeProvisionedToken(brain, "tk_nope", {})).toBe(false);
});
