/** The compile pipeline (spec/10): scan → T1 → artifacts, hash-incremental,
 * byte-stable on no-ops, delta-emitting on change. */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { scan, type Document } from "../core/bundle";
import { canonicalJson, canonicalJsonl, cmpStr, type JsonValue } from "../core/canonical";
import { deepEqual, diffGraphs, type GraphDelta } from "../deltas";
import { SPEC_VERSION, VERSION } from "../version";
import { applyIndexSection, buildDocsRecords, buildGraph, renderIndexBlock, type GraphStats } from "./t1";

export const INDEX_FILE = "index.md";

export interface CompileResult {
  changed: boolean;
  seq: number;
  stats: GraphStats;
  delta: GraphDelta | null;
  /** Advisory lines the CLI relays (the Python engine uses these for T2
   * degradation notices). Always empty in 0.1 chunk 1 — no T2 module yet. */
  warnings: string[];
}

export interface Freshness {
  fresh: boolean;
  reason: string;
}

interface ManifestFileEntry {
  bytes: number;
  sha256: string;
}

/** (what index.md should contain, what it contains now). */
function prospectiveIndex(root: string, docs: Document[]): [string, string | null] {
  const block = renderIndexBlock(docs);
  const disk = readTextOrNull(join(root, INDEX_FILE));
  return [applyIndexSection(disk, block), disk];
}

function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.bp-tmp-${randomBytes(8).toString("hex")}`);
  try {
    writeFileSync(tmp, data, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw err;
  }
}

/** Python's `Path.read_text(encoding="utf-8")` — including text mode's
 * universal-newline translation, which the byte comparisons depend on. */
function readTextOrNull(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function runCompile(root: string, full = false): CompileResult {
  const bp = join(root, ".brainpick");

  let docs = scan(root);
  const [indexText, diskIndex] = prospectiveIndex(root, docs);
  const indexChanged = indexText !== diskIndex;
  if (indexChanged) {
    atomicWrite(join(root, INDEX_FILE), indexText);
    docs = scan(root); // the bundle now includes the index as written
  }

  const graph = buildGraph(docs);
  const graphText = canonicalJson(graph as unknown as JsonValue);
  const docsText = canonicalJsonl(buildDocsRecords(docs) as unknown as JsonValue[]);

  const oldManifestText = readTextOrNull(join(bp, "manifest.json"));
  const oldManifest = oldManifestText ? (JSON.parse(oldManifestText) as Record<string, unknown>) : null;
  const oldGraphText = readTextOrNull(join(bp, "t1", "graph.json"));
  const oldTiers = (oldManifest?.["tiers"] ?? {}) as Record<string, string>;

  const t1Changed = !(
    oldManifest !== null &&
    !indexChanged &&
    oldGraphText === graphText &&
    readTextOrNull(join(bp, "t1", "docs.jsonl")) === docsText
  );

  // This engine is chunk-1 T1-only: it behaves exactly like the Python
  // engine with the vectors module off — tiers.t2 is always "off".
  const tiers = { t1: "fresh", t2: "off", t3: "off" };
  const artifactsChanged = t1Changed;
  const unchanged = !artifactsChanged && oldManifest !== null && deepEqual(oldTiers, tiers);
  if (unchanged && !full) {
    return { changed: false, seq: oldManifest!["seq"] as number, stats: graph.stats, delta: null, warnings: [] };
  }

  atomicWrite(join(bp, "t1", "graph.json"), graphText);
  atomicWrite(join(bp, "t1", "docs.jsonl"), docsText);

  // tier-status-only transitions rewrite the manifest without spending a seq
  const seq = oldManifest === null ? 1 : (oldManifest["seq"] as number) + (artifactsChanged ? 1 : 0);

  const indexDoc = docs.find((d) => d.path === INDEX_FILE);
  const files: Record<string, ManifestFileEntry> = {};
  for (const d of docs) files[d.path] = { bytes: d.size, sha256: d.sha256 };
  const manifest = {
    bundle_root: ".",
    compiled_at: utcNowSeconds(),
    files,
    generator: { impl: "node", name: "brainpick", version: VERSION },
    index_md: {
      content_hash: indexDoc ? indexDoc.sha256 : null,
      managed: "section",
    },
    seq,
    spec_version: SPEC_VERSION,
    tiers,
  };
  atomicWrite(join(bp, "manifest.json"), canonicalJson(manifest as unknown as JsonValue));

  let delta: GraphDelta | null = null;
  if (oldGraphText !== null && artifactsChanged) {
    delta = diffGraphs(JSON.parse(oldGraphText), graph);
    const oldFiles = (oldManifest?.["files"] ?? {}) as Record<string, ManifestFileEntry>;
    const changedPaths = new Set<string>();
    for (const p of [...Object.keys(oldFiles), ...Object.keys(files)]) {
      if (oldFiles[p]?.sha256 !== files[p]?.sha256) changedPaths.add(p);
    }
    delta.cause = { paths: [...changedPaths].sort(cmpStr), tier: "t1" };
    delta.seq = seq;
  }

  return { changed: !unchanged, seq, stats: graph.stats, delta, warnings: [] };
}

export function checkFresh(root: string): Freshness {
  const bp = join(root, ".brainpick");
  if (readTextOrNull(join(bp, "manifest.json")) === null) {
    return { fresh: false, reason: "never compiled — run: brainpick compile" };
  }

  const docs = scan(root);
  const [indexText, diskIndex] = prospectiveIndex(root, docs);
  if (indexText !== diskIndex) {
    return { fresh: false, reason: "stale — run: brainpick compile" };
  }

  const graphText = canonicalJson(buildGraph(docs) as unknown as JsonValue);
  const docsText = canonicalJsonl(buildDocsRecords(docs) as unknown as JsonValue[]);
  if (
    readTextOrNull(join(bp, "t1", "graph.json")) !== graphText ||
    readTextOrNull(join(bp, "t1", "docs.jsonl")) !== docsText
  ) {
    return { fresh: false, reason: "stale — run: brainpick compile" };
  }
  return { fresh: true, reason: "fresh" };
}

function utcNowSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
