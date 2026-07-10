import { describe, expect, test } from "vitest";

import {
  currentPlatformKey,
  isForeignOnnxArchDir,
  isForeignOnnxPlatformDir,
  nodeArchiveFilename,
  nodeDownloadUrl,
  nodeExecutablePath,
  resolveTarget,
  shouldPruneOnnxProvider,
} from "../scripts/stage-lib.mjs";

describe("resolveTarget", () => {
  test("resolves the three supported targets with their archive shape", () => {
    expect(resolveTarget("linux-x64")).toMatchObject({
      key: "linux-x64",
      nodeDist: "linux-x64",
      archiveExt: "tar.xz",
      exeRelPath: ["bin", "node"],
    });
    expect(resolveTarget("darwin-arm64")).toMatchObject({
      key: "darwin-arm64",
      nodeDist: "darwin-arm64",
      archiveExt: "tar.gz",
      exeRelPath: ["bin", "node"],
    });
    expect(resolveTarget("win-x64")).toMatchObject({
      key: "win-x64",
      nodeDist: "win-x64",
      archiveExt: "zip",
      exeRelPath: ["node.exe"], // flat layout — no bin/ subdir, unlike unix
    });
  });

  test("rejects an unknown target with the valid choices in the message", () => {
    expect(() => resolveTarget("freebsd-x64")).toThrow(/linux-x64.*darwin-arm64.*win-x64/s);
  });

  test("defaults to the current host platform when no target is given", () => {
    const target = resolveTarget(undefined);
    expect(target.key).toBe(currentPlatformKey());
  });
});

describe("nodeArchiveFilename / nodeDownloadUrl", () => {
  test("builds the exact nodejs.org dist filenames", () => {
    expect(nodeArchiveFilename(resolveTarget("linux-x64"))).toMatch(/^node-v\d+\.\d+\.\d+-linux-x64\.tar\.xz$/);
    expect(nodeArchiveFilename(resolveTarget("darwin-arm64"))).toMatch(/^node-v\d+\.\d+\.\d+-darwin-arm64\.tar\.gz$/);
    expect(nodeArchiveFilename(resolveTarget("win-x64"))).toMatch(/^node-v\d+\.\d+\.\d+-win-x64\.zip$/);
  });

  test("the download URL is nodejs.org's dist tree, versioned", () => {
    const target = resolveTarget("linux-x64");
    const url = nodeDownloadUrl(target);
    expect(url).toMatch(/^https:\/\/nodejs\.org\/dist\/v\d+\.\d+\.\d+\/node-v\d+\.\d+\.\d+-linux-x64\.tar\.xz$/);
  });
});

describe("nodeExecutablePath", () => {
  test("unix targets nest under bin/", () => {
    expect(nodeExecutablePath("/out/node", resolveTarget("linux-x64"))).toBe("/out/node/bin/node");
    expect(nodeExecutablePath("/out/node", resolveTarget("darwin-arm64"))).toBe("/out/node/bin/node");
  });

  test("windows is flat — node.exe directly, no bin/ (the layout bug this chunk fixes)", () => {
    expect(nodeExecutablePath("/out/node", resolveTarget("win-x64"))).toBe("/out/node/node.exe");
  });
});

describe("onnxruntime-node bloat pruning — CUDA/TensorRT are datacenter GPU providers", () => {
  test("prunes the CUDA and TensorRT provider libraries (500MB+ we never use)", () => {
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_cuda.so")).toBe(true);
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_tensorrt.so")).toBe(true);
  });

  test("keeps the core runtime and the shared provider glue", () => {
    expect(shouldPruneOnnxProvider("libonnxruntime.so.1.19.2")).toBe(false);
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_shared.so")).toBe(false);
    expect(shouldPruneOnnxProvider("onnxruntime_binding.node")).toBe(false);
  });
});

describe("onnxruntime-node cross-platform dir pruning (bin/napi-v3/<platform>/<arch>)", () => {
  test("a platform dir foreign to the target is prunable", () => {
    const target = resolveTarget("linux-x64");
    expect(isForeignOnnxPlatformDir("darwin", target)).toBe(true);
    expect(isForeignOnnxPlatformDir("win32", target)).toBe(true);
    expect(isForeignOnnxPlatformDir("linux", target)).toBe(false);
  });

  test("an arch dir foreign to the target is prunable", () => {
    const target = resolveTarget("linux-x64");
    expect(isForeignOnnxArchDir("arm64", target)).toBe(true);
    expect(isForeignOnnxArchDir("x64", target)).toBe(false);
  });

  test("darwin-arm64 keeps arm64, not x64", () => {
    const target = resolveTarget("darwin-arm64");
    expect(isForeignOnnxArchDir("x64", target)).toBe(true);
    expect(isForeignOnnxArchDir("arm64", target)).toBe(false);
  });
});
