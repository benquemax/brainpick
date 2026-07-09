/** e2e: one process serving REST + live SSE + the web UI + /mcp (spec/50 + spec/60).
 *
 * Everything runs against a REAL express server on an ephemeral port — a live
 * socket is the honest test of a serve layer (the twin of test_e2e_serve.py).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { loadConfig, type ServeConfig } from "../src/config";
import { sha256Hex } from "../src/core/canonical";
import { buildApp, type BuildAppOptions, type ServeHandles } from "../src/serve/app";
import { sseFrame } from "../src/serve/live";
import { recompileAndBroadcast } from "../src/serve/watcher";
import { cleanup, copyBundle, tempDir, stageT3Export } from "./helpers";

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n";

const KUU_REWRITE =
  "---\ntype: Concept\ntags: [kuu]\ntimestamp: 2026-06-15T08:30:00Z\n---\n\n" +
  "# Kuu\n\nThe moon pulls the tides of [Maa](maa.md), rewritten.\n";

// a 1x1 transparent PNG — a real image the asset endpoint accepts
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const savedPath = process.env["PATH"];

interface Running {
  base: string;
  handles: ServeHandles;
  stop: () => Promise<void>;
}

const runningServers: Running[] = [];

afterEach(async () => {
  process.env["PATH"] = savedPath;
  for (const server of runningServers.splice(0)) await server.stop();
  cleanup();
});

async function makeApp(
  root: string,
  overrides: Partial<ServeConfig> = {},
  options: BuildAppOptions = {},
): Promise<ServeHandles> {
  const config = loadConfig(root);
  config.serve.watch = false;
  Object.assign(config.serve, overrides);
  return buildApp(root, config, options);
}

/** A real server on an ephemeral port, torn down by afterEach. */
async function serve(handles: ServeHandles): Promise<Running> {
  const server: Server = handles.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  await handles.start();
  const port = (server.address() as AddressInfo).port;
  const running: Running = {
    base: `http://127.0.0.1:${port}`,
    handles,
    stop: async () => {
      await handles.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  runningServers.push(running);
  return running;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text), headers: res.headers };
}

/** Read one SSE frame (events and comment-only pings alike) off a live stream. */
class SseReader {
  private buffer = "";
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  async nextEvent(timeoutMs = 20_000): Promise<Record<string, string>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const cut = this.buffer.indexOf("\n\n");
      if (cut !== -1) {
        const frame = this.buffer.slice(0, cut);
        this.buffer = this.buffer.slice(cut + 2);
        const event: Record<string, string> = {};
        for (const line of frame.split("\n")) {
          if (line === "") continue;
          if (line.startsWith(":")) {
            event["comment"] ??= line;
            continue;
          }
          const sep = line.indexOf(":");
          const key = sep === -1 ? line : line.slice(0, sep);
          let value = sep === -1 ? "" : line.slice(sep + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (key === "data") event["data"] = (event["data"] ?? "") + value;
          else event[key] = value;
        }
        if (Object.keys(event).length > 0) return event;
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("no SSE frame within the timeout");
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE read timeout")), remaining)),
      ]);
      if (chunk.done) throw new Error("SSE stream ended unexpectedly");
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async waitForEvent(name: string, timeoutMs = 20_000): Promise<Record<string, string>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = await this.nextEvent(deadline - Date.now());
      if (event["event"] === name) return event;
    }
    throw new Error(`no '${name}' event within ${timeoutMs}ms`);
  }
}

