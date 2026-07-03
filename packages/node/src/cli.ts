#!/usr/bin/env node
/** brainpick CLI — same verbs, same lines as the Python engine (spec parity). */
import { resolve } from "node:path";

import { Command } from "commander";

import { checkFresh, runCompile, type CompileResult } from "./compile/pipeline";
import { VERSION } from "./version";

function printCompiled(result: CompileResult): void {
  const s = result.stats;
  console.log(
    `compiled: ${s.docs} docs · ${s.edges} links · ${s.ghosts} ghosts` +
      ` · ${s.orphans} orphans · seq ${result.seq}`,
  );
}

const program = new Command();
program
  .name("brainpick")
  .description("pick your agent's brain — compile and serve OKF knowledge bundles")
  .version(`brainpick ${VERSION}`, "--version", "show the version and exit");

program
  .command("compile")
  .description("compile the bundle into .brainpick/ artifacts")
  .option("--root <path>", "bundle root (default: current directory)", ".")
  .option("--full", "ignore the manifest, rebuild all")
  .option("--check-fresh", "verify freshness without writing (exit 1 when stale)")
  .action((opts: { root: string; full?: boolean; checkFresh?: boolean }) => {
    const root = resolve(opts.root);
    if (opts.checkFresh) {
      const verdict = checkFresh(root);
      console.log(verdict.fresh ? "fresh" : verdict.reason);
      process.exitCode = verdict.fresh ? 0 : 1;
      return;
    }
    const result = runCompile(root, opts.full ?? false);
    if (result.changed) printCompiled(result);
    else console.log(`fresh — nothing to do (seq ${result.seq})`);
    for (const warning of result.warnings) console.log(warning);
  });

program.parse();
