/** The compile pipeline (spec/10): scan → T1 → T2 → artifacts, hash-incremental,
 * byte-stable on no-ops, delta-emitting on change. */
import { join } from "node:path";

import { loadConfig, type Config } from "../config";
import { scan, type Document } from "../core/bundle";
import { canonicalJson, canonicalJsonl, cmpStr, type JsonValue } from "../core/canonical";
import { atomicWrite, readTextOrNull } from "../core/fs";
import { deepEqual, diffGraphs, type GraphDelta } from "../deltas";
import { SPEC_VERSION, VERSION } from "../version";
import { applyIndexSection, buildDocsRecords, buildGraph, renderIndexBlock, type GraphStats } from "./t1";
import { runT2Stage, t2Gate } from "./t2";

export const INDEX_FILE = "index.md";

export type Tier = "t1" | "t2";

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

export async function runCompile(
  root: string,
  full = false,
  only: readonly Tier[] | null = null,
  config: Config | null = null,
): Promise<CompileResult> {
  const bp = join(root, ".brainpick");
  const cfg = config ?? loadConfig(root);
  const wanted = new Set<Tier>(only ?? ["t1", "t2"]);
  if (wanted.size === 1 && wanted.has("t2")) return compileT2Only(bp, cfg);

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

  const tiers = { t1: "fresh", t2: t2Status, t3: "off" };
  const artifactsChanged = t1Changed || t2Changed;
  const unchanged = !artifactsChanged && oldManifest !== null && deepEqual(oldTiers, tiers);
  if (unchanged && !full) {
    return { changed: false, seq: oldManifest!["seq"] as number, stats: graph.stats, delta: null, warnings };
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
    delta.cause = { paths: [...changedPaths].sort(cmpStr), tier: t1Changed ? "t1" : "t2" };
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