async function openLive(
  base: string,
  headers: Record<string, string> = {},
): Promise<{ reader: SseReader; close: () => void }> {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/live`, { headers, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")!.startsWith("text/event-stream")).toBe(true);
  return { reader: new SseReader(res.body!), close: () => controller.abort() };
}

// -----------------------------------------------------------------------------------

test("sse frame format", () => {
  expect(sseFrame("graph.delta", 3, '{"seq":3}')).toBe('event: graph.delta\nid: 3\ndata: {"seq":3}\n\n');
  expect(sseFrame("compile.status", null, "{}")).toBe("event: compile.status\ndata: {}\n\n");
});

test("health", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const { body } = await getJson(`${base}/api/health`);
  expect(body).toEqual({ impl: "node", name: "brainpick", spec_version: "0.1", version: "0.1.0" });
});

test("status", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const { body } = await getJson(`${base}/api/status`);
  expect(body.seq).toBe(1);
  expect(body.tiers).toEqual({ t1: "fresh", t2: "off", t3: "fresh" });
  expect(body.docs).toBe(10);
  expect(body.ghosts).toBe(1);
  expect(body.orphans).toBe(1);
  expect(body.watching).toBe(false);
  expect(body.bundle_root).toBeTruthy();
  expect(body.edges).toBeGreaterThan(0);
  expect(body.writes).toBe(true); // default [serve] writes = "guarded" → editor shows Edit
  expect(body.id).toBeNull(); // the fixture predates [bundle] id (spec/80)
  // [ui] policy reaches the client so it stops guessing from the GPU (spec/50, spec/80)
  expect(body.ui).toEqual({ max_nodes_mobile: 8000, default_mode: "cosmos" });
});

test("status ships the configured bundle id", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[bundle]\nid = "abc123xyz987def456ghi0a"\n', "utf8");
  const { base } = await serve(await makeApp(root));
  const { body } = await getJson(`${base}/api/status`);
  expect(body.id).toBe("abc123xyz987def456ghi0a");
});

test("status ships configured ui", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[ui]\nmax_nodes_mobile = 1200\ndefault_mode = "brain"\n', "utf8");
  const { base } = await serve(await makeApp(root));
  const { body } = await getJson(`${base}/api/status`);
  expect(body.ui).toEqual({ max_nodes_mobile: 1200, default_mode: "brain" });
});

test("graph etag roundtrip", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const first = await getJson(`${base}/api/graph`);
  expect(first.status).toBe(200);
  expect(first.headers.get("etag")).toBe('"1"');
  expect(first.body.stats.docs).toBe(10);
  const cached = await fetch(`${base}/api/graph`, { headers: { "If-None-Match": first.headers.get("etag")! } });
  expect(cached.status).toBe(304);
  // the algorithmic default derives an entity layer on every compile — it serves
  const entities = await getJson(`${base}/api/graph?layer=entities`);
  expect(entities.status).toBe(200);
  expect(entities.body.nodes.some((n: { type: string }) => n.type === "ghost")).toBe(true);
});

test("entity layer 404s only when the export is truly absent", async () => {
  // [modules] graph = "off" compiles no T3 export at all — only THEN does the
  // entity layer 404 (an empty-but-present export serves empty instead, spec/40)
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[modules]\ngraph = "off"\n', "utf8");
  const { base } = await serve(await makeApp(root));
  const entities = await getJson(`${base}/api/graph?layer=entities`);
  expect(entities.status).toBe(404);
  expect(entities.body.error).toBeTruthy();
  // the instructive 404 wins over a cache: a stale If-None-Match must not 304
  const cachedEntities = await fetch(`${base}/api/graph?layer=entities`, { headers: { "If-None-Match": '"1"' } });
  expect(cachedEntities.status).toBe(404);
});

test("timeline empty then served", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  // the fixture copy is not a git repo → no timeline.json → the empty shape
  const first = await getJson(`${base}/api/timeline`);
  expect(first.status).toBe(200);
  expect(first.headers.get("etag")).toBe('"1"');
  expect(first.body).toEqual({ commits: [], docs: {}, span: null });

  // once an advisory timeline.json exists, the endpoint serves it verbatim
  const payload = {
    commits: [
      { added: ["a.md"], author: "Tom", date: "2026-07-02T20:41:00Z",
        deleted: [], message: "Founding", modified: [], sha: "abc1234" },
    ],
    docs: { "a.md": { created: "2026-07-02T20:41:00Z", deleted: null, modified: [] } },
    span: { commits: 1, first: "2026-07-02T20:41:00Z", last: "2026-07-02T20:41:00Z" },
  };
  writeFileSync(join(root, ".brainpick", "t1", "timeline.json"), JSON.stringify(payload), "utf8");
  const served = await getJson(`${base}/api/timeline`);
  expect(served.status).toBe(200);
  expect(served.headers.get("etag")).toBe('"1"');
  expect(served.body).toEqual(payload);

  // ETag by seq (spec/90): a matching If-None-Match short-circuits to 304
  const cached = await fetch(`${base}/api/timeline`, { headers: { "If-None-Match": '"1"' } });
  expect(cached.status).toBe(304);
});

test("docs happy and nested", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const { body } = await getJson(`${base}/api/docs/kuu.md`);
  expect(new Set(Object.keys(body))).toEqual(new Set(["path", "frontmatter", "title", "text", "sha", "neighbors"]));
  expect(body.sha).toHaveLength(64); // sha256 of the raw file bytes — the editor's next base_sha
  expect(body.title).toBe("Kuu");
  expect(body.frontmatter.type).toBe("Concept");
  expect(body.frontmatter.timestamp).toBe("2026-06-15T08:30:00Z");
  expect(body.text).toContain("tides");
  expect(body.neighbors.out).toContainEqual({ path: "maa.md", title: "Maa" });
  expect(body.neighbors.in.map((n: { path: string }) => n.path)).toContain("aurinko.md");
  const nested = await getJson(`${base}/api/docs/saaret/atolli.md`);
  expect(nested.status).toBe(200);
  expect(nested.body.path).toBe("saaret/atolli.md");
});

test("docs 404 carries suggestions", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const missing = await getJson(`${base}/api/docs/kuu`);
  expect(missing.status).toBe(404);
  expect(missing.body.error).toBeTruthy();
  expect(missing.body.suggestions).toContain("kuu.md");
  expect(missing.body.suggestions.length).toBeLessThanOrEqual(5);
});

test("search keyword set", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const { body } = await getJson(`${base}/api/search?q=aurinko`);
  expect(new Set(body.hits.map((h: { path: string }) => h.path))).toEqual(
    new Set(["aurinko.md", "komeetta.md", "planeetat.md", "yksinainen.md"]),
  );
  expect(new Set(Object.keys(body.hits[0]))).toEqual(
    new Set(["path", "title", "description", "score", "snippet", "source"]),
  );
  expect(body.used_modes).toEqual(["keyword"]);
  expect(body.degraded_from).toBe("semantic"); // auto without T2 says so (spec/30)
  const keyword = await getJson(`${base}/api/search?q=aurinko&mode=keyword`);
  expect(keyword.body.degraded_from).toBeNull();
  const unknownMode = await getJson(`${base}/api/search?q=aurinko&mode=banana`);
  expect(unknownMode.status).toBe(200);
  expect(unknownMode.body.used_modes).toEqual(["keyword"]);
  const semantic = await getJson(`${base}/api/search?q=aurinko&mode=semantic`);
  expect(semantic.body.degraded_from).toBe("semantic");
  expect((await getJson(`${base}/api/search`)).status).toBe(400);
});

test("search semantic and auto with mock vectors", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[models.embedding]\nkind = "mock"\n', "utf8");
  const { base } = await serve(await makeApp(root));
  expect((await getJson(`${base}/api/status`)).body.tiers.t2).toBe("fresh");

  const semantic = (await getJson(`${base}/api/search?q=${encodeURIComponent("kuu vuorovesi maa")}&mode=semantic`)).body;
  expect(semantic.used_modes).toEqual(["semantic"]);
  expect(semantic.degraded_from).toBeNull();
  expect(semantic.hits.length).toBeGreaterThan(0);
  expect(semantic.hits.every((h: { source: string }) => h.source === "semantic")).toBe(true);
  expect(new Set(Object.keys(semantic.hits[0]))).toEqual(
    new Set(["path", "title", "description", "score", "snippet", "source"]),
  );

  const auto = (await getJson(`${base}/api/search?q=aurinko&mode=auto`)).body;
  expect(auto.used_modes).toEqual(["keyword", "semantic"]);
  expect(auto.degraded_from).toBeNull();
  const paths = auto.hits.map((h: { path: string }) => h.path);
  expect(paths).toContain("aurinko.md");
  expect(paths.length).toBe(new Set(paths).size); // RRF dedupes by document
  expect(auto.hits.every((h: { source: string }) => ["keyword", "semantic"].includes(h.source))).toBe(true);
});

test("neighbors depth semantics", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const one = (await getJson(`${base}/api/neighbors?id=maa.md`)).body;
  expect(one.center).toBe("maa.md");
  expect(new Set(one.nodes.map((n: { id: string }) => n.id))).toEqual(
    new Set(["maa.md", "kuu.md", "planeetat.md", "index.md"]),
  );
  for (const e of one.edges) {
    expect(new Set(Object.keys(e))).toEqual(new Set(["source", "target", "kind", "count", "label"]));
  }
  const two = (await getJson(`${base}/api/neighbors?id=maa.md&depth=2`)).body;
  expect(new Set(two.nodes.map((n: { id: string }) => n.id))).toEqual(
    new Set([
      "maa.md", "kuu.md", "planeetat.md", "index.md", "aurinko.md",
      "komeetta.md", "yksinainen.md", "saaret/atolli.md", "saaret/laguuni.md",
    ]),
  );
  const missing = await getJson(`${base}/api/neighbors?id=olematon.md`);
  expect(missing.status).toBe(404);
  expect(missing.body.suggestions.length).toBeGreaterThan(0);
  expect((await getJson(`${base}/api/neighbors`)).status).toBe(400);
});

/** A running server whose ServeState holds the staged T3 export (kg present). */
async function serveWithT3(root: string): Promise<{ base: string }> {
  const handles = await makeApp(root); // buildApp already ran state.load()
  stageT3Export(root);
  handles.state.reloadArtifacts(); // re-read the flipped manifest + the export
  return serve(handles);
}

test("t3 entity graph endpoint", async () => {
  const { base } = await serveWithT3(copyBundle());
  expect((await getJson(`${base}/api/status`)).body.tiers.t3).toBe("fresh");

  const response = await getJson(`${base}/api/graph?layer=entities`);
  expect(response.status).toBe(200);
  expect(response.headers.get("etag")).toBe('"1"'); // versioned by seq, like layer=links
  expect(response.body.nodes.map((n: { id: string }) => n.id)).toEqual([
    "aurinko", "komeetta", "kuu", "maa", "planeetat", "vuorovesi",
  ]);
  const aurinko = response.body.nodes.find((n: { id: string }) => n.id === "aurinko");
  expect(new Set(Object.keys(aurinko))).toEqual(
    new Set(["id", "name", "type", "description", "degree", "source_docs"]),
  );
  expect(aurinko.type).toBe("star");
  expect(aurinko.degree).toBe(2);
  // source_docs (spec/50): the entity's provenance, sorted, so the entity panel
  // need not make N follow-up calls.
  expect(aurinko.source_docs).toEqual(["aurinko.md", "komeetta.md", "planeetat.md"]);
  expect(response.body.edges).toContainEqual({ src: "komeetta", dst: "aurinko", weight: 0.6 });
  expect(response.body.edges).toHaveLength(5);

  const cached = await fetch(`${base}/api/graph?layer=entities`, { headers: { "If-None-Match": '"1"' } });
  expect(cached.status).toBe(304);
});

test("t3 neighbors entities and both", async () => {
  const { base } = await serveWithT3(copyBundle());
  const entities = (await getJson(`${base}/api/neighbors?id=kuu.md&layer=entities`)).body;
  expect(entities.center).toBe("kuu.md");
  expect(new Set(entities.nodes.map((n: { id: string }) => n.id))).toEqual(
    new Set(["kuu", "maa", "vuorovesi", "planeetat"]),
  );
  expect(entities.degraded_from).toBeUndefined(); // T3 present — no degradation
  const grounding = new Set<string>(entities.nodes.flatMap((n: { source_docs: string[] }) => n.source_docs));
  expect(grounding).toEqual(new Set(["aurinko.md", "kuu.md", "maa.md", "planeetat.md"]));
  expect(entities.edges).toContainEqual({ src: "kuu", dst: "vuorovesi" });

  const both = (await getJson(`${base}/api/neighbors?id=kuu.md&layer=both`)).body;
  expect(new Set(both.nodes.map((n: { layer: string }) => n.layer))).toEqual(new Set(["links", "entities"]));
  // link nodes carry a doc title, entity nodes an entity name — overlaid, not merged
  expect(both.nodes.some((n: Record<string, unknown>) => n["layer"] === "links" && "title" in n)).toBe(true);
  expect(both.nodes.some((n: Record<string, unknown>) => n["layer"] === "entities" && "name" in n)).toBe(true);
});

test("t3 graph mode search", async () => {
  const { base } = await serveWithT3(copyBundle());
  const orbits = (await getJson(`${base}/api/search?q=${encodeURIComponent("what orbits the star")}&mode=graph&limit=4`)).body;
  expect(new Set(orbits.hits.map((h: { path: string }) => h.path))).toEqual(
    new Set(["aurinko.md", "komeetta.md", "maa.md", "planeetat.md"]),
  );
  expect(orbits.used_modes).toEqual(["graph"]);
  expect(orbits.degraded_from).toBeNull();
  expect(orbits.hits.every((h: { source: string }) => h.source === "graph")).toBe(true);

  // "vuorovesi" is in no document body — keyword finds nothing, graph expands
  const vuorovesi = (await getJson(`${base}/api/search?q=vuorovesi&mode=graph`)).body;
  expect(new Set(vuorovesi.hits.map((h: { path: string }) => h.path))).toEqual(
    new Set(["kuu.md", "aurinko.md", "maa.md"]),
  );
});

test("graph mode degrades without t3", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[modules]\ngraph = "off"\n', "utf8"); // no export exists
  const { base } = await serve(await makeApp(root));
  const body = (await getJson(`${base}/api/search?q=aurinko&mode=graph`)).body;
  expect(body.degraded_from).toBe("graph"); // honest marker, keyword + T1 link-walk beneath
  expect(new Set(body.hits.map((h: { path: string }) => h.path)).has("aurinko.md")).toBe(true);
});

test("ui and spa fallback", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  for (const path of ["/", "/graph/some-deep-link"]) {
    const page = await fetch(base + path);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")!.startsWith("text/html")).toBe(true);
    await page.text();
  }
  const missing = await getJson(`${base}/api/olematon`);
  expect(missing.status).toBe(404);
  expect(missing.body.error).toBeTruthy();
});

test("fallback page when ui unbuilt", async () => {
  const { base } = await serve(await makeApp(copyBundle(), {}, { uiDir: null }));
  const page = await fetch(base + "/");
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("web UI");
});

test("mcp route mounted and sse optional", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const posted = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await posted.text();
  expect(posted.status).not.toBe(404); // mounted — the SDK answers (400/406), not the SPA
  expect([400, 406]).toContain(posted.status);
  const noSse = await fetch(`${base}/sse`);
  expect(noSse.headers.get("content-type")!).toContain("text/html"); // /sse not mounted by default
  await noSse.text();

  const both = await serve(await makeApp(copyBundle(), { transports: ["streamable-http", "sse"] }));
  const controller = new AbortController();
  const sse = await fetch(`${both.base}/sse`, { signal: controller.signal });
  expect(sse.headers.get("content-type")!).toContain("text/event-stream");
  controller.abort();
});

test("mcp bearer gate on nonlocal bind", async () => {
  const { base } = await serve(await makeApp(copyBundle(), { host: "0.0.0.0", token: "s3cret" }));
  expect((await getJson(`${base}/api/health`)).status).toBe(200); // REST stays open
  const denied = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await denied.text();
  expect(denied.status).toBe(401);
  const allowed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer s3cret" },
    body: "{}",
  });
  await allowed.text();
  expect(allowed.status).not.toBe(401);
});

// -- auth (spec/80 + spec/50): open by default; tokens gate /api and /mcp; the
// -- password gates the static UI behind a login page and a session cookie.

const AUTH_401 =
  "authentication required — send Authorization: Bearer <token> " +
  "(create one: brainpick token create) or log in";

test("auth open by default serves everything", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  expect((await getJson(`${base}/api/status`)).status).toBe(200);
  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await mcp.text();
  expect(mcp.status).not.toBe(401);
  const page = await fetch(`${base}/`);
  expect(page.status).toBe(200);
  expect(await page.text()).not.toContain('id="login"'); // no password → no login page
});

test("token gates api and mcp until revoked", async () => {
  const { createToken, listTokens, revokeToken } = await import("../src/auth");
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const [tokenId, secret] = createToken(root, "hermes"); // picked up live
  const [, secondSecret] = createToken(root, "vartija");

  const denied = await getJson(`${base}/api/status`);
  expect(denied.status).toBe(401);
  expect(denied.headers.get("www-authenticate")).toBe("Bearer");
  expect(denied.body).toEqual({ error: AUTH_401 });
  const wrong = await getJson(`${base}/api/status`, { Authorization: "Bearer bp_" + "0".repeat(32) });
  expect(wrong.status).toBe(401);
  const allowed = await getJson(`${base}/api/status`, { Authorization: `Bearer ${secret}` });
  expect(allowed.status).toBe(200);

  const mcpDenied = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(mcpDenied.status).toBe(401);
  expect(await mcpDenied.json()).toEqual({ error: AUTH_401 });
  const mcpAllowed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${secret}` },
    body: "{}",
  });
  await mcpAllowed.text();
  expect(mcpAllowed.status).not.toBe(401);

  const page = await fetch(`${base}/`); // tokens without a password never lock the UI (spec/80)
  expect(page.status).toBe(200);
  expect(await page.text()).not.toContain('id="login"');

  revokeToken(root, tokenId); // a running server notices without a restart
  expect((await getJson(`${base}/api/status`, { Authorization: `Bearer ${secret}` })).status).toBe(401);
  expect((await getJson(`${base}/api/status`, { Authorization: `Bearer ${secondSecret}` })).status).toBe(200);

  // revoking the LAST token reopens the brain — tokenless + passwordless
  // stays a first-class setup (spec/80), never a lock-out
  for (const record of listTokens(root)) revokeToken(root, record.id);
  expect((await getJson(`${base}/api/status`)).status).toBe(200);
});

