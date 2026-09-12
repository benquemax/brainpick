/** `brainpick integrate` (skill, MCP snippets, the AGENTS.md report) and the
 * compile-side report fill. Twin of packages/python/tests/test_integrate.py. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { REPORT_BEGIN_PREFIX, REPORT_END_MARKER } from "../src/compile/t1";
import {
  exportedSkillStubs,
  installRitual,
  renderRitualBlock,
  renderSkillStub,
  REPORT_PLACEHOLDER,
  RITUAL_BEGIN_PREFIX,
  RITUAL_END_MARKER,
  RITUAL_VERSION,
  ritualPath,
  runIntegrate,
  SKILL_DESTINATIONS,
  skillPath,
  skillText,
} from "../src/integrate";
import { cleanup, FIXTURE_BUNDLES, REPO_ROOT, tempDir } from "./helpers";

afterEach(cleanup);

const CANONICAL = join(REPO_ROOT, "integrations", "skill", "SKILL.md");

/** A git repo whose bundle is the kotiaurinko fixture in a subdirectory. */
function gitRepoWithBundle(): { repo: string; bundle: string } {
  const repo = join(tempDir(), "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const bundle = join(repo, "wiki");
  cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), bundle, { recursive: true });
  return { repo, bundle };
}

const silent = { print: () => {} };

describe("Agent Skill parity", () => {
  test("the shipped skill is byte-identical to the repo-root canonical", () => {
    expect(readFileSync(skillPath(), "utf8")).toBe(readFileSync(CANONICAL, "utf8"));
    expect(skillText().startsWith("---\nname: brainpick\n")).toBe(true);
    expect(skillText().split("---")[1]).toContain("description:");
  });
});

describe("integrate claude-code / opencode", () => {
  test("claude-code writes the skill and prints snippets", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    const lines: string[] = [];
    expect(await runIntegrate("claude-code", bundle, { print: (l) => lines.push(l) })).toBe(0);
    expect(readFileSync(join(repo, SKILL_DESTINATIONS["claude-code"]), "utf8")).toBe(
      readFileSync(CANONICAL, "utf8"),
    );
    const out = lines.join("\n");
    expect(out).toContain("PreToolUse");
    expect(out).toContain("Grep|Glob");
    expect(out).toContain("claude mcp add brainpick");
  });

  test("opencode writes the skill under its convention", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    const lines: string[] = [];
    expect(await runIntegrate("opencode", bundle, { print: (l) => lines.push(l) })).toBe(0);
    expect(existsSync(join(repo, SKILL_DESTINATIONS["opencode"]))).toBe(true);
    expect(lines.join("\n").toLowerCase()).toContain("opencode");
  });

  test("dry-run is inert", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    await runIntegrate("claude-code", bundle, { dryRun: true, ...silent });
    expect(existsSync(join(repo, ".claude"))).toBe(false);
    await runIntegrate("agents-md", bundle, { dryRun: true, ...silent });
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(false);
  });
});

describe("integrate agents-md", () => {
  test("creates markers and fills the block", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    expect(await runIntegrate("agents-md", bundle, silent)).toBe(0);
    const text = readFileSync(join(repo, "AGENTS.md"), "utf8");
    expect(text).toContain(REPORT_BEGIN_PREFIX);
    expect(text).toContain(REPORT_END_MARKER);
    expect(text).toContain("Consult the brain BEFORE grepping");
    expect(text).toContain("- Counts: 10 docs · 20 links · 8 tags · 1 orphans · 1 ghosts");
    expect(text).toContain("Bundle root: wiki");
  });

  test("places the report above the henxels block", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    const agents = join(repo, "AGENTS.md");
    writeFileSync(agents, "# AGENTS.md\n\nIntro.\n\n<!-- henxels:begin -->\ncontract\n<!-- henxels:end -->\n", "utf8");
    await runIntegrate("agents-md", bundle, silent);
    const text = readFileSync(agents, "utf8");
    expect(text.indexOf(REPORT_BEGIN_PREFIX)).toBeLessThan(text.indexOf("<!-- henxels:begin -->"));
    expect(text).toContain("Intro.");
    expect(text).toContain("contract");
  });
});

