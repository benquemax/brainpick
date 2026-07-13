/** Timeline (spec/90): the bundle's git history distilled into a shape the UI can
 * travel through — the Time Machine. Ports timeline.py byte-shape for byte-shape.
 *
 * Advisory by construction: git history differs across clones, is absent in a
 * non-repo bundle, and is not bundle content — so `timeline.json` is never
 * byte-golden or conformance-tested for content, only for layout. One `git log`
 * over the bundle path, parsed; any failure (no repo, missing git, unreadable
 * history) yields `null`, and T1 simply omits the file.
 */
import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

import { fnmatchToRegExp, posixBasename, RESERVED_NAMES } from "./core/bundle";
import { cmpStr } from "./core/canonical";

const RECORD_SEP = "\x01"; // between commits — survives any subject text
const FIELD_SEP = "\x1f"; // between a commit's header fields
// spec/90 prints %H %aI %an %s per commit; the \x01/\x1f separators make the
// name-status stream (tab-separated, one path per line) unambiguous to parse.
const GIT_FORMAT = `${RECORD_SEP}%H${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%s`;
// NOTE (deviation from spec/90's literal command): spec/90 writes
// `--diff-filter=AMD`, but AMD excludes status R, so `-M`-detected renames are
// dropped entirely — which contradicts the spec's own rule that a rename is
// recorded as delete(old)+add(new). We include R (AMDR) so renames survive and
// are split as documented. Flagged for a spec amendment.
const DIFF_FILTER = "AMDR";

export interface TimelineCommit {
  added: string[];
  author: string;
  date: string;
  deleted: string[];
  message: string;
  modified: string[];
  sha: string;
}

export interface DocLifecycle {
  created: string;
  deleted: string | null;
  modified: string[];
}

export interface TimelineData {
  commits: TimelineCommit[];
  docs: Record<string, DocLifecycle>;
  span: { commits: number; first: string; last: string };
}

/** Distill git history for `bundleRoot` into `timeline.json`'s shape, or `null`
 * when there is no readable history. Never throws — advisory (spec/90). */
export function buildTimeline(
  bundleRoot: string,
  repoRoot: string | null,
  includeGlobs: readonly string[] = ["*.md"],
  excludes: readonly string[] = [],
): TimelineData | null {
  if (repoRoot === null) return null;
  try {
    const bundle = resolve(bundleRoot);
    const repo = resolve(repoRoot);
    const prefix = (relative(repo, bundle) || ".").split(sep).join("/");
    if (prefix.startsWith("..")) return null; // bundle is not inside the repo
    const pathspec = prefix === "" || prefix === "." ? "." : prefix;
    const output = runGitLog(repo, pathspec);
    if (output === null) return null;
    const commits = parseCommits(output, prefix, includeGlobs, excludes);
    if (commits.length === 0) return null;
    const docs = lifecycle(commits);
    const span = {
      commits: commits.length,
      first: commits[0]!.date,
      last: commits[commits.length - 1]!.date,
    };
    return { commits, docs, span };
  } catch {
    return null; // git surprises never break the compile — the feature hides
  }
}

/** The doc's text AS OF a commit (spec/50 "Doc versions" — the file-level
 * Time Machine), read via `git show <sha>:<prefix>/<path>` with the same
 * repo-root + bundle-prefix scoping buildTimeline uses. Null when there is no
 * repo, the commit is unknown, or the file did not exist at that commit —
 * advisory like the timeline itself, never throws. */
