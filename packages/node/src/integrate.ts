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
 * The shipped Agent Skill (integrations/skill/SKILL.md, canonical) rides inside the
 * package; the parity test asserts the shipped copy is byte-identical to the canonical.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { runCompile } from "./compile/pipeline";
import { REPORT_BEGIN_PREFIX, REPORT_END_MARKER } from "./compile/t1";
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
const REPORT_PLACEHOLDER =
  `${REPORT_BEGIN_PREFIX}pending) -->\n` +
  "_brainpick fills this block on the next `brainpick compile`._\n" +
  REPORT_END_MARKER;

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
