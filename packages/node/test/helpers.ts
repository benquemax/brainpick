/** Shared test plumbing: fixture copies in disposable temp dirs. */
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, type JsonValue } from "../src/core/canonical";

export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const SPEC = join(REPO_ROOT, "spec");
export const FIXTURE_BUNDLES = join(SPEC, "fixtures", "bundles");
export const EXPECTED = join(SPEC, "fixtures", "expected");
export const SCENARIOS = join(SPEC, "fixtures", "scenarios");

const created: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-node-"));
  created.push(dir);
  return dir;
}

/** A disposable copy of a fixture bundle (the pytest `kotiaurinko` fixture). */
export function copyBundle(name = "kotiaurinko"): string {
  const dst = join(tempDir(), name);
  cpSync(join(FIXTURE_BUNDLES, name), dst, { recursive: true });
  return dst;
}

/** A disposable bundle from an inline path → content map. */
export function makeBundle(files: Record<string, string>): string {
  const root = join(tempDir(), "bundle");
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

/** Stage the hand-authored T3 export into a compiled bundle and flip its
 * manifest tier to fresh — no extractor runs (spec/40). The twin of the Python
 * harness's stage_t3_export; kept byte-identical so a mistake in one fails the
 * other's conformance. Compile the bundle before calling this. */
export function stageT3Export(root: string, bundle = "kotiaurinko"): void {
  const bp = join(root, ".brainpick");
  cpSync(join(EXPECTED, bundle, "t3"), join(bp, "t3"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(bp, "manifest.json"), "utf8")) as Record<string, unknown>;
  (manifest["tiers"] as Record<string, string>)["t3"] = "fresh";
  writeFileSync(join(bp, "manifest.json"), canonicalJson(manifest as JsonValue), "utf8");
}

/** A fake `henxels` on PATH that just prints `message` and exits `exitCode`
 * — CI-2 (_plans/2026-07-10-phase1.5-release.md): a bare extensionless file
 * with a unix shebang is invisible to detect.ts's `which()` on win32 (its
 * PATHEXT-aware search never matches a candidate that doesn't already end
 * in one of PATHEXT's extensions), so tests exercising the write-guard's
 * `henxelsOnPath()` lookup were silently skipping it on Windows rather than
 * genuinely testing it — the write path LOOKED unguarded there, but the
 * actual production `which("henxels")` call is already PATHEXT-correct (a
 * real `uv tool install henxels` produces a proper `henxels.exe` launcher
 * on Windows, which this DOES find). Returns `binDir` for the caller to
 * prepend onto PATH with `path.delimiter`. */
export function stageFakeHenxels(binDir: string, message: string, exitCode = 1): string {
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "henxels.bat"), `@echo off\r\necho ${message}\r\nexit /b ${exitCode}\r\n`, "utf8");
  } else {
    const fake = join(binDir, "henxels");
    writeFileSync(fake, `#!/bin/sh\necho '${message}'\nexit ${exitCode}\n`, "utf8");
    chmodSync(fake, 0o755);
  }
  return binDir;
}

/** `binDir` + the existing PATH, joined with the platform separator — CI-2:
 * the existing call sites hardcoded `:`, invisible-broken on Windows (`;`)
 * even once the fake executable itself was fixed. */
export function prependPath(envPath: string | undefined, binDir: string): string {
  return `${binDir}${delimiter}${envPath ?? ""}`;
}

/** On Windows, `npm` is a `.cmd` shim, not a directly-executable binary —
 * execFileSync/spawnSync (no shell) can't find bare "npm" there (ENOENT).
 * Every unix platform runs the plain binary. Twin of packages/desktop/app/
 * scripts/stage-lib.mjs's own npmCommand/needsShellForNpm (CI-2 flagged
 * this exact class of bug here, in run 29125813729's node-windows log —
 * duplicated locally rather than cross-imported, since packages/node has
 * no dependency on packages/desktop). */
export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

/** Node's CVE-2024-27980 hardening refuses to spawn a .cmd/.bat at all
 * without an explicit shell, regardless of using the right filename —
 * npmCommand() alone isn't enough on win32. */
export function needsShellForNpm(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

/** Register in each test file via `afterEach(cleanup)`. */
export function cleanup(): void {
  // CI-1 evidence (run 29143029495, node engine ubuntu-latest): timeline.test.ts's
  // own throwaway git repos hit `ENOTEMPTY: directory not empty, rmdir
  // '.../.git'` here — a transient race, not a git-identity gap (that repo
  // was already fully hermetic: local `git config user.*` + GIT_AUTHOR/
  // COMMITTER env on every commit). `rmSync(recursive)` defaults to zero
  // retries; a just-exited `git` subprocess's file handles/directory entries
  // can still be settling on the runner's filesystem when the very next
  // synchronous call tries to remove them. maxRetries+retryDelay is Node's
  // own documented remedy for exactly this class of transient EBUSY/ENOTEMPTY.
  //
  // CI-2 (run 29145923212, SAME commit as the CI-1 fix — confirmed via
  // headSha): the identical ENOTEMPTY race still hit a DIFFERENT test in
  // this file (a sibling throwaway repo, "a bundle in a subdir maps to
  // bundle-relative paths") — 5 retries × 100ms (~500ms of headroom) wasn't
  // always enough under the real CI runner's concurrency (vitest runs test
  // files in parallel, so several of these throwaway git repos' subprocess
  // teardowns can be settling on the filesystem at once, unlike a quiet
  // local run). More of the same hardening, not a different mechanism.
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
