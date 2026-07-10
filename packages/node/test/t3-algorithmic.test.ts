/** The algorithmic T3 backend (spec/40 "The algorithmic backend") — the Node
 * twin of packages/python/tests/test_t3_algorithmic.py. The derivation is exact
 * and normative, so these tests pin the same fields, templates, weights, and
 * canonical export bytes; the kg-algorithmic conformance class then proves the
 * two engines byte-identical against one golden. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { deriveAlgorithmicExport } from "../src/compile/t3";
import { defaultConfig, loadConfig, resolveGraphBackend } from "../src/config";
import type { DocRecord } from "../src/compile/t1";
import { loadKg } from "../src/kg";
import { cleanup, copyBundle, makeBundle } from "./helpers";

afterEach(cleanup);

function record(path: string, text = "", tags: string[] = [], reserved = false): DocRecord {
  return {
    about: null, description: null, path, reserved, sha256: "0".repeat(64),
    tags, text, timestamp: null, title: path, type: null,
  };
}

function manifestOf(root: string): { tiers: Record<string, string> } {
  return JSON.parse(readFileSync(join(root, ".brainpick", "manifest.json"), "utf8"));
}

// -- ghost entities ------------------------------------------------------------------

test("ghost entity from a dead link", () => {
  const [entities, relations] = deriveAlgorithmicExport([record("a.md", "See [Olematon shoal](olematon.md) for more.")]);
  expect(entities).toEqual([{
    description: "Referenced from 1 page(s) but not yet written.",
    id: "olematon", // the TARGET's stem, normalized — not the name
    name: "Olematon shoal", // the link text of the first reference
    source_docs: ["a.md"],
    type: "ghost",
  }]);
  expect(relations).toEqual([]);
});

test("ghost name is the first reference in sorted-path-then-document order", () => {
  const [entities] = deriveAlgorithmicExport([
    record("b.md", "[wrong name](ghost.md)"),
    record("a.md", "before [Second](ghost.md) comes [First](ghost.md)."),
  ]);
  expect(entities.map((e) => e.name)).toEqual(["Second"]); // a.md first, document order within
  expect(entities[0]!.source_docs).toEqual(["a.md", "b.md"]);
  expect(entities[0]!.description).toBe("Referenced from 2 page(s) but not yet written.");
});

test("ghost key is the normalized stem so spellings converge", () => {
  const [entities] = deriveAlgorithmicExport([
    record("a.md", "[Ghost](ghost.md)"),
    record("sub/b.md", "[Other name](../ghost.md) and [[Ghost]]"),
  ]);
  expect(entities).toHaveLength(1);
  expect(entities[0]!.id).toBe("ghost");
  expect(entities[0]!.source_docs).toEqual(["a.md", "sub/b.md"]);
});

test("ghost from a wikilink; name whitespace collapses", () => {
  const [entities] = deriveAlgorithmicExport([record("a.md", "An old [[puuttuva sivu|Puuttuva\n  Sivu]] reference.")]);
  expect(entities[0]!.id).toBe("puuttuva-sivu");
  expect(entities[0]!.name).toBe("Puuttuva Sivu");
  expect(entities[0]!.type).toBe("ghost");
});

test("ghost with empty link text falls back to the stem", () => {
  const [entities] = deriveAlgorithmicExport([record("a.md", "[](olematon.md)")]);
  expect(entities[0]!.name).toBe("olematon");
  expect(entities[0]!.id).toBe("olematon");
});

test("resolved links and degenerate targets yield no ghosts", () => {
  const [entities] = deriveAlgorithmicExport([
    record("a.md", "[B](b.md) resolves; [self](a.md) is a self-link; [x](///) is degenerate."),
    record("b.md", ""),
  ]);
  expect(entities).toEqual([]);
});

test("reserved docs reference ghosts too", () => {
  const [entities] = deriveAlgorithmicExport([
    record("index.md", "* [Tuleva](tuleva.md) — not yet written", [], true),
  ]);
  expect(entities[0]!.id).toBe("tuleva");
  expect(entities[0]!.source_docs).toEqual(["index.md"]);
});

// -- tag entities ----------------------------------------------------------------------

test("tag entity name is as first written", () => {
  const [entities] = deriveAlgorithmicExport([
    record("a.md", "", ["Saari"]),
    record("b.md", "", ["saari"]),
  ]);
  expect(entities).toEqual([{
    description: "Tagged on 2 page(s).",
    id: "saari",
    name: "Saari", // a.md sorts first — its spelling wins
    source_docs: ["a.md", "b.md"],
    type: "tag",
  }]);
});

test("empty and degenerate tags are skipped", () => {
  const [entities] = deriveAlgorithmicExport([record("a.md", "", ["", "###", "koti"])]);
  expect(entities.map((e) => e.id)).toEqual(["koti"]);
});

test("ghost and tag id collision disambiguates in name codepoint order", () => {
  const [entities] = deriveAlgorithmicExport([record("a.md", "[Kuu](kuu.md)", ["kuu"])]);
  expect(entities.map((e) => [e.id, e.name, e.type])).toEqual([
    ["kuu", "Kuu", "ghost"], // "Kuu" < "kuu" by codepoint
    ["kuu-2", "kuu", "tag"],
  ]);
});

// -- co-occurrence relations -------------------------------------------------------------

test("co-occurrence weight is 1 - 2^(-shared)", () => {
  const [, relations] = deriveAlgorithmicExport([
    record("a.md", "[Ghost](ghost.md)", ["koti"]),
    record("b.md", "[Ghost](ghost.md)", ["koti"]),
    record("c.md", "", ["koti", "yksin"]),
  ]);
  expect(relations).toEqual([
    {
      description: "Co-mentioned in 2 page(s).",
      dst: "koti",
      keywords: [],
      source_docs: ["a.md", "b.md"],
      src: "ghost", // src < dst by id
      weight: 0.75, // 1 − 2^(−2), exactly representable
    },
    {
      description: "Co-mentioned in 1 page(s).",
      dst: "yksin",
      keywords: [],
      source_docs: ["c.md"],
      src: "koti",
      weight: 0.5, // 1 − 2^(−1)
    },
  ]);
});

test("empty bundle derives an empty export", () => {
  const [entities, relations] = deriveAlgorithmicExport([record("a.md", "no links"), record("b.md")]);
  expect(entities).toEqual([]);
  expect(relations).toEqual([]);
});

// -- config resolution (spec/80: [modules] graph) ---------------------------------------

test("resolveGraphBackend maps every [modules] graph value", () => {
  const resolve = (graph: string, extraction = ""): string => {
    const cfg = defaultConfig();
    if (graph !== "") cfg.modules.graph = graph;
    cfg.models.extraction.kind = extraction;
    return resolveGraphBackend(cfg);
  };
  expect(resolve("")).toBe("algorithmic"); // the default
  expect(resolve("algorithmic")).toBe("algorithmic");
  expect(resolve("off")).toBe("off");
  expect(resolve("lightrag")).toBe("lightrag");
  expect(resolve("auto")).toBe("algorithmic"); // no extraction model
  expect(resolve("auto", "mock")).toBe("lightrag");
  expect(resolve("on", "mock")).toBe("lightrag"); // legacy on ≈ auto
  expect(resolve("on")).toBe("algorithmic");
  expect(resolve("sparkling")).toBe("algorithmic"); // unknown → forgiving default
});

// -- the compile stage (default: algorithmic, zero config) ------------------------------

const EXPECTED_ENTITY_LINES = [
  '{"description":"Tagged on 1 page(s).","id":"koti","name":"koti","source_docs":["maa.md"],"type":"tag"}',
  '{"description":"Tagged on 1 page(s).","id":"kuu","name":"kuu","source_docs":["kuu.md"],"type":"tag"}',
  '{"description":"Tagged on 1 page(s).","id":"luettelo","name":"luettelo","source_docs":["planeetat.md"],"type":"tag"}',
  '{"description":"Tagged on 1 page(s).","id":"mysteeri","name":"mysteeri","source_docs":["yksinainen.md"],"type":"tag"}',
  '{"description":"Referenced from 1 page(s) but not yet written.","id":"olematon","name":"Olematon","source_docs":["saaret/laguuni.md"],"type":"ghost"}',
  '{"description":"Tagged on 1 page(s).","id":"planeetta","name":"planeetta","source_docs":["maa.md"],"type":"tag"}',
  '{"description":"Tagged on 2 page(s).","id":"saari","name":"saari","source_docs":["saaret/atolli.md","saaret/laguuni.md"],"type":"tag"}',
  '{"description":"Tagged on 1 page(s).","id":"tähti","name":"tähti","source_docs":["aurinko.md"],"type":"tag"}',
  '{"description":"Tagged on 1 page(s).","id":"vierailija","name":"vierailija","source_docs":["komeetta.md"],"type":"tag"}',
];

const EXPECTED_RELATION_LINES = [
  '{"description":"Co-mentioned in 1 page(s).","dst":"planeetta","keywords":[],"source_docs":["maa.md"],"src":"koti","weight":0.5}',
  '{"description":"Co-mentioned in 1 page(s).","dst":"saari","keywords":[],"source_docs":["saaret/laguuni.md"],"src":"olematon","weight":0.5}',
];

test("default compile derives T3 natively — no config, no delegation", async () => {
  const root = copyBundle();
  const result = await runCompile(root); // zero config — the algorithmic default needs nothing
  expect(manifestOf(root).tiers).toEqual({ t1: "fresh", t2: "off", t3: "fresh" });
  expect(result.warnings.some((w) => w.includes("extraction") || w.includes("graph"))).toBe(false);

  const t3 = join(root, ".brainpick", "t3");
  expect(readFileSync(join(t3, "entities.jsonl"), "utf8")).toBe(EXPECTED_ENTITY_LINES.join("\n") + "\n");
  expect(readFileSync(join(t3, "relations.jsonl"), "utf8")).toBe(EXPECTED_RELATION_LINES.join("\n") + "\n");
  expect(JSON.parse(readFileSync(join(t3, "kg-meta.json"), "utf8"))).toEqual({
    entities: 9,
    extractor: { kind: "algorithmic" }, // no model — nothing was called
    relations: 2,
    spec_version: "0.1",
  });
});

test("a tag-only edit rederives the graph", async () => {
  const root = copyBundle();
  await runCompile(root);
  const maa = join(root, "maa.md");
  writeFileSync(maa, readFileSync(maa, "utf8").replace("[planeetta, koti]", "[planeetta]"), "utf8");
  const result = await runCompile(root);
  expect(result.changed).toBe(true);
  const entities = readFileSync(join(root, ".brainpick", "t3", "entities.jsonl"), "utf8");
  expect(entities).not.toContain('"id":"koti"');
  expect(entities).toContain('"id":"planeetta"');
});

test("an empty derivation is a valid fresh export that loads and serves empty", async () => {
  const root = makeBundle({
    "yksi.md": "---\ntype: Concept\n---\n\n# Yksi\n\n[Kaksi](kaksi.md)\n",
    "kaksi.md": "---\ntype: Concept\n---\n\n# Kaksi\n\n[Yksi](yksi.md)\n",
  });
  await runCompile(root);
  expect(manifestOf(root).tiers["t3"]).toBe("fresh");

  const t3 = join(root, ".brainpick", "t3");
  expect(readFileSync(join(t3, "entities.jsonl"), "utf8")).toBe("");
  expect(readFileSync(join(t3, "relations.jsonl"), "utf8")).toBe("");
  expect(JSON.parse(readFileSync(join(t3, "kg-meta.json"), "utf8"))).toEqual({
    entities: 0, extractor: { kind: "algorithmic" }, relations: 0, spec_version: "0.1",
  });

  // the empty export still LOADS: an empty entity layer, never a 404 (spec/40)
  const kg = loadKg(join(root, ".brainpick"));
  expect(kg).not.toBeNull();
  expect(kg!.entityGraph()).toEqual({ nodes: [], edges: [] });
});

test("graph = lightrag keeps the read-only presence semantics (Node never extracts)", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[modules]\ngraph = "lightrag"\n', "utf8");
  await runCompile(root);
  expect(manifestOf(root).tiers["t3"]).toBe("off"); // no export staged, none derived
});

test("graph = off compiles no T3 and reports off", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[modules]\ngraph = "off"\n', "utf8");
  await runCompile(root);
  expect(manifestOf(root).tiers["t3"]).toBe("off");
  expect(loadKg(join(root, ".brainpick"))).toBeNull(); // nothing was written
});

test("--only t3 rederives natively from the compiled substrate", async () => {
  const root = copyBundle();
  await runCompile(root);
  const entitiesPath = join(root, ".brainpick", "t3", "entities.jsonl");
  writeFileSync(entitiesPath, "", "utf8"); // vandalize the export out of band
  const result = await runCompile(root, false, ["t3"]);
  expect(result.changed).toBe(true);
  expect(manifestOf(root).tiers["t3"]).toBe("fresh");
  expect(readFileSync(entitiesPath, "utf8")).toBe(EXPECTED_ENTITY_LINES.join("\n") + "\n");
});

test("loadConfig default resolves to the algorithmic backend", () => {
  const root = copyBundle();
  expect(resolveGraphBackend(loadConfig(root))).toBe("algorithmic");
});
