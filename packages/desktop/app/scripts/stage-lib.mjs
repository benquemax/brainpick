/** Pure, no-I/O logic for stage-resources.mjs — the platform table and the
 * pruning decisions — kept separate from the actual download/npm-install/fs
 * work so it can be unit tested without touching the network or disk.
 *
 * Pinned Node runtime (Packaging appendix, _plans/2026-07-09-…): a fixed LTS
 * version, not "current", so a staged bundle is reproducible across runs and
 * matches this repo's own `engines.node: ">=20"` floor.
 */
import { join } from "node:path";

export const NODE_VERSION = "20.20.2";

const PLATFORMS = {
  "linux-x64": { nodeDist: "linux-x64", archiveExt: "tar.xz", exeRelPath: ["bin", "node"] },
  "darwin-arm64": { nodeDist: "darwin-arm64", archiveExt: "tar.gz", exeRelPath: ["bin", "node"] },
  // The official Windows zip is FLAT (node.exe at the archive root, no bin/
  // subdir) — the one layout difference the Rust resolver has to know about.
  "win-x64": { nodeDist: "win-x64", archiveExt: "zip", exeRelPath: ["node.exe"] },
};

export function currentPlatformKey() {
  const { platform, arch } = process;
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "win32" && arch === "x64") return "win-x64";
  throw new Error(
    `unsupported host platform for staging: ${platform}-${arch} — pass --target explicitly ` +
      `(one of: ${Object.keys(PLATFORMS).join(", ")})`,
  );
}

/** @param {string|undefined} name */
export function resolveTarget(name) {
  const key = name ?? currentPlatformKey();
  const entry = PLATFORMS[key];
  if (!entry) {
    throw new Error(`unknown target '${key}' — choose one of: ${Object.keys(PLATFORMS).join(", ")}`);
  }
  return { key, ...entry };
}

export function nodeArchiveFilename(target) {
  return `node-v${NODE_VERSION}-${target.nodeDist}.${target.archiveExt}`;
}

export function nodeDownloadUrl(target) {
  return `https://nodejs.org/dist/v${NODE_VERSION}/${nodeArchiveFilename(target)}`;
}

export function nodeShasumsUrl() {
  return `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`;
}

export function nodeExecutablePath(nodeOutDir, target) {
  return join(nodeOutDir, ...target.exeRelPath);
}

/** On Windows, `npm` is a `.cmd` shim, not a directly-executable binary —
 * execFileSync/spawnSync (no shell) can't find bare "npm" there (ENOENT).
 * Every unix platform runs the plain binary. */
export function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

/** onnxruntime-node ships ALL platforms' native binaries in one package
 * (unlike @lancedb, which splits per-platform via optionalDependencies) —
 * and among those, the CUDA/TensorRT execution providers are 500MB+ of
 * datacenter GPU libraries this CPU-only embedding use case never loads.
 * Confirmed empirically staging linux-x64: providers_cuda.so alone is
 * ~510MB of a ~690MB onnxruntime-node install. */
export function shouldPruneOnnxProvider(filename) {
  return /providers_(cuda|tensorrt)\.so$/i.test(filename);
}

const ONNX_PLATFORM_DIRS = { "linux-x64": "linux", "darwin-arm64": "darwin", "win-x64": "win32" };
const ONNX_ARCH_DIRS = { "linux-x64": "x64", "darwin-arm64": "arm64", "win-x64": "x64" };

/** bin/napi-v3/<platform>/<arch> — every OS's binaries ship in the same
 * package; only the target's own platform dir is ever loaded. */
export function isForeignOnnxPlatformDir(dirName, target) {
  return dirName !== ONNX_PLATFORM_DIRS[target.key];
}

export function isForeignOnnxArchDir(archDirName, target) {
  return archDirName !== ONNX_ARCH_DIRS[target.key];
}