test("live stream accepts query token", async () => {
  const { createToken } = await import("../src/auth");
  const root = copyBundle();
  const [, secret] = createToken(root, "event-source");
  const { base } = await serve(await makeApp(root));

  const denied = await getJson(`${base}/api/live`);
  expect(denied.status).toBe(401);
  expect(denied.body).toEqual({ error: AUTH_401 });

  const controller = new AbortController();
  const res = await fetch(`${base}/api/live?token=${secret}`, { signal: controller.signal });
  expect(res.status).toBe(200); // EventSource cannot set headers
  const reader = new SseReader(res.body!);
  expect((await reader.nextEvent())["event"]).toBe("hello");
  controller.abort();

  expect((await getJson(`${base}/api/live?token=bp_${"f".repeat(32)}`)).status).toBe(401);
});

test("password login flow", async () => {
  const { SESSION_COOKIE, setPassword } = await import("../src/auth");
  const root = copyBundle();
  setPassword(root, "kotiaurinko");
  const { base } = await serve(await makeApp(root));

  const page = await fetch(`${base}/`);
  expect(page.status).toBe(200);
  const pageText = await page.text();
  expect(pageText).toContain('id="login"'); // spec/50: the login page, not the UI
  const deep = await fetch(`${base}/graph/deep-link`);
  expect(await deep.text()).toBe(pageText); // every static path asks
  expect((await getJson(`${base}/api/status`)).status).toBe(401);

  const wrong = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "väärä" }),
  });
  expect(wrong.status).toBe(401);
  expect(await wrong.json()).toEqual({ error: "wrong password — try again" });
  const empty = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await empty.text();
  expect(empty.status).toBe(400);

  const right = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "kotiaurinko" }),
  });
  expect(right.status).toBe(204);
  const cookie = right.headers.get("set-cookie")!;
  expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Max-Age=43200"); // 12 h session
  const session = cookie.split(";")[0]!;

  const ui = await fetch(`${base}/`, { headers: { Cookie: session } });
  expect(ui.status).toBe(200);
  expect(await ui.text()).not.toContain('id="login"');
  expect((await getJson(`${base}/api/status`, { Cookie: session })).status).toBe(200); // /api too

  const out = await fetch(`${base}/api/logout`, { method: "POST", headers: { Cookie: session } });
  await out.text();
  expect(out.status).toBe(204);
  expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await getJson(`${base}/api/status`)).status).toBe(401);
  const locked = await fetch(`${base}/`);
  expect(await locked.text()).toContain('id="login"');
});

