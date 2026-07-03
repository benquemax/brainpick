/**
 * Kill the spawned engines (process group first, then the pid) and remove the
 * tmp bundles. Runs even when tests fail — the ports must be freed either way.
 */
import { rmSync } from 'node:fs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function signal(pid: number, sig: NodeJS.Signals): boolean {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, sig);
      return true;
    } catch {
      // group/process already gone — try the other form
    }
  }
  return false;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stop(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return;
  signal(pid, 'SIGTERM');
  for (let i = 0; i < 20 && alive(pid); i += 1) await sleep(100);
  if (alive(pid)) signal(pid, 'SIGKILL');
}

export default async function globalTeardown(): Promise<void> {
  await stop(Number(process.env.BP_E2E_PID ?? ''));
  await stop(Number(process.env.BP_E2E_PID_T2LESS ?? ''));
  const tmpDir = process.env.BP_E2E_TMPDIR;
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}
