/** The similarity gap-detector (spec/45): T2 vectors joined against T1's link
 * graph to surface semantically-similar, unlinked document pairs — the twin
 * of packages/python/tests/test_similarity_gaps.py. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  ALLOWLIST_FILE,
  computePairs,
  pairKey,
  readAllowlist,
  runSimilarityGapsStage,
  similarityGapsGate,
} from "../src/compile/similarity-gaps";
import { defaultConfig } from "../src/config";
import { lancedbAvailable, VectorStore } from "../src/vectorstore";
import { cleanup, tempDir } from "./helpers";

afterEach(cleanup);

function graphWithEdges(...pairs: Array<[string, string]>) {
  return {
    edges: pairs.map(([source, target]) => ({ count: 1, kind: "link", label: "x", source, target })),
  };
}

// -- gate ------------------------------------------------------------------------

test("gate off by config", () => {
  const config = defaultConfig();
  config.modules.similarity_gaps = "off";
  expect(similarityGapsGate(config, "fresh")).toEqual([false, null]);
});

for (const mode of ["auto", "on"]) {
  test(`gate rides T2 freshness (${mode})`, () => {
    const config = defaultConfig();
    config.modules.similarity_gaps = mode;
    expect(similarityGapsGate(config, "fresh")).toEqual([true, null]);
    expect(similarityGapsGate(config, "off")).toEqual([false, null]);
    expect(similarityGapsGate(config, "stale")).toEqual([false, null]);
  });
}

// -- computePairs (pure) -----------------------------------------------------------

test("computePairs excludes already-linked pairs", () => {
  const vectors = new Map([["a.md", [1.0, 0.0]], ["b.md", [1.0, 0.0]]]);
  const pairs = computePairs(vectors, graphWithEdges(["a.md", "b.md"]), new Set(), 0.5, 50, new Set());
  expect(pairs).toEqual([]);
});

test("computePairs finds an unlinked similar pair", () => {
  const vectors = new Map([["a.md", [1.0, 0.0]], ["b.md", [0.9, 0.1]], ["c.md", [0.0, 1.0]]]);
  const pairs = computePairs(vectors, graphWithEdges(), new Set(), 0.9, 50, new Set());
  expect(pairs).toEqual([{ a: "a.md", b: "b.md", score: 0.994, status: "open" }]);
});

test("computePairs excludes reserved docs", () => {
  const vectors = new Map([["a.md", [1.0, 0.0]], ["index.md", [1.0, 0.0]]]);
  const pairs = computePairs(vectors, graphWithEdges(), new Set(["index.md"]), 0.5, 50, new Set());
  expect(pairs).toEqual([]);
});

test("computePairs sorts by score desc then path, and caps", () => {
  const vectors = new Map([
    ["a.md", [1.0, 0.0]], ["b.md", [0.99, 0.01]],
    ["c.md", [1.0, 0.02]], ["d.md", [1.0, 0.05]],
  ]);
  const pairs = computePairs(vectors, graphWithEdges(), new Set(), 0.0, 1, new Set());
  expect(pairs.length).toBe(1);
});

test("computePairs canonical pair order is lexicographic", () => {
  const vectors = new Map([["z.md", [1.0, 0.0]], ["a.md", [1.0, 0.0]]]);
  const pairs = computePairs(vectors, graphWithEdges(), new Set(), 0.5, 50, new Set());
  expect([pairs[0]!.a, pairs[0]!.b]).toEqual(["a.md", "z.md"]);
});

test("computePairs marks dismissed", () => {
  const vectors = new Map([["a.md", [1.0, 0.0]], ["b.md", [1.0, 0.0]]]);
  const pairs = computePairs(
    vectors, graphWithEdges(), new Set(), 0.5, 50, new Set([pairKey("a.md", "b.md")]),
  );
  expect(pairs[0]!.status).toBe("dismissed");
});

// -- allowlist ---------------------------------------------------------------------

test("readAllowlist: absent file is empty", () => {
  expect(readAllowlist(tempDir())).toEqual(new Set());
});

test("readAllowlist normalizes pair order", () => {
  const root = tempDir();
  writeFileSync(
    join(root, ALLOWLIST_FILE),
    '[[dismissed]]\na = "z.md"\nb = "a.md"\nreason = "not related"\n',
    "utf8",
  );
  expect(readAllowlist(root)).toEqual(new Set([pairKey("a.md", "z.md")]));
});

test("readAllowlist malformed toml is empty, not throwing", () => {
  const root = tempDir();
  writeFileSync(join(root, ALLOWLIST_FILE), "not [ valid toml", "utf8");
  expect(() => readAllowlist(root)).not.toThrow();
  expect(readAllowlist(root)).toEqual(new Set());
});

// -- the compile stage ---------------------------------------------------------------

const available = await lancedbAvailable();

describe.skipIf(!available)("runSimilarityGapsStage", () => {
  test("writes the artifact", async () => {
    const root = tempDir();
    const bp = join(root, ".brainpick");
    const store = new VectorStore(join(bp, "t2", "lancedb"));
    await store.replaceAll(
      [
        { id: "a#0", doc: "a.md", ord: 0, text: "t", vector: [1.0, 0.0] },
        { id: "b#0", doc: "b.md", ord: 0, text: "t", vector: [0.95, 0.05] },
      ],
      2,
    );
    const records = [
      { path: "a.md", reserved: false } as never,
      { path: "b.md", reserved: false } as never,
    ];
    const config = defaultConfig();

    const result = await runSimilarityGapsStage(bp, root, graphWithEdges(), records, config);
    expect(result.pairs).toEqual([{ a: "a.md", b: "b.md", score: 0.999, status: "open" }]);

    const written = JSON.parse(readFileSync(join(bp, "t1", "similarity-gaps.json"), "utf8"));
    expect(written.threshold).toBe(0.75);
    expect(written.max_pairs).toBe(50);
  });
});
