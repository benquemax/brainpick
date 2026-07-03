/** The REST surface (spec/50): JSON everywhere, instructive errors, ETag'd graph.
 * Ports serve/rest.py onto an express Router. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import express, { Router, type NextFunction, type Request, type Response } from "express";

import {
  clearSessionCookieHeader,
  sessionCookieHeader,
  verifyPassword,
  type AuthProvider,
} from "../auth";
import type { GraphStats } from "../compile/t1";
import { splitFrontmatter } from "../core/frontmatter";
import { runSearch } from "../query/router";
import { SPEC_VERSION, VERSION } from "../version";
import { bfsNeighborhood, jsonable, suggestPaths, type ServeState } from "./state";
import { liveHandler } from "./live";

/** Python `int(str)`: trimmed integer literals only — anything else keeps the default. */
export function intParam(raw: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  const value = /^[+-]?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
  if (Number.isNaN(value)) return fallback;
  return Math.max(lo, Math.min(value, hi));
}

function firstQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" ? value : undefined;
}

function docFrontmatter(state: ServeState, path: string): [Record<string, unknown>, string] | null {
  const record = state.recordFor(path);
  if (record === null) return null;
  const filePath = join(state.root, path);
  let isFile = false;
  try {
    isFile = statSync(filePath).isFile();
  } catch {
    isFile = false;
  }
  if (isFile) return splitFrontmatter(readFileSync(filePath, "utf8"));
  // deleted since the last compile — serve the held record
  const meta: Record<string, unknown> = {};
  for (const key of ["type", "title", "description", "tags", "timestamp"] as const) {
    const value = record[key];
    // Python keeps only truthy values here (empty tags/description drop out)
    if (value && !(Array.isArray(value) && value.length === 0)) meta[key] = value;
  }
  return [meta, record.text];
}

