/** Conventions (spec/85 *Conventions*, spec/20 *t1/conventions.json*): a
 * `type: convention` doc is a standing rule the engine lists before anything
 * else — in the overview, in the AGENTS.md report — so an agent reads the rules
 * before it acts. Format 2 → 3 makes the template's `conventions/` a type the
 * engine recognises. Twin of packages/python/tests/test_conventions.py. */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { buildConventions, isConvention } from "../src/compile/conventions";
import { checkFresh, runCompile } from "../src/compile/pipeline";
import { renderReportBlock } from "../src/compile/t1";
import { loadConfig } from "../src/config";
import { scan } from "../src/core/bundle";
import { overviewPayload } from "../src/mcp";
import { LATEST_FORMAT, migrate } from "../src/migrate";
import { overviewMirror } from "../src/query/mirrors";
import { ServeState } from "../src/serve/state";
import { cleanup, copyBundle, makeBundle } from "./helpers";

afterEach(cleanup);

const TODAY = "2026-07-02";
const DESCRIPTION = "Coffee is offered before anything else is said — to guests and to the household alike.";

async function stateOf(root: string): Promise<ServeState> {
  await runCompile(root);
  const state = new ServeState(root, loadConfig(root));
  state.reloadArtifacts();
  return state;
}

function v2(): string {
  const root = copyBundle("kotiaivot-v2");
  renameSync(join(root, "gitignore"), join(root, ".gitignore"));
  return root;
}

const read = (path: string): string => readFileSync(path, "utf8");

describe("recognition", () => {
  test.each([
    ["convention", true],
    ["Convention", true],
    ["CONVENTION ", true],
    ["decision", false],
    ["skill", false],
    [null, false],
    ["", false],
  ])("isConvention(%j) is %s", (value, expected) => {
    expect(isConvention(value)).toBe(expected);
  });

  test("scan flags convention docs wherever they live", () => {
    const root = makeBundle({
      "rule.md": "---\ntype: convention\ntitle: R\n---\n# R\n",
      "adr.md": "---\ntype: decision\ntitle: A\n---\n# A\n",
    });
    const docs = new Map(scan(root).map((d) => [d.path, d.convention]));
    expect(docs.get("rule.md")).toBe(true);
    expect(docs.get("adr.md")).toBe(false);
  });
});

describe("the artifact", () => {
  test("buildConventions sorts by path with null descriptions", () => {
    const root = copyBundle("kotiaivot");
    writeFileSync(join(root, "conventions", "b-rule.md"), "---\ntype: convention\ntitle: B\n---\n# B\n");
    const docs = scan(root, ["**/*.md"], ["raw/*"]);
    expect(buildConventions(docs)).toEqual({
      conventions: [
        { description: DESCRIPTION, path: "conventions/aamukahvi-ensin.md", title: "Aamukahvi ensin" },
        { description: null, path: "conventions/b-rule.md", title: "B" },
      ],
    });
  });

  test("compile writes conventions.json and it counts for freshness", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    const artifact = join(root, ".brainpick", "t1", "conventions.json");
    const data = JSON.parse(read(artifact)) as { conventions: Array<{ path: string }> };
    expect(data.conventions.map((c) => c.path)).toEqual(["conventions/aamukahvi-ensin.md"]);
    expect(checkFresh(root).fresh).toBe(true);
    writeFileSync(artifact, '{"conventions": []}');
    expect(checkFresh(root).fresh).toBe(false);
  });

  test("a wiki writes an empty artifact", async () => {
    const root = copyBundle("kotiaurinko");
    await runCompile(root);
    expect(JSON.parse(read(join(root, ".brainpick", "t1", "conventions.json")))).toEqual({ conventions: [] });
  });
});

describe("surfaces", () => {
  test("overview lists conventions before skills and says so", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaivot")));
    expect(result["conventions"]).toEqual([
      { path: "conventions/aamukahvi-ensin.md", title: "Aamukahvi ensin", description: DESCRIPTION },
    ]);
    const keys = Object.keys(result);
    expect(keys.indexOf("conventions")).toBeLessThan(keys.indexOf("skills"));
    const hint = result["hint"] as string;
    expect(hint.startsWith("1 convention applies — read it before acting")).toBe(true);
    expect(hint.indexOf("convention")).toBeLessThan(hint.indexOf("skills"));
  });

  test("overview without conventions is empty and silent", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaurinko")));
    expect(result["conventions"]).toEqual([]);
    expect(result["hint"]).not.toContain("convention");
  });

  test("overview survives budget trimming with conventions intact", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaivot")), 60);
    expect((result["conventions"] as unknown[]).length).toBe(1);
    expect((result["tree"] as Array<{ docs: unknown[] }>).every((g) => g.docs.length === 0)).toBe(true);
  });

  test("overview reads a stale artifact as no conventions", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    unlinkSync(join(root, ".brainpick", "t1", "conventions.json"));
    const state = new ServeState(root, loadConfig(root));
    state.reloadArtifacts();
    expect(overviewPayload(state)["conventions"]).toEqual([]);
  });

  test("report lists conventions above skills only when there are any", () => {
    const graph = {
      nodes: [],
      edges: [],
      ghosts: [],
      islands: [],
      tags: {},
      stats: { docs: 0, edges: 0, tags: 0, orphans: 0, ghosts: 0, islands: 0 },
    };
    const tiers = { t1: "fresh", t2: "off", t3: "off" };
    const conventions = { conventions: [{ description: null, path: "conventions/a.md", title: "A" }] };
    const skills = {
      skills: [{ depends_on: [], description: null, export: [], path: "skills/s.md", title: "S", tools: [] }],
    };
    const block = renderReportBlock(graph, tiers, ".", null, skills, null, null, conventions);
    expect(block).toContain("- Conventions (these apply to you):\n  - A (conventions/a.md)\n");
    expect(block.indexOf("Conventions")).toBeLessThan(block.indexOf("Skills"));
    expect(renderReportBlock(graph, tiers, ".", null, skills)).not.toContain("Conventions");
  });

  test("CLI overview prints the conventions", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    const out = (await overviewMirror(root, false)).out ?? "";
    expect(out).toContain("conventions (these apply to you):");
    expect(out).toContain("Aamukahvi ensin (conventions/aamukahvi-ensin.md)");
    expect(out.indexOf("conventions")).toBeLessThan(out.indexOf("skills"));
  });
});

