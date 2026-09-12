/** `brainpick migrate --to N` — the one command that rewrites committed bytes
 * (spec/85 *Versioning and migration*).
 *
 * A migration is mechanical: it moves and splits files, rewrites links and the
 * `[brain] format` stamp, never prose. It is deterministic (the conformance
 * class `migrate` pins the 1 → 2 rewrite byte for byte across engines), writes
 * by default — one command for an agent, git is the undo — and `--dry-run`
 * prints the same action list plus a unified diff, writing nothing. Every step
 * works on an in-memory tree (`path → text`, `null` = deleted) that is applied
 * to disk at the very end, so a failure half-way leaves the bundle untouched. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

import { loadConfig, type Config } from "./config";

export const LATEST_FORMAT = 2;
export const ENV_TODAY = "BRAINPICK_TODAY";

const MONTH_FILE = /^(\d{4})-(\d{2})\.md$/;
const DAY_HEADING = /^## +(\d{4}-\d{2}-\d{2}) *$/;
const MONTH_TITLE = /^# +\d{4}-\d{2} *$/;
const H3 = /^### /;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// Rewrite only real links: fences and inline code are matched first and kept.
const TOKEN = /(^```[\s\S]*?^```[ \t]*$)|(`[^`\n]*`)|((?<!!)\[[^\]]*\]\([^)\s]+\))/gm;
const LINK = /^(?<!!)(\[[^\]]*\]\()([^)\s]+)(\))$/;
const BRAIN_SECTION = /^\[brain\][ \t]*(?:#.*)?$/;
const ANY_SECTION = /^\[/;
const FORMAT_LINE = /^([ \t]*format[ \t]*=[ \t]*)(\d+)(.*)$/;
const SKIP_DIRS = new Set([".brainpick", ".git", "_temp", "node_modules"]);

export const TODO_INDEX = `# Todo

The brain's own work queue: \`open.md\` is the live list, \`archive/\` holds
what was closed, one file per day.

- [Open](open.md)
`;

const TODO_OPEN_HEAD = (today: string): string => `---
type: todo
title: Open
description: What is still to be done — the brain's live work queue.
timestamp: ${today}T00:00:00Z
---

# Open
`;

export class MigrateError extends Error {}

export interface MigrateReport {
  from_format: number;
  to_format: number;
  actions: string[];
  diff: string;
  dry_run: boolean;
}

/** The bundle (and the repo root beside it) as `path → text`; `null` marks a
 * deletion. Paths are posix, relative to the repo root `P`. */
class Tree {
  readonly files = new Map<string, string | null>();
  readonly original = new Map<string, string | null>();
  readonly actions: string[] = [];

  constructor(
    readonly repo: string,
    readonly bundleRel: string, // "" when the bundle IS the repo root
  ) {}

  /** Bundle-relative → repo-relative. */
  b(rel: string): string {
    return this.bundleRel ? posix.join(this.bundleRel, rel) : rel;
  }

  private disk(rel: string): string {
    return join(this.repo, ...rel.split("/"));
  }

  read(rel: string): string | null {
    if (this.files.has(rel)) return this.files.get(rel)!;
    const path = this.disk(rel);
    const text = existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : null;
    this.original.set(rel, text);
    return text;
  }

  exists(rel: string): boolean {
    return this.read(rel) !== null;
  }

  /** Every .md under the bundle (repo-relative, sorted), skipping the always-
   * excluded folders, with in-memory changes applied. */
  listMd(): string[] {
    const base = this.bundleRel ? this.disk(this.bundleRel) : this.repo;
    const found = new Set<string>();
    if (existsSync(base) && statSync(base).isDirectory()) {
      for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const abs = join(entry.parentPath, entry.name);
        const rel = relative(this.repo, abs).split(sep).join("/");
        if (rel.split("/").some((part) => SKIP_DIRS.has(part))) continue;
        found.add(rel);
      }
    }
    for (const [rel, text] of this.files) {
      if (text === null) found.delete(rel);
      else if (rel.endsWith(".md")) found.add(rel);
    }
    const prefix = this.bundleRel ? this.bundleRel + "/" : "";
    return [...found].filter((r) => r.startsWith(prefix) && this.read(r) !== null).sort();
  }

  write(rel: string, text: string): void {
    if (!this.original.has(rel)) this.read(rel);
    this.files.set(rel, text);
  }

  delete(rel: string): void {
    if (!this.original.has(rel)) this.read(rel);
    this.files.set(rel, null);
  }

  changed(): string[] {
    return [...this.files.keys()].filter((rel) => this.original.get(rel) !== this.files.get(rel)).sort();
  }

  diff(): string {
    let out = "";
    for (const rel of this.changed()) {
      out += unifiedDiff(this.original.get(rel) ?? "", this.files.get(rel) ?? "", rel);
    }
    return out;
  }

  apply(): void {
    for (const rel of this.changed()) {
      const path = this.disk(rel);
      const text = this.files.get(rel);
      if (text === null || text === undefined) {
        if (existsSync(path)) unlinkSync(path);
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
      }
    }
  }
}

