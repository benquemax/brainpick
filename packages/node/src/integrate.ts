/** `brainpick integrate <target>`: meet agents where they live. Ports integrate.py.
 *
 * Three targets, one family voice (mirrors henxels' `integrate`):
 *
 * - `claude-code`  — write the Agent Skill into the repo, then PRINT a paste-able
 *   graph-before-grep PreToolUse hook and the `claude mcp add` snippet (settings.json
 *   is never edited for you).
 * - `opencode`     — write the skill under OpenCode's convention, then PRINT the
 *   opencode.json MCP snippet.
 * - `agents-md`    — ensure an AGENTS.md exists (the one place integrate may create a
 *   file), install the brain-report markers if absent, and compile so the block fills.
 *
 * Every target also installs the brain ritual block (spec/20) into AGENTS.md when
 * one exists — pull and compile first, consult before grepping, record while
 * working, commit and push last — directly below the report block; `agents-md`
 * creates the file so the ritual always lands.
 *
 * The shipped Agent Skill (integrations/skill/SKILL.md, canonical) and the ritual
 * (integrations/ritual/RITUAL.md) ride inside the package; parity tests assert the
 * shipped copies are byte-identical to the canonicals.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { runCompile } from "./compile/pipeline";
import { REPORT_BEGIN_PREFIX, REPORT_END_MARKER } from "./compile/t1";
import type { SkillRecord, SkillsArtifact } from "./compile/skills";
import { findRepoRoot } from "./detect";
import { mcpSnippets, Voice, type Print } from "./scaffold";
import { PACKAGE_ROOT } from "./version";

export const TARGETS = ["claude-code", "opencode", "agents-md"] as const;
export type Target = (typeof TARGETS)[number];

const HENXELS_BEGIN = "<!-- henxels:begin -->";

// harness -> where its Agent Skill lands, relative to the repo root
export const SKILL_DESTINATIONS: Record<"claude-code" | "opencode", string> = {
  "claude-code": join(".claude", "skills", "brainpick", "SKILL.md"),
  opencode: join(".opencode", "skills", "brainpick", "SKILL.md"),
};

const MINIMAL_AGENTS = "# AGENTS.md\n\nWorking notes for agents in this repository.\n";
export const REPORT_PLACEHOLDER =
  `${REPORT_BEGIN_PREFIX}pending) -->\n` +
  "_brainpick fills this block on the next `brainpick compile`._\n" +
  REPORT_END_MARKER;

// The brain ritual block (spec/20 *The brain ritual block*): static text, versioned
// by the canonical itself, installed by every integrate target, never generated.
export const RITUAL_VERSION = 1;
export const RITUAL_BEGIN_PREFIX = "<!-- brainpick:begin ritual (v";
export const RITUAL_END_MARKER = "<!-- brainpick:end ritual -->";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RITUAL_BLOCK = new RegExp(escapeRe(RITUAL_BEGIN_PREFIX) + "(\\d+)\\) -->\\n[\\s\\S]*?" + escapeRe(RITUAL_END_MARKER));

/** The shipped Agent Skill: the package copy first (installed tarballs), then the
 * repo-root canonical (dev checkout). */
export function skillPath(): string {
  const packaged = resolve(PACKAGE_ROOT, "skill", "SKILL.md");
  try {
    if (statSync(packaged).isFile()) return packaged;
  } catch {
    /* installed without the shipped copy — fall through to the repo canonical */
  }
  return resolve(PACKAGE_ROOT, "..", "..", "integrations", "skill", "SKILL.md");
}

export function skillText(): string {
  return readFileSync(skillPath(), "utf8");
}

/** The shipped ritual text: the package copy first, then the repo-root canonical. */
export function ritualPath(): string {
  const packaged = resolve(PACKAGE_ROOT, "ritual", "RITUAL.md");
  try {
    if (statSync(packaged).isFile()) return packaged;
  } catch {
    /* installed without the shipped copy — fall through to the repo canonical */
  }
  return resolve(PACKAGE_ROOT, "..", "..", "integrations", "ritual", "RITUAL.md");
}

