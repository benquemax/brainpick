/** buildApp: one express process for /api, /api/live, /mcp, and the web UI.
 * Ports serve/app.py; the lifecycle differences are documented inline —
 * the TS SDK has no session manager to run, but per-request stateless
 * transports must be created (and closed) inside the route handler. */
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig, type Config } from "../config";
import { createMcpServer, WRITES_OFF_REFUSAL } from "../mcp";
import { PACKAGE_ROOT } from "../version";
import { apiRouter } from "./rest";
import { ServeState } from "./state";
import { watchBundle, type BundleWatcher } from "./watcher";

export const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", ""]);

export const FALLBACK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>brainpick</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto;">
<h1>brainpick is serving</h1>
<p>The web UI is not built yet. Build it once:</p>
<pre>cd packages/webui &amp;&amp; npm install &amp;&amp; npm run build</pre>
<p>Meanwhile the API is live: <a href="/api/status">/api/status</a>,
<a href="/api/graph">/api/graph</a>, <a href="/api/live">/api/live</a> — and MCP at /mcp.</p>
</body></html>
`;

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

/** Package data first (shipped tarballs carry static/), then the dev checkout's webui build. */
export function resolveUiDir(): string | null {
  const packageStatic = resolve(PACKAGE_ROOT, "static");
  if (hasIndexHtml(packageStatic)) return packageStatic;
  const devDist = resolve(PACKAGE_ROOT, "..", "webui", "dist");
  if (hasIndexHtml(devDist)) return devDist;
  return null;
}

function hasIndexHtml(dir: string): boolean {
  try {
    return statSync(resolve(dir, "index.html")).isFile();
  } catch {
    return false;
  }
}

function spaHandler(uiDir: string | null) {
  return (req: Request, res: Response): void => {
    if (uiDir === null) {
      res.type("html").send(FALLBACK_HTML);
      return;
    }
    const path = decodePath(req.path.replace(/^\/+/, ""));
    if (path !== "") {
      const candidate = resolve(uiDir, path);
      const inside = candidate === uiDir || candidate.startsWith(uiDir + sep);
      if (inside && isFile(candidate)) {
        res.sendFile(candidate);
        return;
      }
    }
    res.sendFile(resolve(uiDir, "index.html")); // SPA fallback for client routes
  };
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** On non-localhost binds, MCP endpoints require the configured bearer token (spec/80). */
function bearerGate(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/mcp" || req.path.startsWith("/mcp/") ||
        req.path === "/sse" || req.path.startsWith("/sse/") ||
        req.path === "/messages" || req.path.startsWith("/messages/")) {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.status(401).json({ error: "missing or wrong bearer token — send Authorization: Bearer <token>" });
        return;
      }
    }
    next();
  };
}

function httpWriteRefusal(config: Config): string | null {
  if (config.serve.writes === "off") return WRITES_OFF_REFUSAL;
  if (!isLocalHost(config.serve.host) && !config.serve.token) {
    return "brain_write over a non-localhost bind needs [serve] token set in brainpick.toml";
  }
  return null;
}

export interface BuildAppOptions {
  /** Override UI asset resolution (tests); undefined → auto-detect. */
  uiDir?: string | null;
}

export interface ServeHandles {
  app: Express;
  state: ServeState;
  config: Config;
  /** Start the file watcher (no-op when [serve] watch = false). */
  start(): Promise<void>;
  /** Stop the watcher and close any live MCP transports. */
  close(): Promise<void>;
}

export async function buildApp(
  root: string,
  config: Config | null = null,
  options: BuildAppOptions = {},
): Promise<ServeHandles> {
  let bundleRoot = resolve(root);
  const cfg = config ?? loadConfig(bundleRoot);
  bundleRoot = resolve(bundleRoot, cfg.bundle.root);

  const state = new ServeState(bundleRoot, cfg);
  await state.load();

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false); // /api/graph hand-rolls its ETag from seq (spec/50)

  if (!isLocalHost(cfg.serve.host) && cfg.serve.token) {
    app.use(bearerGate(cfg.serve.token));
  }

  app.use(apiRouter(state));

  const transports = cfg.serve.transports.length > 0 ? cfg.serve.transports : ["streamable-http"];
  const writeRefusal = httpWriteRefusal(cfg);
  const jsonBody = express.json({ limit: "8mb" });
  const sseSessions = new Map<string, SSEServerTransport>();

  if (transports.includes("streamable-http")) {
    // The SDK's documented express pattern for STATELESS servers: a fresh
    // McpServer + transport per POST (sessionIdGenerator: undefined), torn
    // down when the response closes. Nothing to mount, no session manager
    // to keep running — the Python SDK's route-lifting and lifespan traps
    // have no TS equivalent.
    app.post("/mcp", jsonBody, async (req: Request, res: Response) => {
      const server = createMcpServer(state, writeRefusal);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });
    const methodNotAllowed = (_req: Request, res: Response): void => {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
    };
    app.get("/mcp", methodNotAllowed);
    app.delete("/mcp", methodNotAllowed);
  }

  if (transports.includes("sse")) {
    // Legacy SSE transport (spec/70): GET /sse opens the stream, POST
    // /messages?sessionId=… carries the requests. Sessions are per-GET.
    app.get("/sse", async (_req: Request, res: Response) => {
      const transport = new SSEServerTransport("/messages", res);
      sseSessions.set(transport.sessionId, transport);
      const server = createMcpServer(state, writeRefusal);
      res.on("close", () => {
        sseSessions.delete(transport.sessionId);
        void server.close();
      });
      await server.connect(transport);
    });
    app.post("/messages", jsonBody, async (req: Request, res: Response) => {
      const sessionId = String(req.query["sessionId"] ?? "");
      const transport = sseSessions.get(sessionId);
      if (transport === undefined) {
        res.status(400).json({ error: "no live /sse session with that sessionId — reconnect to /sse" });
        return;
      }
      await transport.handlePostMessage(req, res, req.body);
    });
  }

  const uiDir = options.uiDir === undefined ? resolveUiDir() : options.uiDir;
  app.use(spaHandler(uiDir));

  let watcher: BundleWatcher | null = null;
  return {
    app,
    state,
    config: cfg,
    async start(): Promise<void> {
      if (cfg.serve.watch && watcher === null) {
        watcher = watchBundle(state);
        await watcher.ready;
      }
    },
    async close(): Promise<void> {
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
      for (const transport of sseSessions.values()) void transport.close();
      sseSessions.clear();
    },
  };
}
