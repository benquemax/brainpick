/** Orchestration (_todo.md — "all magic in the brainpick service"):
 * wires the registry, users, Supervisor, git sync, and the control API into
 * the one process `brainpickd start` runs. Resumes supervising every
 * enabled brain already in the registry on startup (a restarted daemon must
 * not lose brains that were running before it went down), then keeps a poll
 * loop pulling every enabled remote-repo brain. */
import type { AddressInfo } from "node:net";

import { createApi } from "./api";
import { ensureDaemonToken } from "./daemonToken";
import { cloneIfMissing, pullOnce } from "./gitsync";
import type { Env } from "./paths";
import { createRegistryStore, type RegistryStore } from "./registry";
import { Supervisor } from "./supervisor";
import { loadUsers } from "./users";

export const DEFAULT_DAEMON_PORT = 4748; // one above the brain-registry base (4750), below the engine default (4747)... see docs/daemon.md
export const DEFAULT_SYNC_INTERVAL_MS = 60_000;

export interface DaemonOptions {
  env?: Env;
  port?: number;
  host?: string;
  syncIntervalMs?: number;
  onSyncError?: (message: string) => void;
}

export interface RunningDaemon {
  token: string;
  port: number;
  base: string;
  registryStore: RegistryStore;
  supervisor: Supervisor;
  stop(): Promise<void>;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<RunningDaemon> {
  const env = options.env ?? process.env;
  const token = ensureDaemonToken(env);
  loadUsers(env); // bootstraps users.toml (the default passwordless "local" user) if absent

  const registryStore = createRegistryStore(env);
  const supervisor = new Supervisor({ env });

  for (const brain of registryStore.get().brains) {
    if (!brain.enabled) continue;
    try {
      cloneIfMissing(brain, env); // best-effort — the poll loop retries a failed clone every tick too
    } catch {
      /* surfaced by the next sync tick instead of blocking startup */
    }
    supervisor.start(brain);
  }

  const syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const syncTimer = setInterval(() => {
    for (const brain of registryStore.get().brains) {
      if (!brain.enabled) continue;
      const cloneResult = (() => {
        try {
          return cloneIfMissing(brain, env);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          options.onSyncError?.(`${brain.id}: clone failed (${msg})`);
          return null;
        }
      })();
      if (cloneResult === null) continue;
      const pull = pullOnce(brain, env);
      if (pull.error) options.onSyncError?.(pull.error);
    }
  }, syncIntervalMs);
  syncTimer.unref(); // never keeps the process alive on its own

  const app = createApi({ env, supervisor, registryStore });
  const host = options.host ?? (env["BRAINPICK_DAEMON_HOST"] || "127.0.0.1");
  const port = options.port ?? (Number(env["BRAINPICK_DAEMON_PORT"]) || DEFAULT_DAEMON_PORT);
  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const boundPort = (server.address() as AddressInfo).port;

  return {
    token,
    port: boundPort,
    base: `http://${host}:${boundPort}`,
    registryStore,
    supervisor,
    stop: async () => {
      clearInterval(syncTimer);
      await supervisor.stopAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