test("login without password is an instruction", async () => {
  const { createToken } = await import("../src/auth");
  const root = copyBundle();
  createToken(root); // tokens only — the UI stays open, /api wants the token
  const { base } = await serve(await makeApp(root));
  const refused = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "mikä tahansa" }),
  });
  expect(refused.status).toBe(400);
  expect(((await refused.json()) as { error: string }).error).toContain("brainpick password set");
});

test("live stream delivers deltas", { timeout: 30_000 }, async () => {
  const root = copyBundle();
  const running = await serve(await makeApp(root));
  const state = running.handles.state;
  const { reader, close } = await openLive(running.base);
  try {
    const hello = await reader.nextEvent();
    expect(hello["event"]).toBe("hello");
    expect(hello["id"]).toBe("1");
    const data = JSON.parse(hello["data"]!);
    expect(data.seq).toBe(1);
    expect(data.spec_version).toBe("0.1");
    expect(data.tiers.t1).toBe("fresh");

    writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
    await recompileAndBroadcast(state); // the exact code path the watcher runs

    const running_ = await reader.nextEvent();
    expect(running_["event"]).toBe("compile.status");
    expect(JSON.parse(running_["data"]!).state).toBe("running");
    const delta = await reader.nextEvent();
    expect(delta["event"]).toBe("graph.delta");
    expect(delta["id"]).toBe("2");
    const payload = JSON.parse(delta["data"]!);
    expect(payload.seq).toBe(2);
    expect(payload.cause.paths).toEqual(["index.md", "uusi.md"]);
    expect(payload.added.nodes.some((n: { id: string }) => n.id === "uusi.md")).toBe(true);
    const done = await reader.nextEvent();
    expect(JSON.parse(done["data"]!).state).toBe("done");
  } finally {
    close();
  }
});

