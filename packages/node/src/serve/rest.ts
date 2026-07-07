/** The REST surface (spec/50): JSON everywhere, instructive errors, ETag'd graph.
 * Ports serve/rest.py onto an express Router. */
import { readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import express, { Router, type NextFunction, type Request, type Response } from "express";

import {
  AUTH_REQUIRED_ERROR,
  authActive,
  clearSessionCookieHeader,
  sessionCookieHeader,
  verifyPassword,
  type AuthProvider,
} from "../auth";
import type { GraphStats } from "../compile/t1";
import { sha256Hex } from "../core/canonical";
import { splitFrontmatter } from "../core/frontmatter";
import { atomicWrite } from "../core/fs";
import { guardedWrite } from "../mcp";
import { runSearch } from "../query/router";
import { SPEC_VERSION, VERSION } from "../version";
import { bfsNeighborhood, jsonable, suggestPaths, type ServeState } from "./state";
import { liveHandler } from "./live";

// Writing (spec/50): the browser editor's guarded doc-write + image-upload gate.
export const WRITES_DISABLED_ERROR = 'writes are disabled — set [serve] writes = "guarded"';
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", ""]);
const IMAGE_TYPES: Record<string, string> = {
  // accepted content-type → canonical extension
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const ASSET_INVALID = /[^a-z0-9._-]+/g;

interface GateFailure {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** spec/50: writes only when [serve] writes = "guarded" (else 403), and on a
 * non-localhost bind only with a credential (else 401). When credentials exist
 * the auth middleware has already gated; this closes the no-auth-file case. */
function writesGate(state: ServeState, auth: AuthProvider): GateFailure | null {
  const config = state.config;
  if (config.serve.writes !== "guarded") {
    return { status: 403, body: { error: WRITES_DISABLED_ERROR } };
  }
  if (!LOCAL_HOSTS.has(config.serve.host) && config.serve.token === "" && !authActive(auth.current())) {
    return { status: 401, body: { error: AUTH_REQUIRED_ERROR }, headers: { "WWW-Authenticate": "Bearer" } };
  }
  return null;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Split a buffer on every occurrence of `sep` (Buffer has no native split). */
function splitBuffer(buf: Buffer, separator: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  for (;;) {
    const idx = buf.indexOf(separator, start);
    if (idx === -1) {
      out.push(buf.subarray(start));
      break;
    }
    out.push(buf.subarray(start, idx));
    start = idx + separator.length;
  }
  return out;
}

interface MultipartField {
  filename: string | null;
  contentType: string;
  data: Buffer;
}

/** Minimal multipart/form-data parse → {field: {filename, contentType, data}}.
 * Enough for the single `file` (+ optional `name`) part POST /api/assets takes;
 * the twin of the Python engine's _parse_multipart, kept byte-parallel. */
function parseMultipart(body: Buffer, contentType: string): Map<string, MultipartField> {
  const fields = new Map<string, MultipartField>();
  const m = /boundary="?([^";]+)"?/.exec(contentType);
  if (m === null) return fields;
  const delim = Buffer.from("--" + m[1], "latin1");
  for (const chunk of splitBuffer(body, delim)) {
    let block = chunk;
    if (block.length >= 2 && block[0] === 0x0d && block[1] === 0x0a) block = block.subarray(2);
    if (block.length >= 2 && block[block.length - 2] === 0x0d && block[block.length - 1] === 0x0a) {
      block = block.subarray(0, block.length - 2);
    }
    if (block.length === 0 || block.equals(Buffer.from("--"))) continue; // preamble / closing
    const headEnd = block.indexOf("\r\n\r\n");
    if (headEnd === -1) continue;
    const headers = block.subarray(0, headEnd).toString("latin1");
    const data = block.subarray(headEnd + 4);
    const nameM = /name="([^"]*)"/.exec(headers);
    if (nameM === null) continue;
    const fileM = /filename="([^"]*)"/.exec(headers);
    const ctypeM = /content-type:\s*(.+?)\s*(?:\r?\n|$)/i.exec(headers);
    fields.set(nameM[1]!, {
      filename: fileM ? fileM[1]! : null,
      contentType: ctypeM ? ctypeM[1]!.trim() : "",
      data,
    });
  }
  return fields;
}

/** Kebab [a-z0-9._-], directory parts dropped (traversal can't escape assets/),
 * collapsed dots so no hidden ".." survives (spec/50). */