describe("migrate 2 → 3", () => {
  test("latest format is 3", () => {
    expect(LATEST_FORMAT).toBe(3);
  });

  test("retypes the template stamp and seeds the index", () => {
    const root = v2();
    const report = migrate(root, 3, { today: TODAY });
    expect(read(join(root, "conventions", "aamukahvi-ensin.md")).startsWith("---\ntype: convention\ntitle: Aamukahvi ensin\n")).toBe(true);
    expect(read(join(root, "conventions", "hiljainen-tunti.md")).startsWith("---\ntype: article\n")).toBe(true);
    const index = read(join(root, "conventions", "index.md"));
    expect(index.startsWith("# Conventions\n")).toBe(true);
    expect(index).toContain("* (none yet)");
    const toml = read(join(root, "brainpick.toml"));
    expect(toml).toContain("format = 3              # the brainpick brain format (spec/85)");
    expect(toml).toContain(
      "skills = 0              # procedural memory never fades\nconventions = 0         # rules never fade\n",
    );
    expect(toml.indexOf("conventions = 0")).toBeLessThan(toml.indexOf("[index]"));
    expect(report.actions).toEqual([
      "retype conventions/aamukahvi-ensin.md: decision → convention",
      "create conventions/index.md",
      "stamp brainpick.toml: format 2 → 3",
      "add conventions = 0 to [half_life.folders]",
    ]);
  });

  test("leaves an existing index and key alone", () => {
    const root = v2();
    writeFileSync(join(root, "conventions", "index.md"), "# Mine\n");
    const toml = join(root, "brainpick.toml");
    writeFileSync(toml, read(toml).replace("skills = 0", "conventions = 7\nskills = 0"));
    const report = migrate(root, 3, { today: TODAY });
    expect(read(join(root, "conventions", "index.md"))).toBe("# Mine\n");
    expect(read(toml)).not.toContain("conventions = 0");
    expect(report.actions).not.toContain("create conventions/index.md");
    expect(report.actions.some((a) => a.startsWith("add conventions"))).toBe(false);
  });

  test("without a folders table adds nothing", () => {
    const root = v2();
    const toml = join(root, "brainpick.toml");
    const text = read(toml);
    writeFileSync(toml, text.slice(0, text.indexOf("[half_life]")) + text.slice(text.indexOf("[index]")));
    const report = migrate(root, 3, { today: TODAY });
    expect(read(toml)).not.toContain("half_life");
    expect(report.actions.some((a) => a.startsWith("add conventions"))).toBe(false);
  });

  test("without a conventions folder creates only the index", () => {
    const root = v2();
    rmSync(join(root, "conventions"), { recursive: true });
    const report = migrate(root, 3, { today: TODAY });
    expect(readdirSync(join(root, "conventions"))).toEqual(["index.md"]);
    expect(report.actions[0]).toBe("create conventions/index.md");
  });

  test("1 → 3 is cumulative", () => {
    const root = copyBundle("kotiaivot-v1");
    renameSync(join(root, "gitignore"), join(root, ".gitignore"));
    const report = migrate(root, 3, { today: TODAY });
    expect(report.actions).toContain("stamp brainpick.toml: format 1 → 2");
    expect(report.actions).toContain("stamp brainpick.toml: format 2 → 3");
    const toml = read(join(root, "brainpick.toml"));
    expect(toml).toContain("format = 3");
    expect(toml).toContain("conventions = 0"); // 1→2 wrote the table, 2→3 completed it
    expect(existsSync(join(root, "conventions", "index.md"))).toBe(true);
  });

  test("is idempotent", () => {
    const root = v2();
    migrate(root, 3, { today: TODAY });
    const snapshot = read(join(root, "brainpick.toml")) + read(join(root, "conventions", "aamukahvi-ensin.md"));
    expect(migrate(root, 3, { today: TODAY }).actions).toEqual([]);
    expect(read(join(root, "brainpick.toml")) + read(join(root, "conventions", "aamukahvi-ensin.md"))).toBe(snapshot);
  });
});
