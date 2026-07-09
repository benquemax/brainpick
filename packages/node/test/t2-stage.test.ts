/** T2 in the compile pipeline (spec/30): gating, incrementality, fingerprint,
 * failure degradation, and the --only lever. Uses the mock embedder via config
 * (the twin of packages/python/tests/test_t2_stage.py — vi.mock stands in for
 * pytest's monkeypatch). */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { checkFresh, runCompile } from "../src/compile/pipeline";
import { sha256Hex } from "../src/core/canonical";
import * as embedModule from "../src/embed";
import { MockEmbedder, type Embedder } from "../src/embed";
import * as vectorstoreModule from "../src/vectorstore";
import { VectorStore } from "../src/vectorstore";
import { cleanup, copyBundle } from "./helpers";

vi.mock("../src/embed", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/embed")>();
  return { ...mod, makeEmbedder: vi.fn(mod.makeEmbedder) };
});
vi.mock("../src/vectorstore", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/vectorstore")>();
  return { ...mod, lancedbAvailable: vi.fn(mod.lancedbAvailable) };
});

afterEach(() => {
  vi.mocked(embedModule.makeEmbedder).mockReset();
  vi.mocked(vectorstoreModule.lancedbAvailable).mockReset();
  cleanup();
});

const MOCK_CONFIG = '[models.embedding]\nkind = "mock"\n';

/** Counts every batch it is asked to embed; answers with the normative mock. */
class CountingEmbedder implements Embedder {
  batches: string[][] = [];

  embed(texts: string[]): Promise<number[][]> {
    this.batches.push([...texts]);
    return new MockEmbedder().embed(texts);
  }

  get embeddedTexts(): string[] {
    return this.batches.flat();
  }
}

class ExplodingEmbedder implements Embedder {
  constructor(private readonly message = "backend went away") {}

  embed(): Promise<number[][]> {
    return Promise.reject(new Error(this.message));
  }
}

function counting(): CountingEmbedder {
  const embedder = new CountingEmbedder();
  vi.mocked(embedModule.makeEmbedder).mockReturnValue(embedder);
  return embedder;
}