function sanitizeAssetName(raw: string, defaultExt: string): string {
  let base = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/");
  base = base.slice(base.lastIndexOf("/") + 1);
  base = base.replace(ASSET_INVALID, "-").replace(/-{2,}/g, "-").replace(/\.{2,}/g, ".");
  base = base.replace(/^[-.]+|[-.]+$/g, "");
  if (base === "") base = "asset";
  if (!base.includes(".")) base += defaultExt;
  return base;
}

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
      writes: state.config.serve.writes === "guarded", // the editor shows Edit only when true
      ui: {
        // [ui] policy shipped to the client so it stops guessing from the GPU (spec/50, spec/80)
        max_nodes_mobile: state.config.ui.max_nodes_mobile,
        default_mode: state.config.ui.default_mode,
      },
    });
  });

  router.get("/api/graph", (req: Request, res: Response) => {
    const layer = firstQuery(req.query["layer"]) ?? "links";
    if (layer === "entities" && state.kg === null) {
      // the instructive 404 wins over any cache
      res.status(404).json({ error: "no entity layer yet — compile T3 (an extractor) to populate it" });
      return;
    }
    const etag = `"${state.seq}"`; // both layers version by manifest seq (spec/50)
    const ifNoneMatch = req.headers["if-none-match"];
    if (typeof ifNoneMatch === "string" && ifNoneMatch !== "") {
      const candidates = new Set(ifNoneMatch.split(",").map((value) => value.trim().replace(/^W\//, "")));
      if (candidates.has(etag) || candidates.has("*")) {
        res.status(304).set("ETag", etag).end();
        return;
      }
    }
    if (layer === "entities") {
      res.set("ETag", etag).json(state.kg!.entityGraph());
      return;
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
    // sha of the raw file bytes (matches the write path's base_sha), null if deleted
    let sha: string | null = null;
    try {
      const filePath = join(state.root, path);
      if (statSync(filePath).isFile()) sha = sha256Hex(readFileSync(filePath));
    } catch {
      sha = null;
    }
    res.json({
      path,
      frontmatter: jsonable(frontmatter),
      title: record.title,
      text: body,
      sha,
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
    const body = await runSearch(
      state.records, state.tiers(), query, mode, limit,
      state.semanticFn(), state.graphFn(), state.graph,
    );
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
    let layer = firstQuery(req.query["layer"]) ?? "links";
    if (layer !== "links" && layer !== "entities" && layer !== "both") layer = "links";
    let wantEntities = layer === "entities" || layer === "both";
    let wantLinks = layer === "links" || layer === "both";
    let tagged = layer === "both";

    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    const body: Record<string, unknown> = { center, nodes, edges };
    if (wantEntities && state.kg === null) {
      body["degraded_from"] = "entities"; // links until a T3 export, said out loud
      wantLinks = true;
      wantEntities = false;
      tagged = false;
    }
    if (wantLinks) {
      const [distance, linkEdges] = bfsNeighborhood(state.graph, center, depth);
      for (const node of state.graph.nodes) {
        if (distance.has(node.id)) nodes.push(tagged ? { ...node, layer: "links" } : { ...node });
      }
      for (const edge of linkEdges) edges.push(tagged ? { ...edge, layer: "links" } : { ...edge });
    }
    if (wantEntities) {
      const [entityNodes, entityEdges] = state.kg!.neighborEntities(center, depth);
      for (const node of entityNodes) nodes.push(tagged ? { ...node, layer: "entities" } : { ...node });
      for (const edge of entityEdges) edges.push(tagged ? { ...edge, layer: "entities" } : { ...edge });
    }
    res.json(body);
  });

  router.get("/api/timeline", (req: Request, res: Response) => {
    // The advisory t1/timeline.json (spec/90), or the empty shape when the bundle
    // has no git history. ETag by manifest seq, like /api/graph.
    const etag = `"${state.seq}"`;
    const ifNoneMatch = req.headers["if-none-match"];
    if (typeof ifNoneMatch === "string" && ifNoneMatch !== "") {
      const candidates = new Set(ifNoneMatch.split(",").map((value) => value.trim().replace(/^W\//, "")));
      if (candidates.has(etag) || candidates.has("*")) {
        res.status(304).set("ETag", etag).end();
        return;
      }
    }
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(join(state.root, ".brainpick", "t1", "timeline.json"), "utf8"));
    } catch {
      payload = { commits: [], docs: {}, span: null };
    }
    res.set("ETag", etag).json(payload);
  });

  router.get("/api/live", liveHandler(state));

  // PUT /api/docs/{path} (spec/50): brain_write's HTTP face over guarded_write.
  const docJson = express.json({ limit: "2mb" });
  const forgivingDocJson = (req: Request, res: Response, next: NextFunction): void => {
    docJson(req, res, (err?: unknown) => {
      if (err !== undefined && err !== null) req.body = null;
      next();
    });
  };
  router.put(/^\/api\/docs\/(.*)$/u, forgivingDocJson, async (req: Request, res: Response) => {
    const gate = writesGate(state, auth);
    if (gate !== null) {
      res.status(gate.status).set(gate.headers ?? {}).json(gate.body);
      return;
    }
    const path = (req.params as Record<string, string>)["0"] ?? "";
    if (!path.endsWith(".md")) {
      res.status(400).json({ ok: false, instruction: "the editor writes .md docs — target a path ending in .md" });
      return;
    }
    const body: unknown = req.body;
    const rec = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    if (typeof rec["content"] !== "string") {
      res.status(400).json({ error: 'send JSON: {"content": "…", "base_sha"?: "…", "mode"?: "replace"}' });
      return;
    }
    const baseSha = typeof rec["base_sha"] === "string" ? (rec["base_sha"] as string) : null;
    const mode = typeof rec["mode"] === "string" ? (rec["mode"] as string) : "replace"; // editor saves a full doc
    const [status, payload] = await guardedWrite(state, path, rec["content"] as string, mode, baseSha);
    if (status === "ok") {
      res.status(200).json({ ok: true, path: payload["path"], seq: payload["seq"], sha: payload["sha"] });
      return;
    }
    if (status === "badpath") {
      res.status(400).json({ ok: false, instruction: payload["instruction"] });
      return;
    }
    if (status === "conflict") {
      res.status(409).json(payload);
      return;
    }
    // violation | exists → 422: the request was well-formed, the content/mode was not
    res.status(422).json({ ok: false, instruction: payload["instruction"] });
  });

  // POST /api/assets (spec/50): store an uploaded image under <bundle>/assets/.
  const rawLimit = state.config.serve.max_asset_bytes + 1_048_576; // + slop for the multipart envelope
  const assetRaw = express.raw({ type: "multipart/form-data", limit: rawLimit });
  const assetBody = (req: Request, res: Response, next: NextFunction): void => {
    assetRaw(req, res, (err?: unknown) => {
      if (err !== undefined && err !== null) {
        res.status(413).json({ error: `asset exceeds the ${state.config.serve.max_asset_bytes}-byte cap` });
        return;
      }
      next();
    });
  };
  router.post("/api/assets", assetBody, (req: Request, res: Response) => {
    const gate = writesGate(state, auth);
    if (gate !== null) {
      res.status(gate.status).set(gate.headers ?? {}).json(gate.body);
      return;
    }
    const maxBytes = state.config.serve.max_asset_bytes;
    const rawBody = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    const fields = parseMultipart(rawBody, String(req.headers["content-type"] ?? ""));
    const filePart = fields.get("file");
    if (filePart === undefined) {
      res.status(400).json({ error: "send multipart/form-data with a 'file' part" });
      return;
    }
    const data = filePart.data;
    const ctype = (filePart.contentType || "").split(";")[0]!.trim().toLowerCase();
    const nameField = fields.get("name");
    const requested = nameField ? nameField.data.toString("utf8").trim() : "";
    const rawName = requested || filePart.filename || "";
    const dotIdx = rawName.lastIndexOf(".");
    const ext = dotIdx === -1 ? "" : rawName.slice(dotIdx).toLowerCase();
    if (!(ctype in IMAGE_TYPES) && !IMAGE_EXTS.has(ext)) {
      res.status(400).json({ error: "assets must be png, jpeg, webp, gif, or svg images" });
      return;
    }
    if (data.length > maxBytes) {
      res.status(413).json({
        error: `asset is ${data.length} bytes — the cap is ${maxBytes} (raise [serve] max_asset_bytes)`,
      });
      return;
    }
    const defaultExt = IMAGE_TYPES[ctype] ?? (IMAGE_EXTS.has(ext) ? ext : ".png");
    let name = sanitizeAssetName(rawName, defaultExt);
    const assetsDir = join(state.root, "assets");
    const resolvedDir = resolve(assetsDir);
    if (resolve(assetsDir, name) !== resolvedDir && !resolve(assetsDir, name).startsWith(resolvedDir + sep)) {
      res.status(400).json({ error: "asset name escapes assets/" });
      return;
    }
    const sha = sha256Hex(data);
    let target = join(assetsDir, name);
    const sameBytes = (p: string): boolean => fileExists(p) && readFileSync(p).equals(data);
    if (!sameBytes(target)) {
      if (fileExists(target)) {
        // a different image already owns this name → hash-suffix it
        const d = name.lastIndexOf(".");
        name = d === -1 ? `${name}-${sha.slice(0, 8)}` : `${name.slice(0, d)}-${sha.slice(0, 8)}${name.slice(d)}`;
        target = join(assetsDir, name);
      }
      if (!sameBytes(target)) atomicWrite(target, data);
    }
    res.status(201).json({ path: `assets/${name}`, sha, bytes: data.length });
  });

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
