/** Watch mode (spec/60): debounced recompiles, plus manifest-seq watching so
 * compiles by other processes (cron, the sibling engine) produce deltas too.
 * Ports serve/watcher.py onto chokidar 4. */
import { join, relative, resolve, sep } from "node:path";

import { watch, type FSWatcher } from "chokidar";

import { runCompile, type CompileResult } from "../compile/pipeline";
import { ALWAYS_EXCLUDED_DIRS } from "../core/bundle";
import type { ServeState } from "./state";

export const DEBOUNCE_MS = 250; // spec/60 wants >= 200 ms of coalescing

/** Only .md files outside .brainpick/, .git/, _temp/, node_modules/ count as sources. */
export function sourceFilter(root: string): (path: string) => boolean {
  const base = resolve(root);
  return (path: string): boolean => {
    const rel = relative(base, resolve(path));
    if (rel === "" || rel.startsWith("..")) return false;
    const parts = rel.split(sep);
    if (parts.slice(0, -1).some((part) => ALWAYS_EXCLUDED_DIRS.has(part))) return false;
    return parts[parts.length - 1]!.endsWith(".md");
  };
}

/** Sources plus the manifest — the one .brainpick/ file worth watching (foreign compiles). */
export function bundleFilter(root: string): (path: string) => boolean {
  const allowSource = sourceFilter(root);
  const manifest = resolve(join(root, ".brainpick", "manifest.json"));
  return (path: string): boolean => resolve(path) === manifest || allowSource(path);
}

/** The one recompile path: watcher batches, guarded writes, and tests all route here.
 *
 * Hash-gated no-ops broadcast nothing; a change brackets its delta with
 * compile.status running/done (spec/60). */
export async function recompileAndBroadcast(state: ServeState): Promise<CompileResult> {
  let result: CompileResult;
  try {
    result = await runCompile(state.root, false, null, state.config);
  } catch (error) {
    state.broadcastStatus("failed", state.seq);
    throw error;
  }
  if (result.changed) {
    state.broadcastStatus("running", result.seq);
    state.applyCompileResult(result);
    state.broadcastStatus("done", result.seq);
  }
  return result;
}

/** chokidar must not descend into the machinery; .brainpick/ stays visible only
 * far enough to see manifest.json (foreign compiles bump its seq). */
export function watchIgnored(root: string): (path: string) => boolean {
  const base = resolve(root);
  return (path: string): boolean => {
    const rel = relative(base, resolve(path));
    if (rel === "" || rel.startsWith("..")) return false;
    const parts = rel.split(sep);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part === ".brainpick") {
        if (i === parts.length - 1) return false; // the dir itself — keep watching it
        return !(i === parts.length - 2 && parts[i + 1] === "manifest.json");
      }
      if (ALWAYS_EXCLUDED_DIRS.has(part)) return true;
    }
    return false;
  };
}

export interface BundleWatcher {
  /** Resolves once the initial scan is done (events flow from here on). */
  ready: Promise<void>;
  /** Stop watching and wait for any in-flight recompile to finish. */
  close(): Promise<void>;
}

/** Runs until closed; every batch routes through the shared recompile path. */
export function watchBundle(state: ServeState, onError?: (error: unknown) => void): BundleWatcher {
  const root = resolve(state.root);
  const manifest = resolve(join(root, ".brainpick", "manifest.json"));
  const allow = bundleFilter(root);

  const watcher: FSWatcher = watch(root, {
    ignored: watchIgnored(root),
    ignoreInitial: true,
  });

  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> = Promise.resolve();
  let closed = false;

  const reportError = onError ?? ((error: unknown) => console.error("brainpick.serve: recompile after a change failed", error));

  const flush = (): void => {
    timer = null;
    const paths = pending;
    pending = new Set();
    running = running.then(async () => {
      if (closed) return;
      try {
        if (paths.has(manifest)) state.rescanFromManifest();
        if ([...paths].some((p) => p !== manifest)) await recompileAndBroadcast(state);
      } catch (error) {
        // keep watching; the failure went out as compile.status
        reportError(error);
      }
    });
  };

  const onEvent = (path: string): void => {
    const abs = resolve(path);
    if (!allow(abs)) return;
    pending.add(abs);
    if (timer === null) timer = setTimeout(flush, DEBOUNCE_MS); // watchfiles-style step window
  };

  watcher.on("add", onEvent);
  watcher.on("change", onEvent);
  watcher.on("unlink", onEvent);
  watcher.on("error", (error) => reportError(error));

  const ready = new Promise<void>((resolveReady) => watcher.once("ready", () => resolveReady()));

  return {
    ready,
    async close(): Promise<void> {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
      await running;
    },
  };
}
