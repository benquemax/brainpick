/** Git sync (_todo.md): clone a remote-repo brain on add, then
 * fetch + fast-forward pull on each poll tick via SYSTEM git — never a
 * bundled git library. Exercised against a REAL local git "remote" (a plain
 * repo, cloned over a file path) rather than mocked, since git's plumbing is
 * exactly the thing worth proving works. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { cloneIfMissing, gitSshEnv, pullOnce } from "../src/gitsync";
import { clonedRepoDir, type BrainRecord } from "../src/registry";
import { ensureBrainKey } from "../src/keys";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-gitsync-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

/** A real git repo (default branch main) with one commit, standing in for a
 * forge remote — cloned over a plain file path, no SSH involved. */
function makeRemote(): string {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "index.md"), "# hello\n", "utf8");
  git(dir, "add", "index.md");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

function brainFor(id: string, repo: string, dataDir: string): { brain: BrainRecord; env: Record<string, string> } {
  return {
    brain: { id, repo, bundle_path: "", port: 1, enabled: true, host: "127.0.0.1" },
    env: { BRAINPICK_DAEMON_DATA_DIR: dataDir },
  };
}

test("cloneIfMissing clones a remote-repo brain into its data dir", () => {
  const remote = makeRemote();
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", `file://${remote}`, dataDir);
  const result = cloneIfMissing(brain, env);
  expect(result.cloned).toBe(true);
  expect(readFileSync(join(clonedRepoDir(brain, env), "index.md"), "utf8")).toBe("# hello\n");
});

test("cloneIfMissing is a no-op the second time (already cloned)", () => {
  const remote = makeRemote();
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", `file://${remote}`, dataDir);
  cloneIfMissing(brain, env);
  const second = cloneIfMissing(brain, env);
  expect(second.cloned).toBe(false);
});

test("cloneIfMissing skips a local-path brain — nothing to clone", () => {
  const local = tempDir();
  writeFileSync(join(local, "index.md"), "# local\n", "utf8");
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", local, dataDir);
  const result = cloneIfMissing(brain, env);
  expect(result.cloned).toBe(false);
  expect(existsSync(clonedRepoDir(brain, env))).toBe(false);
});

test("pullOnce fast-forwards when the remote has new commits", () => {
  const remote = makeRemote();
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", `file://${remote}`, dataDir);
  cloneIfMissing(brain, env);

  writeFileSync(join(remote, "kuu.md"), "# kuu\n", "utf8");
  git(remote, "add", "kuu.md");
  git(remote, "commit", "-q", "-m", "add kuu");

  const result = pullOnce(brain, env);
  expect(result.changed).toBe(true);
  expect(existsSync(join(clonedRepoDir(brain, env), "kuu.md"))).toBe(true);
});

test("pullOnce reports no change when the remote is unchanged", () => {
  const remote = makeRemote();
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", `file://${remote}`, dataDir);
  cloneIfMissing(brain, env);
  const result = pullOnce(brain, env);
  expect(result.changed).toBe(false);
  expect(result.error).toBeUndefined();
});

test("pullOnce on a local-path brain is a no-op, never an error", () => {
  const local = tempDir();
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", local, dataDir);
  const result = pullOnce(brain, env);
  expect(result).toEqual({ changed: false });
});

test("pullOnce surfaces a diverged history as an error, never force-resetting", () => {
  const remote = makeRemote();
  const dataDir = tempDir();
  const { brain, env } = brainFor("a", `file://${remote}`, dataDir);
  cloneIfMissing(brain, env);
  const local = clonedRepoDir(brain, env);

  // the remote gains a commit AND the local clone diverges independently
  writeFileSync(join(remote, "remote-only.md"), "# r\n", "utf8");
  git(remote, "add", "remote-only.md");
  git(remote, "commit", "-q", "-m", "remote change");
  writeFileSync(join(local, "local-only.md"), "# l\n", "utf8");
  git(local, "add", "local-only.md");
  git(local, "commit", "-q", "-m", "local change");

  const result = pullOnce(brain, env);
  expect(result.changed).toBe(false);
  expect(result.error).toBeTruthy();
  // no destructive reset — the local commit survives
  expect(existsSync(join(local, "local-only.md"))).toBe(true);
});

// -- SSH env construction (unit, no real SSH remote needed) ---------------------------

test("gitSshEnv is empty when no deploy key exists for the brain", () => {
  const dataDir = tempDir();
  expect(gitSshEnv("no-such-brain", { BRAINPICK_DAEMON_DATA_DIR: dataDir })).toEqual({});
});

test("gitSshEnv points GIT_SSH_COMMAND at the brain's deploy key once one exists", () => {
  const dataDir = tempDir();
  const key = ensureBrainKey("a", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  const env = gitSshEnv("a", { BRAINPICK_DAEMON_DATA_DIR: dataDir });
  expect(env["GIT_SSH_COMMAND"]).toContain(key.privateKeyPath);
  expect(env["GIT_SSH_COMMAND"]).toContain("IdentitiesOnly=yes");
});
