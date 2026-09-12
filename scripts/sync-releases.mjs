#!/usr/bin/env node
/**
 * Sync the canonical release ledger into each engine's shipped copy.
 *
 * spec/releases.yaml  (the ONE source of truth — spec/80 *The release ledger*)
 *   → packages/python/src/brainpick/_releases/releases.yaml   (pip package-data)
 *   → packages/node/releases/releases.yaml                    (npm `files`)
 *
 * Same pattern as sync-skill.mjs: each engine resolves its shipped copy at
 * runtime (installed wheels/tarballs have no repo root) and the parity tests in
 * both engines assert the shipped copy is byte-identical to the canonical.
 * Run this after editing the canonical.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const canonical = join(repo, 'spec', 'releases.yaml');

if (!existsSync(canonical)) {
  console.error(`no canonical ledger at ${canonical}`);
  process.exit(1);
}

const targets = [
  join(repo, 'packages', 'python', 'src', 'brainpick', '_releases', 'releases.yaml'),
  join(repo, 'packages', 'node', 'releases', 'releases.yaml'),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(canonical, target);
  console.log(`synced: ${target}`);
}
