/** Git sync (_todo.md): clone a remote-repo brain on add, then
 * fetch + fast-forward pull on a poll tick — via SYSTEM git (ssh present by
 * default on Win10+/macOS/Linux), never a bundled git library. A pull never
 * force-resets: a diverged history (the local clone has a commit the remote
 * doesn't — e.g. from a guarded write) surfaces as an error and is left
 * alone, since the daemon must never destroy something a human just wrote.
 * On a successful pull, there is nothing else to do — `brainpick serve
 * --watch` (the Supervisor's own child process) notices the changed files
 * and recompiles + live-deltas on its own. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { keyDir } from "./keys";
import type { Env } from "./paths";
import { clonedRepoDir, isLocalRepo, type BrainRecord } from "./registry";

export interface PullResult {
  changed: boolean;
  error?: string;
}

export interface CloneResult {
  cloned: boolean;
}

/** `GIT_SSH_COMMAND` pointed at the brain's deploy key, or `{}` when it has
 * none (a public repo, or SSH already configured for this host). Runs the
 * daemon non-interactively, so a first-contact host key is auto-accepted
 * (TOFU) rather than hanging on a prompt nobody can answer — the same
 * trust model `ssh-keyscan` + `known_hosts` gives you interactively. */
export function gitSshEnv(id: string, env: Env = process.env): Record<string, string> {
  const keyPath = join(keyDir(id, env), "id_ed25519");
  if (!existsSync(keyPath)) return {};
  return {
    GIT_SSH_COMMAND: `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  };
}

function runGit(cwd: string, args: string[], gitEnv: Record<string, string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...gitEnv },
  }).trim();
}

/** Clones a remote-repo brain into its data-dir slot if not already present.
 * A local-path brain has nothing to clone — it serves its own directory
 * directly (registry.brainBundleRoot). Idempotent: an existing clone (or
 * anything already at that path) is left untouched. */
export function cloneIfMissing(brain: BrainRecord, env: Env = process.env): CloneResult {
  if (isLocalRepo(brain.repo)) return { cloned: false };
  const path = clonedRepoDir(brain, env);
  if (existsSync(join(path, ".git"))) return { cloned: false };

  mkdirSync(dirname(path), { recursive: true });
  runGit(dirname(path), ["clone", "--quiet", brain.repo, path], gitSshEnv(brain.id, env));
  return { cloned: true };
}

/** One fetch + fast-forward-only pull. Never touches a local-path brain
 * (nothing to sync — a no-op, not an error). A diverged or missing-upstream
 * history is reported via `error`, not raised — a poll loop keeps ticking. */
export function pullOnce(brain: BrainRecord, env: Env = process.env): PullResult {
  if (isLocalRepo(brain.repo)) return { changed: false };
  const path = clonedRepoDir(brain, env);
  if (!existsSync(join(path, ".git"))) {
    return { changed: false, error: "not cloned yet — call cloneIfMissing first" };
  }
  const gitEnv = gitSshEnv(brain.id, env);
  try {
    runGit(path, ["fetch", "--quiet", "origin"], gitEnv);
    const local = runGit(path, ["rev-parse", "HEAD"], gitEnv);
    const upstream = runGit(path, ["rev-parse", "@{upstream}"], gitEnv);
    if (local === upstream) return { changed: false };

    const isAncestor = (() => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", local, upstream], {
          cwd: path,
          env: { ...process.env, ...gitEnv },
        });
        return true;
      } catch {
        return false;
      }
    })();
    if (!isAncestor) {
      return {
        changed: false,
        error: `${brain.id}: local history has diverged from origin — resolve manually in ${path}`,
      };
    }

    runGit(path, ["merge", "--quiet", "--ff-only", upstream], gitEnv);
    return { changed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { changed: false, error: `${brain.id}: git sync failed (${msg})` };
  }
}