export function apiRouter(state: ServeState, auth: AuthProvider): Router {
  const router = Router();
  const jsonBody = express.json({ limit: "64kb" });
  // Starlette treats an unparseable login body as a missing password (400 with the
  // same instruction) — mirror that instead of express.json's default HTML error.
  const forgivingJson = (req: Request, res: Response, next: NextFunction): void => {
    jsonBody(req, res, (err?: unknown) => {
      if (err !== undefined && err !== null) req.body = null;
      next();
    });
  };

  // POST /api/login {password} → 204 + signed session cookie, 401 on mismatch (spec/50)
  router.post("/api/login", forgivingJson, (req: Request, res: Response) => {
    const store = auth.current();
    const body: unknown = req.body;
    const password =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)["password"]
        : undefined;
    if (typeof password !== "string") {
      res.status(400).json({ error: 'send JSON: {"password": "…"}' });
      return;
    }
    if (store === null || store.password === null) {
      res.status(400).json({
        error: "no password is set on this brain — set one first: brainpick password set",
      });
      return;
    }
    if (!verifyPassword(store, password)) {
      res.status(401).json({ error: "wrong password — try again" });
      return;
    }
    res.status(204).set("Set-Cookie", sessionCookieHeader(store)).end();
  });

  // POST /api/logout — clears the session (spec/50); always succeeds
  router.post("/api/logout", (_req: Request, res: Response) => {
    res.status(204).set("Set-Cookie", clearSessionCookieHeader()).end();
  });

  // Starlette's Route(methods=["POST"]) answers other verbs with 405 — mirror it
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).set("Allow", "POST").type("text/plain").send("Method Not Allowed");
  };
  router.all("/api/login", methodNotAllowed);
  router.all("/api/logout", methodNotAllowed);

  router.get("/api/health", (_req: Request, res: Response) => {
    res.json({ impl: "node", name: "brainpick", spec_version: SPEC_VERSION, version: VERSION });
  });

  router.get("/api/status", (_req: Request, res: Response) => {
    const stats = (state.graph.stats ?? {}) as Partial<GraphStats>;
    res.json({
      seq: state.seq,
      tiers: state.tiers(),
      docs: stats.docs ?? 0,
      edges: stats.edges ?? 0,
      ghosts: stats.ghosts ?? 0,
      orphans: stats.orphans ?? 0,
      bundle_root: state.root,
      watching: state.watching,
    });
  });

  router.get("/api/graph", (req: Request, res: Response) => {
    const layer = firstQuery(req.query["layer"]) ?? "links";
    if (layer === "entities") {
      res.status(404).json({ error: "layer=entities lands with T3 — use layer=links for now" });
      return;
    }
    const etag = `"${state.seq}"`;
    const ifNoneMatch = req.headers["if-none-match"];
    if (typeof ifNoneMatch === "string" && ifNoneMatch !== "") {
      const candidates = new Set(ifNoneMatch.split(",").map((value) => value.trim().replace(/^W\//, "")));
      if (candidates.has(etag) || candidates.has("*")) {
        res.status(304).set("ETag", etag).end();
        return;
      }
    }
    res.set("ETag", etag).json(state.graph);
  });

  router.get(/^\/api\/docs\/(.*)$/u, (req: Request, res: Response) => {
    // Express 5 decodes regexp captures (Starlette decodes path params too)
    const path = (req.params as Record<string, string>)["0"] ?? "";
    const record = state.recordFor(path);
    if (record === null) {
      res.status(404).json({
        error: `no document at '${path}' — the closest paths are listed under suggestions`,
        suggestions: suggestPaths(state.records, path),
      });
      return;
    }
    const [frontmatter, body] = docFrontmatter(state, path)!;
    res.json({
      path,
      frontmatter: jsonable(frontmatter),
      title: record.title,
      text: body,
      neighbors: state.neighborsOf(path),
    });
  });

  router.get("/api/search", async (req: Request, res: Response) => {
    const query = firstQuery(req.query["q"]);
    if (!query) {
      res.status(400).json({ error: "add ?q=<words> — e.g. /api/search?q=aurinko" });
      return;
    }
    const mode = firstQuery(req.query["mode"]) ?? "auto"; // the router forgives unknown modes
    const limit = intParam(firstQuery(req.query["limit"]) ?? "8", 8, 1, 50);
    const body = await runSearch(state.records, state.tiers(), query, mode, limit, state.semanticFn());
    res.json(body);
  });

  router.get("/api/neighbors", (req: Request, res: Response) => {
    const center = firstQuery(req.query["id"]);
    if (!center) {
      res.status(400).json({ error: "add ?id=<doc path> — e.g. /api/neighbors?id=kuu.md" });
      return;
    }
    const nodeIds = new Set(state.graph.nodes.map((node) => node.id));
    if (!nodeIds.has(center)) {
      res.status(404).json({
        error: `no node '${center}' in the graph — the closest paths are listed under suggestions`,
        suggestions: suggestPaths(state.records, center),
      });
      return;
    }
    const depth = intParam(firstQuery(req.query["depth"]) ?? "1", 1, 1, 3);
    const layer = firstQuery(req.query["layer"]) ?? "links";
    const [distance, edges] = bfsNeighborhood(state.graph, center, depth);
    const body: Record<string, unknown> = {
      center,
      nodes: state.graph.nodes.filter((node) => distance.has(node.id)),
      edges,
    };
    if (layer === "entities" || layer === "both") {
      body["degraded_from"] = "entities"; // links until T3, said out loud
    }
    res.json(body);
  });

  router.get("/api/live", liveHandler(state));

  router.all(/^\/api\/(.*)$/u, (req: Request, res: Response) => {
    const rest = (req.params as Record<string, string>)["0"] ?? "";
    res.status(404).json({
      error:
        `no endpoint /api/${rest} — see /api/health, /api/status, ` +
        "/api/graph, /api/docs/{path}, /api/search, /api/neighbors, /api/live",
    });
  });

  return router;
}
