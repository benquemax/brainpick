/** The shared conformance harness — reads spec/conformance/cases.yaml.
 *
 * The twin of packages/python/tests/test_conformance.py: every case class
 * runs against the same fixtures and goldens. This engine claims every 0.1
 * class — nothing here may skip (spec/README — CI watches skip counts).
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, test } from "vitest";

import { scan } from "../src/core/bundle";
import { canonicalJsonl, type JsonValue } from "../src/core/canonical";
import { checkFresh, runCompile } from "../src/compile/pipeline";
import type { SkillsArtifact } from "../src/compile/skills";
import { loadConfig } from "../src/config";
import { buildDocsRecords, renderReportBlock, type DocRecord, type Graph } from "../src/compile/t1";
import { buildChunks } from "../src/compile/t2";
import { Brain, BrainSet } from "../src/federation";
import { searchPayload } from "../src/mcp";
import { graphSearch, loadKg } from "../src/kg";
import { search, type SearchHit } from "../src/query/keyword";
import { runSearch } from "../src/query/router";
import { semanticSearch } from "../src/query/vectors";
import { cleanup, copyBundle, EXPECTED, SCENARIOS, SPEC, stageT3Export } from "./helpers";

afterEach(cleanup);

const SENTINEL_TIME = "1970-01-01T00:00:00Z";
const MOCK_CONFIG = '[models.embedding]\nkind = "mock"\n'; // the spec/30 conformance embedder

interface ConformanceCase {
  id: string;
  class: string;
  bundle: string;
  artifacts?: string[];
  artifact?: string;
  mutate?: string;
  query?: string;
  mode?: string;
  embedder?: string;
  limit?: number;
  expect_paths?: string[];
  scenario?: string;
  op?: string;
  doc?: string;
  depth?: number;
  brains?: Record<string, string>;
  embed?: string[];
  expect_order?: boolean;
  scope?: string;
  half_life?: { default?: number; folders?: Record<string, number> };
  now?: string;
}

const CASES = (
  parseYaml(readFileSync(join(SPEC, "conformance", "cases.yaml"), "utf8")) as { cases: ConformanceCase[] }
).cases;

function normalizedManifest(text: string): Record<string, unknown> {
  const m = JSON.parse(text) as Record<string, unknown>;
  m["compiled_at"] = SENTINEL_TIME;
  delete m["generator"];
  return m;
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    out[abs.slice(root.length + 1)] = readFileSync(abs).toString("base64");
  }
  return out;
}

/** The full T2 path: compile with the mock embedder, then route the search
 * (the twin of the Python harness's `_mock_query_hits`). */
