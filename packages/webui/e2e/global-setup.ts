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
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEALTH_TIMEOUT_MS = 120_000; // uv may resolve an environment first — be generous

const webuiDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(webuiDir, '..', '..');
const pythonProject = path.join(repoRoot, 'packages', 'python');
const fixtureBundle = path.join(repoRoot, 'spec', 'fixtures', 'bundles', 'kotiaurinko');

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

export default async function globalSetup(): Promise<void> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brainpick-e2e-'));
  const bundle = path.join(tmpDir, 'kotiaurinko');
  cpSync(fixtureBundle, bundle, { recursive: true });
  // The mock embedder lights up T2 (spec/30 test hook) — semantic for real.
  writeFileSync(path.join(bundle, 'brainpick.toml'), '[models.embedding]\nkind = "mock"\n', 'utf-8');

  const bundleT2less = path.join(tmpDir, 'kotiaurinko-t2less');
  cpSync(fixtureBundle, bundleT2less, { recursive: true });

  const [port, portT2less] = [await freePort(), await freePort()];
  const primary = spawnServe(bundle, port);
  const t2less = spawnServe(bundleT2less, portT2less);

  try {
    await waitForHealth(`${primary.url}/api/health`, HEALTH_TIMEOUT_MS, primary.output);
    await waitForHealth(`${t2less.url}/api/health`, HEALTH_TIMEOUT_MS, t2less.output);
  } catch (error) {
    killGroup(primary.child);
    killGroup(t2less.child);
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }

  primary.child.unref(); // the runner must not wait on the servers to exit
  t2less.child.unref();
  process.env.BP_E2E_URL = primary.url;
  process.env.BP_E2E_URL_T2LESS = t2less.url;
  process.env.BP_E2E_BUNDLE = bundle;
  process.env.BP_E2E_TMPDIR = tmpDir;
  process.env.BP_E2E_PID = String(primary.child.pid ?? '');
  process.env.BP_E2E_PID_T2LESS = String(t2less.child.pid ?? '');
}