/** The fenced block exactly as it lands in AGENTS.md (conformance class `ritual`). */
export function renderRitualBlock(): string {
  const body = readFileSync(ritualPath(), "utf8").replace(/^\n+|\n+$/g, "");
  return `${RITUAL_BEGIN_PREFIX}${RITUAL_VERSION}) -->\n${body}\n${RITUAL_END_MARKER}\n`;
}

/** The version of the ritual block `text` carries, or null when it has none. */
export function ritualVersionIn(text: string): number | null {
  const m = RITUAL_BLOCK.exec(text);
  return m ? Number(m[1]) : null;
}

/** Install (or refresh) the ritual block: directly below the report block when
 * there is one, else where the report would go (above henxels, else at the end).
 * An older version is replaced in place; the current one is left untouched. */
export function installRitual(text: string): string {
  const block = renderRitualBlock().replace(/\n+$/, "");
  const m = RITUAL_BLOCK.exec(text);
  if (m) {
    if (Number(m[1]) >= RITUAL_VERSION) return text;
    return text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
  }
  const end = text.indexOf(REPORT_END_MARKER);
  if (end !== -1) {
    const after = end + REPORT_END_MARKER.length;
    const rest = text.slice(after);
    return text.slice(0, after) + "\n\n" + block + (rest.replace(/^\n+|\n+$/g, "") ? "\n" + rest : "\n");
  }
  const idx = text.indexOf(HENXELS_BEGIN);
  if (idx !== -1) {
    return text.slice(0, idx).replace(/\n+$/, "") + "\n\n" + block + "\n\n" + text.slice(idx);
  }
  return text.replace(/\n+$/, "") + "\n\n" + block + "\n";
}

/** Apply the ritual to the repo's AGENTS.md; returns the text to write (null when
 * nothing is to be written). Harness targets never create the file — `agents-md` does. */
function installRitualInto(voice: Voice, repo: string, dryRun: boolean, create: boolean): string | null {
  const agents = join(repo, "AGENTS.md");
  let text: string;
  if (!existsSync(agents)) {
    if (!create) {
      voice.line("○", `ritual: no AGENTS.md at ${repo} — run \`brainpick integrate agents-md\` to create one`);
      return null;
    }
    text = MINIMAL_AGENTS;
  } else {
    text = readFileSync(agents, "utf8");
  }
  const have = ritualVersionIn(text);
  if (dryRun) {
    if (have === null) voice.step(`• install the brain ritual block (v${RITUAL_VERSION}) in ${agents}`);
    else if (have < RITUAL_VERSION) voice.step(`• refresh the brain ritual block v${have} → v${RITUAL_VERSION} in ${agents}`);
    return null;
  }
  const out = installRitual(text);
  if (have === null) voice.line("✓", `ritual: installed (v${RITUAL_VERSION}) in ${agents} — pull first, push last`);
  else if (have < RITUAL_VERSION) voice.line("✓", `ritual: refreshed v${have} → v${RITUAL_VERSION} in ${agents}`);
  else voice.line("○", `ritual: already current (v${RITUAL_VERSION}) in ${agents}`);
  return out;
}

function ritualForHarness(voice: Voice, repo: string, dryRun: boolean): void {
  const out = installRitualInto(voice, repo, dryRun, false);
  if (out !== null) writeFileSync(join(repo, "AGENTS.md"), out, "utf8");
}

/** A paste-able Claude Code PreToolUse fragment that nudges the agent toward the
 * brain before it greps — advisory (exit 0), never a block. */