test("live replay and snapshot", { timeout: 30_000 }, async () => {
  const root = copyBundle();
  const running = await serve(await makeApp(root));
  const state = running.handles.state;
  writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
  await recompileAndBroadcast(state); // seq 2

  {
    const { reader, close } = await openLive(running.base, { "Last-Event-ID": "1" });
    try {
      const hello = await reader.nextEvent();
      expect(hello["event"]).toBe("hello");
      expect(hello["id"]).toBe("2");
      const replayed = await reader.nextEvent();
      expect(replayed["event"]).toBe("graph.delta");
      expect(replayed["id"]).toBe("2");
      expect(JSON.parse(replayed["data"]!).seq).toBe(2);
    } finally {
      close();
    }
  }

  {
    const { reader, close } = await openLive(running.base, { "Last-Event-ID": "0" });
    try {
      expect((await reader.nextEvent())["event"]).toBe("hello");
      const snapshot = await reader.nextEvent();
      expect(snapshot["event"]).toBe("graph.snapshot");
      expect(snapshot["id"]).toBe("2");
      const body = JSON.parse(snapshot["data"]!);
      expect(body.seq).toBe(2);
      expect(body.graph.stats.docs).toBe(11);
    } finally {
      close();
    }
  }
});

test("watcher end to end", { timeout: 60_000 }, async () => {
  const root = copyBundle();
  const config = loadConfig(root);
  config.serve.watch = true;
  const running = await serve(await buildApp(root, config));
  expect((await getJson(`${running.base}/api/status`)).body.watching).toBe(true);
  const { reader, close } = await openLive(running.base);
  try {
    expect((await reader.nextEvent())["event"]).toBe("hello");

    const kuu = join(root, "kuu.md");
    writeFileSync(kuu, readFileSync(kuu, "utf8") + "\nThe tides also breathe.\n", "utf8");
    const delta = await reader.waitForEvent("graph.delta");
    const payload = JSON.parse(delta["data"]!);
    expect(payload.seq).toBe(2);
    expect(payload.cause).toEqual({ paths: ["kuu.md"], tier: "t1" });

    // an out-of-process compile: the watcher notices the manifest seq move
    writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
    await runCompile(root);
    const second = await reader.waitForEvent("graph.delta");
    const payload2 = JSON.parse(second["data"]!);
    expect(payload2.seq).toBe(3);
    expect(payload2.cause.paths).toContain("uusi.md");
  } finally {
    close();
  }
});

