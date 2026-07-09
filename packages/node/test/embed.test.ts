/** Embedder clients (spec/30): the normative mock, HTTP backends, ≤64 batching
 * (the twin of packages/python/tests/test_t2_embed.py). */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, test } from "vitest";

import {
  BATCH_SIZE,
  DEFAULT_LOCAL_MODEL,
  EmbeddingUnavailable,
  fnv1a,
  LocalEmbedder,
  makeEmbedder,
  MockEmbedder,
  OllamaEmbedder,
  OpenAICompatEmbedder,
  transformersAvailable,
} from "../src/embed";

// fnv1a("kuu") = 1815928360 -> bucket 8; fnv1a("maa") = 4003661646 -> bucket 14
// (the Python engine pins the same values — the hash must agree across engines)
const KUU_BUCKET = 8;
const MAA_BUCKET = 14;

interface Call {
  path: string;
  body: Record<string, unknown>;
}

/** An http server answering POST with canned JSON, capturing request bodies. */
async function withEmbedServer<T>(
  reply: (body: Record<string, unknown>) => unknown,
  fn: (base: string, calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (part: Buffer) => {
      data += part.toString("utf8");
    });
    req.on("end", () => {
      const body = JSON.parse(data) as Record<string, unknown>;
      calls.push({ path: req.url ?? "", body });
      const out = JSON.stringify(reply(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(out);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// -- the normative mock (spec/30) ----------------------------------------------------

test("fnv1a pins the cross-engine hash values", () => {
  const utf8 = new TextEncoder();
  expect(fnv1a(utf8.encode("kuu"))).toBe(1815928360);
  expect(fnv1a(utf8.encode("maa"))).toBe(4003661646);
});

test("mock embedder pins the spec vector", async () => {
  const [vec] = await new MockEmbedder().embed(["Kuu kuu maa"]);
  expect(vec).toHaveLength(16);
  const expected = new Array<number>(16).fill(0.0);
  expected[KUU_BUCKET] = 2.0 / Math.sqrt(5.0);
  expected[MAA_BUCKET] = 1.0 / Math.sqrt(5.0);
  expect(vec).toEqual(expected); // exact — same IEEE doubles as the Python engine
  let sum = 0;
  for (const x of vec!) sum += x * x;
  expect(Math.abs(sum - 1.0)).toBeLessThan(1e-12);
});

test("mock embedder tokenizes on non-alnum and underscore", async () => {
  const [withUnderscore] = await new MockEmbedder().embed(["kuu_maa"]);
  const [withSpace] = await new MockEmbedder().embed(["kuu maa"]);
  expect(withUnderscore).toEqual(withSpace); // `_` is a boundary (spec/30)
});

test("mock embedder all-zero stays all-zero", async () => {
  const [vec] = await new MockEmbedder().embed(["!!! --- ..."]);
  expect(vec).toEqual(new Array(16).fill(0.0));
  expect(await new MockEmbedder().embed([""])).toEqual([new Array(16).fill(0.0)]);
});

test("mock embedder is case-insensitive and deterministic", async () => {
  const a = await new MockEmbedder().embed(["Aurinko PAISTAA"]);
  const b = await new MockEmbedder().embed(["aurinko paistaa"]);
  expect(a).toEqual(b);
});

// -- HTTP backends -------------------------------------------------------------------

test("ollama embedder posts api/embed and batches", async () => {
  const reply = (body: Record<string, unknown>) => ({
    embeddings: (body["input"] as string[]).map((t) => [t.length, 0.0]),
  });
  const texts = Array.from({ length: 70 }, (_, i) => `t${i}`.repeat(i + 1));
  const { vectors, calls } = await withEmbedServer(reply, async (base, calls) => {
    const embedder = new OllamaEmbedder(base, "nomic-embed-text");
    return { vectors: await embedder.embed(texts), calls };
  });
  expect(vectors).toHaveLength(70);
  expect(vectors[0]).toEqual([2.0, 0.0]); // order preserved across batches
  expect(vectors[69]).toEqual([texts[69]!.length, 0.0]);
  expect(calls.map((c) => c.path)).toEqual(["/api/embed", "/api/embed"]);
  expect(calls.map((c) => (c.body["input"] as string[]).length)).toEqual([BATCH_SIZE, 70 - BATCH_SIZE]);
  expect(calls.every((c) => c.body["model"] === "nomic-embed-text")).toBe(true);
});

test("openai-compat embedder posts v1/embeddings and sorts by index", async () => {
  const reply = (body: Record<string, unknown>) => {
    const data = (body["input"] as string[]).map((_, i) => ({ embedding: [i], index: i }));
    return { data: data.reverse() }; // servers may reorder; index is the truth
  };
  const { vectors, calls } = await withEmbedServer(reply, async (base, calls) => {
    const embedder = new OpenAICompatEmbedder(`${base}/v1`, "text-embedding-nomic");
    return { vectors: await embedder.embed(["a", "b", "c"]), calls };
  });
  expect(vectors).toEqual([[0.0], [1.0], [2.0]]);
  expect(calls[0]!.path).toBe("/v1/embeddings");
  expect(calls[0]!.body).toEqual({ model: "text-embedding-nomic", input: ["a", "b", "c"] });
});

test("http embedder failure raises EmbeddingUnavailable", async () => {
  const embedder = new OllamaEmbedder("http://127.0.0.1:9", "nomic-embed-text"); // port 9: discard
  await expect(embedder.embed(["kuu"])).rejects.toThrow(EmbeddingUnavailable);
});

test("empty input never calls the backend", async () => {
  const embedder = new OllamaEmbedder("http://127.0.0.1:9", "nomic-embed-text");
  expect(await embedder.embed([])).toEqual([]);
});

// -- the factory ---------------------------------------------------------------------

test("makeEmbedder maps kinds", () => {
  expect(makeEmbedder("mock")).toBeInstanceOf(MockEmbedder);
  expect(makeEmbedder("ollama", "http://x", "m")).toBeInstanceOf(OllamaEmbedder);
  expect(makeEmbedder("openai-compatible", "http://x/v1", "m")).toBeInstanceOf(OpenAICompatEmbedder);
  // "openai" (init's paid-API record) is an openai-compatible endpoint with a bearer key
  expect(makeEmbedder("openai", "https://api.openai.com/v1", "m")).toBeInstanceOf(OpenAICompatEmbedder);
  expect(makeEmbedder("local", "", "some/model")).toBeInstanceOf(LocalEmbedder);
  expect(() => makeEmbedder("teleport", "http://x", "m")).toThrow(EmbeddingUnavailable);
});

test("makeEmbedder fastembed steers to local, ollama, or the python sibling", () => {
  // spec/30 detection ladder rung 5: fastembed stays Python-only, but this engine
  // now has its OWN in-process floor (kind = "local") — named first in the steer.
  expect(() => makeEmbedder("fastembed", "", "BAAI/bge-small-en-v1.5")).toThrow(EmbeddingUnavailable);
  expect(() => makeEmbedder("fastembed", "", "m")).toThrow(/local|ollama|Python/);
});

test("makeEmbedder local defaults to nomic-embed-text-v1.5 when no model is given", () => {
  // construction is cheap and synchronous — no network until embed() is called,
  // so this proves the default wiring without paying for a model download.
  expect(() => makeEmbedder("local")).not.toThrow();
  expect(makeEmbedder("local")).toBeInstanceOf(LocalEmbedder);
  expect(DEFAULT_LOCAL_MODEL).toBe("nomic-ai/nomic-embed-text-v1.5");
});

// -- local (transformers.js on onnxruntime-node) — spec/30 rung 5, this engine's peer to fastembed

test("empty input never loads the local pipeline", async () => {
  // proves the import guard never even fires for the trivial case — no network,
  // no onnxruntime session, regardless of whether the optional dep resolves.
  const embedder = new LocalEmbedder("nonexistent/model-that-would-404");
  expect(await embedder.embed([])).toEqual([]);
});

const localAvailable = await transformersAvailable();

describe.skipIf(!localAvailable)("local embedder (transformers.js present)", () => {
  test("transformersAvailable reports true here", () => {
    expect(localAvailable).toBe(true);
  });

  // Heavy: downloads real ONNX weights on first run. Kept out of the default
  // gate (like Python's fastembed leg, spec/30) — opt in with
  // BRAINPICK_TEST_LOCAL_EMBED=1, e.g. a dedicated CI leg.
  test.skipIf(!process.env["BRAINPICK_TEST_LOCAL_EMBED"])(
    "embeds real text with the default model",
    { timeout: 120_000 },
    async () => {
      const embedder = new LocalEmbedder(DEFAULT_LOCAL_MODEL);
      const [vec] = await embedder.embed(["kuu maa"]);
      expect(vec!.length).toBeGreaterThan(0);
      expect(vec!.some((x) => x !== 0)).toBe(true);
    },
  );
});

test("makeEmbedder unknown kind mentions local in the way out", () => {
  expect(() => makeEmbedder("teleport")).toThrow(/local/);
});
