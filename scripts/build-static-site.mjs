#!/usr/bin/env node
/**
 * Bake a brain into a fully static site — the GitHub Pages demo path.
 *
 * The recipe is deliberately parasitic on the real product: compile the
 * bundle, start the actual engine, snapshot its own API responses to files,
 * and pair them with a UI built in static-snapshot mode (VITE_STATIC_SNAPSHOT
 * → relative base, no service worker, client-side search/neighbors/versions —
 * see packages/webui/src/live/staticMode.ts). Every baked byte is a real
 * server answer, so the demo cannot drift from the live contract.
 *
 * Static hosts drop query strings, so per-query surfaces move to distinct
 * paths the adapter knows:
 *   /api/graph?layer=links     → api/graph.links.json
 *   /api/graph?layer=entities  → api/graph.entities.json
 *   /api/neighbors?id=<doc>    → api/neighbors/<doc>.json     (entities, depth 1)
 *   /api/docs/<doc>?at=<sha>   → api/doc-versions/<version-sha>/<doc>
 *   /api/search?q=…            → client-side over api/search-index.json
 *
 * Usage: node scripts/build-static-site.mjs [--root docs] [--out _temp/dist/static-site]
 *
 * The default output sits under a `dist` path component on purpose: a brain
 * may legitimately contain `*.md.codx/` pages (this repo's does), and baking
 * them recreates directories codumentation would otherwise discover and
 * fail on — its scanner skips any path containing a `dist` segment.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const root = resolve(repo, argOf('--root', 'docs'));
const out = resolve(repo, argOf('--out', join('_temp', 'dist', 'static-site')));
const cli = join(repo, 'packages', 'node', 'dist', 'cli.js');

if (!existsSync(cli)) {
  console.error('node engine not built — run: npm run build -w packages/node');
  process.exit(1);
}

const run = (cmd, argv, opts = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, argv, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${cmd} ${argv.join(' ')} -> exit ${code}`)),
    );
  });

const freePort = () =>
  new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });

/** Run `task` over `items` with a fixed concurrency ceiling. */
async function pool(items, limit, task) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
}

const writeFile = (relPath, data) => {
  const file = join(out, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

// 1 · fresh artifacts, then the real engine (no watcher — one still snapshot).
await run('node', [cli, 'compile', '--root', root]);
const port = await freePort();
const api = `http://127.0.0.1:${port}`;
const server = spawn('node', [cli, 'serve', '--root', root, '--port', String(port), '--no-watch'], {
  stdio: 'ignore',
});
try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${api}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`engine did not come up on ${api}`);
    await new Promise((r) => setTimeout(r, 200));
  }

  // 2 · the UI, built in static-snapshot mode, straight into the output dir.
  rmSync(out, { recursive: true, force: true });
  await run('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
    cwd: join(repo, 'packages', 'webui'),
    env: { ...process.env, VITE_STATIC_SNAPSHOT: '1' },
  });

  // 3 · snapshot the engine's own answers.
  const getJson = async (path) => {
    const res = await fetch(`${api}${path}`, { headers: { accept: 'application/json' } });
    return res.ok ? { status: res.status, body: await res.text() } : { status: res.status, body: null };
  };

  const health = await getJson('/api/health');
  writeFile('api/health', health.body);

  const status = JSON.parse((await getJson('/api/status')).body);
  status.writes = 'off'; // nobody is listening behind a static page
  status.static = { generated_at: new Date().toISOString() };
  writeFile('api/status', JSON.stringify(status));

  const links = await getJson('/api/graph?layer=links');
  writeFile('api/graph.links.json', links.body);
  const graph = JSON.parse(links.body);

  const entities = await getJson('/api/graph?layer=entities');
  if (entities.body !== null) writeFile('api/graph.entities.json', entities.body);

  const timelineRes = await getJson('/api/timeline');
  writeFile('api/timeline', timelineRes.body);
  const timeline = JSON.parse(timelineRes.body);

  const docPaths = graph.nodes.map((n) => n.id);
  const docSet = new Set(docPaths);
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
  let docCount = 0;
  await pool(docPaths, 8, async (path) => {
    const doc = await getJson(`/api/docs/${encodePath(path)}`);
    if (doc.body === null) return;
    writeFile(join('api', 'docs', path), doc.body);
    docCount += 1;
    if (entities.body !== null) {
      const nb = await getJson(`/api/neighbors?id=${encodeURIComponent(path)}&layer=entities&depth=1`);
      if (nb.body !== null) writeFile(join('api', 'neighbors', `${path}.json`), nb.body);
    }
  });

  // One file per DISTINCT doc version (commit that added/modified it); the
  // UI resolves any scrubber station to one of these (staticMode.ts).
  const versionPairs = [];
  for (const commit of timeline.commits ?? []) {
    for (const path of [...commit.added, ...commit.modified]) {
      if (docSet.has(path)) versionPairs.push({ sha: commit.sha, path });
    }
  }
  let versionCount = 0;
  await pool(versionPairs, 8, async ({ sha, path }) => {
    const doc = await getJson(`/api/docs/${encodePath(path)}?at=${sha}`);
    if (doc.body === null) return;
    writeFile(join('api', 'doc-versions', sha, path), doc.body);
    versionCount += 1;
  });

  // 4 · the client-side search index, from the compiled full-text substrate.
  const docsJsonl = join(root, '.brainpick', 't1', 'docs.jsonl');
  const index = readFileSync(docsJsonl, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const d = JSON.parse(line);
      return { path: d.path, title: d.title, description: d.description ?? null, text: d.text, reserved: d.reserved };
    });
  writeFile('api/search-index.json', JSON.stringify(index));

  // 5 · embedded doc images + Pages hygiene.
  const assets = join(root, 'assets');
  if (existsSync(assets)) cpSync(assets, join(out, 'assets'), { recursive: true });
  writeFile('.nojekyll', '');

  console.log(
    `static site: ${out}\n  docs ${docCount} · versions ${versionCount} · ` +
      `entities ${entities.body !== null ? 'baked' : 'absent'} · search index ${index.length} docs`,
  );
} finally {
  server.kill('SIGTERM');
}