// -- guarded REST writes (spec/50): PUT /api/docs is brain_write's HTTP face --------
// The SAME guarded core backs both; the REST siblings of the brain_write
// conflict/rollback tests in mcp-tools.test.ts.

async function putJson(
  url: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}

async function postAsset(
  base: string,
  filename: string,
  data: Uint8Array,
  type: string,
  name?: string,
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(data)], { type }), filename);
  if (name !== undefined) form.append("name", name);
  const res = await fetch(`${base}/api/assets`, { method: "POST", body: form });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore" },
  );
}

test("PUT /api/docs writes, bumps timestamp, returns new sha, fires a delta", async () => {
  const root = copyBundle();
  const { base, handles } = await serve(await makeApp(root));
  const queue = handles.state.subscribe();
  const before = (await getJson(`${base}/api/docs/kuu.md`)).body.text as string;
  expect(before).toContain("tides");
  const next =
    "---\ntype: Concept\ntitle: Kuu\ndescription: The moon.\n---\n\n" +
    "# Kuu\n\nThe moon, edited live in the browser [Maa](maa.md).\n";
  const { status, body } = await putJson(`${base}/api/docs/kuu.md`, { content: next, mode: "replace" });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true, path: "kuu.md", seq: 2, sha: body.sha });
  expect(body.sha).toMatch(/^[0-9a-f]{64}$/);
  expect(body.sha).toBe(sha256Hex(readFileSync(join(root, "kuu.md")))); // the client's next base_sha
  const after = (await getJson(`${base}/api/docs/kuu.md`)).body.text as string;
  expect(after).toContain("edited live in the browser");
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toMatch(
    /^timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m,
  );
  expect(queue.drain().map(([name]) => name)).toContain("graph.delta"); // open UIs updated
});

test("PUT /api/docs henxels violation is 422 verbatim and rolls back", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "henxels.yaml"), "henxels: []\n", "utf8");
  const bin = join(tempDir(), "bin");
  mkdirSync(bin, { recursive: true });
  const fake = join(bin, "henxels");
  writeFileSync(fake, "#!/bin/sh\necho 'one concept per page'\nexit 1\n", "utf8");
  chmodSync(fake, 0o755);
  process.env["PATH"] = `${bin}:${savedPath}`;
  const { base } = await serve(await makeApp(root));
  const original = readFileSync(join(root, "kuu.md"), "utf8");
  const { status, body } = await putJson(`${base}/api/docs/kuu.md`, {
    content: "# Kuu\n\nClobbered.\n",
    mode: "replace",
  });
  expect(status).toBe(422);
  expect(body.ok).toBe(false);
  expect((body.instruction as string).trim()).toBe("one concept per page"); // verbatim
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toBe(original); // rolled back
});

test("PUT /api/docs stale base_sha is a 409 conflict without writing", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const original = readFileSync(join(root, "kuu.md"), "utf8");
  const { status, body } = await putJson(`${base}/api/docs/kuu.md`, {
    content: KUU_REWRITE,
    mode: "replace",
    base_sha: "0".repeat(64),
  });
  expect(status).toBe(409);
  expect(body.ok).toBe(false);
  expect(body.conflict).toBe(true);
  expect(body.current_sha).toBe(sha256Hex(Buffer.from(original, "utf8")));
  expect(body.theirs).toContain("tides");
  expect(body.instruction).toContain("re-read");
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toBe(original); // MUST NOT write
});

test("PUT /api/docs create mode refuses to clobber", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const { status, body } = await putJson(`${base}/api/docs/kuu.md`, {
    content: "# Kaappaus\n",
    mode: "create",
  });
  expect(status).toBe(422);
  expect(body.ok).toBe(false);
  expect(body.instruction).toContain("replace");
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toContain("tides");
});

test("PUT /api/docs rejects bad paths with 400", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  expect((await putJson(`${base}/api/docs/notes.txt`, { content: "x" })).status).toBe(400); // non-.md
  expect((await putJson(`${base}/api/docs/foo%5Cbar.md`, { content: "x" })).status).toBe(400); // backslash
  const nonKebab = await putJson(`${base}/api/docs/Kuun%20Vaiheet.md`, { content: "x" });
  expect(nonKebab.status).toBe(400);
  expect(existsSync(join(root, "Kuun Vaiheet.md"))).toBe(false);
});

test("PUT /api/docs is 403 when writes are off", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root, { writes: "off" }));
  const { status, body } = await putJson(`${base}/api/docs/uusi.md`, { content: "# X\n" });
  expect(status).toBe(403);
  expect(body.error).toContain("writes are disabled");
  expect(existsSync(join(root, "uusi.md"))).toBe(false);
});

test("PUT /api/docs on a non-localhost bind without a token is 401", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root, { host: "0.0.0.0" }));
  expect((await getJson(`${base}/api/health`)).status).toBe(200); // reads stay open
  const { status } = await putJson(`${base}/api/docs/uusi.md`, { content: "# X\n" });
  expect(status).toBe(401);
  expect(existsSync(join(root, "uusi.md"))).toBe(false);
});

