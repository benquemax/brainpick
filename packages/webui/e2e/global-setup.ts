/**
 * Boot the REAL Python engine for the e2e run — twice:
 *
 *  1. The primary bundle gets `[models.embedding] kind = "mock"` written as
 *     brainpick.toml BEFORE serve, so the engine compiles T2 for real and
 *     /api/search?mode=semantic answers from vectors (no network, no models).
 *  2. A second copy runs WITHOUT the config — T2 stays off, and semantic
 *     requests degrade honestly (the UI must show the degraded chip).
 *
 * Both are fixture copies in one disposable tmp dir on free ports; state is
 * handed to tests and teardown via process.env (workers inherit the runner's
 * environment).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEALTH_TIMEOUT_MS = 120_000; // uv may resolve an environment first — be generous

const webuiDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(webuiDir, '..', '..');
const pythonProject = path.join(repoRoot, 'packages', 'python');
const fixtureBundle = path.join(repoRoot, 'spec', 'fixtures', 'bundles', 'kotiaurinko');
const t3Fixture = path.join(repoRoot, 'spec', 'fixtures', 'expected', 'kotiaurinko', 't3');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('could not determine a free port')));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(url: string, deadlineMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`brainpick serve never answered ${url} within ${deadlineMs} ms\n--- server output ---\n${output()}`);
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL'); // the whole group — ports must be freed
  } catch {
    // already gone
  }
}

interface Spawned {
  child: ChildProcess;
  url: string;
  output: () => string;
}

function spawnServe(bundle: string, port: number): Spawned {
  const child = spawn(
    'uv',
    ['run', '--project', pythonProject, 'brainpick', 'serve', '--root', bundle, '--port', String(port)],
    { cwd: webuiDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, url: `http://127.0.0.1:${port}`, output: () => output };
}

/**
 * Stage the hand-authored T3 export into a COMPILED bundle and flip its
 * manifest tier to fresh — the out-of-process twin of the conformance harness's
 * stage_t3_export (in each engine's tests). No extractor runs. Because the bundle is
 * already compiled and unchanged, serve's start-up compile carries the fresh t3
 * status forward (run_compile: old t3 fresh + t1 unchanged → fresh) and
 * reload_artifacts loads the staged export — /api/graph?layer=entities is live.
 */
function compileAndStageT3(bundle: string): void {
  const compile = spawnSync(
    'uv',
    ['run', '--project', pythonProject, 'brainpick', 'compile', '--root', bundle],
    { cwd: webuiDir, stdio: 'pipe', encoding: 'utf-8' },
  );
  if (compile.status !== 0) {
    throw new Error(`compile of the T3 bundle failed:\n${compile.stdout ?? ''}\n${compile.stderr ?? ''}`);
  }
  const bp = path.join(bundle, '.brainpick');
  cpSync(t3Fixture, path.join(bp, 't3'), { recursive: true });
  const manifestPath = path.join(bp, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { tiers: Record<string, string> };
  manifest.tiers.t3 = 'fresh';
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');
}

export default async function globalSetup(): Promise<void> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brainpick-e2e-'));
  const bundle = path.join(tmpDir, 'kotiaurinko');
  cpSync(fixtureBundle, bundle, { recursive: true });
  // The mock embedder lights up T2 (spec/30 test hook) — semantic for real.
  writeFileSync(path.join(bundle, 'brainpick.toml'), '[models.embedding]\nkind = "mock"\n', 'utf-8');

  const bundleT2less = path.join(tmpDir, 'kotiaurinko-t2less');
  cpSync(fixtureBundle, bundleT2less, { recursive: true });

  // A third bundle carries a staged T3 export so /api/graph?layer=entities
  // returns real data — the entity/overlay layer tests run against it.
  const bundleT3 = path.join(tmpDir, 'kotiaurinko-t3');
  cpSync(fixtureBundle, bundleT3, { recursive: true });
  compileAndStageT3(bundleT3);

  // A fourth bundle is the editor's writable target: default config, so serve
  // exposes writes = "guarded" and PUT /api/docs is live. It has no henxels
  // contract, so a valid save returns 200; a create over an existing doc is the
  // reference engine's own 422 ("exists") — the guarded-save flow, end to end.
  const bundleEdit = path.join(tmpDir, 'kotiaurinko-edit');
  cpSync(fixtureBundle, bundleEdit, { recursive: true });

  const [port, portT2less, portT3, portEdit] = [await freePort(), await freePort(), await freePort(), await freePort()];
  const primary = spawnServe(bundle, port);
  const t2less = spawnServe(bundleT2less, portT2less);
  const t3 = spawnServe(bundleT3, portT3);
  const edit = spawnServe(bundleEdit, portEdit);

  try {
    await waitForHealth(`${primary.url}/api/health`, HEALTH_TIMEOUT_MS, primary.output);
    await waitForHealth(`${t2less.url}/api/health`, HEALTH_TIMEOUT_MS, t2less.output);
    await waitForHealth(`${t3.url}/api/health`, HEALTH_TIMEOUT_MS, t3.output);
    await waitForHealth(`${edit.url}/api/health`, HEALTH_TIMEOUT_MS, edit.output);
  } catch (error) {
    killGroup(primary.child);
    killGroup(t2less.child);
    killGroup(t3.child);
    killGroup(edit.child);
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }

  primary.child.unref(); // the runner must not wait on the servers to exit
  t2less.child.unref();
  t3.child.unref();
  edit.child.unref();
  process.env.BP_E2E_URL = primary.url;
  process.env.BP_E2E_URL_T2LESS = t2less.url;
  process.env.BP_E2E_URL_T3 = t3.url;
  process.env.BP_E2E_URL_EDIT = edit.url;
  process.env.BP_E2E_BUNDLE = bundle;
  process.env.BP_E2E_BUNDLE_EDIT = bundleEdit;
  process.env.BP_E2E_TMPDIR = tmpDir;
  process.env.BP_E2E_PID = String(primary.child.pid ?? '');
  process.env.BP_E2E_PID_T2LESS = String(t2less.child.pid ?? '');
  process.env.BP_E2E_PID_T3 = String(t3.child.pid ?? '');
  process.env.BP_E2E_PID_EDIT = String(edit.child.pid ?? '');
}