async function mockQueryHits(root: string, c: ConformanceCase): Promise<SearchHit[]> {
  writeFileSync(join(root, "brainpick.toml"), MOCK_CONFIG, "utf8");
  await runCompile(root);
  const bp = join(root, ".brainpick");
  const records = readFileSync(join(bp, "t1", "docs.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as DocRecord);
  const tiers = (
    JSON.parse(readFileSync(join(bp, "manifest.json"), "utf8")) as { tiers: Record<string, string> }
  ).tiers;
  expect(tiers["t2"]).toBe("fresh");
  const body = await runSearch(records, tiers, c.query!, c.mode, c.limit!, (q, k) =>
    semanticSearch(bp, records, q, k),
  );
  expect(body.degraded_from).toBeNull(); // the mock path must never fall back
  return body.hits;
}

describe("conformance", () => {
  for (const c of CASES) {
    switch (c.class) {
      case "compile":
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          await runCompile(root);
          for (const artifact of c.artifacts!) {
            const actual = readFileSync(join(root, artifact), "utf8");
            const expected = readFileSync(join(EXPECTED, c.bundle, artifact), "utf8");
            if (artifact.endsWith("manifest.json")) {
              expect(normalizedManifest(actual), artifact).toEqual(normalizedManifest(expected));
            } else {
              expect(actual, `${artifact} drifted from golden`).toBe(expected);
            }
          }
        });
        break;

      case "compile-idempotent":
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          const first = await runCompile(root);
          const before = snapshot(root);
          const second = await runCompile(root);
          expect(first.changed).toBe(true);
          expect(second.changed).toBe(false);
          expect(second.seq).toBe(first.seq);
          expect(snapshot(root)).toEqual(before);
        });
        break;

      case "check-fresh":
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          await runCompile(root);
          expect(checkFresh(root).fresh).toBe(true);
          const target = join(root, c.mutate!);
          writeFileSync(target, readFileSync(target, "utf8") + "\nMutation.\n", "utf8");
          expect(checkFresh(root).fresh).toBe(false);
        });
        break;

      case "chunks":
        test(c.id, () => {
          const root = copyBundle(c.bundle);
          const actual = canonicalJsonl(
            buildChunks(buildDocsRecords(scan(root))) as unknown as JsonValue[],
          );
          const expected = readFileSync(join(EXPECTED, c.bundle, c.artifact!), "utf8");
          expect(actual, `${c.artifact} drifted from golden`).toBe(expected);
        });
        break;

      case "query":
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          let hits: SearchHit[];
          if (c.embedder === "mock") {
            hits = await mockQueryHits(root, c);
          } else {
            const config = loadConfig(root); // honour [bundle] exclude (a brain's raw/)
            const records = buildDocsRecords(scan(root, config.bundle.include, config.bundle.exclude));
            if (c.half_life) {
              // spec/50 Half-life: the case carries its config and clock
              const halfLife = { default: c.half_life.default ?? 0, folders: { ...(c.half_life.folders ?? {}) } };
              hits = (
                await runSearch(records, {}, c.query!, c.mode, c.limit!, null, null, null, {
                  halfLife,
                  now: new Date(c.now!),
                })
              ).hits;
            } else {
              hits = search(records, c.query!, c.limit!);
            }
          }
          if (c.expect_order) expect(hits.map((h) => h.path)).toEqual(c.expect_paths!);
          else expect(new Set(hits.map((h) => h.path))).toEqual(new Set(c.expect_paths!));
        });
        break;

      case "report":
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          await runCompile(root);
          const bp = join(root, ".brainpick");
          const graph = JSON.parse(readFileSync(join(bp, "t1", "graph.json"), "utf8")) as Graph;
          const tiers = (
            JSON.parse(readFileSync(join(bp, "manifest.json"), "utf8")) as { tiers: Record<string, string> }
          ).tiers;
          const skills = JSON.parse(readFileSync(join(bp, "t1", "skills.json"), "utf8")) as SkillsArtifact;
          const actual = renderReportBlock(graph, tiers, ".", null, skills) + "\n";
          const expected = readFileSync(join(EXPECTED, c.bundle, c.artifact!), "utf8");
          expect(actual, `${c.artifact} drifted from golden`).toBe(expected);
        });
        break;

      case "kg-algorithmic":
        // The algorithmic T3 backend is byte-golden (spec/40): a default compile
        // (graph = "algorithmic") derives the export deterministically from ghosts
        // and tags — natively in THIS engine, no delegation — and must match the
        // Python-regenerated golden byte for byte.
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          await runCompile(root);
          for (const artifact of c.artifacts!) {
            const actual = readFileSync(join(root, artifact), "utf8");
            const expected = readFileSync(join(EXPECTED, c.bundle, artifact), "utf8");
            expect(actual, `${artifact} drifted from golden`).toBe(expected);
          }
        });
        break;

      case "similarity-gaps":
        // spec/45: T2 vectors (mock embedder) joined against T1's link graph is
        // fully deterministic, so — like kg-algorithmic — the artifact is held
        // to a byte-golden standard, not just a result-set comparison.
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          writeFileSync(join(root, "brainpick.toml"), MOCK_CONFIG, "utf8");
          await runCompile(root);
          const actual = readFileSync(join(root, c.artifact!), "utf8");
          const expected = readFileSync(join(EXPECTED, c.bundle, c.artifact!), "utf8");
          expect(actual, `${c.artifact} drifted from golden`).toBe(expected);
        });
        break;

      case "kg-query":
        // T3 consumer over the staged export — the normative reader only, never
        // an extractor (spec/40). Asserts the returned document SET.
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          await runCompile(root);
          stageT3Export(root, c.bundle);
          const bp = join(root, ".brainpick");
          const kg = loadKg(bp);
          expect(kg, "the staged export must load — kg-query has nothing to test otherwise").not.toBeNull();
          const records = readFileSync(join(bp, "t1", "docs.jsonl"), "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as DocRecord);

          let got: Set<string>;
          if (c.op === "search") {
            got = new Set(graphSearch(kg!, records, c.query!, c.limit).map((h) => h.path));
          } else if (c.op === "neighbors") {
            const [nodes] = kg!.neighborEntities(c.doc!, c.depth ?? 1);
            got = new Set(nodes.flatMap((node) => node.source_docs));
          } else {
            throw new Error(`unknown kg-query op ${c.op}`);
          }
          expect(got).toEqual(new Set(c.expect_paths!));
        });
        break;

      case "delta":
        test(c.id, async () => {
          const root = copyBundle(c.bundle);
          await runCompile(root);

          const scenario = join(SCENARIOS, c.scenario!);
          const steps = (
            parseYaml(readFileSync(join(scenario, "steps.yaml"), "utf8")) as {
              steps: Array<{ id: string; action: string; path: string; content?: string }>;
            }
          ).steps;
          const expectedLines = readFileSync(join(scenario, "expected-deltas.jsonl"), "utf8")
            .split("\n")
            .filter((line) => line !== "");
          expect(expectedLines).toHaveLength(steps.length);

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i]!;
            if (step.action === "write") writeFileSync(join(root, step.path), step.content!, "utf8");
            else if (step.action === "delete") unlinkSync(join(root, step.path));
            else throw new Error(`unknown action ${step.action}`);
            const result = await runCompile(root);
            expect(result.delta, step.id).toEqual(JSON.parse(expectedLines[i]!));
          }
        });
        break;

      case "federated-query":
        // spec/75: each listed bundle is its own brain; brain_search fans out, merges
        // and qualifies — the SET of alias:path hits is what both engines must agree on
        test(c.id, async () => {
          const brains = Object.entries(c.brains!).map(
            ([alias, bundle]) => new Brain({ alias, root: copyBundle(bundle) }),
          );
          for (const brain of brains) {
            if ((c.embed ?? []).includes(brain.alias)) writeFileSync(join(brain.root, "brainpick.toml"), MOCK_CONFIG, "utf8");
          }
          const body = await searchPayload(new BrainSet(brains), c.query!, c.mode, c.limit, null, c.scope ?? "all");
          const hits = body["hits"] as Array<{ path: string; brain: string }>;
          const paths = hits.map((h) => h.path);
          if (c.expect_order) expect(paths).toEqual(c.expect_paths); // the rank merge is deterministic (spec/75)
          else expect(new Set(paths)).toEqual(new Set(c.expect_paths));
          for (const hit of hits) expect(hit.path.startsWith(hit.brain + ":")).toBe(true);
        });
        break;

      default:
        // spec drift must fail loudly, never skip — this engine claims every class
        test(c.id, () => {
          throw new Error(`conformance class "${c.class}" is not implemented by the node engine`);
        });
    }
  }
});
