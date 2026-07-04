#!/usr/bin/env node
/**
 * Sync the canonical Agent Skill into each engine's shipped copy.
 *
 * integrations/skill/SKILL.md  (the ONE source of truth)
 *   → packages/python/src/brainpick/_skill/SKILL.md   (pip package-data)
 *   → packages/node/skill/SKILL.md                     (npm `files`)
 *
 * Each engine resolves its shipped copy at runtime (installed wheels/tarballs
 * have no repo root); the parity tests in both engines assert the shipped copy
 * is byte-identical to this canonical. Run this after editing the canonical.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const canonical = join(repo, 'integrations', 'skill', 'SKILL.md');

if (!existsSync(canonical)) {
  console.error(`no canonical skill at ${canonical}`);
  process.exit(1);
}

const targets = [
  join(repo, 'packages', 'python', 'src', 'brainpick', '_skill', 'SKILL.md'),
  join(repo, 'packages', 'node', 'skill', 'SKILL.md'),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(canonical, target);
  console.log(`synced: ${target}`);
}
