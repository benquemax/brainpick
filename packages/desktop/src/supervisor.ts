/** Supervisor (_todo.md): one `serve` child process PER BRAIN
 * (process isolation, zero engine changes) — restart on crash with bounded
 * backoff, stop on remove. A brain that keeps crashing eventually gives up
 * (`"crashed"`) instead of spinning forever; a brain that ran stably for a
 * while has its backoff budget restored, so one transient crash after days
 * of uptime doesn't eat into the budget a real crash-loop needs. */
import { spawn, type ChildProcess } from "node:child_process";

import { brainBundleRoot, type BrainRecord } from "./registry";
import { resolveEngineCommand, type EngineCommand } from "./engine";
import type { Env } from "./paths";

export type BrainStatus = "running" | "stopped" | "crashed";

// Doubling up to a cap, five attempts — a real crash-loop gives up in under a
// minute rather than hammering the process (or the operator's disk/network).
export const DEFAULT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
export const DEFAULT_STABLE_AFTER_MS = 30_000;

export interface SupervisorOptions {
  /** Resolve the engine command for a brain — default: resolveEngineCommand(env). */
  command?: (brain: BrainRecord, env: Env) => EngineCommand;
  env?: Env;
  backoffMs?: readonly number[];
  stableAfterMs?: number;
  onSpawn?: (brain: BrainRecord) => void;
  onLog?: (brainId: string, stream: "stdout" | "stderr", chunk: string) => void;
  onStatusChange?: (brainId: string, status: BrainStatus) => void;
}

interface Managed {
  child: ChildProcess | null;
  status: BrainStatus;
  attempt: number;
  timer: NodeJS.Timeout | null;
  stopRequested: boolean;
}

export class Supervisor {
  private readonly managed = new Map<string, Managed>();
  private readonly commandFor: (brain: BrainRecord, env: Env) => EngineCommand;
  private readonly env: Env;
  private readonly backoffMs: readonly number[];
  private readonly stableAfterMs: number;
  private readonly onSpawnHook?: (brain: BrainRecord) => void;
  private readonly onLogHook?: (brainId: string, stream: "stdout" | "stderr", chunk: string) => void;
  private readonly onStatusChangeHook?: (brainId: string, status: BrainStatus) => void;

  constructor(options: SupervisorOptions = {}) {
    this.commandFor = options.command ?? ((_brain, env) => resolveEngineCommand(env));
    this.env = options.env ?? process.env;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.stableAfterMs = options.stableAfterMs ?? DEFAULT_STABLE_AFTER_MS;
    this.onSpawnHook = options.onSpawn;
    this.onLogHook = options.onLog;
    this.onStatusChangeHook = options.onStatusChange;
  }

  /** Idempotent: a no-op if the brain is already running. */
  start(brain: BrainRecord): void {
    const existing = this.managed.get(brain.id);
    if (existing !== undefined && existing.status === "running") return;
    this.spawnNow(brain, existing ?? { child: null, status: "running", attempt: 0, timer: null, stopRequested: false });
  }

  private setStatus(id: string, managed: Managed, status: BrainStatus): void {
    managed.status = status;
    this.onStatusChangeHook?.(id, status);
  }

  private spawnNow(brain: BrainRecord, managed: Managed): void {
    const { node, cliPath } = this.commandFor(brain, this.env);
    const root = brainBundleRoot(brain, this.env);
    // --watch is already `serve`'s default (its flag is --no-watch to disable it)
    const args = [cliPath, "serve", "--root", root, "--port", String(brain.port), "--host", brain.host];
    const child = spawn(node, args, { stdio: ["ignore", "pipe", "pipe"] });
    managed.child = child;
    managed.stopRequested = false;
    this.setStatus(brain.id, managed, "running");
    this.managed.set(brain.id, managed);
    this.onSpawnHook?.(brain);

    child.stdout?.on("data", (chunk: Buffer) => this.onLogHook?.(brain.id, "stdout", chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => this.onLogHook?.(brain.id, "stderr", chunk.toString()));

    const startedAt = Date.now();
    child.on("exit", () => {
      if (managed.stopRequested) {
        this.setStatus(brain.id, managed, "stopped");
        return;
      }
      if (Date.now() - startedAt >= this.stableAfterMs) managed.attempt = 0;
      const delay = this.backoffMs[managed.attempt];
      if (delay === undefined) {
        this.setStatus(brain.id, managed, "crashed"); // bounded — never an infinite restart loop
        return;
      }
      managed.attempt++;
      managed.timer = setTimeout(() => this.spawnNow(brain, managed), delay);
    });
  }

  /** Stops the process (if any) and cancels any pending restart — a removed
   * or disabled brain never comes back on its own. Resolves once the process
   * has actually exited (or immediately if there was nothing to wait for) —
   * a caller tearing down the whole daemon needs to know the children are
   * really gone, not just asked to leave. */
  stop(id: string): Promise<void> {
    const managed = this.managed.get(id);
    if (managed === undefined) return Promise.resolve();
    managed.stopRequested = true;
    if (managed.timer !== null) {
      clearTimeout(managed.timer);
      managed.timer = null;
    }
    if (managed.child !== null && managed.child.exitCode === null && !managed.child.killed) {
      const child = managed.child;
      return new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
    }
    this.setStatus(id, managed, "stopped");
    return Promise.resolve();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.managed.keys()].map((id) => this.stop(id)));
  }

  /** No process outlives its registry entry (tester-zero, 2026-07-12): stop
   * every managed brain whose id is no longer registered. Called after
   * registry mutations so a lost/removed entry can never leave an orphaned
   * serve fighting over a port. */
  async reconcile(registry: { brains: Array<{ id: string }> }): Promise<void> {
    const known = new Set(registry.brains.map((b) => b.id));
    await Promise.all(
      [...this.managed.keys()].filter((id) => !known.has(id)).map((id) => this.stop(id)),
    );
  }

  status(id: string): BrainStatus | undefined {
    return this.managed.get(id)?.status;
  }
}
