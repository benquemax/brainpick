/**
 * Boot the REAL Python engine for the e2e run: copy the kotiaurinko fixture to a
 * disposable tmp bundle, pick a free port, spawn `uv run brainpick serve`, and wait
 * for /api/health. State is handed to tests and teardown via process.env (workers
 * inherit the runner's environment).
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
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

export default async function globalSetup(): Promise<void> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brainpick-e2e-'));
  const bundle = path.join(tmpDir, 'kotiaurinko');
  cpSync(fixtureBundle, bundle, { recursive: true });

  const port = await freePort();
  const child = spawn(
    'uv',
    ['run', '--project', pythonProject, 'brainpick', 'serve', '--root', bundle, '--port', String(port)],
    { cwd: webuiDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(`${url}/api/health`, HEALTH_TIMEOUT_MS, () => output);
  } catch (error) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL'); // the whole group — ports must be freed
      } catch {
        // already gone
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }

  child.unref(); // the runner must not wait on the server to exit
  process.env.BP_E2E_URL = url;
  process.env.BP_E2E_BUNDLE = bundle;
  process.env.BP_E2E_TMPDIR = tmpDir;
  process.env.BP_E2E_PID = String(child.pid ?? '');
}