test("PUT /api/docs conflict body matches brain_write's conflict shape", async () => {
  // The REST 409 reuses brain_write's conflict shape (mcp-tools.test.ts). Here the
  // claimed base_sha ("0"*64) hash-verifies against nothing — not the git HEAD —
  // and no model is configured, so the ladder yields no proposal (the manual path).
  const root = copyBundle();
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const { base } = await serve(await makeApp(root));
  const { body } = await putJson(`${base}/api/docs/kuu.md`, {
    content: KUU_REWRITE,
    mode: "replace",
    base_sha: "0".repeat(64),
  });
  expect(body.conflict).toBe(true);
  expect(body.merged).toBeUndefined(); // base unresolvable + no model → no proposal
});

test("PUT /api/docs stale base_sha returns a three-way merged proposal", async () => {
  // The parity the editor consumes: a stale save whose base IS resolvable (git HEAD)
  // and whose edits do not overlap comes back with a mechanical three-way proposal.
  const root = copyBundle();
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const baseBytes = readFileSync(join(root, "kuu.md"));
  const baseText = baseBytes.toString("utf8");

  // A foreign writer edits the tides line after the editor last read the doc.
  const theirs = baseText.replaceAll(
    "The moon pulls the tides of [Maa](maa.md).",
    "The moon pulls the spring tides of [Maa](maa.md).",
  );
  writeFileSync(join(root, "kuu.md"), theirs, "utf8");

  const { base } = await serve(await makeApp(root));
  const yours = baseText + "\n## Vaiheet\n\nNew moon, then full moon.\n";
  const { status, body } = await putJson(`${base}/api/docs/kuu.md`, {
    content: yours,
    mode: "replace",
    base_sha: sha256Hex(baseBytes),
  });
  expect(status).toBe(409);
  expect(body.conflict).toBe(true);
  expect(body.current_sha).toBe(sha256Hex(Buffer.from(theirs, "utf8")));
  expect(body.merged.strategy).toBe("three-way");
  expect(body.merged.content).toContain("spring tides"); // the foreign edit survives
  expect(body.merged.content).toContain("## Vaiheet"); // this edit survives
  expect(readFileSync(join(root, "kuu.md"), "utf8")).not.toContain("## Vaiheet"); // proposal only, never written
});

// -- image assets (spec/50): POST /api/assets ---------------------------------------

test("POST /api/assets stores an image and returns 201", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const { status, body } = await postAsset(base, "Diagram One.png", PNG_1PX, "image/png");
  expect(status).toBe(201);
  expect(body).toEqual({ path: "assets/diagram-one.png", sha: sha256Hex(PNG_1PX), bytes: PNG_1PX.length });
  expect(readFileSync(join(root, "assets", "diagram-one.png")).equals(PNG_1PX)).toBe(true);
});

test("POST /api/assets de-dupes identical bytes to the same path", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const first = (await postAsset(base, "logo.png", PNG_1PX, "image/png")).body;
  const second = (await postAsset(base, "logo.png", PNG_1PX, "image/png")).body;
  expect(first.path).toBe("assets/logo.png");
  expect(second.path).toBe("assets/logo.png");
});

test("POST /api/assets hash-suffixes different bytes under the same name", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const first = (await postAsset(base, "logo.png", PNG_1PX, "image/png")).body;
  const other = Buffer.concat([PNG_1PX, Buffer.from("extra")]);
  const second = (await postAsset(base, "logo.png", other, "image/png")).body;
  expect(first.path).toBe("assets/logo.png");
  expect(second.path).not.toBe(first.path);
  expect(second.path.startsWith("assets/logo-")).toBe(true);
  expect(second.path.endsWith(".png")).toBe(true);
  expect(readFileSync(join(root, second.path)).equals(other)).toBe(true);
});

test("POST /api/assets rejects a non-image", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const { status } = await postAsset(base, "notes.txt", Buffer.from("hello"), "text/plain");
  expect(status).toBe(400);
  expect(existsSync(join(root, "assets"))).toBe(false);
});

test("POST /api/assets rejects an oversized upload", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root, { max_asset_bytes: 64 }));
  const big = Buffer.concat([PNG_1PX, Buffer.alloc(400)]);
  const { status } = await postAsset(base, "big.png", big, "image/png");
  expect(status).toBe(413);
  expect(existsSync(join(root, "assets"))).toBe(false);
});

test("POST /api/assets traversal name cannot escape assets/", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  const { status, body } = await postAsset(base, "x.png", PNG_1PX, "image/png", "../../evil.png");
  expect(status).toBe(201);
  expect(body.path).toBe("assets/evil.png"); // directory parts dropped
  expect(existsSync(join(root, "..", "evil.png"))).toBe(false);
  expect(existsSync(join(root, "assets", "evil.png"))).toBe(true);
});

test("POST /api/assets is 403 when writes are off", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root, { writes: "off" }));
  const { status } = await postAsset(base, "x.png", PNG_1PX, "image/png");
  expect(status).toBe(403);
  expect(existsSync(join(root, "assets"))).toBe(false);
});

test("an uploaded asset is invisible to the compile", async () => {
  const root = copyBundle();
  const { base } = await serve(await makeApp(root));
  await postAsset(base, "diagram.png", PNG_1PX, "image/png");
  await runCompile(root); // assets/ holds no .md — the graph/index/docs never see it
  const graph = JSON.parse(readFileSync(join(root, ".brainpick", "t1", "graph.json"), "utf8"));
  expect(graph.nodes.some((n: { id: string }) => n.id.includes("assets/"))).toBe(false);
  expect(readFileSync(join(root, ".brainpick", "t1", "docs.jsonl"), "utf8")).not.toContain("assets/");
  expect(readFileSync(join(root, "index.md"), "utf8")).not.toContain("assets/");
});