// -- a small unified diff (the dry-run preview; not byte-held by any golden) --------

function unifiedDiff(a: string, b: string, name: string): string {
  const al = a === "" ? [] : a.split("\n").map((l, i, arr) => (i < arr.length - 1 ? l + "\n" : l)).filter((l) => l !== "");
  const bl = b === "" ? [] : b.split("\n").map((l, i, arr) => (i < arr.length - 1 ? l + "\n" : l)).filter((l) => l !== "");
  // LCS table
  const n = al.length;
  const m = bl.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = al[i] === bl[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Array<[" " | "-" | "+", string]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      ops.push([" ", al[i]!]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push(["-", al[i]!]);
      i++;
    } else {
      ops.push(["+", bl[j]!]);
      j++;
    }
  }
  while (i < n) ops.push(["-", al[i++]!]);
  while (j < m) ops.push(["+", bl[j++]!]);
  if (!ops.some(([op]) => op !== " ")) return "";
  const body = ops.map(([op, line]) => op + (line.endsWith("\n") ? line : line + "\n\\ No newline at end of file\n")).join("");
  return `--- ${name}\n+++ ${name}\n@@ -1,${n} +1,${m} @@\n${body}`;
}

// -- step 1: months into days --------------------------------------------------------

function trim(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

/** Split a format-1 month file into `[day, body]` pairs in file order. A `###`
 * heading inside a day becomes `##`; non-date `##` content stays with the day
 * it followed; the month's own `# YYYY-MM` title (and blank lines around it) is
 * dropped, any other preamble opens the first day. No day heading at all → one
 * day, the month's first. */
export function splitMonth(text: string, month: string): Array<[string, string]> {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let preamble: string[] = [];
  const days: Array<[string, string[]]> = [];
  for (let line of lines) {
    const m = DAY_HEADING.exec(line);
    if (m) {
      days.push([m[1]!, []]);
      continue;
    }
    if (H3.test(line)) line = line.slice(1);
    (days.length ? days[days.length - 1]![1] : preamble).push(line);
  }
  preamble = trim(preamble.filter((l) => !MONTH_TITLE.test(l)));
  if (!days.length) days.push([`${month}-01`, []]);
  return days.map(([day, rawBody], index) => {
    let body = trim(rawBody);
    if (index === 0 && preamble.length) body = [...preamble, ...(body.length ? [""] : []), ...body];
    return [day, [`# ${day}`, "", ...body].join("\n") + "\n"];
  });
}

function dayTarget(day: string, today: string): string {
  if (day === today) return `journals/${day}.md`;
  return `journals/archive/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.md`;
}

function rewriteLinks(text: string, rewrite: (target: string) => string | null): [string, number] {
  let count = 0;
  const out = text.replace(TOKEN, (whole, _fence: string | undefined, _code: string | undefined, link: string | undefined) => {
    if (link === undefined) return whole;
    const lm = LINK.exec(link);
    if (!lm) return whole;
    const next = rewrite(lm[2]!);
    if (next === null || next === lm[2]) return whole;
    count++;
    return `${lm[1]}${next}${lm[3]}`;
  });
  return [out, count];
}

function isLocal(target: string): boolean {
  return target !== "" && !SCHEME.test(target);
}

/** A link target as a bundle-relative posix path (fragment stripped). */
function resolveTarget(docRel: string, target: string): string {
  const path = target.split("#", 1)[0]!;
  if (path.startsWith("/")) return posix.normalize(path.replace(/^\/+/, ""));
  return posix.normalize(posix.join(posix.dirname(docRel), path));
}

function relativeTo(targetRel: string, docRel: string): string {
  const start = posix.dirname(docRel) || ".";
  return posix.relative(start, targetRel);
}

function stepJournals(tree: Tree, today: string): Map<string, Map<string, string>> {
  const months: Array<[string, string]> = [];
  for (const folder of ["journals", "journals/archive"]) {
    const base = join(tree.repo, ...tree.b(folder).split("/"));
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const name of readdirSync(base).sort()) {
      const m = MONTH_FILE.exec(name);
      if (m && statSync(join(base, name)).isFile()) months.push([`${folder}/${name}`, `${m[1]}-${m[2]}`]);
    }
  }
  months.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const mapping = new Map<string, Map<string, string>>();
  for (const [monthRel, month] of months) {
    const text = tree.read(tree.b(monthRel));
    if (text === null) continue;
    const days = splitMonth(text, month);
    tree.actions.push(`split ${monthRel} → ${days.length} day file${days.length === 1 ? "" : "s"}`);
    const homes = new Map<string, string>();
    for (const [day, rawBody] of days) {
      const newRel = dayTarget(day, today);
      homes.set(day, newRel);
      const [body] = rewriteLinks(rawBody, (target) => {
        if (!isLocal(target) || target.startsWith("/")) return null;
        const [path, frag] = splitFragment(target);
        if (!path) return null;
        const moved = relativeTo(resolveTarget(monthRel, path), newRel);
        return moved + (frag ? `#${frag}` : "");
      });
      tree.write(tree.b(newRel), body);
      tree.actions.push(`move ${monthRel}#${day} → ${newRel}`);
    }
    tree.delete(tree.b(monthRel));
    const earliest = [...homes.keys()].sort()[0]!;
    homes.set("", homes.get(earliest)!); // a link to the month lands on its earliest day
    mapping.set(monthRel, homes);
  }
  return mapping;
}

