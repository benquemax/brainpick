/**
 * NAVIGATOR tree: a pure directory tree derived from the graph nodes already
 * in the store — node ids ARE bundle paths ("saaret/atolli.md"), so the tree
 * is entirely client-side (no new API). Dirs come before docs and each group
 * is codepoint-sorted; every dir carries its recursive doc count. Reserved
 * docs (index/log) stay in the tree but are flagged so rows can de-emphasize
 * them, mirroring the cosmos.
 */
import type { GraphNode } from '../graph/types';

export interface TreeDoc {
  kind: 'doc';
  /** File name — the last path segment, e.g. "atolli.md". */
  name: string;
  /** Full bundle path — the graph node id, e.g. "saaret/atolli.md". */
  path: string;
  title: string;
  orphan: boolean;
  reserved: boolean;
}

export interface TreeDir {
  kind: 'dir';
  /** Directory segment name, e.g. "saaret" ("" for the root). */
  name: string;
  /** Full directory path, e.g. "saaret/koillinen" ("" for the root). */
  path: string;
  /** Dirs first, then docs — each group codepoint-sorted by name. */
  children: TreeEntry[];
  /** Documents anywhere under this directory (recursive). */
  docCount: number;
}

export type TreeEntry = TreeDir | TreeDoc;

/** With this many dirs or fewer the panel default-expands the whole tree. */
export const AUTO_EXPAND_MAX_DIRS = 3;

/** Codepoint comparison — deterministic, locale-independent (spec-style). */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface MutableDir {
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  docs: TreeDoc[];
}

function freeze(dir: MutableDir): TreeDir {
  const dirs = [...dir.dirs.values()].sort((a, b) => byCodepoint(a.name, b.name)).map(freeze);
  const docs = [...dir.docs].sort((a, b) => byCodepoint(a.name, b.name));
  const docCount = docs.length + dirs.reduce((sum, d) => sum + d.docCount, 0);
  return { kind: 'dir', name: dir.name, path: dir.path, children: [...dirs, ...docs], docCount };
}

/** Build the directory tree for a set of graph nodes (any iteration order). */
export function buildTree(nodes: Iterable<GraphNode>): TreeDir {
  const root: MutableDir = { name: '', path: '', dirs: new Map(), docs: [] };
  for (const node of nodes) {
    const segments = node.id.split('/');
    const fileName = segments[segments.length - 1] ?? node.id;
    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      let child = dir.dirs.get(segment);
      if (child === undefined) {
        child = {
          name: segment,
          path: dir.path === '' ? segment : `${dir.path}/${segment}`,
          dirs: new Map(),
          docs: [],
        };
        dir.dirs.set(segment, child);
      }
      dir = child;
    }
    dir.docs.push({
      kind: 'doc',
      name: fileName,
      path: node.id,
      title: node.title,
      orphan: node.orphan,
      reserved: node.reserved,
    });
  }
  return freeze(root);
}

// One-slot memo: the graph only changes through applyDelta/applySnapshot,
// which bump seq and replace the nodes Map — so (seq, map identity) is a
// complete change signature and the tree rebuilds exactly once per delta.
let memo: { seq: number; nodes: ReadonlyMap<string, GraphNode>; tree: TreeDir } | null = null;

/** The tree for the store's current graph — memoized by seq (+ map identity). */
export function treeForGraph(nodes: ReadonlyMap<string, GraphNode>, seq: number): TreeDir {
  if (memo === null || memo.seq !== seq || memo.nodes !== nodes) {
    memo = { seq, nodes, tree: buildTree(nodes.values()) };
  }
  return memo.tree;
}

export interface TreeRow {
  entry: TreeEntry;
  /** Nesting depth: 0 for entries directly under the bundle root. */
  depth: number;
}

/**
 * The rows currently visible in render order — the flat list the keyboard
 * focus ring walks. Children of a dir appear only while it is expanded.
 */
export function flattenVisible(root: TreeDir, isExpanded: (dirPath: string) => boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: TreeDir, depth: number) => {
    for (const entry of dir.children) {
      rows.push({ entry, depth });
      if (entry.kind === 'dir' && isExpanded(entry.path)) walk(entry, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Every ancestor dir path of a bundle path, outermost first ("a/b/c.md" -> ["a", "a/b"]). */
export function ancestorDirsOf(path: string): string[] {
  const dirs: string[] = [];
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
    dirs.push(path.slice(0, i));
  }
  return dirs;
}

/** Total dir count in the tree (root excluded) — drives default expansion. */
export function countDirs(root: TreeDir): number {
  let count = 0;
  for (const entry of root.children) {
    if (entry.kind === 'dir') count += 1 + countDirs(entry);
  }
  return count;
}
