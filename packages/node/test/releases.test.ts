/** The release ledger and the what's-new notice (spec/80 *The release ledger*):
 * deterministic, offline, surfaced where agents already look. The twin of
 * packages/python/tests/test_releases.py. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, expect, test, vi } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { renderReportBlock, type Graph } from "../src/compile/t1";
import type { SkillsArtifact } from "../src/compile/skills";
import { loadConfig } from "../src/config";
import { overviewPayload } from "../src/mcp";
import { latestBrainFormat, ledgerPath, loadLedger, renderWhatsNew, runWhatsNew } from "../src/releases";
import { ServeState } from "../src/serve/state";
import { VERSION } from "../src/version";
import { cleanup, copyBundle, SPEC } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const CANONICAL = join(SPEC, "releases.yaml");
const FIXTURE_LEDGER = join(SPEC, "fixtures", "releases", "ledger.yaml");

const core = (v: string): number[] => v.split(".").map((x) => parseInt(x, 10));
const newer = (a: number[], b: number[]): boolean => a.some((x, i) => x !== b[i]) && a > b;

// -- the ledger --------------------------------------------------------------------

test("the shipped ledger is byte-identical to the canonical", () => {
  expect(readFileSync(ledgerPath(), "utf8")).toBe(readFileSync(CANONICAL, "utf8"));
});

test("the canonical ledger is well-formed, newest first, and heads at the package version", () => {
  const ledger = loadLedger();
  expect(ledger.length).toBeGreaterThan(0);
  const versions = ledger.map((r) => r.version);
  const sorted = [...versions].sort((a, b) => (newer(core(a), core(b)) ? -1 : newer(core(b), core(a)) ? 1 : 0));
  expect(versions).toEqual(sorted);
  const head = ledger[0]!;
  if (head.date === "unreleased") expect(newer(core(head.version), core(VERSION))).toBe(true);
  else expect(head.version).toBe(VERSION);
  for (const release of ledger) {
    expect(Number.isInteger(release.brain_format)).toBe(true);
    for (const change of release.changes) {
      expect(["added", "changed", "fixed", "removed"]).toContain(change.kind);
      expect(["brain", "cli", "mcp", "search", "config", "compile", "webui", "docs"]).toContain(change.area);
      expect(change.text.trim()).not.toBe("");
    }
  }
  expect(versions).toContain("0.5.0");
  expect(versions).toContain("0.1.0");
});

test("latestBrainFormat counts the unreleased head but not released futures", () => {
  const ledger = loadLedger(FIXTURE_LEDGER);
  expect(latestBrainFormat(ledger, "1.1.1")).toBe(3); // the unreleased head is what this checkout writes
  expect(latestBrainFormat(ledger, "1.2.0")).toBe(3);
  const releasedOnly = ledger.filter((r) => r.date !== "unreleased");
  expect(latestBrainFormat(releasedOnly, "1.0.0")).toBe(1); // 1.1.0's format 2 is a future release
  expect(latestBrainFormat(releasedOnly, "0.9.0")).toBeNull();
});

test("render collects agent actions under Do next", () => {
  const ledger = loadLedger(FIXTURE_LEDGER);
  const text = renderWhatsNew(ledger, "1.1.1", "1.0.0", 1);
  expect(text).toContain("## 1.1.1 (2026-09-20)");
  expect(text).toContain("## 1.1.0 (2026-09-13)");
  expect(text).not.toContain("## 1.0.0"); // since is exclusive
  expect(text).not.toContain("## 1.2.0"); // the head is unreleased
  expect(text).toContain("- added (brain): Brain format 2.");
  expect(text).toContain("Do next:");
  // a numbered checklist in the order to do them: oldest shown release first,
  // each in ledger order, the format part last
  expect(text.slice(text.indexOf("Do next:"))).toBe(
    "Do next:\n\n" +
      "1. Run `brainpick migrate --to 2`.\n" +
      "2. Run `brainpick integrate agents-md`.\n" +
      "3. brain format 1 → 3: run `brainpick migrate --to 3`\n", // the head's format
  );
});

test("render with nothing between shows the current release itself", () => {
  const ledger = loadLedger(FIXTURE_LEDGER);
  const text = renderWhatsNew(ledger, "1.1.1", null, null);
  expect(text.startsWith("## 1.1.1 (2026-09-20)")).toBe(true);
  expect(text).not.toContain("## 1.1.0");
});

// -- the CLI --------------------------------------------------------------------------

function setGenerator(root: string, version: string): void {
  const path = join(root, ".brainpick", "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { generator: { version: string } };
  manifest.generator.version = version;
  writeFileSync(path, JSON.stringify(manifest), "utf8");
}

function capture(): { out: string[]; print: (t: string) => void } {
  const out: string[] = [];
  return { out, print: (t) => out.push(t) };
}

test("whats-new defaults to the manifest generator and names the format", async () => {
  const root = copyBundle("kotiaivot-v1");
  await runCompile(root);
  setGenerator(root, "0.4.0");
  const { out, print } = capture();
  expect(runWhatsNew(root, {}, print)).toBe(0);
  const text = out.join("");
  expect(text).toContain("## 0.5.0 (2026-09-11)");
  expect(text).toContain("## 0.4.5");
  expect(text).not.toContain("## 0.4.0");
  expect(text).toContain("brain format 1 → 2: run `brainpick migrate --to 2`");
});

test("whats-new --since, --all and --json", () => {
  const root = copyBundle("kotiaivot-v1");
  let c = capture();
  expect(runWhatsNew(root, { since: "0.4.4" }, c.print)).toBe(0);
  expect(c.out.join("")).toContain("## 0.4.5");
  expect(c.out.join("")).not.toContain("## 0.4.4");
  c = capture();
  expect(runWhatsNew(root, { all: true }, c.print)).toBe(0);
  expect(c.out.join("")).toContain("## 0.1.0 (2026-08-25)");
  c = capture();
  expect(runWhatsNew(root, { since: "0.4.4", json: true }, c.print)).toBe(0);
  const payload = JSON.parse(c.out.join("")) as {
    releases: Array<{ version: string }>;
    notice: { since: string; format: { current: number; latest: number } };
  };
  expect(payload.releases[payload.releases.length - 1]!.version).toBe("0.4.5");
  expect(payload.notice.format).toEqual({ current: 1, latest: 2 });
  expect(payload.notice.since).toBe("0.4.4");
});

test("whats-new outside a brain prints the current release", () => {
  const wiki = copyBundle("kotiaurinko");
  const { out, print } = capture();
  expect(runWhatsNew(wiki, {}, print)).toBe(0);
  const text = out.join("");
  expect(text.startsWith("## ")).toBe(true);
  expect(text).not.toContain("brain format");
});

// -- where the notice surfaces ---------------------------------------------------------

test("compile result and report carry the notice for an old brain", async () => {
  const root = copyBundle("kotiaivot-v1");
  const agents = join(root, "AGENTS.md");
  writeFileSync(agents, "# A\n\n<!-- brainpick:begin report (hash:0) -->\n<!-- brainpick:end report -->\n", "utf8");
  const result = await runCompile(root);
  expect(result.whats_new).not.toBeNull();
  expect(result.whats_new!.format).toEqual({ current: 1, latest: 2 });
  expect(result.whats_new!.releases).toBeUndefined(); // a first compile has nothing to have missed
  expect(readFileSync(agents, "utf8")).toContain("- What's new: brain format 1 → 2: run `brainpick migrate --to 2`");
});

test("the release part clears once the current version has compiled", async () => {
  const root = copyBundle("kotiaivot-v1");
  await runCompile(root);
  setGenerator(root, "0.1.0");
  const vieraat = join(root, "knowledge", "vieraat.md");
  writeFileSync(vieraat, readFileSync(vieraat, "utf8") + "\nMore.\n", "utf8");
  const result = await runCompile(root);
  expect(result.whats_new!.since).toBe("0.1.0");
  expect(result.whats_new!.releases).toContain("0.5.0");
  expect(result.whats_new!.hint).toContain("run `brainpick whats-new --since 0.1.0`");
  // the manifest was rewritten by the current version: the release part is gone, the format part stays
  const again = await runCompile(root);
  expect(again.whats_new!.releases).toBeUndefined();
  expect(again.whats_new!.format!.current).toBe(1);
});

test("a format-2 brain compiled by this version hears nothing", async () => {
  const root = copyBundle("kotiaivot");
  await runCompile(root);
  expect((await runCompile(root)).whats_new).toBeNull();
});

test("the report block stays golden without a notice", async () => {
  const root = copyBundle("kotiaivot");
  await runCompile(root);
  const bp = join(root, ".brainpick");
  const graph = JSON.parse(readFileSync(join(bp, "t1", "graph.json"), "utf8")) as Graph;
  const skills = JSON.parse(readFileSync(join(bp, "t1", "skills.json"), "utf8")) as SkillsArtifact;
  const tiers = { t1: "fresh", t2: "off", t3: "off" };
  const plain = renderReportBlock(graph, tiers, ".", null, skills);
  const noticed = renderReportBlock(graph, tiers, ".", null, skills, null, {
    current: "9.9.9",
    format: { current: 1, latest: 2 },
    hint: "x",
  });
  const strip = (block: string): string => block.split("\n").slice(1).join("\n"); // the hash stamp differs by design
  expect(strip(noticed).replace("\n- What's new: x", "")).toBe(strip(plain));
  expect(noticed.indexOf("- Bundle root:")).toBeLessThan(noticed.indexOf("- What's new: x"));
});

test("the overview carries whats_new and leads the hint", async () => {
  const root = copyBundle("kotiaivot-v1");
  const state = new ServeState(root, loadConfig(root));
  await state.load();
  const result = overviewPayload(state);
  expect(result["whats_new"]).toMatchObject({ format: { current: 1, latest: 2 } });
  expect(String(result["hint"]).startsWith("What's new — brain format 1 → 2: run `brainpick migrate --to 2`. ")).toBe(true);
});

test("the fixture ledger matches the canonical shape", () => {
  for (const path of [CANONICAL, FIXTURE_LEDGER]) {
    const data = parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["releases"]);
  }
});