function splitFragment(target: string): [string, string] {
  const at = target.indexOf("#");
  return at === -1 ? [target, ""] : [target.slice(0, at), target.slice(at + 1)];
}

// -- step 2: links to days -----------------------------------------------------------

function stepLinks(tree: Tree, mapping: Map<string, Map<string, string>>): void {
  if (!mapping.size) return;
  for (const repoRel of tree.listMd()) {
    const docRel = tree.bundleRel ? repoRel.slice(tree.bundleRel.length + 1) : repoRel;
    const text = tree.read(repoRel);
    if (text === null) continue;
    const [next, count] = rewriteLinks(text, (target) => {
      if (!isLocal(target)) return null;
      const [path, frag] = splitFragment(target);
      const homes = path ? mapping.get(resolveTarget(docRel, path)) : undefined;
      if (!homes) return null;
      const newRel = DAY.test(frag) ? homes.get(frag) : undefined;
      return relativeTo(newRel ?? homes.get("")!, docRel);
    });
    if (count) {
      tree.write(repoRel, next);
      tree.actions.push(`rewrite links in ${docRel} (${count})`);
    }
  }
}

// -- step 3: to-dos into the brain ---------------------------------------------------

function stepTodos(tree: Tree, today: string): void {
  const openRel = tree.b("todo/open.md");
  const indexRel = tree.b("todo/index.md");
  if (!tree.exists(openRel)) {
    const parked = tree.read("_todo.md");
    if (parked !== null) {
      const lines = parked.split("\n");
      const body = trim(lines.length && lines[0]!.startsWith("# ") ? lines.slice(1) : lines);
      // `_todo.md` sat at P; open.md sits at R/todo/ — re-root its links
      const [text] = rewriteLinks(body.join("\n"), (target) => {
        if (!isLocal(target) || target.startsWith("/")) return null;
        const [path, frag] = splitFragment(target);
        if (!path) return null;
        return relativeTo(posix.normalize(path), openRel) + (frag ? `#${frag}` : "");
      });
      tree.write(openRel, TODO_OPEN_HEAD(today) + (text ? `\n${text}\n` : ""));
      tree.delete("_todo.md");
      tree.actions.push("move _todo.md → todo/open.md");
      const ignore = tree.read(".gitignore");
      if (ignore !== null) {
        const all = ignore.split("\n");
        const kept = all.filter((l) => l.trim() !== "_todo.md");
        if (kept.length !== all.length) {
          tree.write(".gitignore", kept.join("\n"));
          tree.actions.push("unignore _todo.md in .gitignore");
        }
      }
    } else {
      tree.write(openRel, TODO_OPEN_HEAD(today));
      tree.actions.push("create todo/open.md");
    }
  }
  if (!tree.exists(indexRel)) {
    tree.write(indexRel, TODO_INDEX);
    tree.actions.push("create todo/index.md");
  }
}

