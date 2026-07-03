/** e2e: one process serving REST + live SSE + the web UI + /mcp (spec/50 + spec/60).
 *
 * Everything runs against a REAL express server on an ephemeral port — a live
 * socket is the honest test of a serve layer (the twin of test_e2e_serve.py).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { loadConfig, type ServeConfig } from "../src/config";
import { buildApp, type BuildAppOptions, type ServeHandles } from "../src/serve/app";
import { sseFrame } from "../src/serve/live";
import { recompileAndBroadcast } from "../src/serve/watcher";
import { cleanup, copyBundle } from "./helpers";

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n";

interface Running {
  base: string;
  handles: ServeHandles;
  stop: () => Promise<void>;
}

const runningServers: Running[] = [];

afterEach(async () => {
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
  expect(body.tiers).toEqual({ t1: "fresh", t2: "off", t3: "off" });
  expect(body.docs).toBe(10);
  expect(body.ghosts).toBe(1);
  expect(body.orphans).toBe(1);
  expect(body.watching).toBe(false);
  expect(body.bundle_root).toBeTruthy();
  expect(body.edges).toBeGreaterThan(0);
});

test("graph etag roundtrip", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const first = await getJson(`${base}/api/graph`);
  expect(first.status).toBe(200);
  expect(first.headers.get("etag")).toBe('"1"');
  expect(first.body.stats.docs).toBe(10);
  const cached = await fetch(`${base}/api/graph`, { headers: { "If-None-Match": first.headers.get("etag")! } });
  expect(cached.status).toBe(304);
  const entities = await getJson(`${base}/api/graph?layer=entities`);
  expect(entities.status).toBe(404);
  expect(entities.body.error).toBeTruthy();
});

test("docs happy and nested", async () => {
  const { base } = await serve(await makeApp(copyBundle()));
  const { body } = await getJson(`${base}/api/docs/kuu.md`);
  expect(new Set(Object.keys(body))).toEqual(new Set(["path", "frontmatter", "title", "text", "neighbors"]));
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
