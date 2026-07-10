import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../graph/types';
import {
  AUTO_EXPAND_MAX_DIRS,
  ancestorDirsOf,
  buildTree,
  countDirs,
  flattenVisible,
  treeForGraph,
  type TreeDir,
  type TreeDoc,
} from './tree';

function makeNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    title: id,
    description: null,
    type: null,
    about: null,
    tags: [],
    timestamp: null,
    in: 0,
    out: 0,
    orphan: false,
    reserved: false,
    ...over,
  };
}

function nodeMap(...nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function names(entries: TreeDir['children']): string[] {
  return entries.map((e) => e.name);
}

describe('buildTree', () => {
  it('nests documents under their directories (multi-level paths)', () => {
    const root = buildTree(
      nodeMap(
        makeNode('kuu.md', { title: 'Kuu' }),
        makeNode('saaret/atolli.md', { title: 'Atolli' }),
        makeNode('saaret/koillinen/riutta.md', { title: 'Riutta' }),
      ).values(),
    );
    expect(root.path).toBe('');
    const saaret = root.children[0] as TreeDir;
    expect(saaret.kind).toBe('dir');
    expect(saaret.name).toBe('saaret');
    expect(saaret.path).toBe('saaret');
    const koillinen = saaret.children[0] as TreeDir;
    expect(koillinen.kind).toBe('dir');
    expect(koillinen.path).toBe('saaret/koillinen');
    expect((koillinen.children[0] as TreeDoc).path).toBe('saaret/koillinen/riutta.md');
    const atolli = saaret.children[1] as TreeDoc;
    expect(atolli.kind).toBe('doc');
    expect(atolli.name).toBe('atolli.md');
    expect(atolli.title).toBe('Atolli');
  });

  it('sorts dirs first, then docs, each by codepoint — regardless of input order', () => {
    const root = buildTree(
      nodeMap(
        makeNode('zebra.md'),
        makeNode('beta/x.md'),
        makeNode('Alpha.md'),
        makeNode('alpha.md'),
        makeNode('aaa/x.md'),
      ).values(),
    );
    // dirs (aaa, beta) before docs; codepoint order puts 'Alpha.md' before 'alpha.md'
    expect(names(root.children)).toEqual(['aaa', 'beta', 'Alpha.md', 'alpha.md', 'zebra.md']);
  });

  it('counts docs per dir recursively (root counts everything)', () => {
    const root = buildTree(
      nodeMap(
        makeNode('kuu.md'),
        makeNode('maa.md'),
        makeNode('saaret/atolli.md'),
        makeNode('saaret/laguuni.md'),
        makeNode('saaret/koillinen/riutta.md'),
      ).values(),
    );
    expect(root.docCount).toBe(5);
    const saaret = root.children.find((e) => e.name === 'saaret') as TreeDir;
    expect(saaret.docCount).toBe(3);
    const koillinen = saaret.children.find((e) => e.name === 'koillinen') as TreeDir;
    expect(koillinen.docCount).toBe(1);
  });

  it('flags reserved and orphan docs so rows can de-emphasize/mark them', () => {
    const root = buildTree(
      nodeMap(
        makeNode('index.md', { title: 'Koti', reserved: true }),
        makeNode('yksinainen.md', { title: 'Yksinäinen', orphan: true }),
      ).values(),
    );
    const [index, yksinainen] = root.children as TreeDoc[];
    expect(index?.reserved).toBe(true);
    expect(index?.orphan).toBe(false);
    expect(yksinainen?.reserved).toBe(false);
    expect(yksinainen?.orphan).toBe(true);
  });
});

describe('treeForGraph (memo by seq)', () => {
  it('returns the identical tree object while the graph is unchanged', () => {
    const nodes = nodeMap(makeNode('kuu.md'), makeNode('saaret/atolli.md'));
    const first = treeForGraph(nodes, 10);
    expect(treeForGraph(nodes, 10)).toBe(first);
  });

  it('rebuilds when a graph change bumps the seq — a joined doc appears in its dir', () => {
    const before = nodeMap(makeNode('kuu.md'), makeNode('saaret/atolli.md'));
    const first = treeForGraph(before, 10);
    const after = new Map(before);
    after.set('saaret/uusi.md', makeNode('saaret/uusi.md', { title: 'Uusi' }));
    const second = treeForGraph(after, 11);
    expect(second).not.toBe(first);
    const saaret = second.children.find((e) => e.name === 'saaret') as TreeDir;
    expect(saaret.docCount).toBe(2);
    expect(names(saaret.children)).toEqual(['atolli.md', 'uusi.md']);
  });
});

describe('flattenVisible', () => {
  const root = buildTree(
    nodeMap(
      makeNode('kuu.md', { title: 'Kuu' }),
      makeNode('saaret/atolli.md', { title: 'Atolli' }),
      makeNode('saaret/koillinen/riutta.md', { title: 'Riutta' }),
    ).values(),
  );

  it('hides children of collapsed dirs', () => {
    const rows = flattenVisible(root, () => false);
    expect(rows.map((r) => r.entry.path)).toEqual(['saaret', 'kuu.md']);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  it('walks expanded dirs in render order with increasing depth', () => {
    const rows = flattenVisible(root, () => true);
    expect(rows.map((r) => r.entry.path)).toEqual([
      'saaret',
      'saaret/koillinen',
      'saaret/koillinen/riutta.md',
      'saaret/atolli.md',
      'kuu.md',
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it('expands per-dir: an open parent can hold a closed child dir', () => {
    const rows = flattenVisible(root, (p) => p === 'saaret');
    expect(rows.map((r) => r.entry.path)).toEqual(['saaret', 'saaret/koillinen', 'saaret/atolli.md', 'kuu.md']);
  });
});

describe('tree helpers', () => {
  it('ancestorDirsOf lists every ancestor dir path, outermost first', () => {
    expect(ancestorDirsOf('kuu.md')).toEqual([]);
    expect(ancestorDirsOf('saaret/atolli.md')).toEqual(['saaret']);
    expect(ancestorDirsOf('a/b/c.md')).toEqual(['a', 'a/b']);
  });

  it('countDirs counts every dir in the tree (root excluded)', () => {
    const root = buildTree(
      nodeMap(makeNode('kuu.md'), makeNode('saaret/atolli.md'), makeNode('saaret/koillinen/riutta.md')).values(),
    );
    expect(countDirs(root)).toBe(2);
    expect(AUTO_EXPAND_MAX_DIRS).toBe(3); // few dirs -> default-expanded tree
  });
});
