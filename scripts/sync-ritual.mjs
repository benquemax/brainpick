#!/usr/bin/env node
/**
 * Sync the canonical brain ritual into each engine's shipped copy.
 *
 * integrations/ritual/RITUAL.md  (the ONE source of truth; spec/20)
 *   → packages/python/src/brainpick/_ritual/RITUAL.md  (pip package-data)
 *   → packages/node/ritual/RITUAL.md                    (npm `files`)
 *
 * Same pattern as sync-skill.mjs: each engine resolves its shipped copy at
 * runtime and a parity test holds it byte-identical to the canonical.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const canonical = join(repo, 'integrations', 'ritual', 'RITUAL.md');

if (!existsSync(canonical)) {
  console.error(`no canonical ritual at ${canonical}`);
  process.exit(1);
}

const targets = [
  join(repo, 'packages', 'python', 'src', 'brainpick', '_ritual', 'RITUAL.md'),
  join(repo, 'packages', 'node', 'ritual', 'RITUAL.md'),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(canonical, target);
  console.log(`synced: ${target}`);
}
