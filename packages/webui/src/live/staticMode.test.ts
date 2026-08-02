/**
 * The static-snapshot adapter (staticMode.ts): pure URL mapping + the
 * client-side keyword search that stands in for GET /api/search when the UI
 * is served as a baked snapshot (GitHub Pages demo) with no engine behind it.
 *
 * The search scoring deliberately mirrors scripts/mock-server.mjs
 * handleSearch — title×3 / description×2 / body×1 per query token, score
 * normalized by token count, snippet cut around the first body match — so the
 * static demo answers exactly like the T2-less reference contract.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveStaticVersionSha,
  staticDocUrl,
  staticGraphUrl,
  staticNeighborsUrl,
  staticSearch,
  type StaticSearchDoc,
} from './staticMode';
import type { Timeline } from '../time/timeline';

const BASE = './';

describe('static URL mapping', () => {
  it('separates graph layers into distinct paths (static hosts drop query strings)', () => {
    expect(staticGraphUrl(BASE, 'links')).toBe('./api/graph.links.json');
    expect(staticGraphUrl(BASE, 'entities')).toBe('./api/graph.entities.json');
  });

  it('maps a doc to its baked file, encoding per path segment', () => {
    expect(staticDocUrl(BASE, 'reference/cli/serve.md')).toBe('./api/docs/reference/cli/serve.md');
    expect(staticDocUrl(BASE, 'sär kylä.md')).toBe('./api/docs/s%C3%A4r%20kyl%C3%A4.md');
  });

  it('maps a doc AS OF a commit into the doc-versions tree', () => {
    expect(staticDocUrl(BASE, 'a/b.md', 'abc123')).toBe('./api/doc-versions/abc123/a/b.md');
  });

  it('maps neighbors to a per-doc baked file', () => {
    expect(staticNeighborsUrl(BASE, 'reference/cli/serve.md')).toBe(
      './api/neighbors/reference/cli/serve.md.json',
    );
  });

  it('respects a non-root base prefix', () => {
    expect(staticGraphUrl('/brainpick/', 'links')).toBe('/brainpick/api/graph.links.json');
  });
});

const INDEX: StaticSearchDoc[] = [
  {
    path: 'compile-pipeline.md',
    title: 'Compile pipeline',
    description: 'How a bundle becomes artifacts',
    text: 'The compiler walks the bundle and emits tiered artifacts.',
  },
  {
    path: 'holo-ui.md',
    title: 'The holographic UI',
    description: null,
    text: 'A cosmos of docs. The compile pipeline feeds it live deltas over SSE.',
  },
  {
    path: 'index.md',
    title: 'Index',
    description: 'Reserved page',
    text: 'compile compile compile',
    reserved: true,
  },
];

describe('staticSearch', () => {
  it('returns the empty response for a blank query', () => {
    const res = staticSearch(INDEX, '   ', 'keyword', 12);
    expect(res.hits).toEqual([]);
    expect(res.used_modes).toEqual(['keyword']);
    expect(res.degraded_from).toBeNull();
  });

  it('ranks a title match above a body-only match', () => {
    const res = staticSearch(INDEX, 'compile', 'keyword', 12);
    expect(res.hits.map((h) => h.path)).toEqual(['compile-pipeline.md', 'holo-ui.md']);
    const top = res.hits[0]!;
    // title (3) + body (1) for one token
    expect(top.score).toBe(4);
    expect(top.source).toBe('keyword');
  });

  it('excludes reserved docs', () => {
    const res = staticSearch(INDEX, 'compile', 'keyword', 12);
    expect(res.hits.some((h) => h.path === 'index.md')).toBe(false);
  });

  it('normalizes the score by token count and cuts a snippet at the first body match', () => {
    const res = staticSearch(INDEX, 'compile artifacts', 'keyword', 12);
    const top = res.hits[0]!;
    expect(top.path).toBe('compile-pipeline.md');
    // "compile": title 3 + body 1; "artifacts": description 2 + body 1 → 7 / 2 tokens
    expect(top.score).toBe(3.5);
    expect(top.snippet).toContain('walks the bundle');
  });

  it('honors the limit', () => {
    expect(staticSearch(INDEX, 'compile', 'keyword', 1).hits).toHaveLength(1);
  });

  it('reports honest degradation per requested mode', () => {
    expect(staticSearch(INDEX, 'compile', 'keyword', 12).degraded_from).toBeNull();
    expect(staticSearch(INDEX, 'compile', 'auto', 12).degraded_from).toBe('semantic');
    expect(staticSearch(INDEX, 'compile', 'semantic', 12).degraded_from).toBe('semantic');
    expect(staticSearch(INDEX, 'compile', 'graph', 12).degraded_from).toBe('graph');
  });
});

/**
 * The exporter bakes one file per DISTINCT doc version (the commits that
 * added/modified it), not per (doc × commit). The resolver answers the live
 * server's "?at=<any commit>" question client-side: which of the doc's own
 * versions was in effect at that commit.
 */
const commit = (sha: string, date: string, added: string[], modified: string[]) => ({
  sha,
  date,
  author: 'a',
  message: sha,
  added,
  modified,
  deleted: [],
});

const TIMELINE: Timeline = {
  commits: [
    commit('c1', '2026-01-01T00:00:00Z', ['a.md'], []),
    commit('c2', '2026-01-02T00:00:00Z', ['b.md'], []),
    commit('c3', '2026-01-03T00:00:00Z', [], ['a.md']),
    commit('c4', '2026-01-04T00:00:00Z', [], []),
  ],
  docs: {},
  span: { commits: 4, first: '2026-01-01T00:00:00Z', last: '2026-01-04T00:00:00Z' },
};

describe('resolveStaticVersionSha', () => {
  it('answers the version in effect at a later, unrelated commit', () => {
    expect(resolveStaticVersionSha(TIMELINE, 'a.md', 'c2')).toBe('c1');
    expect(resolveStaticVersionSha(TIMELINE, 'a.md', 'c4')).toBe('c3');
  });

  it('answers the version at exactly its own commit', () => {
    expect(resolveStaticVersionSha(TIMELINE, 'a.md', 'c3')).toBe('c3');
  });

  it('returns null for a doc unborn at that commit', () => {
    expect(resolveStaticVersionSha(TIMELINE, 'b.md', 'c1')).toBeNull();
  });

  it('returns null for an unknown commit sha', () => {
    expect(resolveStaticVersionSha(TIMELINE, 'a.md', 'nope')).toBeNull();
  });
});
