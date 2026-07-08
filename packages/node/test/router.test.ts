/** Search routing (spec/30 + spec/50): mode resolution, RRF fusion, honest
 * degradation (the twin of packages/python/tests/test_router.py). */
import { expect, test } from "vitest";

import type { DocRecord } from "../src/compile/t1";
import { titleSearch, type HitSource, type SearchHit } from "../src/query/keyword";
import {
  ensureTitles,
  isRelational,
  resolveMode,
  RRF_K,
  rrfFuse,
  runSearch,
  TITLE_INJECT_CAP,
} from "../src/query/router";

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

function graphStub(paths: string[]) {
  return (_query: string, limit: number): SearchHit[] =>
    paths.map((p) => hit(p, 0.8, null, "graph")).slice(0, limit);
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

test("graph mode degrades to keyword when t3 absent", async () => {
  const body = await runSearch(RECORDS, FRESH, "aurinko", "graph", 8, semanticStub(["kuu.md"]));
  expect(body.used_modes).toEqual(["keyword"]);
  expect(body.degraded_from).toBe("graph");
  expect(body.hits[0]!.path).toBe("aurinko.md");
});

test("graph mode uses the entity graph when present", async () => {
  const body = await runSearch(
    RECORDS, FRESH, "aurinko", "graph", 8, semanticStub(["kuu.md"]), graphStub(["maa.md", "kuu.md"]),
  );
  expect(body.used_modes).toEqual(["graph"]);
  expect(body.degraded_from).toBeNull();
  expect(body.hits.map((h) => h.path)).toEqual(["maa.md", "kuu.md"]);
  expect(body.hits.every((h) => h.source === "graph")).toBe(true);
});

// -- isRelational heuristic (spec/40) ------------------------------------------------

test("isRelational matches connection words", () => {
  expect(isRelational("how does the moon relate to the tides")).toBe(true);
  expect(isRelational("what connects to Aurinko")).toBe(true);
  expect(isRelational("the link between maa and kuu")).toBe(true);
  expect(isRelational("related work")).toBe(true); // substring stems catch inflections
  expect(isRelational("aurinko")).toBe(false);
  expect(isRelational("tides of the moon")).toBe(false);
});

test("auto widens with graph only for relational queries", async () => {
  const graph = graphStub(["planeetat.md"]);
  const plain = await runSearch(RECORDS, FRESH, "aurinko", "auto", 8, semanticStub(["aurinko.md"]), graph);
  expect(plain.used_modes).toEqual(["keyword", "semantic"]); // not relational → no graph

  const relational = await runSearch(
    RECORDS, FRESH, "what connects to aurinko", "auto", 8, semanticStub(["aurinko.md"]), graph,
  );
  expect(relational.used_modes).toEqual(["keyword", "semantic", "graph"]);
  expect(relational.hits.map((h) => h.path)).toContain("planeetat.md"); // graph-only recall joins
});

test("auto relational graph still marks semantic degrade when t2 off", async () => {
  const body = await runSearch(
    RECORDS, NO_T2, "how does aurinko relate to maa", "auto", 8, semanticStub(["x.md"]), graphStub(["maa.md"]),
  );
  expect(body.used_modes).toEqual(["keyword", "graph"]); // semantic absent, graph joined
  expect(body.degraded_from).toBe("semantic"); // the missing tier is still named
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

// -- title-match guarantee (a word that IS an article title always surfaces) ----------

test("titleSearch names the page (exact + stem, precise)", () => {
  expect(titleSearch(RECORDS, "aurinko", 8).map((h) => h.path)).toEqual(["aurinko.md"]);
  const recs = [...RECORDS, record("agents.md", "Agent integrations", "how agents connect")];
  expect(titleSearch(recs, "agents", 8).map((h) => h.path)).toContain("agents.md");
  expect(titleSearch(RECORDS, "supernova", 8)).toEqual([]);
  expect(titleSearch([record("a.md", "Authentication", "x")], "auth", 8)).toEqual([]);
});

test("ensureTitles injects only when missing and is capped", () => {
  const sem = [hit("kuu.md", 0.9, null, "semantic"), hit("maa.md", 0.9, null, "semantic")];
  const title = [hit("aurinko.md", 2.0, null, "title")];
  const injected = ensureTitles(sem, title, 4);
  expect(injected.map((h) => h.path)).toEqual(["aurinko.md", "kuu.md", "maa.md"]);
  expect(injected[0]!.source).toBe("title"); // the named page, at the front
  const already = ensureTitles([hit("aurinko.md", 0.9, null, "semantic"), ...sem], title, 4);
  expect(already.map((h) => h.path)).toEqual(["aurinko.md", "kuu.md", "maa.md"]);
  expect(already[0]!.source).toBe("semantic"); // no-op keeps the retriever's own hit
  const many = Array.from({ length: 6 }, (_, i) => hit(`t${i}.md`, 1.0, null, "title"));
  expect(ensureTitles([], many, 10)).toHaveLength(TITLE_INJECT_CAP);
});

test("semantic surfaces a missed title match", async () => {
  const body = await runSearch(RECORDS, FRESH, "aurinko", "semantic", 8, semanticStub(["kuu.md", "maa.md"]));
  expect(body.used_modes).toEqual(["semantic"]);
  expect(body.degraded_from).toBeNull();
  expect(body.hits[0]!.path).toBe("aurinko.md");
  expect(body.hits[0]!.source).toBe("title");
});

test("auto never drops a title match", async () => {
  const body = await runSearch(RECORDS, FRESH, "aurinko", "auto", 1, semanticStub(["kuu.md", "maa.md"]));
  expect(body.hits.map((h) => h.path)).toContain("aurinko.md");
});