function withMockConfig(root: string): string {
  writeFileSync(join(root, "brainpick.toml"), MOCK_CONFIG, "utf8");
  return root;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function manifestOf(root: string): Record<string, unknown> {
  return readJson(join(root, ".brainpick", "manifest.json"));
}

function tiersOf(root: string): Record<string, string> {
  return manifestOf(root)["tiers"] as Record<string, string>;
}

function bpSnapshot(root: string, skipLancedb = false): Record<string, string> {
  const bp = join(root, ".brainpick");
  const out: Record<string, string> = {};
  for (const entry of readdirSync(bp, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    const rel = abs.slice(bp.length + 1);
    if (skipLancedb && rel.includes("lancedb")) continue;
    out[rel] = readFileSync(abs).toString("base64");
  }
  return out;
}

// -- gating --------------------------------------------------------------------------

test("t2 off without embedding config instructs once", async () => {
  const root = copyBundle();
  const first = await runCompile(root);
  expect(tiersOf(root)["t2"]).toBe("off");
  expect(first.warnings.some((w) => w.includes("models.embedding"))).toBe(true);
  const second = await runCompile(root);
  expect(second.warnings).toEqual([]); // the instruction lands once, not on every compile
  expect(() => readdirSync(join(root, ".brainpick", "t2"))).toThrow(); // no t2 artifacts
});

test("t2 off by explicit config stays quiet", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[modules]\nvectors = "off"\n' + MOCK_CONFIG, "utf8");
  const result = await runCompile(root);
  expect(tiersOf(root)["t2"]).toBe("off");
  expect(result.warnings).toEqual([]);
});

test("t2 off when lancedb missing names the install", async () => {
  vi.mocked(vectorstoreModule.lancedbAvailable).mockResolvedValue(false);
  const root = withMockConfig(copyBundle());
  const result = await runCompile(root);
  expect(tiersOf(root)["t2"]).toBe("off");
  expect(result.warnings.some((w) => w.includes("npm install @lancedb/lancedb"))).toBe(true);
});

// -- the happy compile ---------------------------------------------------------------

test("mock compile writes chunks, embedding record, and vectors", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  const bp = join(root, ".brainpick");
  expect(tiersOf(root)).toEqual({ t1: "fresh", t2: "fresh", t3: "fresh" });

  const chunks = readFileSync(join(bp, "t2", "chunks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const docs = chunks.map((c) => c["doc"] as string);
  expect(docs).toEqual([...docs].sort());
  expect(docs).not.toContain("index.md"); // reserved docs never chunked
  expect(docs).not.toContain("log.md");
  const kuu = chunks.find((c) => c["doc"] === "kuu.md")!;
  expect(kuu["id"]).toBe("kuu.md#kuu~0");
  expect(kuu["heading_path"]).toEqual(["Kuu"]);

  const record = readJson(join(bp, "t2", "embedding.json"));
  expect(record).toEqual({
    dim: 16,
    endpoint: "",
    fingerprint: sha256Hex("mock||mock|16").slice(0, 16),
    kind: "mock",
    model: "mock",
  });
  const lance = readdirSync(join(bp, "t2", "lancedb"));
  expect(lance).toContain("chunks.lance");
  expect(embedder.embeddedTexts).toHaveLength(chunks.length);
});

test("recompile is a no-op and embeds nothing", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  embedder.batches.length = 0;
  const before = bpSnapshot(root, true);
  const result = await runCompile(root);
  expect(result.changed).toBe(false);
  expect(embedder.batches).toEqual([]);
  expect(bpSnapshot(root, true)).toEqual(before);
});

test("editing one doc re-embeds only its chunks", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  const first = await runCompile(root);
  embedder.batches.length = 0;
  writeFileSync(
    join(root, "kuu.md"),
    "---\ntype: Concept\n---\n\n# Kuu\n\nThe moon breathes new tides tonight.\n",
    "utf8",
  );
  const result = await runCompile(root);
  expect(result.changed).toBe(true);
  expect(result.seq).toBe(first.seq + 1);
  expect(embedder.embeddedTexts).toEqual(["The moon breathes new tides tonight."]);
  expect(tiersOf(root)["t2"]).toBe("fresh");
});

test("deleting a doc removes its chunks and vectors", async () => {
  counting();
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  unlinkSync(join(root, "yksinainen.md"));
  await runCompile(root);
  const chunksText = readFileSync(join(root, ".brainpick", "t2", "chunks.jsonl"), "utf8");
  expect(chunksText).not.toContain("yksinainen.md");
  const ids = await new VectorStore(join(root, ".brainpick", "t2", "lancedb")).existingIds();
  expect([...ids].some((i) => i.startsWith("yksinainen.md#"))).toBe(false);
});

test("fingerprint change re-embeds everything", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  const total = embedder.embeddedTexts.length;
  embedder.batches.length = 0;
  writeFileSync(join(root, "brainpick.toml"), '[models.embedding]\nkind = "mock"\nmodel = "mock-v2"\n', "utf8");
  const result = await runCompile(root);
  expect(result.changed).toBe(true);
  expect(embedder.embeddedTexts).toHaveLength(total); // every chunk again
  const record = readJson(join(root, ".brainpick", "t2", "embedding.json"));
  expect(record["model"]).toBe("mock-v2");
  expect(record["fingerprint"]).toBe(sha256Hex("mock||mock-v2|16").slice(0, 16));
});

// -- degradation ---------------------------------------------------------------------

test("embed failure is stale, never a compile failure", async () => {
  vi.mocked(embedModule.makeEmbedder).mockReturnValue(new ExplodingEmbedder());
  const root = withMockConfig(copyBundle());
  const result = await runCompile(root);
  const tiers = tiersOf(root);
  expect(tiers["t1"]).toBe("fresh");
  expect(tiers["t2"]).toBe("stale");
  expect(result.warnings.some((w) => w.includes("backend went away"))).toBe(true);
  // chunks.jsonl is still written — "chunks changed but embedding hasn't run" (spec/30)
  expect(readFileSync(join(root, ".brainpick", "t2", "chunks.jsonl"), "utf8")).not.toBe("");
  expect(readFileSync(join(root, ".brainpick", "t1", "graph.json"), "utf8")).not.toBe("");
});

