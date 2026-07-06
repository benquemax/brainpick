/** Bundle scanning: documents, tolerant metadata, resolved links (spec/20). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { cmpStr, sha256Hex } from "./canonical";
import { splitFrontmatter } from "./frontmatter";
import { extractLinks, type RawLink } from "./links";
import { PY_SPACE_CLASS } from "./pyfmt";
import { pyStr, YamlTimestamp } from "./yaml11";

export const ALWAYS_EXCLUDED_DIRS = new Set([".brainpick", ".git", "_temp", "node_modules"]);
export const RESERVED_NAMES = new Set(["index.md", "log.md"]);

export const DEFAULT_INCLUDE: readonly string[] = ["**/*.md"];

// Python: ^# +(.+?)\s*$ MULTILINE — `.` is [^\n], `\s` the Python class.
const H1 = new RegExp(`^# +([^\\n]+?)[${PY_SPACE_CLASS}]*$`, "mu");

export interface ResolvedLink {
  kind: "link" | "wikilink";
  target: string;
  text: string;
}

export interface Ghost {
  target: string;
}

export interface Document {
  path: string;
  sha256: string;
  size: number;
  title: string;
  type: string | null;
  description: string | null;
  tags: string[];
  timestamp: string | null;
  reserved: boolean;
  body: string;
  links: ResolvedLink[];
  ghosts: Ghost[];
}

export function normalizeTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof YamlTimestamp) return value.normalized();
  return pyStr(value);
}

export function normalizeTags(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(pyStr);
  return [pyStr(value)];
}

function titleOf(meta: Record<string, unknown>, body: string, path: string): string {
  if (meta["title"] !== null && meta["title"] !== undefined) return pyStr(meta["title"]);
  const m = H1.exec(body);
  if (m) return m[1]!;
  const stem = fileStem(posixBasename(path));
  return stem.replace(/-/g, " ").replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// posixpath ports (bundle-relative paths only ever use POSIX separators).

export function posixBasename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

export function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  if (i === -1) return "";
  let head = p.slice(0, i + 1);
  if (head !== "" && !/^\/+$/.test(head)) head = head.replace(/\/+$/, "");
  return head;
}

export function posixJoin(a: string, b: string): string {
  if (b.startsWith("/")) return b;
  if (a === "" || a.endsWith("/")) return a + b;
  return a + "/" + b;
}

/** posixpath.normpath, ported faithfully — including the '..'-escape shapes
 * that _resolve turns into ghosts. */
export function posixNormpath(path: string): string {
  if (path === "") return ".";
  const initialSlashes = path.startsWith("/")
    ? path.startsWith("//") && !path.startsWith("///")
      ? 2
      : 1
    : 0;
  const comps: string[] = [];
  for (const comp of path.split("/")) {
    if (comp === "" || comp === ".") continue;
    if (
      comp !== ".." ||
      (initialSlashes === 0 && comps.length === 0) ||
      (comps.length > 0 && comps[comps.length - 1] === "..")
    ) {
      comps.push(comp);
    } else if (comps.length > 0) {
      comps.pop();
    }
  }
  const joined = "/".repeat(initialSlashes) + comps.join("/");
  return joined || ".";
}

/** Python `posixpath.basename(p).rsplit(".", 1)[0]`. */
function fileStem(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? name : name.slice(0, i);
}

// ---------------------------------------------------------------------------
// File collection. The 0.1 include set is fixed (`**/*.md`), so the tree is
// hand-walked instead of pulling in a glob dependency. Mirrors
// pathlib.Path.glob on Python 3.10–3.12: dotfiles are matched, directory
// symlinks are not followed, file symlinks count via is_file().

function collectFiles(root: string, include: readonly string[], exclude: readonly string[]): string[] {
  for (const pattern of include) {
    if (pattern !== "**/*.md") {
      throw new Error(`unsupported include pattern ${JSON.stringify(pattern)} — 0.1 fixes the include set to **/*.md`);
    }
  }
  if (include.length === 0) return [];
  const files: string[] = [];
  walk(root, "", files);
  const excludeRes = exclude.map(fnmatchToRegExp);
  return files.filter((rel) => !excludeRes.some((re) => re.test(rel))).sort(cmpStr);
}

