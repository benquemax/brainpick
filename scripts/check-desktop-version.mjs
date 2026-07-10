#!/usr/bin/env node
/**
 * The desktop app versions independently of the pip/npm engine lockstep
 * (check-versions.mjs) — its own tag prefix, its own package.json. This is
 * the one-line guard for THAT pairing: a `desktop-v*` tag must equal
 * packages/desktop/app/package.json's version, or the release workflow
 * refuses to ship a half-bumped desktop build.
 *
 *   node scripts/check-desktop-version.mjs desktop-v0.1.0
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const appPkg = JSON.parse(readFileSync(join(repo, "packages/desktop/app/package.json"), "utf-8"));

const tagArg = process.argv[2];
if (!tagArg) {
  console.error("usage: node scripts/check-desktop-version.mjs desktop-vX.Y.Z");
  process.exit(1);
}

const match = tagArg.match(/^desktop-v(.+)$/);
if (!match) {
  console.error(`version lockstep FAILED:\n  tag '${tagArg}' does not match the desktop-v* pattern`);
  process.exit(1);
}
const tagVersion = match[1];

if (tagVersion !== appPkg.version) {
  console.error(
    `version lockstep FAILED:\n  tag ${tagArg} (${tagVersion}) !== packages/desktop/app/package.json (${appPkg.version})`,
  );
  process.exit(1);
}
console.log(`versions agree: ${appPkg.version} (tag ${tagArg})`);
