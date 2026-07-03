#!/usr/bin/env node
/**
 * Sync the built web UI into the engines' static dirs (release plumbing).
 *
 * packages/webui/dist → packages/python/src/brainpick/_static
 *                     → packages/node/static        (once M2 exists)
 *
 * The dist is built once and shipped identically by both engines
 * (principle 8: one spec, many runtimes — and one UI).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(repo, 'packages', 'webui', 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('no built UI at packages/webui/dist — run: npm run build -w packages/webui');
  process.exit(1);
}

const targets = [
  join(repo, 'packages', 'python', 'src', 'brainpick', '_static'),
  join(repo, 'packages', 'node', 'static'),
];

for (const target of targets) {
  if (!existsSync(dirname(target))) {
    console.log(`skip (engine absent): ${target}`);
    continue;
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(dist, target, { recursive: true });
  writeFileSync(join(target, '.gitkeep'), '');
  console.log(`synced: ${target}`);
}
