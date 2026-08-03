/** Similarity gaps in the compile pipeline (spec/45): gating, artifact
 * placement, and that it never blocks compile — twin of
 * packages/python/tests/test_similarity_gaps_stage.py. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { lancedbAvailable } from "../src/vectorstore";
import { cleanup, copyBundle } from "./helpers";

afterEach(cleanup);

const MOCK_CONFIG = '[models.embedding]\nkind = "mock"\n';

function withMockConfig(root: string): string {
  writeFileSync(join(root, "brainpick.toml"), MOCK_CONFIG, "utf8");
  return root;
}

const available = await lancedbAvailable();

describe.skipIf(!available)("similarity gaps in the pipeline", () => {
  test("artifact appears once T2 is fresh", async () => {
    const root = withMockConfig(copyBundle());
    await runCompile(root);
    const artifact = join(root, ".brainpick", "t1", "similarity-gaps.json");
    expect(existsSync(artifact)).toBe(true);
    const data = JSON.parse(readFileSync(artifact, "utf8"));
    expect(data.threshold).toBe(0.75);
    expect(data.max_pairs).toBe(50);
    // aurinko.md/maa.md: the highest similarity in the bundle, no direct edge
    // between them — the natural gap this fixture was chosen to exercise
    // (see spec/conformance/cases.yaml, and the Python twin test).
    expect(data.pairs.some((p: { a: string; b: string }) => p.a === "aurinko.md" && p.b === "maa.md")).toBe(true);
  });

  test("absent when T2 is off", async () => {
    const root = copyBundle(); // no mock config — T2 stays off by default
    await runCompile(root);
    expect(existsSync(join(root, ".brainpick", "t1", "similarity-gaps.json"))).toBe(false);
  });

  test("off by explicit config", async () => {
    const root = copyBundle();
    writeFileSync(join(root, "brainpick.toml"), MOCK_CONFIG + '[modules]\nsimilarity_gaps = "off"\n', "utf8");
    await runCompile(root);
    expect(existsSync(join(root, ".brainpick", "t1", "similarity-gaps.json"))).toBe(false);
  });

  test("never tracked as a manifest tier", async () => {
    const root = withMockConfig(copyBundle());
    await runCompile(root);
    const manifest = JSON.parse(readFileSync(join(root, ".brainpick", "manifest.json"), "utf8"));
    expect(Object.keys(manifest.tiers).sort()).toEqual(["t1", "t2", "t3"]); // advisory, like timeline.json
  });
});