function graphBeforeGrepHook(): string {
  const fragment = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Grep|Glob",
          hooks: [
            {
              type: "command",
              command:
                "echo 'brainpick: consult the brain first — brain_search " +
                "or `brainpick search` before grepping' >&2",
            },
          ],
        },
      ],
    },
  };
  return JSON.stringify(fragment, null, 2);
}

const STUB_TEMPLATE = `---
name: {name}
description: {description}
---

# {title}

This skill lives in the brain at \`{path}\`. Read it there before acting —
\`brain_read {path}\` (MCP) or \`brainpick read {path}\` (CLI) — the brain
copy is canonical and carries its prerequisites and tools.

- Prerequisites: {prerequisites}
- Tools: {tools}
`;

function stemOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

/** The pointer stub for one exported skill (spec/85 *Exported skills*): the
 * harness loads it on its trigger, the brain stays canonical. */
export function renderSkillStub(skill: SkillRecord): string {
  const description = (skill.description || skill.title).replace(/\n/g, " ").trim();
  const fill: Record<string, string> = {
    name: stemOf(skill.path),
    description,
    title: skill.title,
    path: skill.path,
    prerequisites: skill.depends_on.join(", ") || "none",
    tools: skill.tools.join(", ") || "none",
  };
  return STUB_TEMPLATE.replace(/\{(\w+)\}/g, (_m, key: string) => fill[key] ?? "");
}

/** The skills that declare `export: agent-skill`, from the compiled
 * t1/skills.json (path order) — empty when the bundle is uncompiled or a wiki. */
export function exportedSkillStubs(root: string): SkillRecord[] {
  try {
    const data = JSON.parse(readFileSync(join(root, ".brainpick", "t1", "skills.json"), "utf8")) as SkillsArtifact;
    return (data.skills ?? []).filter((s) => (s.export ?? []).includes("agent-skill"));
  } catch {
    return [];
  }
}

function writeStubs(voice: Voice, root: string, repo: string, target: "claude-code" | "opencode", dryRun: boolean): void {
  const skillsDir = dirname(dirname(join(repo, SKILL_DESTINATIONS[target])));
  for (const skill of exportedSkillStubs(root)) {
    const name = stemOf(skill.path);
    if (name === "brainpick") {
      voice.line("!", `exported skill ${skill.path} skipped — its stub would shadow the brainpick skill; rename the doc`);
      continue;
    }
    const dest = join(skillsDir, name, "SKILL.md");
    if (dryRun) {
      voice.step(`• write the exported skill stub ${dest}`);
      continue;
    }
    const existed = existsSync(dest);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderSkillStub(skill), "utf8");
    voice.line("✓", `exported skill: ${existed ? "updated" : "wrote"} ${dest} → ${skill.path}`);
  }
}

function writeSkill(repo: string, target: "claude-code" | "opencode", dryRun: boolean): [string, boolean] {
  const dest = join(repo, SKILL_DESTINATIONS[target]);
  const existed = existsSync(dest);
  if (!dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, skillText(), "utf8");
  }
  return [dest, existed];
}

/** Install the report markers above the henxels digest block when one exists,
 * else at the end — never disturbing hand-written content. */
export function insertReportMarkers(text: string): string {
  if (text.includes(REPORT_BEGIN_PREFIX)) return text;
  const idx = text.indexOf(HENXELS_BEGIN);
  if (idx !== -1) {
    return text.slice(0, idx).replace(/\n+$/, "") + "\n\n" + REPORT_PLACEHOLDER + "\n\n" + text.slice(idx);
  }
  return text.replace(/\n+$/, "") + "\n\n" + REPORT_PLACEHOLDER + "\n";
}

