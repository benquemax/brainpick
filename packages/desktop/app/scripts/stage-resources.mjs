#!/usr/bin/env node
/**
 * Assemble the resources dir the Tauri shell expects (Phase 1.5, Chunk 1.5-A,
 * _plans/2026-07-10-phase1.5-release.md): the official Node runtime plus the
 * built daemon+engine with a REAL (non-symlinked) production node_modules —
 * "no single-binary compilation, no Bun/SEA in v1" (the Packaging appendix).
 *
 *   <out>/node/{bin/node | node.exe}   — verified against nodejs.org's own
 *                                        SHASUMS256.txt, never trusted blind
 *   <out>/daemon/package.json          — packages/desktop's own (real
 *                                        version, real "dependencies")
 *   <out>/daemon/dist/                 — packages/desktop/dist, copied flat
 *   <out>/daemon/node_modules/         — `npm install --install-links` from
 *                                        package.json's own deps PLUS an
 *                                        explicit local path for `brainpick`
 *                                        (unpublished — the registry 404s on
 *                                        it, so it MUST be resolved locally)
 *
 * Rust reads `daemon/dist/cli.js` (matching a real npm package's shape, so
 * version.ts's `../package.json` lookup — the SAME trick both engines use to
 * read their own version at runtime — resolves correctly without a special
 * case) and `node/bin/node` on unix or `node/node.exe` on Windows (the one
 * layout Node's own official archives disagree on).
 *
 * Native optional deps (@lancedb, onnxruntime) install for WHATEVER platform
 * this script is actually running on — cross-staging is only real for the
 * downloaded node BINARY (an explicit URL); node_modules' native pieces can
 * only ever be correct when this script runs ON the target OS (matching the
 * CI matrix: one runner per target, each staging its own).
 *
 * Usage: node stage-resources.mjs [--target linux-x64|darwin-arm64|win-x64] [--out <dir>]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  currentPlatformKey,
  isForeignOnnxArchDir,
  isForeignOnnxPlatformDir,
  nodeArchiveFilename,
  nodeDownloadUrl,
  nodeExecutablePath,
  nodeShasumsUrl,
  resolveTarget,
  shouldPruneOnnxProvider,
} from "./stage-lib.mjs";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(APP_ROOT, "..", "..", "..");
const NODE_PKG = join(REPO_ROOT, "packages", "node");
const DESKTOP_PKG = join(REPO_ROOT, "packages", "desktop");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let target;
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") target = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
    else fail(`unknown argument: ${argv[i]}`);
  }
  return { target, out: out ?? join(APP_ROOT, "src-tauri", "resources") };
}

function verifyPrereqs() {
  const checks = [
    [join(NODE_PKG, "dist", "cli.js"), "npm run build -w packages/node"],
    [join(DESKTOP_PKG, "dist", "cli.js"), "npm run build -w packages/desktop"],
    [join(NODE_PKG, "static", "index.html"), "npm run build -w packages/webui && node scripts/sync-ui.mjs"],
  ];
  for (const [path, fix] of checks) {
    if (!existsSync(path)) fail(`missing ${path} — run first: ${fix} (from the repo root)`);
  }
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function stageNodeRuntime(target, outDir) {
  console.log(`→ node runtime (${target.key})…`);
  const archiveName = nodeArchiveFilename(target);
  const [archiveBytes, shasums] = await Promise.all([
    download(nodeDownloadUrl(target)),
    download(nodeShasumsUrl()).then((b) => b.toString("utf8")),
  ]);

  const line = shasums.split("\n").find((l) => l.trim().endsWith(archiveName));
  if (!line) fail(`SHASUMS256.txt has no entry for ${archiveName} — did the pinned version change?`);
  const expected = line.trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(archiveBytes).digest("hex");
  if (actual !== expected) {
    fail(`checksum mismatch for ${archiveName}: expected ${expected}, got ${actual} — refusing to trust it`);
  }

  const nodeOut = join(outDir, "node");
  rmSync(nodeOut, { recursive: true, force: true });
  mkdirSync(nodeOut, { recursive: true });
  const archivePath = join(outDir, archiveName);
  writeFileSync(archivePath, archiveBytes);
  execFileSync("tar", ["xf", archivePath, "-C", nodeOut, "--strip-components=1"], { stdio: "inherit" });
  rmSync(archivePath);

  const exe = nodeExecutablePath(nodeOut, target);
  if (!existsSync(exe)) fail(`expected ${exe} after extracting ${archiveName} — did the archive layout change?`);
  if (target.key !== "win-x64") execFileSync("chmod", ["+x", exe]);
  console.log(`  ✓ verified sha256, unpacked to ${exe}`);
}

function stageDaemon(outDir) {
  console.log("→ daemon (real node_modules, cli.js, engine, synced webui)…");
  const daemonOut = join(outDir, "daemon");
  rmSync(daemonOut, { recursive: true, force: true });
  mkdirSync(daemonOut, { recursive: true });

  cpSync(join(DESKTOP_PKG, "dist"), join(daemonOut, "dist"), { recursive: true });
  cpSync(join(DESKTOP_PKG, "package.json"), join(daemonOut, "package.json"));

  // package.json's own "dependencies" already names `brainpick` — but it is
  // NOT published (the registry 404s), so it must be handed the local path
  // explicitly in the SAME install call or npm has nothing else to resolve
  // it against. `--install-links` is required too: npm SYMLINKS a bare local
  // directory path by default (workspace-style), which would leak this dev
  // tree's absolute paths into the bundle instead of a real, portable copy.
  execFileSync(
    "npm",
    ["install", "--omit=dev", "--no-save", "--no-audit", "--no-fund", "--install-links", NODE_PKG],
    { cwd: daemonOut, stdio: "inherit" },
  );

  const cli = join(daemonOut, "dist", "cli.js");
  if (!existsSync(cli)) fail(`expected ${cli} after staging — did packages/desktop's package.json regress?`);
  const engine = join(daemonOut, "node_modules", "brainpick", "dist", "cli.js");
  if (!existsSync(engine)) fail(`expected ${engine} — brainpick did not resolve to the LOCAL packages/node`);
  console.log(`  ✓ ${cli}\n  ✓ ${engine}`);
}

/** onnxruntime-node bundles every OS's binaries (including 500MB+ of CUDA/
 * TensorRT datacenter GPU libraries) in one package regardless of what
 * platform actually installed it — there can be more than one copy nested
 * under different dependents (e.g. @lancedb's own pinned version), so this
 * walks the whole tree rather than assuming a single location. */
