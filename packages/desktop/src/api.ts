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
  generateBundleId,
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
import { resolveAdvertiseHost } from "./network";
import type { Env } from "./paths";
import {
  addBrain,
  brainBundleRoot,
  findBrain,
  isLocalHost,
  isLocalRepo,
  removeBrain,
  validateBrainInput,
  type RegistryStore,
} from "./registry";
import type { Supervisor } from "./supervisor";
import { ensureLanTokenForBrain } from "./users";
import { VERSION } from "./version";

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
    res.json({ ok: true, version: VERSION });
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
    ensureLanTokenForBrain(brain, env); // ready before the first status check, not just on-demand

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
    // never advertise an address the brain isn't actually bound to: a
    // loopback-only brain has no LAN url at all, only the local one.
    const mcpUrlLocal = `http://127.0.0.1:${brain.port}/mcp`;
    const lanBound = !isLocalHost(brain.host);
    const mcpUrl = lanBound ? `http://${resolveAdvertiseHost(env)}:${brain.port}/mcp` : mcpUrlLocal;

    let claudeMcpAdd = `claude mcp add --transport http ${brain.id} ${mcpUrl}`;
    const lanSecret = lanBound ? ensureLanTokenForBrain(brain, env) : null;
    if (lanSecret !== null) claudeMcpAdd += ` --header "Authorization: Bearer ${lanSecret}"`;

    let engineStatus: unknown = null;
    try {
      // the health probe always goes over loopback — this daemon and the
      // brain it supervises share a machine regardless of what host clients
      // are told to use. Once a LAN-bound brain has a provisioned token, the
      // ENGINE itself starts requiring auth (spec/80) — including it here is
      // what keeps this probe from going blind the moment that happens.
      const headers: Record<string, string> = lanSecret !== null ? { Authorization: `Bearer ${lanSecret}` } : {};
      const response = await fetch(mcpUrlLocal.replace("/mcp", "/api/status"), {
        headers,
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
      mcp_url_local: mcpUrlLocal,
      claude_mcp_add: claudeMcpAdd,
      engine_status: engineStatus,
    });
  });

  app.post("/daemon/keys", jsonBody, (req, res) => {
    // A private-repo wizard needs the deploy key BEFORE the clone can happen
    // (paste the pubkey into the forge first) — but POST /daemon/brains is
    // the only other place that mints a brain id. Omitting id here mints one
    // fresh, so the wizard can generate the key, then pass that SAME id to
    // POST /daemon/brains once the pubkey is pasted in.
    const rawId = (req.body as Record<string, unknown> | undefined)?.["id"];
    if (rawId !== undefined && typeof rawId !== "string") {
      res.status(400).json({ error: "id must be a string when given" });
      return;
    }
    const id = rawId && rawId !== "" ? rawId : generateBundleId();
    const key = ensureBrainKey(id, env);
    res.json({ id, public_key: key.publicKey });
  });

  return app;
}
