/** The release ledger and the what's-new notice (spec/80 *The release ledger*).
 *
 * The update notice says a newer engine exists; this one says what changed and
 * what to do about it. `spec/releases.yaml` is the canonical ledger, shipped
 * byte-identical inside each package (scripts/sync-releases.mjs). The notice
 * is a pure function of the ledger, the running version, the version that last
 * compiled the brain (the manifest's `generator.version`) and the brain's
 * stamped `[brain] format` — deterministic, offline, conformance-tested. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import { isBrain, loadConfig } from "./config";
import { isNewer } from "./update";
import { PACKAGE_ROOT, VERSION } from "./version";

export interface ReleaseChange {
  kind: string;
  area: string;
  text: string;
  agent_action?: string;
}

export interface Release {
  version: string;
  date: string;
  brain_format: number;
  summary: string;
  changes: ReleaseChange[];
}

export interface WhatsNewNotice {
  since?: string;
  current: string;
  releases?: string[];
  format?: { current: number; latest: number };
  hint: string;
}

/** The shipped ledger: the package copy first (installed tarballs), then the
 * repo-root canonical (dev checkout) — the Agent Skill's resolution. */
export function ledgerPath(): string {
  const packaged = resolve(PACKAGE_ROOT, "releases", "releases.yaml");
  if (existsSync(packaged)) return packaged;
  return resolve(PACKAGE_ROOT, "..", "..", "spec", "releases.yaml");
}

/** The ledger, newest first, with `version` and `date` as strings (the yaml
 * library keeps `2026-09-11` a string; the Python engine coerces its date). */
export function loadLedger(path: string = ledgerPath()): Release[] {
  const data = (parseYaml(readFileSync(path, "utf8")) ?? {}) as { releases?: unknown[] };
  const out: Release[] = [];
  for (const raw of data.releases ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    out.push({
      version: String(r["version"] ?? ""),
      date: String(r["date"] ?? ""),
      brain_format: typeof r["brain_format"] === "number" ? r["brain_format"] : Number(r["brain_format"] ?? 0),
      summary: String(r["summary"] ?? ""),
      changes: Array.isArray(r["changes"])
        ? (r["changes"] as Record<string, unknown>[]).map((c) => ({
            kind: String(c["kind"] ?? "?"),
            area: String(c["area"] ?? "?"),
            text: String(c["text"] ?? ""),
            ...(c["agent_action"] ? { agent_action: String(c["agent_action"]) } : {}),
          }))
        : [],
    });
  }
  return out;
}

export function isUnreleased(release: Release): boolean {
  return release.date.trim().toLowerCase() === "unreleased";
}

/** Ledger entries ≤ current, newest first. */
function atMost(ledger: Release[], current: string): Release[] {
  return ledger.filter((r) => !isNewer(current, r.version));
}

/** Entries with since < version ≤ current, newest first; [] without a since.
 * An `unreleased` head is never one you could have missed. */
export function releasesBetween(ledger: Release[], since: string | null, current: string): Release[] {
  if (since === null) return [];
  return atMost(ledger, current).filter((r) => isNewer(since, r.version) && !isUnreleased(r));
}

/** The newest brain format among ledger entries ≤ current or marked unreleased —
 * the format a dev checkout's head declares is what it writes. */
export function latestBrainFormat(ledger: Release[], current: string): number | null {
  const formats = ledger
    .filter((r) => isUnreleased(r) || !isNewer(current, r.version))
    .map((r) => r.brain_format);
  return formats.length ? Math.max(...formats) : null;
}

/** The notice (spec/80): releases since the brain was last compiled and/or a
 * brain format newer than its stamp; null when there is nothing to say. */