// -- presentations (spec/95): POST /api/show + the brain.show live event ------------

async function postJson(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}

test("POST /api/show broadcasts and returns the shape", async () => {
  const { base, handles } = await serve(await makeApp(copyBundle()));
  const queue = handles.state.subscribe();
  const { status, body } = await postJson(`${base}/api/show`, {
    nodes: ["aurinko.md", "kuu", "ei-ole"],
    annotation: "the star",
    mode: "brain",
  });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true, shown: 2, dropped: ["ei-ole"], seq: 1 });
  // it went out on the live channel as brain.show — no manifest delta
  expect(queue.drain().map(([name]) => name)).toEqual(["brain.show"]);
  expect((await getJson(`${base}/api/status`)).body.seq).toBe(1); // manifest seq untouched
});

test("POST /api/show is not write-gated", async () => {
  const { base } = await serve(await makeApp(copyBundle(), { writes: "off" }));
  const { status, body } = await postJson(`${base}/api/show`, { nodes: ["aurinko.md"] });
  expect(status).toBe(200); // a presentation is not a write
  expect(body.shown).toBe(1);
});

test("POST /api/show on a non-localhost bind without a credential is 401", async () => {
  const { base } = await serve(await makeApp(copyBundle(), { host: "0.0.0.0" }));
  expect((await getJson(`${base}/api/health`)).status).toBe(200); // reads stay open
  const { status } = await postJson(`${base}/api/show`, { nodes: ["aurinko.md"] });
  expect(status).toBe(401);
});

test("live stream delivers brain.show", { timeout: 30_000 }, async () => {
  const running = await serve(await makeApp(copyBundle()));
  const { reader, close } = await openLive(running.base);
  try {
    expect((await reader.nextEvent())["event"]).toBe("hello");
    const { body } = await postJson(`${running.base}/api/show`, {
      nodes: ["aurinko.md"],
      annotation: "hi",
    });
    expect(body).toEqual({ ok: true, shown: 1, dropped: [], seq: 1 });
    const show = await reader.waitForEvent("brain.show");
    expect("id" in show).toBe(false); // no SSE id — brain.show stays out of the ring buffer
    expect(JSON.parse(show["data"]!)).toEqual({
      annotation: "hi",
      focus: "aurinko.md",
      mode: null,
      nodes: ["aurinko.md"],
      seq: 1,
    });
  } finally {
    close();
  }
});

test("brain.show is excluded from the ring and replayed to joiners", { timeout: 30_000 }, async () => {
  const root = copyBundle();
  const running = await serve(await makeApp(root));
  const state = running.handles.state;
  await postJson(`${running.base}/api/show`, { nodes: ["aurinko.md"], annotation: "hi" });
  writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
  await recompileAndBroadcast(state); // a real graph delta → seq 2 in the ring

  // a NEW client is replayed the latest presentation once, after the snapshot
  {
    const { reader, close } = await openLive(running.base);
    try {
      expect((await reader.nextEvent())["event"]).toBe("hello");
      const replayed = await reader.waitForEvent("brain.show");
      expect(JSON.parse(replayed["data"]!).annotation).toBe("hi");
    } finally {
      close();
    }
  }

  // a Last-Event-ID reconnect replays graph deltas from the ring, THEN the latest
  // presentation — brain.show never rode the ring itself
  {
    const { reader, close } = await openLive(running.base, { "Last-Event-ID": "1" });
    try {
      expect((await reader.nextEvent())["event"]).toBe("hello");
      const delta = await reader.nextEvent();
      expect(delta["event"]).toBe("graph.delta");
      expect(delta["id"]).toBe("2");
      const pres = await reader.nextEvent();
      expect(pres["event"]).toBe("brain.show");
      expect("id" in pres).toBe(false);
      expect(JSON.parse(pres["data"]!).annotation).toBe("hi");
    } finally {
      close();
    }
  }
});

test("a cleared presentation replays as the empty shape", { timeout: 30_000 }, async () => {
  const running = await serve(await makeApp(copyBundle()));
  await postJson(`${running.base}/api/show`, { nodes: ["aurinko.md"] });
  await postJson(`${running.base}/api/show`, { clear: true });
  const { reader, close } = await openLive(running.base);
  try {
    expect((await reader.nextEvent())["event"]).toBe("hello");
    const replayed = await reader.waitForEvent("brain.show");
    expect(JSON.parse(replayed["data"]!)).toEqual({
      annotation: null,
      focus: null,
      mode: null,
      nodes: [],
      seq: 2,
    });
  } finally {
    close();
  }
});

// -- brainpick show (spec/95): the CLI posts a presentation to a running server -----

test("brainpick show posts to a running server and broadcasts", { timeout: 30_000 }, async () => {
  const { showAction } = await import("../src/cli");
  const root = copyBundle();
  const running = await serve(await makeApp(root));
  const port = Number(new URL(running.base).port);
  const { reader, close } = await openLive(running.base);
  try {
    expect((await reader.nextEvent())["event"]).toBe("hello");
    const result = await showAction(root, { nodes: ["aurinko.md"], annotate: "hi", port });
    expect(result.code).toBe(0);
    expect(result.out).toContain("1 node(s)");
    expect(result.out).toContain("seq 1");
    const show = await reader.waitForEvent("brain.show");
    expect(JSON.parse(show["data"]!).annotation).toBe("hi"); // it reached the open UI
  } finally {
    close();
  }
});

test("brainpick show against an unreachable server is an instruction, not a crash", async () => {
  const { showAction } = await import("../src/cli");
  const result = await showAction(copyBundle(), { nodes: ["aurinko.md"], port: 4 }); // nothing on :4
  expect(result.code).toBe(1);
  expect(result.err).toContain("brainpick serve");
});