describe("the compile-side fill (spec/20 mechanics)", () => {
  test("compile fills a marked repo AGENTS.md, preserving its surroundings", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    const agents = join(repo, "AGENTS.md");
    writeFileSync(
      agents,
      `top matter\n\n${REPORT_BEGIN_PREFIX}old) -->\nplaceholder\n${REPORT_END_MARKER}\nbottom matter\n`,
      "utf8",
    );
    await runCompile(bundle);
    const text = readFileSync(agents, "utf8");
    expect(text).not.toContain("placeholder");
    expect(text).toContain("- Counts: 10 docs");
    expect(text.startsWith("top matter\n")).toBe(true);
    expect(text.trimEnd().endsWith("bottom matter")).toBe(true);
  });

  test("compile never creates AGENTS.md", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    await runCompile(bundle);
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(bundle, "AGENTS.md"))).toBe(false);
  });

  test("the report fill is idempotent", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    const agents = join(repo, "AGENTS.md");
    writeFileSync(agents, `x\n\n${REPORT_BEGIN_PREFIX}p) -->\n_\n${REPORT_END_MARKER}\n`, "utf8");
    await runCompile(bundle);
    const first = readFileSync(agents);
    await runCompile(bundle);
    expect(readFileSync(agents).equals(first)).toBe(true);
  });
});

// -- exported skills: pointer stubs beside the brainpick skill (spec/85) ---------

