/** Skills (spec/85 *Skills*, spec/20 *Skills and frontmatter edges*): procedural
 * memory the engine recognises by `type`, links by `depends_on`, points at by
 * `tools`, surfaces first — and never executes. Twin of the Python test_skills.py. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { checkFresh, runCompile } from "../src/compile/pipeline";
import {
  buildSkills,
  dependencyCycles,
  isSkill,
  renderSkilltree,
  SKILLTREE_FILE,
  type SkillsArtifact,
} from "../src/compile/skills";
import { buildDocsRecords, buildGraph, renderReportBlock } from "../src/compile/t1";
import { loadConfig } from "../src/config";
import { scan } from "../src/core/bundle";
import { qualifyPaths } from "../src/federation";
import { overviewPayload, readPayload, searchPayload } from "../src/mcp";
import { search } from "../src/query/keyword";
import { ServeState } from "../src/serve/state";
import { skillList, skillNew } from "../src/skill";
import { cleanup, copyBundle, makeBundle } from "./helpers";

afterEach(cleanup);

const RAW = ["raw/*"];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function stateOf(root: string): Promise<ServeState> {
  await runCompile(root);
  const state = new ServeState(root, loadConfig(root));
  state.reloadArtifacts();
  return state;
}

describe("recognition", () => {
  test.each([
    ["skill", true], ["Skill", true], ["SKILL ", true], ["playbook", true], ["Playbook", true],
    ["Concept", false], ["reference", false], [null, false], ["", false],
  ])("isSkill(%j) is keyed on type, case-insensitively", (value, expected) => {
    expect(isSkill(value)).toBe(expected);
  });

  test("reserved files are never skills", () => {
    const root = makeBundle({
      "skills/index.md": "---\ntype: skill\n---\n# no\n",
      "skills/skilltree.md": "---\ntype: skill\n---\n# no\n",
      "skills/a.md": "---\ntype: skill\n---\n# A\n",
    });
    const docs = scan(root);
    expect(docs.filter((d) => d.skill).map((d) => d.path)).toEqual(["skills/a.md"]);
    expect(docs.find((d) => d.path === "skills/skilltree.md")!.reserved).toBe(true);
  });
});

describe("T1: depends_on edges, tools, skills.json", () => {
  test("depends_on becomes an authored edge", () => {
    const root = copyBundle("kotiaivot");
    const graph = buildGraph(scan(root, undefined, RAW));
    expect(graph.edges.filter((e) => e.kind === "depends_on")).toEqual([
      { count: 1, kind: "depends_on", label: "Veden keitto", source: "skills/kahvin-keitto.md", target: "skills/veden-keitto.md" },
    ]);
    const veden = graph.nodes.find((n) => n.id === "skills/veden-keitto.md")!;
    expect(veden.in).toBeGreaterThanOrEqual(2);
    expect(veden.orphan).toBe(false);
  });

  test("an unresolved depends_on is a ghost and a self-dependency is dropped", () => {
    const root = makeBundle({
      "a.md": "---\ntype: skill\ntitle: A\ndepends_on: [a.md, missing.md]\n---\n# A\n\n[B](b.md)\n",
      "b.md": "---\ntype: Concept\ntitle: B\n---\n# B\n\n[A](a.md)\n",
    });
    const graph = buildGraph(scan(root));
    expect(graph.ghosts).toEqual([{ source: "a.md", target: "missing.md" }]);
    expect(graph.edges.filter((e) => e.kind === "depends_on")).toEqual([]);
  });

  test("depends_on resolves rooted then relative and wraps scalars", () => {
    const root = makeBundle({
      "skills/a.md": "---\ntype: skill\ntitle: A\ndepends_on: b\n---\n# A\n\n[B](b.md)\n",
      "skills/b.md": "---\ntype: skill\ntitle: B\ndepends_on: [/skills/c]\n---\n# B\n\n[C](c.md)\n",
      "skills/c.md": "---\ntype: skill\ntitle: C\n---\n# C\n\n[A](a.md)\n",
    });
    const byPath = new Map(buildSkills(scan(root), root).skills.map((s) => [s.path, s]));
    expect(byPath.get("skills/a.md")!.depends_on).toEqual(["skills/b.md"]);
    expect(byPath.get("skills/b.md")!.depends_on).toEqual(["skills/c.md"]);
    expect(byPath.get("skills/c.md")!.depends_on).toEqual([]);
  });

  test("depends_on and tools are ignored on non-skills", () => {
    const root = makeBundle({
      "a.md": "---\ntype: Concept\ntitle: A\ndepends_on: [b.md]\ntools: [x]\n---\n# A\n\n[B](b.md)\n",
      "b.md": "---\ntitle: B\n---\n# B\n\n[A](a.md)\n",
    });
    const docs = scan(root);
    expect(buildGraph(docs).edges.filter((e) => e.kind === "depends_on")).toEqual([]);
    expect(buildSkills(docs, root)).toEqual({ skills: [] });
  });

  test("skills.json lists resolved prerequisites and tools", () => {
    const root = copyBundle("kotiaivot");
    expect(buildSkills(scan(root, undefined, RAW), root)).toEqual({
      skills: [
        {
          depends_on: ["skills/veden-keitto.md"],
          description: "Use when brewing the morning coffee — the whole procedure, kettle to cup.",
          path: "skills/kahvin-keitto.md",
          title: "Kahvin keitto",
          tools: ["tools/keita"],
        },
        {
          depends_on: [],
          description: "Use when you need boiling water — for coffee, tea, or pasta.",
          path: "skills/veden-keitto.md",
          title: "Veden keitto",
          tools: [],
        },
      ],
    });
  });

  test("tools resolve relative to the skill and survive when missing", () => {
    const root = makeBundle({
      "tools/go": "#!/bin/sh\n",
      "skills/a.md": "---\ntype: skill\ntitle: A\ntools: [../tools/go, tools/nope]\n---\n# A\n\n[B](b.md)\n",
      "skills/b.md": "---\ntitle: B\n---\n# B\n\n[A](a.md)\n",
    });
    expect(buildSkills(scan(root), root).skills[0]!.tools).toEqual(["tools/go", "tools/nope"]);
  });

  test("compile writes skills.json and it gates freshness", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    const artifact = join(root, ".brainpick", "t1", "skills.json");
    expect(readJson<SkillsArtifact>(artifact).skills[0]!.path).toBe("skills/kahvin-keitto.md");
    expect(checkFresh(root).fresh).toBe(true);
    writeFileSync(artifact, '{"skills": []}\n');
    expect(checkFresh(root).fresh).toBe(false);
  });

  test("a wiki without skills still writes an empty skills.json", async () => {
    const root = copyBundle();
    await runCompile(root);
    expect(readJson(join(root, ".brainpick", "t1", "skills.json"))).toEqual({ skills: [] });
  });
});

describe("skilltree.md", () => {
  test("renders every skill once with needs and tools", () => {
    const root = copyBundle("kotiaivot");
    const text = renderSkilltree(buildSkills(scan(root, undefined, RAW), root), "skills/" + SKILLTREE_FILE);
    expect(text).toBe(
      "# Skill tree\n\n" +
        "_Generated by `brainpick compile` from `depends_on` frontmatter — edit the\n" +
        "skills, never this file._\n\n" +
        "- [Kahvin keitto](kahvin-keitto.md) — Use when brewing the morning coffee — the whole procedure, kettle to cup.\n" +
        "  - needs [Veden keitto](veden-keitto.md)\n" +
        "  - tools: `../tools/keita`\n" +
        "- [Veden keitto](veden-keitto.md) — Use when you need boiling water — for coffee, tea, or pasta.\n",
    );
  });

  test("compile generates the tree in a brain and never in a wiki", async () => {
    const brain = copyBundle("kotiaivot");
    await runCompile(brain);
    const tree = join(brain, "skills", SKILLTREE_FILE);
    expect(existsSync(tree)).toBe(true);
    const manifest = readJson<{ files: Record<string, unknown> }>(join(brain, ".brainpick", "manifest.json"));
    expect(manifest.files).toHaveProperty("skills/skilltree.md");
    expect(manifest.files).not.toHaveProperty("raw/kuitti.md");
    expect(readFileSync(join(brain, "index.md"), "utf8")).not.toContain("skilltree");
    expect(checkFresh(brain).fresh).toBe(true);
    writeFileSync(tree, "# stale\n");
    expect(checkFresh(brain).fresh).toBe(false);

    const wiki = copyBundle();
    writeFileSync(join(wiki, "kuu.md"), "---\ntype: skill\ntitle: Kuu\n---\n# Kuu\n\n[Maa](maa.md)\n");
    await runCompile(wiki);
    expect(existsSync(join(wiki, SKILLTREE_FILE))).toBe(false);
  });

  test("a dependency cycle is a warning, not a failure", async () => {
    const root = makeBundle({
      "brainpick.toml": "[brain]\nformat = 1\n",
      "a.md": "---\ntype: skill\ntitle: A\ndepends_on: [b.md]\n---\n# A\n\n[B](b.md)\n",
      "b.md": "---\ntype: skill\ntitle: B\ndepends_on: [a.md]\n---\n# B\n\n[A](a.md)\n",
    });
    expect(dependencyCycles(buildSkills(scan(root), root))).toEqual([["a.md", "b.md"]]);
    const result = await runCompile(root);
    expect(result.warnings.some((w) => w.includes("cycle") && w.includes("a.md"))).toBe(true);
    expect(readFileSync(join(root, SKILLTREE_FILE), "utf8").split("\n- [").length - 1).toBe(2);
  });
});

describe("report block", () => {
  test("lists skills only when there are any", () => {
    const brain = copyBundle("kotiaivot");
    const docs = scan(brain, undefined, RAW);
    const block = renderReportBlock(buildGraph(docs), { t1: "fresh" }, ".", null, buildSkills(docs, brain));
    expect(block).toContain("- Skills (read before improvising):\n");
    expect(block).toContain(
      "  - Kahvin keitto (skills/kahvin-keitto.md) — Use when brewing the morning coffee — the whole procedure, kettle to cup.\n    · tools: tools/keita\n",
    );
    expect(block.indexOf("- Skills")).toBeLessThan(block.indexOf("- Bundle root"));

    const wiki = copyBundle();
    const wikiDocs = scan(wiki);
    expect(renderReportBlock(buildGraph(wikiDocs), { t1: "fresh" }, ".", null, buildSkills(wikiDocs, wiki))).not.toContain("Skills");
  });
});

describe("search", () => {
  test("keyword search boosts a matching skill above prose", () => {
    const records = buildDocsRecords(scan(copyBundle("kotiaivot"), undefined, RAW));
    const hits = search(records, "morning coffee", 8); // raw BM25 ranks the prose page first
    expect(hits.map((h) => h.path).slice(0, 2)).toEqual(["skills/kahvin-keitto.md", "knowledge/kahvi.md"]);
  });

  test("the boost never surfaces a skill the query missed", () => {
    const records = buildDocsRecords(scan(copyBundle("kotiaivot"), undefined, RAW));
    expect(search(records, "click", 8).map((h) => h.path)).toEqual(["skills/veden-keitto.md"]);
  });
});

describe("overview / read payloads", () => {
  test("overview lists skills apart from the tree", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaivot")));
    expect(result["skills"]).toEqual([
      {
        path: "skills/kahvin-keitto.md",
        title: "Kahvin keitto",
        description: "Use when brewing the morning coffee — the whole procedure, kettle to cup.",
        depends_on: ["skills/veden-keitto.md"],
        tools: ["tools/keita"],
      },
      {
        path: "skills/veden-keitto.md",
        title: "Veden keitto",
        description: "Use when you need boiling water — for coffee, tea, or pasta.",
        depends_on: [],
        tools: [],
      },
    ]);
    expect(String(result["hint"]).toLowerCase()).toContain("skill");
    const tree = result["tree"] as Array<{ docs: Array<{ path: string }> }>;
    expect(tree.some((g) => g.docs.some((d) => d.path.endsWith("skilltree.md")))).toBe(false);
  });

  test("overview skills survive budget trimming", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaivot")), 150);
    expect(result["truncated"]).toBe(true);
    expect((result["skills"] as unknown[]).length).toBe(2);
  });

  test("overview without skills has an empty list", async () => {
    const result = overviewPayload(await stateOf(copyBundle()));
    expect(result["skills"]).toEqual([]);
    expect(String(result["hint"]).toLowerCase()).not.toContain("skill");
  });

  test("read on a skill returns prerequisites, dependents and tools", async () => {
    const state = await stateOf(copyBundle("kotiaivot"));
    const result = readPayload(state, "kahvin-keitto");
    expect(result["skill"]).toEqual({
      depends_on: [{ path: "skills/veden-keitto.md", title: "Veden keitto" }],
      dependents: [],
      tools: [{ path: "tools/keita", exists: true }],
    });
    expect(String(result["hint"])).toContain("tools/keita");
    expect(String(result["hint"])).toContain("never");
    const dep = readPayload(state, "veden-keitto");
    expect((dep["skill"] as { dependents: unknown[] }).dependents).toEqual([
      { path: "skills/kahvin-keitto.md", title: "Kahvin keitto" },
    ]);
    expect(readPayload(state, "kahvi")).not.toHaveProperty("skill");
  });

  test("search payload ranks the boosted skill first", async () => {
    const result = await searchPayload(await stateOf(copyBundle("kotiaivot")), "morning coffee", "keyword");
    expect((result["hits"] as Array<{ path: string }>)[0]!.path).toBe("skills/kahvin-keitto.md");
  });

  test("federation qualifies skill payload paths", () => {
    const overview = { skills: [{ path: "skills/a.md", title: "A", description: null, depends_on: ["skills/b.md"], tools: ["tools/x"] }] };
    expect(qualifyPaths("me", overview)).toEqual({
      skills: [{ path: "me:skills/a.md", title: "A", description: null, depends_on: ["me:skills/b.md"], tools: ["me:tools/x"] }],
    });
    const read = {
      path: "skills/b.md",
      skill: {
        depends_on: [{ path: "skills/c.md", title: "C" }],
        dependents: [{ path: "skills/a.md", title: "A" }],
        tools: [{ path: "tools/x", exists: true }],
      },
    };
    expect(qualifyPaths("me", read).skill).toEqual({
      depends_on: [{ path: "me:skills/c.md", title: "C" }],
      dependents: [{ path: "me:skills/a.md", title: "A" }],
      tools: [{ path: "me:tools/x", exists: true }],
    });
  });
});

describe("CLI: brainpick skill list / new", () => {
  test("list, plain and JSON", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    const plain = await skillList(root, false);
    expect(plain.out).toContain("skills/kahvin-keitto.md");
    expect(plain.out).toContain("Use when brewing");
    expect(plain.out).toContain("needs");
    const json = await skillList(root, true);
    expect(JSON.parse(json.out!).skills[1].path).toBe("skills/veden-keitto.md");
  });

  test("list self-heals when uncompiled", async () => {
    const result = await skillList(copyBundle("kotiaivot"), false);
    expect(result.code).toBe(0);
    expect(result.err).toContain("compile");
  });

  test("new scaffolds a compliant doc and compiles", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    const result = await skillNew(root, "Tee Batch Upscale", {
      description: "Use when a folder of images needs upscaling in one go.",
      dependsOn: ["skills/veden-keitto.md"],
      tools: ["tools/keita"],
    });
    expect(result.code).toBe(0);
    const text = readFileSync(join(root, "skills", "tee-batch-upscale.md"), "utf8");
    expect(text.startsWith('---\ntype: skill\ntitle: "Tee Batch Upscale"\n')).toBe(true);
    expect(text).toContain('description: "Use when a folder of images needs upscaling in one go."');
    expect(text).toMatch(/timestamp: 20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ\n/);
    expect(text).toContain("depends_on: [skills/veden-keitto.md]");
    expect(text).toContain("tools: [tools/keita]");
    for (const heading of ["## Trigger", "## Steps", "## Tools", "## Gotchas", "## When not to use this", "## Evaluation log", "## Related"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("[Veden keitto](veden-keitto.md)");
    expect(checkFresh(root).fresh).toBe(true);
    const skills = readJson<SkillsArtifact>(join(root, ".brainpick", "t1", "skills.json"));
    expect(skills.skills.map((s) => s.path)).toContain("skills/tee-batch-upscale.md");
    expect(result.out).toContain("skills/tee-batch-upscale.md");
  });

  test("new refuses to overwrite", async () => {
    const result = await skillNew(copyBundle("kotiaivot"), "kahvin-keitto");
    expect(result.code).toBe(1);
    expect(result.err).toContain("exists");
  });

  test("new picks the skills dir or the root", async () => {
    const wiki = copyBundle();
    expect((await skillNew(wiki, "first")).code).toBe(0);
    expect(existsSync(join(wiki, "skills", "first.md"))).toBe(true);
    const brain = copyBundle("kotiaivot");
    expect((await skillNew(brain, "second")).code).toBe(0);
    expect(existsSync(join(brain, "skills", "second.md"))).toBe(true);
  });
});
