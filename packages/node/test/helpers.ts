/** Shared test plumbing: fixture copies in disposable temp dirs. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Register in each test file via `afterEach(cleanup)`. */
export function cleanup(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