// -- step 4: the stamp ---------------------------------------------------------------

function stepStamp(tree: Tree, from: number, to: number): void {
  const text = tree.read("brainpick.toml");
  if (text === null) throw new MigrateError("no brainpick.toml to stamp");
  const lines = text.split("\n");
  let inBrain = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (ANY_SECTION.test(line)) {
      inBrain = BRAIN_SECTION.test(line);
      continue;
    }
    const m = inBrain ? FORMAT_LINE.exec(line) : null;
    if (m && parseInt(m[2]!, 10) === from) {
      lines[i] = `${m[1]}${to}${m[3]}`;
      tree.write("brainpick.toml", lines.join("\n"));
      tree.actions.push(`stamp brainpick.toml: format ${from} → ${to}`);
      return;
    }
  }
  throw new MigrateError(`brainpick.toml has no \`format = ${from}\` under [brain] to stamp`);
}

function migrate1to2(tree: Tree, today: string): void {
  const mapping = stepJournals(tree, today);
  stepLinks(tree, mapping);
  stepTodos(tree, today);
  stepStamp(tree, 1, 2);
}

const MIGRATIONS: Record<number, (tree: Tree, today: string) => void> = { 2: migrate1to2 }; // target → step from target-1

// -- the command -----------------------------------------------------------------------

export function resolveToday(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env[ENV_TODAY] ?? "").trim();
  if (value && DAY.test(value)) return value;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface MigrateOptions {
  today?: string | null;
  dryRun?: boolean;
  config?: Config | null;
}

/** Rewrite the brain at `root` (a repo root or the bundle itself, spec/80) from
 * its stamped format up to `to`. Returns the actions taken (or previewed). */
export function migrate(root: string, to: number, opts: MigrateOptions = {}): MigrateReport {
  const repo = resolve(root);
  const config = opts.config ?? loadConfig(repo);
  const bundle = resolve(repo, config.bundle.root);
  const current = config.brain.format;
  if (current <= 0) throw new MigrateError(`${repo} is not a brain: no [brain] format in brainpick.toml (spec/85)`);
  if (to < current) {
    throw new MigrateError(
      `target format ${to} is below the bundle's current format ${current}; migrate never downgrades`,
    );
  }
  const report: MigrateReport = { from_format: current, to_format: to, actions: [], diff: "", dry_run: !!opts.dryRun };
  if (to === current) return report;
  for (let step = current + 1; step <= to; step++) {
    if (!(step in MIGRATIONS)) {
      throw new MigrateError(`unknown brain format ${step}; this engine knows formats up to ${LATEST_FORMAT}`);
    }
  }
  const today = opts.today ?? resolveToday();
  const bundleRel = relative(repo, bundle).split(sep).join("/");
  if (bundleRel.startsWith("..")) throw new MigrateError(`bundle ${bundle} is not under ${repo}`);
  const tree = new Tree(repo, bundleRel === "" || bundleRel === "." ? "" : bundleRel);
  for (let step = current + 1; step <= to; step++) MIGRATIONS[step]!(tree, today);
  report.actions = [...tree.actions];
  report.diff = tree.diff();
  if (!opts.dryRun) tree.apply();
  return report;
}

/** The CLI verb: print the action list (and the diff on --dry-run); exit code. */
export function runMigrate(root: string, to: number, dryRun: boolean, print: (line: string) => void = console.log): number {
  let report: MigrateReport;
  try {
    report = migrate(root, to, { dryRun });
  } catch (err) {
    if (err instanceof MigrateError) {
      console.error(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
  if (!report.actions.length) {
    print(`already at format ${report.to_format}; nothing to do`);
    return 0;
  }
  for (const action of report.actions) print(action);
  if (report.dry_run) {
    print(`dry run: ${report.actions.length} actions, nothing written — the diff:`);
    process.stdout.write(report.diff);
    return 0;
  }
  print(
    `migrated to format ${report.to_format} (${report.actions.length} actions); review with git diff, then run \`brainpick compile\``,
  );
  return 0;
}