test("recovery after failure embeds only what the store lacks", async () => {
  // chunks.jsonl is current even after a failed pass — the store is the
  // incrementality truth, so recovery re-embeds exactly the lagging chunks.
  const working = new CountingEmbedder();
  vi.mocked(embedModule.makeEmbedder).mockReturnValue(working);
  const root = withMockConfig(copyBundle());
  const stale = await runCompile(root);

  vi.mocked(embedModule.makeEmbedder).mockReturnValue(new ExplodingEmbedder("down"));
  writeFileSync(join(root, "kuu.md"), "---\ntype: Concept\n---\n\n# Kuu\n\nRecovered tides.\n", "utf8");
  const failed = await runCompile(root);
  expect(tiersOf(root)["t2"]).toBe("stale");
  expect(failed.seq).toBe(stale.seq + 1); // chunks.jsonl moved with the edit

  vi.mocked(embedModule.makeEmbedder).mockReturnValue(working);
  working.batches.length = 0;
  const recovered = await runCompile(root);
  expect(tiersOf(root)["t2"]).toBe("fresh");
  expect(working.embeddedTexts).toEqual(["Recovered tides."]); // only the lagging chunk
  expect(recovered.seq).toBe(failed.seq); // tier transition alone never spends a seq
});

test("check-fresh stays T1-only", async () => {
  vi.mocked(embedModule.makeEmbedder).mockReturnValue(new ExplodingEmbedder("down"));
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  expect(tiersOf(root)["t2"]).toBe("stale");
  expect(checkFresh(root).fresh).toBe(true); // T2 staleness never gates commits
});

// -- the --only lever ----------------------------------------------------------------

test("--only t1 skips t2 and marks it stale", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  embedder.batches.length = 0;
  writeFileSync(join(root, "kuu.md"), "---\ntype: Concept\n---\n\n# Kuu\n\nNew.\n", "utf8");
  const result = await runCompile(root, false, ["t1"]);
  expect(result.changed).toBe(true);
  expect(embedder.batches).toEqual([]);
  expect(tiersOf(root)["t2"]).toBe("stale");
});

test("--only t1 keeps fresh t2 fresh when nothing changed", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  await runCompile(root);
  embedder.batches.length = 0;
  const result = await runCompile(root, false, ["t1"]);
  expect(result.changed).toBe(false);
  expect(tiersOf(root)["t2"]).toBe("fresh");
});

test("--only t2 refreshes vectors without touching t1", async () => {
  const embedder = counting();
  const root = copyBundle();
  await runCompile(root); // T1-only compile, t2 off
  const graphBefore = readFileSync(join(root, ".brainpick", "t1", "graph.json"));
  const seqBefore = manifestOf(root)["seq"] as number;
  withMockConfig(root);
  const result = await runCompile(root, false, ["t2"]);
  expect(result.changed).toBe(true);
  expect(result.seq).toBe(seqBefore + 1);
  expect(tiersOf(root)["t2"]).toBe("fresh");
  expect(readFileSync(join(root, ".brainpick", "t1", "graph.json"))).toEqual(graphBefore);
  expect(readFileSync(join(root, ".brainpick", "t2", "chunks.jsonl"), "utf8")).not.toBe("");
  expect(embedder.embeddedTexts.length).toBeGreaterThan(0); // vectors actually built
});

test("--only t2 before any compile instructs", async () => {
  const root = withMockConfig(copyBundle());
  const result = await runCompile(root, false, ["t2"]);
  expect(result.changed).toBe(false);
  expect(result.warnings.some((w) => w.includes("brainpick compile"))).toBe(true);
});

test("full recompile re-embeds everything but stays byte-stable", async () => {
  const embedder = counting();
  const root = withMockConfig(copyBundle());
  const first = await runCompile(root);
  const total = embedder.embeddedTexts.length;
  embedder.batches.length = 0;
  const result = await runCompile(root, true);
  expect(embedder.embeddedTexts).toHaveLength(total); // ignore the store, rebuild all
  expect(result.seq).toBe(first.seq); // identical artifacts never bump seq
});