/** A git repo whose bundle is the kotiaivot brain (one skill exports itself). */
function gitRepoWithBrain(): { repo: string; bundle: string } {
  const repo = join(tempDir(), "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const bundle = join(repo, "brain");
  cpSync(join(FIXTURE_BUNDLES, "kotiaivot"), bundle, { recursive: true });
  return { repo, bundle };
}

describe("exported skills", () => {
  test("the stub is a pointer, not a copy", () => {
    const stub = renderSkillStub({
      depends_on: ["skills/veden-keitto.md"],
      description: "Use when brewing.",
      export: ["agent-skill"],
      path: "skills/kahvin-keitto.md",
      title: "Kahvin keitto",
      tools: ["tools/keita"],
    });
    expect(stub.startsWith("---\nname: kahvin-keitto\ndescription: Use when brewing.\n---\n")).toBe(true);
    expect(stub).toContain("# Kahvin keitto");
    expect(stub).toContain("`brain_read skills/kahvin-keitto.md`");
    expect(stub).toContain("- Prerequisites: skills/veden-keitto.md");
    expect(stub).toContain("- Tools: tools/keita");
    const bare = renderSkillStub({
      depends_on: [], description: null, export: ["agent-skill"], path: "skills/x.md", title: "X", tools: [],
    });
    expect(bare).toContain("description: X\n");
    expect(bare).toContain("- Prerequisites: none");
    expect(bare).toContain("- Tools: none");
  });

  test("stubs come from skills.json in path order", async () => {
    const { bundle } = gitRepoWithBrain();
    await runCompile(bundle);
    expect(exportedSkillStubs(bundle).map((s) => s.path)).toEqual(["skills/kahvin-keitto.md"]);
  });

  test.each(["claude-code", "opencode"] as const)("%s writes a stub per exported skill", async (target) => {
    const { repo, bundle } = gitRepoWithBrain();
    await runCompile(bundle);
    const lines: string[] = [];
    expect(await runIntegrate(target, bundle, { print: (l) => lines.push(l) })).toBe(0);
    const skillsDir = join(repo, SKILL_DESTINATIONS[target], "..", "..");
    const stub = join(skillsDir, "kahvin-keitto", "SKILL.md");
    expect(existsSync(stub)).toBe(true);
    expect(readFileSync(stub, "utf8")).toContain("This skill lives in the brain at `skills/kahvin-keitto.md`");
    expect(existsSync(join(skillsDir, "veden-keitto"))).toBe(false);
    expect(lines.join("\n")).toContain("exported skill");
  });

  test("a stub that would shadow brainpick is skipped", async () => {
    const { repo, bundle } = gitRepoWithBrain();
    writeFileSync(
      join(bundle, "skills", "brainpick.md"),
      "---\ntype: skill\ntitle: Brainpick\nexport: agent-skill\n---\n# Brainpick\n\n[Kahvin keitto](kahvin-keitto.md)\n",
    );
    await runCompile(bundle);
    const lines: string[] = [];
    expect(await runIntegrate("claude-code", bundle, { print: (l) => lines.push(l) })).toBe(0);
    expect(readFileSync(join(repo, SKILL_DESTINATIONS["claude-code"]), "utf8")).toBe(readFileSync(CANONICAL, "utf8"));
    expect(lines.join("\n")).toContain("shadow");
  });

  test("dry-run names the stubs without writing", async () => {
    const { repo, bundle } = gitRepoWithBrain();
    await runCompile(bundle);
    const lines: string[] = [];
    expect(await runIntegrate("claude-code", bundle, { dryRun: true, print: (l) => lines.push(l) })).toBe(0);
    expect(existsSync(join(repo, ".claude"))).toBe(false);
    expect(lines.join("\n")).toContain("kahvin-keitto");
  });
});

describe("the brain ritual block (spec/20)", () => {
  const CANONICAL_RITUAL = join(REPO_ROOT, "integrations", "ritual", "RITUAL.md");

  test("the shipped ritual is byte-identical to the canonical and renders as the golden", () => {
    expect(readFileSync(ritualPath(), "utf8")).toBe(readFileSync(CANONICAL_RITUAL, "utf8"));
    const block = renderRitualBlock();
    expect(block.startsWith(`${RITUAL_BEGIN_PREFIX}${RITUAL_VERSION}) -->\n`)).toBe(true);
    expect(block.endsWith(RITUAL_END_MARKER + "\n")).toBe(true);
    expect(block).toContain("git pull --ff-only");
    expect(block).toContain("git push");
    const golden = join(REPO_ROOT, "spec", "fixtures", "expected", "ritual-block.md");
    expect(block).toBe(readFileSync(golden, "utf8"));
  });

  test("installs directly below the report block, above henxels", () => {
    const text = "# A\n\nIntro.\n\n" + REPORT_PLACEHOLDER + "\n\n<!-- henxels:begin -->\nc\n<!-- henxels:end -->\n";
    const out = installRitual(text);
    const after = out.slice(out.indexOf(REPORT_END_MARKER) + REPORT_END_MARKER.length);
    expect(after.startsWith("\n\n" + RITUAL_BEGIN_PREFIX)).toBe(true);
    expect(out.indexOf(RITUAL_END_MARKER)).toBeLessThan(out.indexOf("<!-- henxels:begin -->"));
    expect(out).toContain("Intro.");
    expect(out).toContain("\nc\n");
  });

  test("without a report it follows the report placement", () => {
    const out = installRitual("# A\n\nIntro.\n\n<!-- henxels:begin -->\nc\n<!-- henxels:end -->\n");
    expect(out.indexOf(RITUAL_BEGIN_PREFIX)).toBeLessThan(out.indexOf("<!-- henxels:begin -->"));
    expect(installRitual("# A\n").endsWith(RITUAL_END_MARKER + "\n")).toBe(true);
  });

  test("is idempotent and replaces an older version in place", () => {
    const once = installRitual("# A\n");
    expect(installRitual(once)).toBe(once);
    const stale = once
      .replace(`${RITUAL_BEGIN_PREFIX}${RITUAL_VERSION}) -->`, `${RITUAL_BEGIN_PREFIX}0) -->`)
      .replace("git pull --ff-only", "OLD TEXT");
    expect(installRitual(stale)).toBe(once);
  });

  test("agents-md installs it below the report and says so", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    const lines: string[] = [];
    expect(await runIntegrate("agents-md", bundle, { print: (l) => lines.push(l) })).toBe(0);
    const text = readFileSync(join(repo, "AGENTS.md"), "utf8");
    expect(text.indexOf(REPORT_END_MARKER)).toBeLessThan(text.indexOf(RITUAL_BEGIN_PREFIX));
    expect(lines.join("\n")).toContain("ritual: installed");
    lines.length = 0;
    await runIntegrate("agents-md", bundle, { print: (l) => lines.push(l) });
    expect(lines.join("\n")).toContain("ritual: already current");
  });

  test.each(["claude-code", "opencode"])("%s installs it only into an existing AGENTS.md", async (target) => {
    const { repo, bundle } = gitRepoWithBundle();
    const lines: string[] = [];
    expect(await runIntegrate(target, bundle, { print: (l) => lines.push(l) })).toBe(0);
    expect(existsSync(join(repo, "AGENTS.md"))).toBe(false);
    expect(lines.join("\n")).toContain("no AGENTS.md");
    writeFileSync(join(repo, "AGENTS.md"), "# A\n", "utf8");
    expect(await runIntegrate(target, bundle, silent)).toBe(0);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain(RITUAL_BEGIN_PREFIX);
  });

  test("dry-run names the ritual without writing", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    writeFileSync(join(repo, "AGENTS.md"), "# A\n", "utf8");
    const lines: string[] = [];
    await runIntegrate("agents-md", bundle, { dryRun: true, print: (l) => lines.push(l) });
    expect(lines.join("\n")).toContain("ritual");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("# A\n");
  });

  test("compile never touches the ritual block", async () => {
    const { repo, bundle } = gitRepoWithBundle();
    await runIntegrate("agents-md", bundle, silent);
    const agents = join(repo, "AGENTS.md");
    const before = readFileSync(agents, "utf8");
    await runCompile(bundle, true);
    const after = readFileSync(agents, "utf8");
    const slice = (t: string) => t.slice(t.indexOf(RITUAL_BEGIN_PREFIX), t.indexOf(RITUAL_END_MARKER));
    expect(slice(after)).toBe(slice(before));
  });
});
