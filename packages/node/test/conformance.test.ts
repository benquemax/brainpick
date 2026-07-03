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
import { buildDocsRecords, type DocRecord } from "../src/compile/t1";
import { buildChunks } from "../src/compile/t2";
import { search, type SearchHit } from "../src/query/keyword";
import { runSearch } from "../src/query/router";
import { semanticSearch } from "../src/query/vectors";
import { cleanup, copyBundle, EXPECTED, SCENARIOS, SPEC } from "./helpers";

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
            const records = buildDocsRecords(scan(root));
            hits = search(records, c.query!, c.limit!);
          }
          expect(new Set(hits.map((h) => h.path))).toEqual(new Set(c.expect_paths!));
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

      default:
        // spec drift must fail loudly, never skip — this engine claims every class
        test(c.id, () => {
          throw new Error(`conformance class "${c.class}" is not implemented by the node engine`);
        });
    }
  }
});
