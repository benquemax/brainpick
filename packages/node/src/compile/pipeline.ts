/** The compile pipeline (spec/10): scan → T1 → T2 → artifacts, hash-incremental,
 * byte-stable on no-ops, delta-emitting on change. */
import { existsSync, unlinkSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { loadConfig, resolveGraphBackend, type Config } from "../config";
import { scan, type Document } from "../core/bundle";
import { canonicalJson, canonicalJsonl, cmpStr, type JsonValue } from "../core/canonical";
import { atomicWrite, readTextOrNull } from "../core/fs";
import { deepEqual, diffGraphs, type GraphDelta } from "../deltas";
import { findRepoRoot } from "../detect";
import { buildTimeline } from "../timeline";
import { SPEC_VERSION, VERSION } from "../version";
import { runSimilarityGapsStage, similarityGapsGate } from "./similarity-gaps";
import {
  applyIndexSection,
  applyReportSection,
  buildDocsRecords,
  buildGraph,
  renderIndexBlock,
  renderReportBlock,
  type DocRecord,
  type Graph,
  type GraphStats,
} from "./t1";
import { runT2Stage, t2Gate } from "./t2";
import { runT3AlgorithmicStage } from "./t3";

export const INDEX_FILE = "index.md";

export type Tier = "t1" | "t2" | "t3";

export interface CompileResult {
  changed: boolean;
  seq: number;
  stats: GraphStats;
  delta: GraphDelta | null;
  /** Advisory lines the CLI relays — T2 degradation notices and enabling
   * instructions (spec/30). */
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

function generator(): { impl: string; name: string; version: string } {
  return { impl: "node", name: "brainpick", version: VERSION };
}

/** The report reads whatever is currently on disk (spec/45) — null (the
 * section is omitted) when the artifact doesn't exist, its `pairs` list
 * otherwise, even an empty one. */
function similarityGapsForReport(bp: string): Array<{ a: string; b: string; score: number }> | null {
  const text = readTextOrNull(join(bp, "t1", "similarity-gaps.json"));
  if (text === null) return null;
  return (JSON.parse(text) as { pairs: Array<{ a: string; b: string; score: number }> }).pairs;
}

/** Refresh the opt-in AGENTS.md brain report (spec/20) wherever its markers
 * already live — the bundle root, and the repo root above it when the bundle is
 * a subdir. Never creates the file; writes only when the block actually changed. */
function refreshReport(root: string, bp: string, graph: Graph, tiers: Record<string, unknown>): void {
  const bundleRoot = resolve(root);
  const candidates = [bundleRoot];
  const repo = findRepoRoot(bundleRoot);
  if (repo !== null && repo !== bundleRoot) candidates.push(repo);

  const similarityGaps = similarityGapsForReport(bp);
  const seen = new Set<string>();
  for (const base of candidates) {
    const agents = join(base, "AGENTS.md");
    if (seen.has(agents)) continue;
    seen.add(agents);
    const existing = readTextOrNull(agents);
    if (existing === null) continue;
    const bundleDisplay = (relative(base, bundleRoot) || ".").split(sep).join("/");
    const block = renderReportBlock(graph, tiers, bundleDisplay, similarityGaps);
    const updated = applyReportSection(existing, block);
    if (updated !== null && updated !== existing) atomicWrite(agents, updated);
  }
}

/** Advisory T1 artifact (spec/90): the bundle's git history distilled for the
 * Time Machine. A git failure skips the file — it never blocks T1, and it is not
 * tracked as a normative manifest tier hash (git state is external). */
function writeTimeline(root: string, config: Config): void {
  const repoRoot = findRepoRoot(resolve(root));
  const timeline = buildTimeline(root, repoRoot, config.bundle.include, config.bundle.exclude);
  if (timeline === null) return; // non-git bundle or unreadable history — the feature hides
  atomicWrite(join(root, ".brainpick", "t1", "timeline.json"), canonicalJson(timeline as unknown as JsonValue));
}

export async function runCompile(
  root: string,
  full = false,
  only: readonly Tier[] | null = null,
  config: Config | null = null,
): Promise<CompileResult> {
  const bp = join(root, ".brainpick");
  const cfg = config ?? loadConfig(root);
  const wanted = new Set<Tier>(only ?? ["t1", "t2", "t3"]);
  if (wanted.size === 1 && wanted.has("t2")) return compileT2Only(bp, cfg);
  if (wanted.size === 1 && wanted.has("t3")) return compileT3Only(bp, cfg);

  const warnings: string[] = [];
  let docs = scan(root);
  const [indexText, diskIndex] = prospectiveIndex(root, docs);
  const indexChanged = indexText !== diskIndex;
  if (indexChanged) {
    atomicWrite(join(root, INDEX_FILE), indexText);
    docs = scan(root); // the bundle now includes the index as written
  }

  const graph = buildGraph(docs);
  const graphText = canonicalJson(graph as unknown as JsonValue);
  const records = buildDocsRecords(docs);
  const docsText = canonicalJsonl(records as unknown as JsonValue[]);

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

  // T2 (spec/30): gated by [modules] vectors; failures degrade the tier, never the compile.
  const [enabled, instruction] = await t2Gate(cfg);
  let t2Status: string;
  let t2Changed: boolean;
  if (!wanted.has("t2")) {
    t2Changed = false;
    if (!enabled) t2Status = "off";
    else if (!t1Changed && oldTiers["t2"] === "fresh") t2Status = "fresh";
    else t2Status = "stale"; // --only t1 skipped T2 while its inputs moved
  } else if (enabled) {
    const outcome = await runT2Stage(bp, records, cfg.models.embedding, full);
    t2Status = outcome.status;
    t2Changed = outcome.changed;
    if (outcome.warning) warnings.push(outcome.warning);
  } else {
    t2Status = "off";
    t2Changed = false;
    if (instruction && oldTiers["t2"] !== "off") {
      warnings.push(instruction); // said once: the next manifest records t2 = off
    }
  }

  // Similarity gaps (spec/45): advisory, like timeline.json — rides T2's
  // freshness, never blocks compile, not tracked as a manifest tier. Skipped
  // entirely on --only compiles (mirrors writeTimeline's own scope).
  if (wanted.size === 3) {
    const [sgEnabled] = similarityGapsGate(cfg, t2Status);
    if (sgEnabled) {
      try {
        await runSimilarityGapsStage(bp, root, graph, records, cfg);
      } catch (error) {
        // never let a gap-detector surprise break compile
        console.warn(`similarity-gaps: skipped (${(error as Error).message})`);
      }
    } else {
      const gapsFile = join(bp, "t1", "similarity-gaps.json");
      if (existsSync(gapsFile)) unlinkSync(gapsFile); // off/no-longer-fresh — absence is honest
    }
  }

  // T3 (spec/40): runs last, never blocks T1/T2. The algorithmic default is pure
  // computation, so this engine compiles it natively — the only backend it has.
  const t3Backend = resolveGraphBackend(cfg);
  let t3Status: string;
  let t3Changed = false;
  if (t3Backend === "off") {
    t3Status = "off";
  } else if (!wanted.has("t3")) {
    t3Status = !t1Changed && oldTiers["t3"] === "fresh" ? "fresh" : "stale"; // --only t1/t2 skipped T3
  } else {
    const outcome = runT3AlgorithmicStage(bp, records);
    t3Status = outcome.status;
    t3Changed = outcome.changed;
    if (outcome.warning) warnings.push(outcome.warning);
  }
  const tiers = { t1: "fresh", t2: t2Status, t3: t3Status };
  // The opt-in AGENTS.md brain report rides along on every compile so it stays
  // true even when nothing else changed (e.g. the markers were just installed).
  refreshReport(root, bp, graph, tiers);
  const artifactsChanged = t1Changed || t2Changed || t3Changed;
  const unchanged = !artifactsChanged && oldManifest !== null && deepEqual(oldTiers, tiers);
  if (unchanged && !full) {
    return { changed: false, seq: oldManifest!["seq"] as number, stats: graph.stats, delta: null, warnings };
  }

  atomicWrite(join(bp, "t1", "graph.json"), graphText);
  atomicWrite(join(bp, "t1", "docs.jsonl"), docsText);
  writeTimeline(root, cfg); // advisory (spec/90) — rides along, never blocks

  // tier-status-only transitions rewrite the manifest without spending a seq
  const seq = oldManifest === null ? 1 : (oldManifest["seq"] as number) + (artifactsChanged ? 1 : 0);

  const indexDoc = docs.find((d) => d.path === INDEX_FILE);
  const files: Record<string, ManifestFileEntry> = {};
  for (const d of docs) files[d.path] = { bytes: d.size, sha256: d.sha256 };
  const manifest = {
    bundle_root: ".",
    compiled_at: utcNowSeconds(),
    files,
    generator: generator(),
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
    delta.cause = { paths: [...changedPaths].sort(cmpStr), tier: t1Changed ? "t1" : t2Changed ? "t2" : "t3" };
    delta.seq = seq;
  }

  return { changed: !unchanged, seq, stats: graph.stats, delta, warnings };
}

/** `--only t2`: refresh vectors from the already-compiled docs substrate.
 *
 * Chunks derive from t1/docs.jsonl (spec/30), so T1 artifacts and the file
 * map stay exactly as the last full compile left them. */
async function compileT2Only(bp: string, config: Config): Promise<CompileResult> {
  const oldManifestText = readTextOrNull(join(bp, "manifest.json"));
  const docsText = readTextOrNull(join(bp, "t1", "docs.jsonl"));
  const graphText = readTextOrNull(join(bp, "t1", "graph.json"));
  if (oldManifestText === null || docsText === null || graphText === null) {
    return {
      changed: false,
      seq: 0,
      stats: {} as GraphStats,
      delta: null,
      warnings: ["nothing compiled yet — run: brainpick compile"],
    };
  }
  const oldManifest = JSON.parse(oldManifestText) as Record<string, unknown>;
  const stats = ((JSON.parse(graphText) as Record<string, unknown>)["stats"] ?? {}) as GraphStats;
  const records = docsText
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { path: string; text: string; reserved: boolean });

  const warnings: string[] = [];
  const [enabled, instruction] = await t2Gate(config);
  let t2Status: string;
  let t2Changed: boolean;
  if (enabled) {
    const outcome = await runT2Stage(bp, records, config.models.embedding);
    t2Status = outcome.status;
    t2Changed = outcome.changed;
    if (outcome.warning) warnings.push(outcome.warning);
  } else {
    t2Status = "off";
    t2Changed = false;
    const oldTiers = (oldManifest["tiers"] ?? {}) as Record<string, string>;
    if (instruction && oldTiers["t2"] !== "off") warnings.push(instruction);
  }

  const tiers = { ...((oldManifest["tiers"] ?? {}) as Record<string, string>) };
  tiers["t2"] = t2Status;
  if (!t2Changed && deepEqual(tiers, oldManifest["tiers"])) {
    return { changed: false, seq: oldManifest["seq"] as number, stats, delta: null, warnings };
  }

  const manifest = { ...oldManifest };
  manifest["tiers"] = tiers;
  manifest["seq"] = (oldManifest["seq"] as number) + (t2Changed ? 1 : 0);
  manifest["compiled_at"] = utcNowSeconds();
  manifest["generator"] = generator();
  atomicWrite(join(bp, "manifest.json"), canonicalJson(manifest as unknown as JsonValue));
  return { changed: true, seq: manifest["seq"] as number, stats, delta: null, warnings };
}

/** `--only t3`: (re)derive the entity graph from the already-compiled docs.
 *
 * The algorithmic backend reads t1/docs.jsonl (spec/40), so T1/T2 artifacts and
 * the file map stay exactly as the last compile left them — the twin of the
 * Python `_compile_t3_only`. "off" records the tier off. */
async function compileT3Only(bp: string, config: Config): Promise<CompileResult> {
  const oldManifestText = readTextOrNull(join(bp, "manifest.json"));
  const docsText = readTextOrNull(join(bp, "t1", "docs.jsonl"));
  const graphText = readTextOrNull(join(bp, "t1", "graph.json"));
  if (oldManifestText === null || docsText === null || graphText === null) {
    return {
      changed: false,
      seq: 0,
      stats: {} as GraphStats,
      delta: null,
      warnings: ["nothing compiled yet — run: brainpick compile"],
    };
  }
  const oldManifest = JSON.parse(oldManifestText) as Record<string, unknown>;
  const stats = ((JSON.parse(graphText) as Record<string, unknown>)["stats"] ?? {}) as GraphStats;
  const records = docsText
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as DocRecord);

  const warnings: string[] = [];
  const backend = resolveGraphBackend(config);
  let t3Status: string;
  let t3Changed = false;
  if (backend === "algorithmic") {
    const outcome = runT3AlgorithmicStage(bp, records);
    t3Status = outcome.status;
    t3Changed = outcome.changed;
    if (outcome.warning) warnings.push(outcome.warning);
  } else {
    t3Status = "off";
  }

  const tiers = { ...((oldManifest["tiers"] ?? {}) as Record<string, string>) };
  tiers["t3"] = t3Status;
  if (!t3Changed && deepEqual(tiers, oldManifest["tiers"])) {
    return { changed: false, seq: oldManifest["seq"] as number, stats, delta: null, warnings };
  }

  const manifest = { ...oldManifest };
  manifest["tiers"] = tiers;
  manifest["seq"] = (oldManifest["seq"] as number) + (t3Changed ? 1 : 0);
  manifest["compiled_at"] = utcNowSeconds();
  manifest["generator"] = generator();
  atomicWrite(join(bp, "manifest.json"), canonicalJson(manifest as unknown as JsonValue));
  return { changed: true, seq: manifest["seq"] as number, stats, delta: null, warnings };
}

/** The commit gate — deliberately T1-only: it must stay deterministic and
 * model-free (spec/10). T2 staleness (vectors lagging the chunks) is reported
 * by `status`/`doctor` instead, so a missing embedding backend can never
 * block a commit. */
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
