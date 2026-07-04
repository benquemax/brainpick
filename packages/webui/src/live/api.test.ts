import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEntityGraph, fetchNeighbors } from './api';

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl as typeof fetch));
}
function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchEntityGraph', () => {
  it('maps a 200 entity graph and reads the seq from the ETag', async () => {
    mockFetch((url) => {
      expect(url).toContain('/api/graph?layer=entities');
      return json(
        { nodes: [{ id: 'aurinko', name: 'Aurinko', type: 'star', description: 'x', degree: 2 }], edges: [{ src: 'kuu', dst: 'aurinko', weight: 0.9 }] },
        { headers: { ETag: '"1"', 'content-type': 'application/json' } },
      );
    });
    const res = await fetchEntityGraph();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.seq).toBe(1);
    expect(res.graph.nodes[0]?.name).toBe('Aurinko');
    expect(res.graph.edges[0]?.weight).toBe(0.9);
  });

  it('reports a 404 (T3 not compiled) as an availability signal, not a throw', async () => {
    mockFetch(() => json({ error: 'no entity layer yet' }, { status: 404 }));
    const res = await fetchEntityGraph();
    expect(res).toEqual({ ok: false, status: 404 });
  });

  it('busts the cache with a fresh param when asked', async () => {
    const fn = vi.fn(() => json({ nodes: [], edges: [] }, { headers: { ETag: '"9"' } }));
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    await fetchEntityGraph(true, 9);
    expect(String((fn.mock.calls[0] as unknown[])[0])).toContain('fresh=');
  });
});

describe('fetchNeighbors', () => {
  it('requests the doc-centered entity neighborhood and returns source_docs', async () => {
    mockFetch((url) => {
      expect(url).toContain('/api/neighbors?id=aurinko.md&layer=entities&depth=1');
      return json({
        center: 'aurinko.md',
        nodes: [{ id: 'aurinko', name: 'Aurinko', description: 'x', distance: 0, source_docs: ['aurinko.md', 'planeetat.md'] }],
        edges: [],
      });
    });
    const res = await fetchNeighbors('aurinko.md', 'entities', 1);
    expect(res?.nodes[0]).toMatchObject({ id: 'aurinko', source_docs: ['aurinko.md', 'planeetat.md'] });
  });

  it('returns null on an HTTP or transport error (grounding is best-effort)', async () => {
    mockFetch(() => json({ error: 'nope' }, { status: 500 }));
    expect(await fetchNeighbors('x.md')).toBeNull();
    mockFetch(() => {
      throw new Error('network down');
    });
    expect(await fetchNeighbors('x.md')).toBeNull();
  });
});
