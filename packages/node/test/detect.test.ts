/** Detection ladder (docs/embedding-detection.md + onboarding): bundle shape,
 * link style, and backend probes that are parallel, short-fused, and never raise
 * (the twin of packages/python/tests/test_detect.py). */
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";

import { afterEach, expect, test } from "vitest";

import {
  detectBundle,
  detectHenxels,
  detectLinkStyle,
  pickBackend,
  probeBackends,
  probeOllama,
  probeOpenaiCompatible,
} from "../src/detect";
import { cleanup, copyBundle, tempDir } from "./helpers";

afterEach(cleanup);

const OLLAMA_TAGS = {
  models: [{ name: "qwen3.5:4b" }, { name: "mxbai-embed-large:latest" }, { name: "nomic-embed-text:latest" }],
};

/** A local http server answering GET with canned JSON — the fake backend. */
async function jsonServer(payloads: Record<string, unknown>): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const body = payloads[req.url ?? ""];
    if (body === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const data = JSON.stringify(body);
    res.setHeader("Content-Type", "application/json");
    res.end(data);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A port that was just free — connecting to it must refuse, not hang. */
async function closedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// -- backend probes ----------------------------------------------------------------

test("probeOllama prefers nomic-embed-text", async () => {
  const { base, close } = await jsonServer({ "/api/tags": OLLAMA_TAGS });
  try {
    const backend = await probeOllama({ OLLAMA_HOST: base });
    expect(backend).toEqual({ kind: "ollama", endpoint: base, model: "nomic-embed-text:latest" });
  } finally {
    await close();
  }
});

test("probeOllama reports endpoint with no embedding model", async () => {
  const { base, close } = await jsonServer({ "/api/tags": { models: [{ name: "qwen3.5:4b" }] } });
  try {
    const backend = await probeOllama({ OLLAMA_HOST: base });
    expect(backend).not.toBeNull();
    expect(backend!.model).toBeNull(); // up, but nothing to embed with
  } finally {
    await close();
  }
});

test("probeOllama normalizes schemeless host", async () => {
  const { base, close } = await jsonServer({ "/api/tags": OLLAMA_TAGS });
  try {
    const backend = await probeOllama({ OLLAMA_HOST: base.replace(/^http:\/\//, "") });
    expect(backend).not.toBeNull();
    expect(backend!.endpoint).toBe(base);
  } finally {
    await close();
  }
});

test("probeOllama closed port is a silent fast miss", async () => {
  const started = Date.now();
  const backend = await probeOllama({ OLLAMA_HOST: `http://127.0.0.1:${await closedPort()}` });
  expect(backend).toBeNull();
  expect(Date.now() - started).toBeLessThan(2000); // 300 ms budget, generous margin
});

test("probeOpenaiCompatible finds embedding model", async () => {
  const models = { data: [{ id: "qwen/qwen3-8b" }, { id: "text-embedding-nomic-embed-text-v1.5" }] };
  const { base, close } = await jsonServer({ "/v1/models": models });
  try {
    const backend = await probeOpenaiCompatible(base);
    expect(backend).not.toBeNull();
    expect(backend!.kind).toBe("openai-compatible");
    expect(backend!.endpoint).toBe(`${base}/v1`);
    expect(backend!.model).toBe("text-embedding-nomic-embed-text-v1.5");
  } finally {
    await close();
  }
});

test("probeBackends reports every target and pick takes the first model", async () => {
  const { base, close } = await jsonServer({ "/api/tags": OLLAMA_TAGS });
  try {
    const dead = `127.0.0.1:${await closedPort()}`;
    const results = await probeBackends({ OLLAMA_HOST: base }, [
      ["lm studio", dead],
      ["llama.cpp", dead],
    ]);
    expect(results.map(([label]) => label)).toEqual(["ollama", "lm studio", "llama.cpp"]);
    expect(results[1]![1]).toBeNull();
    expect(results[2]![1]).toBeNull();
    const picked = pickBackend(results);
    expect(picked).not.toBeNull();
    expect(picked!.kind).toBe("ollama");
    expect(pickBackend([["ollama", { kind: "ollama", endpoint: "x", model: null }]])).toBeNull(); // modelless ≠ found
  } finally {
    await close();
  }
});

// -- bundle detection --------------------------------------------------------------

test("detectBundle okf via index okf_version", () => {
  const info = detectBundle(copyBundle());
  expect(info.kind).toBe("okf");
  expect(info.docs).toBe(10);
});

test("detectBundle density scan", () => {
  const root = tempDir();
  for (const name of ["yksi", "kaksi", "kolme"]) {
    writeFileSync(join(root, `${name}.md`), `---\ntype: Concept\ntitle: ${name}\n---\n\n# ${name}\n`, "utf8");
  }
  const info = detectBundle(root);
  expect(info.kind).toBe("density");
  expect(info.typed).toBe(3);
});

test("detectBundle none when empty or sparse", () => {
  const root = tempDir();
  expect(detectBundle(root).kind).toBe("none");
  writeFileSync(join(root, "a.md"), "---\ntype: Note\n---\n# a\n", "utf8");
  writeFileSync(join(root, "b.md"), "# b — no frontmatter\n", "utf8");
  const info = detectBundle(root);
  expect(info.kind).toBe("none");
  expect(info.docs).toBe(2);
  expect(info.typed).toBe(1);
});

test("detectBundle ignores always-excluded dirs", () => {
  const root = tempDir();
  mkdirSync(join(root, ".brainpick"));
  writeFileSync(join(root, ".brainpick", "x.md"), "---\ntype: T\n---\n", "utf8");
  expect(detectBundle(root).docs).toBe(0);
});

// -- link style --------------------------------------------------------------------

test("link style kotiaurinko is mixed mostly markdown", () => {
  const style = detectLinkStyle(copyBundle());
  expect(style.style).toBe("mixed");
  expect(style.wikilinks).toBe(2);
  expect(style.markdown).toBeGreaterThan(style.wikilinks);
});

test("link style pure cases", () => {
  const base = tempDir();
  const wiki = join(base, "wiki");
  mkdirSync(wiki);
  writeFileSync(join(wiki, "a.md"), "# a\n\nSee [[b]] and [[c|the c page]].\n", "utf8");
  expect(detectLinkStyle(wiki).style).toBe("wikilinks");
  const md = join(base, "md");
  mkdirSync(md);
  writeFileSync(join(md, "a.md"), "# a\n\nSee [b](b.md).\n", "utf8");
  expect(detectLinkStyle(md).style).toBe("markdown");
  expect(detectLinkStyle(md).markdown).toBe(1);
  const empty = join(base, "empty");
  mkdirSync(empty);
  expect(detectLinkStyle(empty).style).toBe("none");
});

// -- henxels -----------------------------------------------------------------------

test("detectHenxels bundle root beats repo root", () => {
  const base = tempDir();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, "henxels.yaml"), "henxels: []\n", "utf8");
  const bundle = join(repo, "wiki");
  mkdirSync(bundle);
  expect(detectHenxels(bundle)).toBe(join(repo, "henxels.yaml"));
  writeFileSync(join(bundle, "henxels.yaml"), "henxels: []\n", "utf8");
  expect(detectHenxels(bundle)).toBe(join(bundle, "henxels.yaml"));
});

test("detectHenxels none outside any contract", () => {
  const lone = join(tempDir(), "lone");
  mkdirSync(lone);
  expect(detectHenxels(lone)).toBeNull();
});