function pruneOnnxBloat(nodeModulesRoot, target) {
  if (!existsSync(nodeModulesRoot)) return;
  let prunedBytes = 0;
  const dirSize = (dir) => {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
    }
    return total;
  };
  const prune = (path) => {
    prunedBytes += statSync(path).isDirectory() ? dirSize(path) : statSync(path).size;
    rmSync(path, { recursive: true, force: true });
  };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name === "onnxruntime-node") {
        pruneOnnxRuntimeNodePackage(path);
      } else if (entry.name !== ".bin") {
        walk(path);
      }
    }
  };
  const pruneOnnxRuntimeNodePackage = (pkgDir) => {
    const napiDir = join(pkgDir, "bin", "napi-v3");
    if (!existsSync(napiDir)) return;
    for (const platformEntry of readdirSync(napiDir, { withFileTypes: true })) {
      if (!platformEntry.isDirectory()) continue;
      const platformDir = join(napiDir, platformEntry.name);
      if (isForeignOnnxPlatformDir(platformEntry.name, target)) {
        prune(platformDir);
        continue;
      }
      for (const archEntry of readdirSync(platformDir, { withFileTypes: true })) {
        if (!archEntry.isDirectory()) continue;
        const archDir = join(platformDir, archEntry.name);
        if (isForeignOnnxArchDir(archEntry.name, target)) {
          prune(archDir);
          continue;
        }
        for (const file of readdirSync(archDir)) {
          if (shouldPruneOnnxProvider(file)) prune(join(archDir, file));
        }
      }
    }
  };
  walk(nodeModulesRoot);
  if (prunedBytes > 0) {
    console.log(`  ✓ pruned ${(prunedBytes / 1024 / 1024).toFixed(0)} MB of unused onnxruntime-node platforms/providers`);
  }
}

function dirSizeMb(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isSymbolicLink()) continue;
      total += entry.isDirectory() ? 0 : statSync(path).size;
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(dir);
  return total / 1024 / 1024;
}

function printSizeSummary(outDir) {
  console.log("\nSize summary:");
  let grandTotal = 0;
  for (const name of ["node", "daemon"]) {
    const mb = dirSizeMb(join(outDir, name));
    grandTotal += mb;
    console.log(`  ${name.padEnd(8)} ${mb.toFixed(1).padStart(8)} MB`);
  }
  console.log(`  ${"total".padEnd(8)} ${grandTotal.toFixed(1).padStart(8)} MB`);
}

async function main() {
  const { target: targetName, out } = parseArgs(process.argv.slice(2));
  const target = resolveTarget(targetName);
  if (target.key !== currentPlatformKey()) {
    console.warn(
      `⚠ staging for ${target.key} while running on ${currentPlatformKey()} — the node BINARY will be ` +
        `correct, but node_modules' native optional deps (@lancedb, onnxruntime) can only ever match the ` +
        `HOST platform. Real cross-target resources require running this script ON ${target.key} (the CI matrix does).`,
    );
  }

  verifyPrereqs();
  mkdirSync(out, { recursive: true });
  await stageNodeRuntime(target, out);
  stageDaemon(out);
  pruneOnnxBloat(join(out, "daemon", "node_modules"), target);
  printSizeSummary(out);
  console.log(`\n✓ resources staged at ${out}`);
}

main().catch((error) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)));
