/** Search routing (spec/30 + spec/50): mode resolution, RRF fusion, honest
 * degradation (the twin of packages/python/tests/test_router.py). */
import { expect, test } from "vitest";

import type { DocRecord } from "../src/compile/t1";
import type { HitSource, SearchHit } from "../src/query/keyword";
import { resolveMode, RRF_K, rrfFuse, runSearch } from "../src/query/router";

const FRESH = { t1: "fresh", t2: "fresh", t3: "off" };
const NO_T2 = { t1: "fresh", t2: "off", t3: "off" };
const STALE_T2 = { t1: "fresh", t2: "stale", t3: "off" };

function record(path: string, title: string, text: string, description: string | null = null): DocRecord {
  return {
    path,
    title,
    description,
    text,
    reserved: false,
    sha256: "x",
    tags: [],
    timestamp: null,
    type: "Concept",
  };
}

const RECORDS = [
  record("aurinko.md", "Aurinko", "aurinko aurinko keskellä"),
  record("kuu.md", "Kuu", "kuu kiertää maata"),
  record("maa.md", "Maa", "maa on sininen"),
];

function hit(path: string, score = 1.0, snippet: string | null = null, source: HitSource = "keyword"): SearchHit {
  return { path, title: path, description: null, score, snippet, source };
}

function semanticStub(paths: string[]) {
  return (_query: string, limit: number): SearchHit[] =>
    paths.map((p) => hit(p, 0.9, null, "semantic")).slice(0, limit);
}

function brokenSemantic(): Promise<SearchHit[]> {
  return Promise.reject(new Error("store is gone"));
}

// -- mode resolution -----------------------------------------------------------------

test("unknown mode resolves to auto", () => {
  expect(resolveMode("banana")).toBe("auto");
  expect(resolveMode(null)).toBe("auto");
  expect(resolveMode(undefined)).toBe("auto");
  expect(resolveMode("semantic")).toBe("semantic");
});

// -- RRF fusion ----------------------------------------------------------------------

function round6(x: number): number {
  return Number(x.toFixed(6));
}

test("rrfFuse scores and sources", () => {
  const fused = rrfFuse(
    {
      keyword: [hit("a.md"), hit("b.md"), hit("c.md")],
      semantic: [hit("c.md", 1.0, null, "semantic"), hit("a.md", 1.0, null, "semantic")],
    },
    8,
  );
  expect(fused.map((h) => h.path)).toEqual(["a.md", "c.md", "b.md"]);
  const [a, c, b] = fused;
  expect(a!.score).toBe(round6(1 / (RRF_K + 1) + 1 / (RRF_K + 2)));
  expect(c!.score).toBe(round6(1 / (RRF_K + 3) + 1 / (RRF_K + 1)));
  expect(b!.score).toBe(round6(1 / (RRF_K + 2)));
  expect(a!.source).toBe("keyword"); // its best rank came from keyword (1 vs 2)
  expect(c!.source).toBe("semantic"); // rank 1 semantic beats rank 3 keyword
  expect(b!.source).toBe("keyword");
});

test("rrfFuse ties break on path and dedupe by doc", () => {
  const fused = rrfFuse(
    {
      keyword: [hit("b.md"), hit("a.md")],
      semantic: [hit("a.md", 1.0, null, "semantic"), hit("b.md", 1.0, null, "semantic")],
    },
    8,
  );
  expect(fused.map((h) => h.path)).toEqual(["a.md", "b.md"]); // equal scores: path order
  expect(fused).toHaveLength(2);
});

test("rrfFuse respects limit", () => {
  const fused = rrfFuse({ keyword: Array.from({ length: 10 }, (_, i) => hit(`${i}.md`)) }, 3);
  expect(fused).toHaveLength(3);
});

// -- runSearch -----------------------------------------------------------------------

test("keyword mode never degrades", async () => {
  const body = await runSearch(RECORDS, NO_T2, "aurinko", "keyword");
  expect(body.used_modes).toEqual(["keyword"]);
  expect(body.degraded_from).toBeNull();
  expect(body.hits[0]!.path).toBe("aurinko.md");
});

test("semantic degrades to keyword when t2 not fresh", async () => {
  for (const tiers of [NO_T2, STALE_T2]) {
    const body = await runSearch(RECORDS, tiers, "aurinko", "semantic");
    expect(body.used_modes).toEqual(["keyword"]);
    expect(body.degraded_from).toBe("semantic");
  }
});

test("auto degrades with marker when t2 not fresh", async () => {
  const body = await runSearch(RECORDS, NO_T2, "aurinko", "auto");
  expect(body.used_modes).toEqual(["keyword"]);
  expect(body.degraded_from).toBe("semantic"); // spec/30: auto degrades like semantic
});

test("graph mode degrades to keyword until t3", async () => {
  const body = await runSearch(RECORDS, FRESH, "aurinko", "graph", 8, semanticStub(["kuu.md"]));
  expect(body.used_modes).toEqual(["keyword"]);
  expect(body.degraded_from).toBe("graph");
});

test("semantic mode uses vectors alone when fresh", async () => {
  const body = await runSearch(RECORDS, FRESH, "kuu", "semantic", 8, semanticStub(["kuu.md", "maa.md"]));
  expect(body.used_modes).toEqual(["semantic"]);
  expect(body.degraded_from).toBeNull();
  expect(body.hits.map((h) => h.path)).toEqual(["kuu.md", "maa.md"]);
  expect(body.hits.every((h) => h.source === "semantic")).toBe(true);
});

test("auto fuses keyword and semantic when fresh", async () => {
  const body = await runSearch(RECORDS, FRESH, "aurinko", "auto", 8, semanticStub(["aurinko.md", "maa.md"]));
  expect(body.used_modes).toEqual(["keyword", "semantic"]);
  expect(body.degraded_from).toBeNull();
  expect(body.hits[0]!.path).toBe("aurinko.md"); // top of both rankings
  const paths = body.hits.map((h) => h.path);
  expect(paths).toContain("maa.md"); // semantic-only recall surfaces
  expect(paths).toHaveLength(new Set(paths).size); // deduped by document
  expect(body.hits.every((h) => h.source === "keyword" || h.source === "semantic")).toBe(true);
});

test("semantic failure degrades instead of erroring", async () => {
  for (const mode of ["semantic", "auto"]) {
    const body = await runSearch(RECORDS, FRESH, "aurinko", mode, 8, brokenSemantic);
    expect(body.used_modes).toEqual(["keyword"]);
    expect(body.degraded_from).toBe("semantic");
  }
});

test("limit caps the fused set", async () => {
  const body = await runSearch(
    RECORDS,
    FRESH,
    "aurinko kuu maa",
    "auto",
    2,
    semanticStub(["kuu.md", "maa.md", "aurinko.md"]),
  );
  expect(body.hits.length).toBeLessThanOrEqual(2);
});
