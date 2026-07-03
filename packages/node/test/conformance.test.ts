/** The shared conformance harness — reads spec/conformance/cases.yaml.
 *
 * The twin of packages/python/tests/test_conformance.py: every case class
 * implemented here runs against the same fixtures and goldens; classes this
 * engine does not implement yet are skipped VISIBLY (spec/README — CI
 * watches skip counts).
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, test } from "vitest";

import { scan } from "../src/core/bundle";
import { checkFresh, runCompile } from "../src/compile/pipeline";
import { buildDocsRecords } from "../src/compile/t1";
import { search } from "../src/query/keyword";
import { cleanup, copyBundle, EXPECTED, SCENARIOS, SPEC } from "./helpers";

afterEach(cleanup);

const SENTINEL_TIME = "1970-01-01T00:00:00Z";

interface ConformanceCase {
  id: string;
  class: string;
  bundle: string;
  artifacts?: string[];
  mutate?: string;
  query?: string;
  mode?: string;
  limit?: number;
  expect_paths?: string[];
  scenario?: string;
}

const CASES = (
  parseYaml(readFileSync(join(SPEC, "conformance", "cases.yaml"), "utf8")) as { cases: ConformanceCase[] }
).cases;

const IMPLEMENTED_CLASSES = new Set(["compile", "compile-idempotent", "check-fresh", "query", "delta"]);
const IMPLEMENTED_QUERY_MODES = new Set(["keyword"]);

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

describe("conformance", () => {
  for (const c of CASES) {
    if (!IMPLEMENTED_CLASSES.has(c.class)) {
      test.skip(`${c.id} [class "${c.class}" not implemented by the node engine]`, () => {});
      continue;
    }

    switch (c.class) {
      case "compile":
        test(c.id, () => {
          const root = copyBundle(c.bundle);
          runCompile(root);
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
        test(c.id, () => {
          const root = copyBundle(c.bundle);
          const first = runCompile(root);
          const before = snapshot(root);
          const second = runCompile(root);
          expect(first.changed).toBe(true);
          expect(second.changed).toBe(false);
          expect(second.seq).toBe(first.seq);
          expect(snapshot(root)).toEqual(before);
        });
        break;

      case "check-fresh":
        test(c.id, () => {
          const root = copyBundle(c.bundle);
          runCompile(root);
          expect(checkFresh(root).fresh).toBe(true);
          const target = join(root, c.mutate!);
          writeFileSync(target, readFileSync(target, "utf8") + "\nMutation.\n", "utf8");
          expect(checkFresh(root).fresh).toBe(false);
        });
        break;

      case "query": {
        if (!IMPLEMENTED_QUERY_MODES.has(c.mode ?? "")) {
          test.skip(`${c.id} [query mode "${c.mode}" not implemented by the node engine]`, () => {});
          break;
        }
        test(c.id, () => {
          const root = copyBundle(c.bundle);
          const records = buildDocsRecords(scan(root));
          const hits = search(records, c.query!, c.limit!);
          expect(new Set(hits.map((h) => h.path))).toEqual(new Set(c.expect_paths!));
        });
        break;
      }

      case "delta":
        test(c.id, () => {
          const root = copyBundle(c.bundle);
          runCompile(root);

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
            const result = runCompile(root);
            expect(result.delta, step.id).toEqual(JSON.parse(expectedLines[i]!));
          }
        });
        break;
    }
  }
});
