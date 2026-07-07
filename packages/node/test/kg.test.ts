/** T3 knowledge-graph reader (spec/40): id normalization, tolerant export
 * loading, entity neighbors, mode=graph ranking, the entity graph — the twin of
 * packages/python/tests/test_kg.py. Tested against a hand-authored fixture,
 * never an extractor (spec/40). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { DocRecord } from "../src/compile/t1";
import {
  disambiguateIds,
  graphSearch,
  linkWalkSearch,
  loadKg,
  normalizeEntityId,
  type KnowledgeGraph,
} from "../src/kg";
import type { Graph } from "../src/compile/t1";
import { cleanup, EXPECTED, makeBundle } from "./helpers";

afterEach(cleanup);

const T3_FIXTURE = join(EXPECTED, "kotiaurinko", "t3");
const DOCS_JSONL = join(EXPECTED, "kotiaurinko", ".brainpick", "t1", "docs.jsonl");

/** A .brainpick dir with the fixture t3/ export staged under it. */
function stage(): string {
  const root = makeBundle({ "keep.txt": "" });
  const bp = join(root, ".brainpick");
  mkdirSync(join(bp, "t3"), { recursive: true });
  for (const file of ["entities.jsonl", "relations.jsonl", "kg-meta.json"]) {
    writeFileSync(join(bp, "t3", file), readFileSync(join(T3_FIXTURE, file), "utf8"));
  }
  return bp;
}

function records(): DocRecord[] {
  return readFileSync(DOCS_JSONL, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as DocRecord);
}

function loaded(): KnowledgeGraph {
  const kg = loadKg(stage());
  expect(kg).not.toBeNull();
  return kg!;
}

// -- id normalization (golden) -------------------------------------------------------

// name -> id, pinned. Unicode letters survive NFC+lowercase (Yksinäinen); runs of
// non-alphanumerics collapse to a single "-" and trim at the ends.
const ID_GOLDEN: Array<[string, string]> = [
  ["Aurinko", "aurinko"],
  ["Kuu", "kuu"],
  ["Yksinäinen", "yksinäinen"], // unicode: ä is preserved, only cased down
  ["Solar System!", "solar-system"],
  ["  --Trim/Me--  ", "trim-me"],
  ["Ålänningen", "ålänningen"],
  ["H₂O and CO₂", "h₂o-and-co₂"], // subscripts are \p{N}, kept as alphanumerics
];

describe("normalizeEntityId golden", () => {
  for (const [name, expected] of ID_GOLDEN) {
    test(name, () => expect(normalizeEntityId(name)).toBe(expected));
  }
});

test("fixture names normalize to their stored ids", () => {
  // pins that toLowerCase() lands where the export author expected (Python agrees)
  for (const line of readFileSync(join(T3_FIXTURE, "entities.jsonl"), "utf8").split("\n")) {
    if (line === "") continue;
    const entity = JSON.parse(line) as { id: string; name: string };
    expect(normalizeEntityId(entity.name)).toBe(entity.id);
  }
});

test("disambiguate collisions in codepoint order", () => {
  // "SOL" < "Sol" < "sol" by codepoint (S=0x53 before s=0x73; O=0x4f before o=0x6f)
  expect(disambiguateIds(["Sol", "sol", "SOL"])).toEqual({ SOL: "sol", Sol: "sol-2", sol: "sol-3" });
  expect(disambiguateIds(["Aurinko", "Kuu"])).toEqual({ Aurinko: "aurinko", Kuu: "kuu" });
  expect(disambiguateIds(["New York", "new.york", "Kuu"])).toEqual({
    "New York": "new-york",
    "new.york": "new-york-2",
    Kuu: "kuu",
  });
});

// -- reader tolerance ----------------------------------------------------------------

test("absent export is unavailable", () => {
  const root = makeBundle({ "keep.txt": "" });
  expect(loadKg(join(root, ".brainpick"))).toBeNull(); // no t3/ → null, not an error
});

test("empty entities file is unavailable", () => {
  const root = makeBundle({ ".brainpick/t3/entities.jsonl": "" });
  expect(loadKg(join(root, ".brainpick"))).toBeNull();
});

test("tolerates missing relations and meta", () => {
  const root = makeBundle({
    ".brainpick/t3/entities.jsonl":
      '{"id":"a","name":"A","description":"first","source_docs":["a.md"],"type":"x"}\n',
  });
  const kg = loadKg(join(root, ".brainpick"))!;
  expect(kg).not.toBeNull();
  expect(kg.relations).toEqual([]);
  expect(kg.meta).toEqual({});
  expect(kg.entitiesForDoc("a.md")).toEqual(["a"]);
});

test("skips dangling relations", () => {
  const root = makeBundle({
    ".brainpick/t3/entities.jsonl":
      '{"id":"a","name":"A","description":"first","source_docs":["a.md"],"type":"x"}\n',
    ".brainpick/t3/relations.jsonl":
      '{"src":"a","dst":"ghost","keywords":[],"source_docs":["a.md"],"weight":0.5}\n',
  });
  expect(loadKg(join(root, ".brainpick"))!.relations).toEqual([]); // 'ghost' endpoint skipped
});

test("reads meta", () => {
  const kg = loaded();
  expect(kg.meta["entities"]).toBe(6);
  expect(kg.meta["relations"]).toBe(5);
});

