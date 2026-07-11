import { describe, expect, test } from "vitest";

import {
  currentPlatformKey,
  isForeignOnnxArchDir,
  isForeignOnnxPlatformDir,
  isNapiVersionDir,
  needsShellForNpm,
  nodeArchiveFilename,
  nodeDownloadUrl,
  nodeExecutablePath,
  npmCommand,
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

describe("npmCommand — the Windows spawn gotcha (npm is a .cmd shim there, not an exe)", () => {
  test("win32 needs the .cmd suffix — execFileSync/spawnSync can't find bare 'npm'", () => {
    expect(npmCommand("win32")).toBe("npm.cmd");
  });

  test("unix platforms use the plain binary", () => {
    expect(npmCommand("linux")).toBe("npm");
    expect(npmCommand("darwin")).toBe("npm");
  });

  test("defaults to the current host platform when none is given", () => {
    expect(npmCommand()).toBe(process.platform === "win32" ? "npm.cmd" : "npm");
  });
});

describe("needsShellForNpm — SECOND FLIGHT's Windows wall (CVE-2024-27980)", () => {
  test("win32 needs a shell — Node refuses spawnSync of a .cmd/.bat without one (EINVAL)", () => {
    expect(needsShellForNpm("win32")).toBe(true);
  });

  test("unix platforms never need a shell for a plain binary", () => {
    expect(needsShellForNpm("linux")).toBe(false);
    expect(needsShellForNpm("darwin")).toBe(false);
  });

  test("defaults to the current host platform when none is given", () => {
    expect(needsShellForNpm()).toBe(process.platform === "win32");
  });
});

describe("onnxruntime-node bloat pruning — any GPU provider beyond the shared glue", () => {
  test("prunes the CUDA and TensorRT provider libraries (500MB+ we never use)", () => {
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_cuda.so")).toBe(true);
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_tensorrt.so")).toBe(true);
  });

  test("keeps the core runtime and the shared provider glue", () => {
    expect(shouldPruneOnnxProvider("libonnxruntime.so.1.19.2")).toBe(false);
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_shared.so")).toBe(false);
    expect(shouldPruneOnnxProvider("onnxruntime_binding.node")).toBe(false);
  });

  // THIRD FLIGHT: linuxdeploy died on a provider this repo's old cuda|tensorrt
  // allowlist-style regex never named (any future/other accelerator — ROCm,
  // DirectML, CoreML, QNN…) — prune is now a denylist of exactly "shared",
  // across every platform's native-lib extension, not an allowlist of two.
  test("prunes ANY other GPU/accelerator provider, not just cuda/tensorrt", () => {
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_rocm.so")).toBe(true);
    expect(shouldPruneOnnxProvider("onnxruntime_providers_dml.dll")).toBe(true);
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_coreml.dylib")).toBe(true);
  });

  test("keeps the shared provider glue on every extension", () => {
    expect(shouldPruneOnnxProvider("onnxruntime_providers_shared.dll")).toBe(false);
    expect(shouldPruneOnnxProvider("libonnxruntime_providers_shared.dylib")).toBe(false);
  });
});

describe("isNapiVersionDir — THIRD FLIGHT's real Ubuntu root cause", () => {
  // linuxdeploy died on .../onnxruntime-node/bin/napi-v6/linux/x64/
  // libonnxruntime_providers_tensorrt.so — the prune's OWN napi dir lookup
  // was hardcoded to "napi-v3" (this repo's top-level copy), so it silently
  // no-op'd on any nested copy shipping a different N-API version (packages/
  // node's own @huggingface/transformers pins onnxruntime-node 1.24.3, which
  // ships napi-v6 — a real, already-nested nested nested copy, not a fixture).
  test("matches any napi-vN dir, not a hardcoded version", () => {
    expect(isNapiVersionDir("napi-v3")).toBe(true);
    expect(isNapiVersionDir("napi-v6")).toBe(true);
    expect(isNapiVersionDir("napi-v12")).toBe(true);
  });

  test("rejects anything that isn't a napi-vN dir", () => {
    expect(isNapiVersionDir("linux")).toBe(false);
    expect(isNapiVersionDir("napi")).toBe(false);
    expect(isNapiVersionDir("napi-v")).toBe(false);
    expect(isNapiVersionDir("napi-v3-extra")).toBe(false);
  });
});

describe("onnxruntime-node cross-platform dir pruning (bin/napi-vN/<platform>/<arch>)", () => {
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