function integrateClaudeCode(voice: Voice, root: string, repo: string, dryRun: boolean): number {
  const [dest, existed] = writeSkill(repo, "claude-code", dryRun);
  const verb = dryRun ? "would write" : existed ? "updated" : "wrote";
  voice.line("✓", `skill: ${verb} ${dest}`);
  writeStubs(voice, root, repo, "claude-code", dryRun);
  ritualForHarness(voice, repo, dryRun);
  if (dryRun) {
    voice.step("• print the graph-before-grep PreToolUse hook and the `claude mcp add` snippet");
    return 0;
  }
  voice.raw();
  voice.raw("Paste into .claude/settings.json (settings are never edited for you):");
  voice.raw();
  voice.raw(graphBeforeGrepHook());
  voice.raw();
  voice.raw(mcpSnippets(root));
  return 0;
}

function integrateOpencode(voice: Voice, root: string, repo: string, dryRun: boolean): number {
  const [dest, existed] = writeSkill(repo, "opencode", dryRun);
  const verb = dryRun ? "would write" : existed ? "updated" : "wrote";
  voice.line("✓", `skill: ${verb} ${dest}`);
  writeStubs(voice, root, repo, "opencode", dryRun);
  ritualForHarness(voice, repo, dryRun);
  if (dryRun) {
    voice.step("• print the opencode.json MCP snippet");
    return 0;
  }
  voice.raw();
  voice.raw("Add the MCP server to opencode.json (merging JSON is left to you):");
  voice.raw();
  voice.raw(mcpSnippets(root));
  return 0;
}

async function integrateAgentsMd(voice: Voice, root: string, repo: string, dryRun: boolean): Promise<number> {
  const agents = join(repo, "AGENTS.md");
  const existed = existsSync(agents);
  const hasMarkers = existed && readFileSync(agents, "utf8").includes(REPORT_BEGIN_PREFIX);

  if (dryRun) {
    if (!existed) voice.step(`• create a minimal ${agents}`);
    if (!hasMarkers) voice.step(`• install the brain-report markers in ${agents}`);
    installRitualInto(voice, repo, true, true);
    voice.step(`• compile ${root} so the report block fills`);
    return 0;
  }

  let text = existed ? readFileSync(agents, "utf8") : MINIMAL_AGENTS;
  if (!existed) voice.line("✓", `AGENTS.md: created ${agents}`);
  if (!text.includes(REPORT_BEGIN_PREFIX)) {
    text = insertReportMarkers(text);
    voice.line("✓", `report: markers installed in ${agents}`);
  } else {
    voice.line("○", `report: markers already in ${agents}`);
  }
  writeFileSync(agents, text, "utf8");
  const ritual = installRitualInto(voice, repo, false, true);
  if (ritual !== null) writeFileSync(agents, ritual, "utf8");

  const result = await runCompile(root);
  voice.line("✓", `compiled: the report block is filled (seq ${result.seq})`);
  voice.step(`read it back: sed -n '/brainpick:begin report/,/brainpick:end report/p' ${agents}`);
  return 0;
}

export interface IntegrateOptions {
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  print?: Print;
}

export async function runIntegrate(target: string, root: string, options: IntegrateOptions = {}): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line));
  if (!(TARGETS as readonly string[]).includes(target)) {
    print(`unknown target '${target}'; choose from ${TARGETS.join(", ")}`);
    return 1;
  }
  const voice = new Voice(options.env ?? process.env, print);
  voice.banner();
  const resolved = resolve(root);
  let isDir = false;
  try {
    isDir = statSync(resolved).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    voice.line("✗", `${resolved} is not a directory`);
    return 1;
  }
  const repo = findRepoRoot(resolved) ?? resolved;
  voice.line("○", `repo root: ${repo}` + (repo !== resolved ? "" : " (the bundle is its own repo)"));
  if (options.dryRun) {
    voice.raw();
    voice.raw(`dry run — nothing written. integrate ${target} would:`);
  }

  if (target === "claude-code") return integrateClaudeCode(voice, resolved, repo, Boolean(options.dryRun));
  if (target === "opencode") return integrateOpencode(voice, resolved, repo, Boolean(options.dryRun));
  return integrateAgentsMd(voice, resolved, repo, Boolean(options.dryRun));
}