// -- neighbors -----------------------------------------------------------------------

test("entitiesForDoc", () => {
  const kg = loaded();
  expect(kg.entitiesForDoc("kuu.md")).toEqual(["kuu", "maa", "vuorovesi"]);
  expect(kg.entitiesForDoc("komeetta.md")).toEqual(["aurinko", "komeetta"]);
  expect(kg.entitiesForDoc("olematon.md")).toEqual([]);
});

test("neighborEntities widens with depth", () => {
  const kg = loaded();
  const [nodes1, edges1] = kg.neighborEntities("kuu.md", 1);
  expect(nodes1.map((n) => [n.id, n.distance])).toEqual([
    ["kuu", 0],
    ["maa", 0],
    ["vuorovesi", 0],
    ["planeetat", 1],
  ]);
  expect(nodes1.find((n) => n.id === "kuu")!.source_docs).toEqual(["aurinko.md", "kuu.md", "maa.md"]);
  expect(edges1).toContainEqual({ src: "kuu", dst: "vuorovesi" });
  const [nodes2] = kg.neighborEntities("kuu.md", 2);
  expect(new Set(nodes2.map((n) => n.id))).toEqual(
    new Set(["kuu", "maa", "vuorovesi", "planeetat", "aurinko"]),
  );
  expect(nodes2.find((n) => n.id === "aurinko")!.distance).toBe(2);
});

test("neighborEntities empty for a doc without entities", () => {
  const kg = loaded();
  const [nodes, edges] = kg.neighborEntities("olematon.md", 2);
  expect(nodes).toEqual([]);
  expect(edges).toEqual([]);
});

// -- mode=graph ranking --------------------------------------------------------------

test("graphSearch 'what orbits the star' excludes the moon", () => {
  // the entity graph ranks the star and its orbiters; komeetta.md ranks HIGH
  // though its prose barely says 'star', while kuu.md (the moon orbits the
  // earth, not the star) ranks last and is excluded at limit 4.
  const kg = loaded();
  const hits = graphSearch(kg, records(), "what orbits the star", 4);
  expect(hits.map((h) => h.path)).toEqual(["planeetat.md", "aurinko.md", "komeetta.md", "maa.md"]);
  expect(hits.every((h) => h.source === "graph")).toBe(true);
  expect(new Set(hits.map((h) => h.path)).has("kuu.md")).toBe(false);
});

test("graphSearch expands beyond the keyword doc", () => {
  // no document body contains 'vuorovesi' (keyword returns EMPTY), yet the
  // entity grounds kuu.md and one hop reaches the moon's docs — pure graph recall
  const kg = loaded();
  const hits = graphSearch(kg, records(), "vuorovesi", 8);
  expect(new Set(hits.map((h) => h.path))).toEqual(new Set(["kuu.md", "aurinko.md", "maa.md"]));
  expect(hits[0]!.path).toBe("kuu.md");
});

test("graphSearch with no entity match is empty", () => {
  expect(graphSearch(loaded(), records(), "zzz nonsense token", 8)).toEqual([]);
});

test("graphSearch respects limit", () => {
  expect(graphSearch(loaded(), records(), "what orbits the star", 2)).toHaveLength(2);
});

// -- entity graph (for /api/graph?layer=entities) ------------------------------------

test("entityGraph nodes and edges", () => {
  const kg = loaded();
  const graph = kg.entityGraph();
  expect(graph.nodes.find((n) => n.id === "aurinko")).toEqual({
    id: "aurinko",
    name: "Aurinko",
    type: "star",
    description: "The star at the center that everything orbits.",
    degree: 2,
    // source_docs (spec/50): the docs the entity was extracted from, sorted, so
    // the UI's entity panel shows provenance without N extra calls.
    source_docs: ["aurinko.md", "komeetta.md", "planeetat.md"],
  });
  expect(graph.nodes.map((n) => n.id)).toEqual([
    "aurinko",
    "komeetta",
    "kuu",
    "maa",
    "planeetat",
    "vuorovesi",
  ]);
  // every node carries its sorted source_docs, matching the fixture export
  for (const node of graph.nodes) {
    expect(node.source_docs).toEqual([...kg.entities.get(node.id)!.source_docs].sort());
  }
  expect(graph.edges).toContainEqual({ src: "komeetta", dst: "aurinko", weight: 0.6 });
  expect(graph.edges).toHaveLength(5);
});

// -- graph-mode degrade (T3 absent): T1 link-walk over keyword ------------------------

test("linkWalkSearch expands keyword over T1 links", () => {
  const recs = [
    { path: "a.md", title: "A", description: "alpha", text: "alpha", reserved: false },
    { path: "b.md", title: "B", description: "beta", text: "beta", reserved: false },
  ] as unknown as DocRecord[];
  const linkGraph = { edges: [{ source: "a.md", target: "b.md", kind: "link" }] } as unknown as Graph;
  const hits = linkWalkSearch(linkGraph, recs, "alpha", 8);
  expect(hits.map((h) => h.path)).toEqual(["a.md", "b.md"]); // a.md keyword, b.md one T1 hop
  expect(hits[0]!.source).toBe("keyword");
  expect(hits[1]!.source).toBe("graph");
});