export function whatsNew(
  ledger: Release[],
  current: string,
  since: string | null,
  brainFormat: number | null,
): WhatsNewNotice | null {
  // key order matters for the JSON the tests and the MCP payload show
  const ordered = {} as WhatsNewNotice;
  if (since !== null) ordered.since = since;
  ordered.current = current;
  const parts: string[] = [];
  const between = releasesBetween(ledger, since, current);
  if (between.length) {
    ordered.releases = between.map((r) => r.version);
    const n = between.length;
    parts.push(
      `brainpick ${since} → ${current}: ${n} release${n === 1 ? "" : "s"} since this brain was last compiled` +
        ` — run \`brainpick whats-new --since ${since}\``,
    );
  }
  if (brainFormat !== null && brainFormat > 0) {
    const latest = latestBrainFormat(ledger, current);
    if (latest !== null && latest > brainFormat) {
      ordered.format = { current: brainFormat, latest };
      parts.push(`brain format ${brainFormat} → ${latest}: run \`brainpick migrate --to ${latest}\``);
    }
  }
  if (!parts.length) return null;
  ordered.hint = parts.join("; ");
  return ordered;
}

function oneLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

export function renderRelease(release: Release): string {
  const lines = [`## ${release.version} (${release.date || "?"})`, "", oneLine(release.summary), ""];
  for (const change of release.changes) {
    lines.push(`- ${change.kind} (${change.area}): ${oneLine(change.text)}`);
  }
  return lines.join("\n") + "\n";
}

/** What `brainpick whats-new` prints: the releases the notice points at (or the
 * current release alone when nothing lies between), every `agent_action`
 * collected under *Do next*, and the format part when it applies. */
export function renderWhatsNew(
  ledger: Release[],
  current: string,
  since: string | null,
  brainFormat: number | null,
  everything = false,
): string {
  let shown: Release[];
  if (everything) {
    shown = [...ledger];
  } else {
    shown = releasesBetween(ledger, since, current);
    if (!shown.length) {
      shown = ledger.filter((r) => r.version === current);
      if (!shown.length) shown = atMost(ledger, current).slice(0, 1);
    }
  }
  const out = shown.map(renderRelease);
  const actions = shown.flatMap((r) =>
    r.changes.filter((c) => c.agent_action).map((c) => oneLine(c.agent_action!)),
  );
  const notice = whatsNew(ledger, current, since, brainFormat);
  const fmt = notice?.format;
  if (actions.length || fmt) {
    out.push("Do next:\n");
    for (const action of actions) out.push(`- ${action}\n`);
    if (fmt) out.push(`- brain format ${fmt.current} → ${fmt.latest}: run \`brainpick migrate --to ${fmt.latest}\`\n`);
  }
  return out.join("\n");
}

/** The notice for a compile (spec/80): `since` is the version that wrote the
 * manifest the compile started from; the format is the brain's own stamp. */
export function whatsNewFor(
  oldManifest: Record<string, unknown> | null,
  current: string,
  brainFormat: number | null,
  ledger: Release[] = loadLedger(),
): WhatsNewNotice | null {
  const generator = oldManifest?.["generator"];
  const since =
    typeof generator === "object" && generator !== null && typeof (generator as Record<string, unknown>)["version"] === "string"
      ? ((generator as Record<string, unknown>)["version"] as string)
      : null;
  return whatsNew(ledger, current, since, brainFormat);
}

/** The CLI verb `brainpick whats-new`: `since` from --since, else the manifest's
 * `generator.version`, else nothing (the running engine's own notes). */
export function runWhatsNew(
  root: string,
  opts: { since?: string | null; all?: boolean; json?: boolean } = {},
  print: (text: string) => void = (text) => process.stdout.write(text),
): number {
  const repo = resolve(root);
  const config = loadConfig(repo);
  const bundle = resolve(repo, config.bundle.root);
  let since = opts.since ?? null;
  if (since === null) {
    const manifestPath = resolve(bundle, ".brainpick", "manifest.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        const generator = manifest["generator"] as Record<string, unknown> | undefined;
        since = typeof generator?.["version"] === "string" ? (generator["version"] as string) : null;
      } catch {
        since = null;
      }
    }
  }
  const brainFormat = isBrain(config) ? config.brain.format : null;
  const ledger = loadLedger();
  if (opts.json) {
    let shown = opts.all ? ledger : releasesBetween(ledger, since, VERSION);
    if (!shown.length && !opts.all) shown = ledger.filter((r) => r.version === VERSION);
    const payload = { current: VERSION, since, releases: shown, notice: whatsNew(ledger, VERSION, since, brainFormat) };
    print(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }
  print(renderWhatsNew(ledger, VERSION, since, brainFormat, opts.all ?? false));
  return 0;
}
