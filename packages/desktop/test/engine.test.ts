/** Engine binary resolution (Packaging appendix, _plans/2026-07-09-algorithmic-
 * brain-phase1.md): dev (workspace-relative packages/node/dist/cli.js, system
 * node) vs packaged (Tauri resources — a bundled node + a real node_modules
 * alongside it) are both covered by ONE pair of overrides, `BRAINPICK_ENGINE`
 * (the engine's cli.js) / `BRAINPICK_NODE` (the node binary); default = detect
 * via normal module resolution, which works unchanged under either layout. */
import { existsSync } from "node:fs";

import { expect, test } from "vitest";

import { resolveEngineCommand } from "../src/engine";

test("explicit overrides win outright", () => {
  const result = resolveEngineCommand({ BRAINPICK_NODE: "/custom/node", BRAINPICK_ENGINE: "/custom/cli.js" });
  expect(result).toEqual({ node: "/custom/node", cliPath: "/custom/cli.js" });
});

test("default node is the currently running interpreter", () => {
  const result = resolveEngineCommand({});
  expect(result.node).toBe(process.execPath);
});

test("default cliPath resolves brainpick's own built CLI (works in dev via the workspace symlink)", () => {
  const result = resolveEngineCommand({});
  expect(result.cliPath.endsWith("cli.js")).toBe(true);
  expect(existsSync(result.cliPath)).toBe(true);
});

test("BRAINPICK_NODE alone overrides just the interpreter", () => {
  const result = resolveEngineCommand({ BRAINPICK_NODE: "/custom/node" });
  expect(result.node).toBe("/custom/node");
  expect(existsSync(result.cliPath)).toBe(true); // engine path still auto-detected
});
