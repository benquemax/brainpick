/** The control API (_todo.md): a SMALL token-authed surface — the
 * daemon owns the magic, this is just the door. Every `/daemon/*` route
 * requires `Authorization: Bearer <daemon token>` (daemonToken.ts); a brain's
 * OWN `/api`/`/mcp` (on its own port) is a completely separate auth domain
 * (spec/80), gated per-brain via provisioned tokens (users.ts).
 *
 * Endpoints (deliberately just these six — kept small for planning-session
 * review before Chunk E consumes it):
 *   GET    /daemon/health
 *   GET    /daemon/brains
 *   POST   /daemon/brains
 *   DELETE /daemon/brains/:id
 *   GET    /daemon/brains/:id/status
 *   POST   /daemon/keys
 */
import {
  detectBundle,
  detectHenxels,
  henxelsOnPath,
  runCompile,
  type BundleInfo,
  type GraphStats,
} from "brainpick";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { verifyDaemonToken } from "./daemonToken";
import { cloneIfMissing } from "./gitsync";
import { ensureBrainKey } from "./keys";
import type { Env } from "./paths";
import {
  addBrain,
  brainBundleRoot,
  findBrain,
  isLocalRepo,
  removeBrain,
  validateBrainInput,
  type RegistryStore,
} from "./registry";
import type { Supervisor } from "./supervisor";

export interface ApiOptions {
  env: Env;
  supervisor: Supervisor;
  registryStore: RegistryStore;
}

const jsonBody = express.json({ limit: "256kb" }); // control payloads are tiny — brains.toml-sized

function requireToken(env: Env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!verifyDaemonToken(token, env)) {
      res.status(401).json({
        error: "authentication required — send Authorization: Bearer <token> (see: brainpickd token)",
      });
      return;
    }
    next();
  };
}

/** `henxels check --all` from the repo root that owns `henxels.yaml` — the
 * teach-don't-reject fix-list. Absent henxels (no contract, or the CLI isn't
 * on PATH) means no fix-list, never a rejection. */
function henxelsFixList(bundleRoot: string): string | null {
  const contract = detectHenxels(bundleRoot);
  if (contract === null || !henxelsOnPath()) return null;
  try {
    execFileSync("henxels", ["check", "--all"], { cwd: dirname(contract), encoding: "utf8" });
    return null; // exit 0 — nothing to teach
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    return (err.stdout || err.stderr || err.message).trim();
  }
}

function bundleSummary(info: BundleInfo): { kind: string; docs: number; typed: number } {
  return { kind: info.kind, docs: info.docs, typed: info.typed };
}

export function createApi(options: ApiOptions): Express {
  const { env, supervisor, registryStore } = options;
  const app = express();
  app.use(requireToken(env));

  app.get("/daemon/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/daemon/brains", (_req, res) => {
    const registry = registryStore.get();
    res.json({
      brains: registry.brains.map((brain) => ({
        ...brain,
        process_status: supervisor.status(brain.id) ?? "stopped",
      })),
    });
  });

  app.post("/daemon/brains", jsonBody, async (req, res) => {
    const registry = registryStore.get();
    const validation = validateBrainInput((req.body ?? {}) as Record<string, unknown>, registry);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const brain = validation.brain;

    if (isLocalRepo(brain.repo)) {
      if (!existsSync(brain.repo)) {
        res.status(400).json({ error: `local path does not exist: ${brain.repo}` });
        return;
      }
    } else {
      try {
        cloneIfMissing(brain, env);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(422).json({ error: `could not clone ${brain.repo}: ${msg}` });
        return;
      }
    }

    const root = brainBundleRoot(brain, env);
    const bundle = detectBundle(root);

    let compiled: GraphStats;
    try {
      const result = await runCompile(root);
      compiled = result.stats;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(422).json({ error: `${root} did not compile: ${msg}` });
      return;
    }

    const fixList = henxelsFixList(root);
    registryStore.set(addBrain(registry, brain));
    if (brain.enabled) supervisor.start(brain);

    res.status(201).json({ brain, bundle: bundleSummary(bundle), compiled, fix_list: fixList });
  });

  app.delete("/daemon/brains/:id", async (req, res) => {
    const registry = registryStore.get();
    const brain = findBrain(registry, req.params["id"]!);
    if (brain === null) {
      res.status(404).json({ error: `no such brain: ${req.params["id"]}` });
      return;
    }
    await supervisor.stop(brain.id);
    registryStore.set(removeBrain(registry, brain.id));
    res.status(204).end();
  });

  app.get("/daemon/brains/:id/status", async (req, res) => {
    const brain = findBrain(registryStore.get(), req.params["id"]!);
    if (brain === null) {
      res.status(404).json({ error: `no such brain: ${req.params["id"]}` });
      return;
    }
    const mcpUrl = `http://127.0.0.1:${brain.port}/mcp`;
    let engineStatus: unknown = null;
    try {
      const response = await fetch(`http://127.0.0.1:${brain.port}/api/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) engineStatus = await response.json();
    } catch {
      /* the brain isn't answering yet (starting up, crashed) — status just omits it */
    }
    res.json({
      id: brain.id,
      process_status: supervisor.status(brain.id) ?? "stopped",
      port: brain.port,
      mcp_url: mcpUrl,
      claude_mcp_add: `claude mcp add --transport http ${brain.id} ${mcpUrl}`,
      engine_status: engineStatus,
    });
  });

  app.post("/daemon/keys", jsonBody, (req, res) => {
    const id = (req.body as Record<string, unknown> | undefined)?.["id"];
    if (typeof id !== "string" || id === "") {
      res.status(400).json({ error: "id is required (the brain this deploy key is for)" });
      return;
    }
    const key = ensureBrainKey(id, env);
    res.json({ public_key: key.publicKey });
  });

  return app;
}
