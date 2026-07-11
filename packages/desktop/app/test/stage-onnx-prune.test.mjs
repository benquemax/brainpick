/**
 * Chunk 1.5-E, THIRD FLIGHT (run 29143029457): the real Ubuntu failure was
 * `onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so`
 * surviving pruning — a NESTED onnxruntime-node copy at a different N-API
 * version than the top-level one (packages/node's own
 * @huggingface/transformers pins 1.24.3, which ships napi-v6) that the old
 * hardcoded "napi-v3" walk silently skipped. Reproduces that exact shape
 * against a real tmpdir tree (mirrors the Rust side's own tempfile-based
 * fake-staged-tree tests, per Chunk 1.5-A) rather than trusting the pure
 * predicates alone.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { assertOnnxPruneComplete, pruneOnnxBloat } from "../scripts/stage-resources.mjs";
import { resolveTarget } from "../scripts/stage-lib.mjs";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "brainpick-onnx-prune-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Builds one onnxruntime-node package under `pkgDir/bin/<napiDir>/<platform>/<arch>/`
 * with a core runtime file, the shared provider glue, and one GPU provider —
 * the same shape at ANY napi version, since that's exactly the variable the
 * real bug hinged on. */
function seedOnnxPackage(pkgDir, napiDir, platform, arch) {
  const leaf = join(pkgDir, "bin", napiDir, platform, arch);
  mkdirSync(leaf, { recursive: true });
  writeFileSync(join(leaf, "libonnxruntime.so.1.19.2"), "core");
  writeFileSync(join(leaf, "libonnxruntime_providers_shared.so"), "shared");
  writeFileSync(join(leaf, "libonnxruntime_providers_cuda.so"), "cuda");
  writeFileSync(join(leaf, "libonnxruntime_providers_tensorrt.so"), "tensorrt");
}

describe("pruneOnnxBloat + assertOnnxPruneComplete against a real staged tree", () => {
  test("prunes GPU providers and foreign platform/arch dirs from a SINGLE onnxruntime-node copy", () => {
    const target = resolveTarget("linux-x64");
    const nodeModules = join(root, "node_modules");
    const pkgDir = join(nodeModules, "onnxruntime-node");
    seedOnnxPackage(pkgDir, "napi-v3", "linux", "x64");
    seedOnnxPackage(pkgDir, "napi-v3", "linux", "arm64"); // foreign arch
    seedOnnxPackage(pkgDir, "napi-v3", "darwin", "arm64"); // foreign platform
    seedOnnxPackage(pkgDir, "napi-v3", "win32", "x64"); // foreign platform

    pruneOnnxBloat(nodeModules, target);

    expect(() => assertOnnxPruneComplete(nodeModules, target)).not.toThrow();
  });

  test("THE REAL BUG: prunes a NESTED copy at a DIFFERENT napi version — not just the hardcoded napi-v3", () => {
    const target = resolveTarget("linux-x64");
    const nodeModules = join(root, "node_modules");
    // The exact CI shape: a scoped dependency's own nested onnxruntime-node,
    // at napi-v6 — the old hardcoded walk never looked here at all.
    const nestedPkgDir = join(nodeModules, "@lancedb", "lancedb", "node_modules", "onnxruntime-node");
    seedOnnxPackage(nestedPkgDir, "napi-v6", "linux", "x64");
    seedOnnxPackage(nestedPkgDir, "napi-v6", "darwin", "arm64"); // foreign platform

    pruneOnnxBloat(nodeModules, target);

    expect(() => assertOnnxPruneComplete(nodeModules, target)).not.toThrow();
  });

  test("prunes BOTH a top-level copy and a differently-versioned nested copy in one pass", () => {
    const target = resolveTarget("linux-x64");
    const nodeModules = join(root, "node_modules");
    seedOnnxPackage(join(nodeModules, "onnxruntime-node"), "napi-v3", "darwin", "arm64");
    seedOnnxPackage(
      join(nodeModules, "@lancedb", "lancedb", "node_modules", "onnxruntime-node"),
      "napi-v6",
      "win32",
      "x64",
    );

    pruneOnnxBloat(nodeModules, target);

    expect(() => assertOnnxPruneComplete(nodeModules, target)).not.toThrow();
  });

  test("the postcondition FAILS LOUDLY if a GPU provider survives (the regression this chunk prevents)", () => {
    const target = resolveTarget("linux-x64");
    const nodeModules = join(root, "node_modules");
    // Seed the target's OWN platform/arch — pruneOnnxBloat legitimately
    // leaves the cuda/tensorrt files here since only foreign dirs and
    // provider files within kept dirs are ever inspected... so seed them
    // directly and skip pruning to simulate "prune ran but missed something".
    const leaf = join(nodeModules, "onnxruntime-node", "bin", "napi-v6", "linux", "x64");
    mkdirSync(leaf, { recursive: true });
    writeFileSync(join(leaf, "libonnxruntime_providers_tensorrt.so"), "tensorrt");

    expect(() => assertOnnxPruneComplete(nodeModules, target)).toThrow(/GPU provider lib/);
  });

  test("a clean tree with no onnxruntime-node package anywhere passes trivially", () => {
    const target = resolveTarget("linux-x64");
    const nodeModules = join(root, "node_modules");
    mkdirSync(nodeModules, { recursive: true });

    expect(() => assertOnnxPruneComplete(nodeModules, target)).not.toThrow();
  });
});