function walk(dir: string, rel: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    let isFile = entry.isFile();
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      isDir = false; // Path.glob("**") does not follow directory symlinks
      try {
        isFile = statSync(join(dir, entry.name)).isFile();
      } catch {
        isFile = false;
      }
    }
    if (isDir) {
      if (!ALWAYS_EXCLUDED_DIRS.has(entry.name)) walk(join(dir, entry.name), childRel, out);
    } else if (isFile && entry.name.endsWith(".md")) {
      out.push(childRel);
    }
  }
}

/** fnmatch.fnmatch, minimally: `*` (crosses `/`), `?`, `[seq]`. The exclude list
 * reaches it here; the timeline's include/exclude matching (spec/90) reuses it. */
export function fnmatchToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (ch === "[") {
      const close = pattern.indexOf("]", i + 2);
      if (close === -1) {
        re += "\\[";
      } else {
        let seq = pattern.slice(i + 1, close);
        if (seq.startsWith("!")) seq = "^" + seq.slice(1);
        re += "[" + seq.replace(/\\/g, "\\\\") + "]";
        i = close;
      }
    } else re += ch.replace(/[.+^${}()|\\/[\]]/g, "\\$&");
  }
  return new RegExp(`^(?:${re})$`, "su");
}

// ---------------------------------------------------------------------------

function resolve(
  source: string,
  raw: RawLink,
  fileSet: Set<string>,
  stems: Map<string, string[]>,
  stemsCi: Map<string, string[]>,
): string | null {
  if (raw.kind === "wikilink") {
    const exact = stems.get(raw.target) ?? [];
    if (exact.length === 1) return exact[0]!;
    const ci = stemsCi.get(raw.target.toLowerCase()) ?? [];
    if (ci.length === 1) return ci[0]!;
    return null;
  }

  const target = raw.target;
  if (target.startsWith("/")) {
    const base = target.replace(/^\/+/, "");
    for (const cand of [base, base + ".md", posixJoin(base, "index.md")]) {
      if (fileSet.has(cand)) return cand;
    }
    return null;
  }

  const joined = posixNormpath(posixJoin(posixDirname(source), target));
  if (joined.startsWith("..")) return null;
  for (const cand of [joined, joined + ".md"]) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

export function scan(
  root: string,
  include: readonly string[] = DEFAULT_INCLUDE,
  exclude: readonly string[] = [],
): Document[] {
  const paths = collectFiles(root, include, exclude);
  const fileSet = new Set(paths);

  const stems = new Map<string, string[]>();
  const stemsCi = new Map<string, string[]>();
  for (const p of paths) {
    const stem = fileStem(posixBasename(p));
    let list = stems.get(stem);
    if (!list) stems.set(stem, (list = []));
    list.push(p);
    const lower = stem.toLowerCase();
    let ciList = stemsCi.get(lower);
    if (!ciList) stemsCi.set(lower, (ciList = []));
    ciList.push(p);
  }

  const docs: Document[] = [];
  for (const path of paths) {
    const rawBytes = readFileSync(join(root, path));
    // Buffer.toString("utf8") replaces malformed sequences with U+FFFD, like
    // Python's errors="replace".
    const [meta, body] = splitFrontmatter(rawBytes.toString("utf8"));

    const links: ResolvedLink[] = [];
    const ghosts: Ghost[] = [];
    for (const raw of extractLinks(body)) {
      const resolved = resolve(path, raw, fileSet, stems, stemsCi);
      if (resolved === path) continue; // self-links are dropped
      if (resolved === null) ghosts.push({ target: raw.target });
      else links.push({ kind: raw.kind, target: resolved, text: raw.text });
    }

    docs.push({
      path,
      sha256: sha256Hex(rawBytes),
      size: rawBytes.length,
      title: titleOf(meta, body, path),
      type: meta["type"] === null || meta["type"] === undefined ? null : pyStr(meta["type"]),
      description:
        meta["description"] === null || meta["description"] === undefined ? null : pyStr(meta["description"]),
      tags: normalizeTags(meta["tags"]),
      timestamp: normalizeTimestamp(meta["timestamp"]),
      reserved: RESERVED_NAMES.has(posixBasename(path)),
      body,
      links,
      ghosts,
    });
  }
  return docs;
}
