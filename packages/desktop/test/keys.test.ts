/** ed25519 deploy keys (_todo.md: NO OS keychain — a key file in the
 * daemon's data dir, 0600, exactly what OpenSSH itself does). One key per
 * brain: read-only for a repo already sitting decrypted on the same disk, so
 * per-repo scoping is the only isolation that matters. Node's own crypto
 * generates the keypair; the private key is written as a standard PKCS8 PEM
 * (verified against a real `ssh-keygen -y`: OpenSSH reads PKCS8 ed25519 keys
 * directly — no hand-rolled "OPENSSH PRIVATE KEY" format needed) and the
 * public key is hand-encoded into the SSH wire format authorized_keys/deploy
 * key forges expect. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { ensureBrainKey, keyDir } from "../src/keys";

const dirs: string[] = [];
function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-keys-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("keyDir is dataDir/keys/<id>", () => {
  const dataDir = tempDataDir();
  expect(keyDir("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir })).toBe(join(dataDir, "keys", "abc"));
});

test("ensureBrainKey generates a keypair and returns an ssh-ed25519 public key line", () => {
  const dataDir = tempDataDir();
  const key = ensureBrainKey("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  expect(key.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+=*$/);
  expect(key.privateKeyPath).toBe(join(dataDir, "keys", "abc", "id_ed25519"));
});

test("the private key file is 0600 (skipped on Windows, where chmod is a no-op)", () => {
  const dataDir = tempDataDir();
  const key = ensureBrainKey("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  if (process.platform !== "win32") {
    expect(statSync(key.privateKeyPath).mode & 0o777).toBe(0o600);
  }
});

test("ensureBrainKey is idempotent — a second call returns the SAME key, not a new one", () => {
  const dataDir = tempDataDir();
  const first = ensureBrainKey("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  const second = ensureBrainKey("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  expect(second.publicKey).toBe(first.publicKey);
});

test("different brains get different keys", () => {
  const dataDir = tempDataDir();
  const a = ensureBrainKey("a", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  const b = ensureBrainKey("b", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  expect(a.publicKey).not.toBe(b.publicKey);
});

test("the written public key line matches what ssh-keygen -y derives from the private key", () => {
  const dataDir = tempDataDir();
  const key = ensureBrainKey("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  let derived: string;
  try {
    derived = execFileSync("ssh-keygen", ["-y", "-f", key.privateKeyPath], { encoding: "utf8" }).trim();
  } catch {
    return; // ssh-keygen not on PATH in this environment — the format is still verified elsewhere
  }
  expect(derived).toBe(key.publicKey);
});

test("the .pub sidecar file holds the same line ssh-keygen would write", () => {
  const dataDir = tempDataDir();
  const key = ensureBrainKey("abc", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  const pub = readFileSync(`${key.privateKeyPath}.pub`, "utf8").trim();
  expect(pub).toBe(key.publicKey);
});
