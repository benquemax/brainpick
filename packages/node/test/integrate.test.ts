/** `brainpick integrate` (skill, MCP snippets, the AGENTS.md report) and the
 * compile-side report fill. Twin of packages/python/tests/test_integrate.py. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { REPORT_BEGIN_PREFIX, REPORT_END_MARKER } from "../src/compile/t1";
import { runIntegrate, SKILL_DESTINATIONS, skillPath, skillText } from "../src/integrate";
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
