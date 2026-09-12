/** Half-life (spec/50 *Half-life*, spec/80 `[half_life]`): memories fade, and
 * that is a feature — a document's retrieval score is multiplied by
 * max(2^(-age/half_life), 1/16) so a stale page still surfaces but ranks below
 * a fresh one. Twin of packages/python/tests/test_half_life.py. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { buildDocsRecords } from "../src/compile/t1";
import { loadConfig, type HalfLifeConfig } from "../src/config";
import { scan } from "../src/core/bundle";
import { searchPayload } from "../src/mcp";
import { ageDays, effectiveHalfLife, fade, fadeFactor } from "../src/query/half-life";
import { search, type SearchHit } from "../src/query/keyword";
import { runSearch } from "../src/query/router";
import { ServeState } from "../src/serve/state";
import { cleanup, copyBundle, EXPECTED, makeBundle } from "./helpers";

afterEach(cleanup);

const NOW = new Date("2026-08-01T00:00:00Z");
const noop = () => undefined;

describe("config", () => {
  test("defaults to nothing fading", () => {
    const cfg = loadConfig(makeBundle({}), {});
    expect(cfg.half_life).toEqual({ default: 0, folders: {} });
  });

  test("reads default and folders", () => {
    const root = makeBundle({
      "brainpick.toml":
        '[half_life]\ndefault = 90\n[half_life.folders]\njournals = 30\n"journals/archive" = 7\nskills = 0\nbroken = "soon"\n',
    });
    const cfg = loadConfig(root, {}, noop);
    expect(cfg.half_life.default).toBe(90);
    expect(cfg.half_life.folders).toEqual({ journals: 30, "journals/archive": 7, skills: 0 });
  });

  test("env overrides", () => {
    const cfg = loadConfig(makeBundle({}), {
      BRAINPICK_HALF_LIFE_DEFAULT: "45",
      BRAINPICK_HALF_LIFE_FOLDERS: "journals=30, raw = 1.5",
    });
    expect(cfg.half_life.default).toBe(45);
    expect(cfg.half_life.folders).toEqual({ journals: 30, raw: 1.5 });
  });
});

describe("resolution", () => {
  const cfg: HalfLifeConfig = { default: 90, folders: { journals: 30, "journals/archive": 7, skills: 0 } };
  test.each<[string, number | null, number]>([
    ["knowledge/kahvi.md", null, 90],
    ["journals/2026-07-01.md", null, 30],
    ["journals/archive/2026/07/x.md", null, 7],
    ["journalsx/y.md", null, 90],
    ["skills/veden-keitto.md", null, 0],
    ["journals/pinned.md", 0, 0],
    ["knowledge/fresh.md", 3, 3],
  ])("effectiveHalfLife(%s, %s) = %s", (path, frontmatter, expected) => {
    expect(effectiveHalfLife(path, frontmatter, cfg)).toBe(expected);
  });

  test.each<[string | null, number | null]>([
    ["2026-07-02T00:00:00Z", 30],
    ["2026-07-02", 30],
    ["2026-07-02T12:00:00+02:00", 29.5 + 2 / 24],
    ["2026-07-02T00:00:00", 30],
    ["2026-09-01T00:00:00Z", 0],
    [null, null],
    ["last tuesday", null],
  ])("ageDays(%s) = %s", (timestamp, expected) => {
    const result = ageDays(timestamp, NOW);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected, 9);
  });

  test.each<[number | null, number, number]>([
    [0, 30, 1],
    [30, 30, 0.5],
    [60, 30, 0.25],
    [3000, 30, 1 / 16],
    [30, 0, 1],
    [null, 30, 1],
  ])("fadeFactor(%s, %s) = %s", (age, halfLife, expected) => {
    expect(fadeFactor(age, halfLife)).toBeCloseTo(expected, 9);
  });
});

function records() {
  const root = makeBundle({
    "index.md": "# I\n\n- [Old](old.md)\n- [New](new.md)\n- [Pinned](pinned.md)\n",
    "old.md": "---\ntitle: Old\ntimestamp: 2026-01-01T00:00:00Z\n---\n# Old\n\nkettle kettle kettle\n",
    "new.md": "---\ntitle: New\ntimestamp: 2026-07-31T00:00:00Z\n---\n# New\n\nkettle\n",
    "pinned.md": "---\ntitle: Pinned\ntimestamp: 2026-01-01T00:00:00Z\nhalf_life: 0\n---\n# Pinned\n\nkettle kettle\n",
  });
  return buildDocsRecords(scan(root));
}

describe("ranking", () => {
  test("records carry the frontmatter half_life", () => {
    const byPath = new Map(records().map((r) => [r.path, r]));
    expect(byPath.get("pinned.md")!.half_life).toBe(0);
    expect(byPath.get("old.md")!.half_life).toBeNull();
  });

  test("fade reranks by faded score and path", () => {
    const recs = records();
    const hits = search(recs, "kettle", 8);
    expect(hits.map((h) => h.path)).toEqual(["old.md", "pinned.md", "new.md"]);
    const faded = fade(hits, recs, { default: 30, folders: {} }, NOW);
    expect(faded.map((h) => h.path)).toEqual(["pinned.md", "new.md", "old.md"]);
    const old = hits.find((h) => h.path === "old.md")!.score;
    expect(faded.find((h) => h.path === "old.md")!.score).toBeCloseTo(old / 16, 5);
  });

  test("with nothing fading the hits are byte-identical", () => {
    const recs = records();
    const hits = search(recs, "kettle", 8);
    expect(fade(hits, recs, { default: 0, folders: {} }, NOW)).toEqual(hits);
    expect(fade(hits, recs, null, NOW)).toEqual(hits);
  });

  test("runSearch applies the half-life in keyword mode", async () => {
    const body = await runSearch(records(), {}, "kettle", "keyword", 8, null, null, null, {
      halfLife: { default: 30, folders: {} },
      now: NOW,
    });
    expect(body.hits.map((h) => h.path)).toEqual(["pinned.md", "new.md", "old.md"]);
  });

  test("runSearch fades the semantic ranking too", async () => {
    const semantic = async (): Promise<SearchHit[]> => [
      { path: "old.md", title: "Old", description: null, score: 0.9, snippet: null, source: "semantic" },
      { path: "new.md", title: "New", description: null, score: 0.8, snippet: null, source: "semantic" },
    ];
    const body = await runSearch(records(), { t2: "fresh" }, "kettle", "semantic", 8, semantic, null, null, {
      halfLife: { default: 30, folders: {} },
      now: NOW,
    });
    expect(body.hits.map((h) => h.path)).toEqual(["new.md", "old.md"]);
  });

  test("runSearch without a half-life is unchanged", async () => {
    const recs = records();
    const plain = await runSearch(recs, {}, "kettle", "keyword", 8);
    expect(await runSearch(recs, {}, "kettle", "keyword", 8, null, null, null, { now: NOW })).toEqual(plain);
  });
});

describe("end to end", () => {
  async function stateWith(toml: string): Promise<ServeState> {
    const root = copyBundle("kotiaivot");
    writeFileSync(join(root, "brainpick.toml"), toml);
    await runCompile(root);
    const state = new ServeState(root, loadConfig(root, {}));
    state.reloadArtifacts();
    return state;
  }

  test("MCP search honours the bundle half-life", async () => {
    const state = await stateWith(
      'spec = "0.1"\n[bundle]\nexclude = ["raw/*"]\n[brain]\nformat = 2\n[half_life]\ndefault = 0\n[half_life.folders]\nskills = 1\n',
    );
    const hits = (await searchPayload(state, "kahvi", "keyword", 8, null, null, NOW))["hits"] as Array<
      Record<string, unknown>
    >;
    expect(hits[0]!["path"]).toBe("knowledge/kahvi.md");
    expect(hits.some((h) => String(h["why"]).includes("faded"))).toBe(true);
  });

  test("why names the fade", async () => {
    const state = await stateWith('spec = "0.1"\n[bundle]\nexclude = ["raw/*"]\n[brain]\nformat = 2\n[half_life]\ndefault = 1\n');
    const hit = ((await searchPayload(state, "kahvi", "keyword", 8, null, null, NOW))["hits"] as Array<Record<string, unknown>>)[0]!;
    expect(String(hit["why"]).endsWith("; faded (30 days old, half-life 1 day)")).toBe(true);
  });

  test("the docs.jsonl golden carries half_life", () => {
    const first = JSON.parse(
      readFileSync(join(EXPECTED, "kotiaurinko", ".brainpick", "t1", "docs.jsonl"), "utf8").split("\n")[0]!,
    ) as Record<string, unknown>;
    expect("half_life" in first && first["half_life"] === null).toBe(true);
  });
});
