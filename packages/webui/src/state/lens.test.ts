import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../graph/types';
import { lensNodeSet, sameLens } from './lens';

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

describe('lensNodeSet', () => {
  const nodes = nodeMap(
    makeNode('a.md', { tags: ['star'] }),
    makeNode('b.md', { tags: ['star', 'home'] }),
    makeNode('c.md', { orphan: true }),
    makeNode('d.md', { orphan: true, tags: ['home'] }),
    makeNode('e.md', { about: 'person' }),
    makeNode('f.md', { about: 'person' }),
    makeNode('g.md', { about: 'place' }),
  );

  it('none lens selects nothing', () => {
    expect(lensNodeSet(nodes, { kind: 'none' }).size).toBe(0);
  });

  it('orphan lens selects exactly the orphan nodes', () => {
    const set = lensNodeSet(nodes, { kind: 'orphans' });
    expect([...set].sort()).toEqual(['c.md', 'd.md']);
  });

  it('tag lens selects nodes carrying the tag', () => {
    const set = lensNodeSet(nodes, { kind: 'tag', tag: 'star' });
    expect([...set].sort()).toEqual(['a.md', 'b.md']);
  });

  it('tag lens with an unknown tag selects nothing (honest empty state)', () => {
    expect(lensNodeSet(nodes, { kind: 'tag', tag: 'nope' }).size).toBe(0);
  });

  it('about lens selects nodes with that ontology subject', () => {
    const set = lensNodeSet(nodes, { kind: 'about', about: 'person' });
    expect([...set].sort()).toEqual(['e.md', 'f.md']);
  });

  it('about lens with an about value nothing has selects nothing (honest empty state)', () => {
    expect(lensNodeSet(nodes, { kind: 'about', about: 'event' }).size).toBe(0);
  });

  it('sameLens treats equal lenses as equal and different tags/abouts as different', () => {
    expect(sameLens({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(sameLens({ kind: 'orphans' }, { kind: 'orphans' })).toBe(true);
    expect(sameLens({ kind: 'tag', tag: 'star' }, { kind: 'tag', tag: 'star' })).toBe(true);
    expect(sameLens({ kind: 'tag', tag: 'star' }, { kind: 'tag', tag: 'home' })).toBe(false);
    expect(sameLens({ kind: 'orphans' }, { kind: 'none' })).toBe(false);
    expect(sameLens({ kind: 'tag', tag: 'star' }, { kind: 'orphans' })).toBe(false);
    expect(sameLens({ kind: 'about', about: 'person' }, { kind: 'about', about: 'person' })).toBe(true);
    expect(sameLens({ kind: 'about', about: 'person' }, { kind: 'about', about: 'place' })).toBe(false);
    expect(sameLens({ kind: 'about', about: 'person' }, { kind: 'tag', tag: 'star' })).toBe(false);
  });
});
