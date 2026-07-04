#!/usr/bin/env node
/**
 * Version lockstep: the pip package, the npm package, and (optionally) a
 * release tag must all agree. Run in the release workflow before publishing
 * so a half-bumped version can never ship.
 *
 *   node scripts/check-versions.mjs            # python === node
 *   node scripts/check-versions.mjs v0.1.0     # ...and both === the tag
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const pyproject = readFileSync(join(repo, 'packages/python/pyproject.toml'), 'utf-8');
const pyVersion = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const nodePkg = JSON.parse(readFileSync(join(repo, 'packages/node/package.json'), 'utf-8'));
const nodeVersion = nodePkg.version;

const webuiPkg = JSON.parse(readFileSync(join(repo, 'packages/webui/package.json'), 'utf-8'));
const webuiVersion = webuiPkg.version;

const problems = [];
if (!pyVersion) problems.push('could not read version from packages/python/pyproject.toml');
if (pyVersion !== nodeVersion) {
  problems.push(`pip ${pyVersion} !== npm ${nodeVersion}`);
}
// webui is never published; its version tracking is advisory — warn, don't fail.
if (webuiVersion !== pyVersion) {
  console.warn(`note: webui ${webuiVersion} differs from ${pyVersion} (webui is unpublished)`);
}

const tagArg = process.argv[2];
if (tagArg) {
  const tag = tagArg.replace(/^v/, '');
  if (tag !== pyVersion) problems.push(`tag ${tagArg} !== package version ${pyVersion}`);
}

if (problems.length) {
  console.error('version lockstep FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`versions agree: ${pyVersion}${tagArg ? ` (tag ${tagArg})` : ''}`);
