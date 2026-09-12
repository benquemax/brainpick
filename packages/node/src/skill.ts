/** `brainpick skill new|list` (spec/85 *Skills*): scaffold a compliant, empty
 * skill whose body carries the evaluate-and-improve loop, and list the skills a
 * compiled brain holds. Brainpick ships no skills of its own — a skill is
 * something an agent distils from its own repetition; this only makes the first
 * draft cost one call. The twin of the Python skill_cmd.py. */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

import { runCompile } from "./compile/pipeline";
import { buildSkills, type SkillRecord } from "./compile/skills";
import { loadConfig } from "./config";
import { posixDirname, scan } from "./core/bundle";
import { heldState } from "./query/mirrors";
import { toJson } from "./query/present";

const TEMPLATE = `# {title}

## Trigger

<!-- When does this skill apply? The description above is what search and the
overview show — make it start with "Use when …" so an agent recognises the
moment. -->

## Steps

1. {first_step}

## Tools

<!-- The deterministic parts, demoted to scripts listed in \`tools:\` above.
Say what each one does and how to run it; brainpick never runs them for you. -->
{tools_section}
## Gotchas

<!-- What went wrong last time and how the steps now avoid it. -->

## When not to use this

<!-- The boundary: the neighbouring situation where a different skill (or no
skill) is right. -->

## Evaluation log

<!-- After every use: did the steps hold? What was manual that should be a
tool? Improve the steps, bump \`timestamp\`, add a dated line here. -->

- {date}: created.

## Related
{related_section}`;

/** A skill name -> its kebab-case file stem (the wiki convention). */
export function kebab(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem || "skill";
}

function yamlList(values: string[]): string {
  return "[" + values.join(", ") + "]";
}

function yamlStr(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** Beside the existing skills (the first by path); `skills/` by convention
 * when there are none yet — the template's folder, never the engine's test. */
export function skillsDir(existing: SkillRecord[]): string {
  const first = existing[0];
  return first ? posixDirname(first.path) : "skills";
}

/** The whole file: OKF frontmatter (`type: skill`, a real timestamp) plus the
 * template body, with each prerequisite linked so the new page is not an orphan. */
export function renderSkill(
  title: string,
  description: string,
  dependsOn: string[],
  tools: string[],
  titles: Map<string, string>,
  ownDir: string,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "---",
    "type: skill",
    `title: ${yamlStr(title)}`,
    `description: ${yamlStr(description)}`,
    `timestamp: ${stamp}`,
    `depends_on: ${yamlList(dependsOn)}`,
  ];
  if (tools.length) lines.push(`tools: ${yamlList(tools)}`);
  lines.push("---", "");

  const link = (dep: string): string => `[${titles.get(dep) ?? dep}](${posix.relative(ownDir || ".", dep)})`;
  let related = "";
  for (const dep of dependsOn) related += `\n- needs ${link(dep)}`;
  if (!related) related = "\n<!-- Links to the concepts this skill grounds on and the skills near it. -->";
  let toolsSection = tools.map((t) => `\n- \`${t}\` — <!-- what it does -->`).join("");
  if (toolsSection) toolsSection += "\n";
  const firstStep = dependsOn.length ? "First, " + dependsOn.map(link).join(" and ") + "." : "<!-- the first concrete action -->";
  const body = TEMPLATE.replace("{title}", title)
    .replace("{first_step}", firstStep)
    .replace("{tools_section}", toolsSection)
    .replace("{date}", stamp.slice(0, 10))
    .replace("{related_section}", related + "\n");
  return lines.join("\n") + "\n" + body;
}

export function presentSkills(skills: Omit<SkillRecord, "export">[]): string {
  if (!skills.length) return "no skills — `brainpick skill new <name>` scaffolds the first one";
  const lines = [`${skills.length} skills`];
  for (const skill of skills) {
    const desc = skill.description ? ` — ${skill.description}` : "";
    lines.push(`  ${skill.path}  ${skill.title}${desc}`);
    if (skill.depends_on.length) lines.push("    needs: " + skill.depends_on.join(", "));
    if (skill.tools.length) lines.push("    tools: " + skill.tools.join(", "));
  }
  return lines.join("\n");
}

export interface SkillListOutput {
  out?: string;
  err?: string;
  code: number;
}

export async function skillList(root: string, jsonMode: boolean): Promise<SkillListOutput> {
  const state = await heldState(root);
  if (state === null) {
    const instruction = `no compiled brain at ${root} — run: brainpick compile --root ${root}`;
    return jsonMode
      ? { out: toJson({ error: instruction, hint: "compile the brain, then retry" }), code: 0 }
      : { err: instruction, code: 0 };
  }
  const skills = state.skills.map((s) => ({
    path: s.path,
    title: s.title,
    description: s.description,
    depends_on: [...s.depends_on],
    tools: [...s.tools],
  }));
  return { out: jsonMode ? toJson({ skills }) : presentSkills(skills), code: 0 };
}

export interface SkillNewOptions {
  title?: string | null;
  description?: string | null;
  dependsOn?: string[];
  tools?: string[];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Scaffold one compliant skill (spec/85) beside the existing ones, then compile
 * so the tree, the overview and the report already know it. */
export async function skillNew(root: string, name: string, opts: SkillNewOptions = {}): Promise<SkillListOutput> {
  const config = loadConfig(root);
  const docs = scan(root, config.bundle.include, config.bundle.exclude);
  const existing = buildSkills(docs, root).skills;
  const directory = skillsDir(existing);
  const rel = directory ? `${directory}/${kebab(name)}.md` : `${kebab(name)}.md`;
  const target = join(root, rel);
  if (existsSync(target)) return { err: `error: ${rel} already exists — edit it, or pick another name`, code: 1 };

  const warnings: string[] = [];
  const known = new Set(docs.map((d) => d.path));
  const titles = new Map(docs.map((d) => [d.path, d.title]));
  const dependsOn = opts.dependsOn ?? [];
  const tools = opts.tools ?? [];
  for (const dep of dependsOn) {
    if (!known.has(dep)) warnings.push(`warning: depends_on ${dep} is not a doc in this bundle — it will be a ghost`);
  }
  for (const tool of tools) {
    if (!isFile(join(root, tool))) warnings.push(`warning: tool ${tool} does not exist yet under ${root}`);
  }

  const title = opts.title || name.trim();
  const description = opts.description || `Use when … (describe the trigger for ${title}).`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderSkill(title, description, dependsOn, tools, titles, directory), "utf8");
  const result = await runCompile(root, false, null, config);
  for (const warning of result.warnings) warnings.push(`warning: ${warning}`);
  return {
    out: `${rel}\nedit the Trigger, Steps and Tools sections; \`brainpick skill list --root ${root}\` shows it.`,
    err: warnings.length ? warnings.join("\n") : undefined,
    code: 0,
  };
}