export function docAtCommit(
  bundleRoot: string,
  repoRoot: string | null,
  path: string,
  at: string,
): string | null {
  if (repoRoot === null) return null;
  try {
    const bundle = resolve(bundleRoot);
    const repo = resolve(repoRoot);
    const prefix = (relative(repo, bundle) || ".").split(sep).join("/");
    if (prefix.startsWith("..")) return null;
    const rel = prefix === "" || prefix === "." ? path : `${prefix}/${path}`;
    return execFileSync("git", ["-c", "core.quotePath=false", "show", `${at}:${rel}`], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The single `git log` (spec/90). Non-zero exit / missing git → null. */
function runGitLog(repo: string, pathspec: string): string | null {
  try {
    return execFileSync(
      "git",
      [
        "-c", "core.quotePath=false", "log",
        `--diff-filter=${DIFF_FILTER}`, "--name-status", "-M",
        `--format=${GIT_FORMAT}`, "--", pathspec,
      ],
      { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
}

function parseCommits(
  output: string,
  prefix: string,
  includeGlobs: readonly string[],
  excludes: readonly string[],
): TimelineCommit[] {
  const commits: TimelineCommit[] = [];
  for (const chunk of output.split(RECORD_SEP)) {
    if (chunk.trim() === "") continue;
    const lines = chunk.split("\n");
    const fields = splitN(lines[0]!, FIELD_SEP, 4);
    if (fields.length < 4) continue;
    const [shaFull, dateRaw, author, message] = fields as [string, string, string, string];

    const added = new Set<string>();
    const modified = new Set<string>();
    const deleted = new Set<string>();
    for (const line of lines.slice(1)) {
      if (line.trim() !== "") applyStatus(line, prefix, includeGlobs, excludes, added, modified, deleted);
    }
    if (added.size === 0 && modified.size === 0 && deleted.size === 0) continue;

    commits.push({
      added: [...added].sort(cmpStr),
      author,
      date: normalizeDate(dateRaw),
      deleted: [...deleted].sort(cmpStr),
      message,
      modified: [...modified].sort(cmpStr),
      sha: shaFull.slice(0, 7),
    });
  }
  commits.reverse(); // git log is newest-first; the timeline is oldest-first
  return commits;
}

/** Python str.split(sep, maxsplit): at most `max` fields, extra separators kept
 * in the final field. */
function splitN(text: string, sep: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (out.length < max - 1) {
    const i = rest.indexOf(sep);
    if (i === -1) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

function applyStatus(
  line: string,
  prefix: string,
  includeGlobs: readonly string[],
  excludes: readonly string[],
  added: Set<string>,
  modified: Set<string>,
  deleted: Set<string>,
): void {
  const parts = line.split("\t");
  if (parts.length < 2) return;
  const code = parts[0]!.slice(0, 1);
  if (code === "R" && parts.length >= 3) {
    // rename → delete(old) + add(new) (spec/90)
    const old = bundleRelative(parts[1]!, prefix);
    const created = bundleRelative(parts[2]!, prefix);
    if (old && isKnowledgeDoc(old, includeGlobs, excludes)) deleted.add(old);
    if (created && isKnowledgeDoc(created, includeGlobs, excludes)) added.add(created);
    return;
  }
  const path = bundleRelative(parts[1]!, prefix);
  if (path === null || path === "" || !isKnowledgeDoc(path, includeGlobs, excludes)) return;
  if (code === "A") added.add(path);
  else if (code === "M") modified.add(path);
  else if (code === "D") deleted.add(path);
}

/** git prints repo-relative POSIX paths; strip the bundle's prefix. */
function bundleRelative(repoPath: string, prefix: string): string | null {
  if (prefix === "" || prefix === ".") return repoPath;
  if (repoPath === prefix) return ""; // the bundle directory itself, never a doc
  const marker = prefix + "/";
  if (repoPath.startsWith(marker)) return repoPath.slice(marker.length);
  return null; // outside the bundle (the pathspec should prevent this)
}

function isKnowledgeDoc(path: string, includeGlobs: readonly string[], excludes: readonly string[]): boolean {
  if (RESERVED_NAMES.has(posixBasename(path))) return false;
  if (!matchInclude(path, includeGlobs)) return false;
  return !excludes.some((ex) => fnmatchToRegExp(ex).test(path));
}

function matchInclude(path: string, includeGlobs: readonly string[]): boolean {
  for (const glob of includeGlobs) {
    // fnmatch's `*` already spans `/`, so a pathlib-style recursive `**/` prefix
    // (the config default `**/*.md`) is equivalent to dropping it.
    const simplified = glob.startsWith("**/") ? glob.slice(3) : glob;
    if (fnmatchToRegExp(glob).test(path) || fnmatchToRegExp(simplified).test(path)) return true;
  }
  return false;
}

/** %aI is strict ISO 8601 with an offset (or `Z`); normalize to UTC `Z`. */
function normalizeDate(raw: string): string {
  return new Date(raw.trim()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Per-doc created/modified/deleted, derived from the chronological commits
 * (convenience for the UI, spec/90). `created` = first add, `modified` = later
 * change dates (sorted), `deleted` = the delete date or null. */
function lifecycle(commits: TimelineCommit[]): Record<string, DocLifecycle> {
  const docs: Record<string, DocLifecycle> = {};
  for (const commit of commits) {
    // oldest-first
    const date = commit.date;
    for (const path of commit.added) {
      const entry = docs[path];
      if (entry === undefined) docs[path] = { created: date, deleted: null, modified: [] };
      else entry.deleted = null; // re-added after a delete — it exists again
    }
    for (const path of commit.modified) {
      const entry = docs[path];
      if (entry === undefined) docs[path] = { created: date, deleted: null, modified: [] };
      else entry.modified.push(date);
    }
    for (const path of commit.deleted) {
      const entry = docs[path];
      if (entry === undefined) docs[path] = { created: date, deleted: date, modified: [] };
      else entry.deleted = date;
    }
  }
  for (const entry of Object.values(docs)) entry.modified.sort(cmpStr);
  return docs;
}
