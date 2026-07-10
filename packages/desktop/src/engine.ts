/** Where the Node engine lives, for the Supervisor to spawn (Packaging appendix,
 * _plans/2026-07-09-algorithmic-brain-phase1.md). Two layouts, one resolution:
 *
 *  - dev: `brainpick` resolves through the workspace symlink to
 *    `packages/node/dist/cli.js`, run by whatever `node` is currently
 *    executing this process.
 *  - packaged (Tauri): a bundled `node` binary sits in app resources
 *    alongside a real (non-symlinked) `node_modules` — the SAME lookup finds
 *    the SAME relative `cli.js`, so no packaged-specific branch is needed
 *    today.
 *
 * `BRAINPICK_ENGINE` (the engine's cli.js) and `BRAINPICK_NODE` (the node
 * binary) are escape hatches for whatever Tauri's sidecar mechanism turns out
 * to require once Chunk E builds it — set either independently.
 *
 * The lookup walks `node_modules/brainpick` up from this file's own
 * directory (the standard Node resolution algorithm, by hand) rather than
 * `import.meta.resolve` — that API is unavailable under Vitest's module
 * runner, and brainpick's `"type": "module"` + `"exports"` (import-only, no
 * "require" condition) also makes it unreachable via `require.resolve`. */
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Env } from "./paths";

export interface EngineCommand {
  node: string;
  cliPath: string;
}

class EngineNotFoundError extends Error {}

function findBrainpickPackageDir(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "node_modules", "brainpick");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new EngineNotFoundError(
        "could not find the 'brainpick' package in any ancestor node_modules — " +
          "set BRAINPICK_ENGINE to its cli.js explicitly",
      );
    }
    dir = parent;
  }
}

function defaultCliPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageDir = findBrainpickPackageDir(here);
  const cliPath = join(packageDir, "dist", "cli.js");
  if (!existsSync(cliPath) || !statSync(cliPath).isFile()) {
    throw new EngineNotFoundError(
      `found the 'brainpick' package at ${packageDir} but ${cliPath} is missing — ` +
        "build it first (npm run build -w packages/node) or set BRAINPICK_ENGINE",
    );
  }
  return cliPath;
}

export function resolveEngineCommand(env: Env = process.env): EngineCommand {
  return {
    node: env["BRAINPICK_NODE"] || process.execPath,
    cliPath: env["BRAINPICK_ENGINE"] || defaultCliPath(),
  };
}
