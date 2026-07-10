import { describe, expect, it, vi } from 'vitest';
import type { GraphPayload } from '../graph/types';
import type { EntityGraph, NeighborsResponse } from '../graph/entities';
import { entityRenderId } from '../graph/entities';
import { createUIStore } from '../state/store';
import { EntityLayerController } from './entities';
import type { EntityGraphFetch } from './api';

const GRAPH: GraphPayload = {
  nodes: [
    { id: 'aurinko.md', title: 'Aurinko', description: null, type: null, about: null, tags: [], timestamp: null, in: 0, out: 1, orphan: false, reserved: false },
    { id: 'kuu.md', title: 'Kuu', description: null, type: null, about: null, tags: [], timestamp: null, in: 1, out: 0, orphan: false, reserved: false },
  ],
  edges: [{ source: 'aurinko.md', target: 'kuu.md', kind: 'link', label: null, count: 1 }],
  ghosts: [], islands: [], stats: { docs: 2, edges: 1, ghosts: 0, islands: 0, orphans: 0, tags: 0 }, tags: {},
};
const ENTITY_GRAPH: EntityGraph = {
  nodes: [{ id: 'aurinko', name: 'Aurinko', type: 'star', description: 'x', degree: 1 }],
  edges: [],
};

function withT3(store: ReturnType<typeof createUIStore>, tier = 'fresh') {
  store.getState().ingestHello({ seq: 1, spec_version: '0.1', tiers: { t1: 'fresh', t2: 'off', t3: tier } });
  store.getState().ingestSnapshot(GRAPH, 1);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('EntityLayerController', () => {
  it('does nothing in links mode — honesty: no entity fetch', async () => {
    const store = createUIStore();
    withT3(store);
    const fetchGraph = vi.fn<() => Promise<EntityGraphFetch>>();
    const ctl = new EntityLayerController({ store, fetchEntityGraph: fetchGraph, fetchNeighbors: async () => null });
    ctl.start();
    await flush();
    expect(fetchGraph).not.toHaveBeenCalled();
    ctl.dispose();
  });

  it('switching to entities fetches the graph and ingests it', async () => {
    const store = createUIStore();
    withT3(store);
    const fetchGraph = vi.fn(async (): Promise<EntityGraphFetch> => ({ ok: true, graph: ENTITY_GRAPH, seq: 1 }));
    const ctl = new EntityLayerController({ store, fetchEntityGraph: fetchGraph, fetchNeighbors: async () => null });
    ctl.start();
    store.getState().setLayer('entities');
    await flush();
    await flush();
    expect(fetchGraph).toHaveBeenCalledTimes(1);
    expect(store.getState().entityAvailability).toBe('available');
    expect(store.getState().entityGraph?.nodes.length).toBe(1);
    ctl.dispose();
  });

  it('a 404 degrades to unavailable and falls the view back to links, not an error', async () => {
    const store = createUIStore();
    withT3(store);
    const ctl = new EntityLayerController({
      store,
      fetchEntityGraph: async () => ({ ok: false, status: 404 }),
      fetchNeighbors: async () => null,
    });
    ctl.start();
    store.getState().setLayer('overlay');
    await flush();
    await flush();
    const s = store.getState();
    expect(s.entityAvailability).toBe('unavailable');
    expect(s.layer).toBe('links'); // the view fell back
    // and the layer can no longer be re-entered
    store.getState().setLayer('entities');
    expect(store.getState().layer).toBe('links');
    ctl.dispose();
  });

  it('after the graph loads, grounding is reconstructed from neighbors source_docs', async () => {
    const store = createUIStore();
    withT3(store);
    const neighbors = vi.fn(async (id: string): Promise<NeighborsResponse | null> => ({
      center: id,
      nodes: id === 'aurinko.md'
        ? [{ id: 'aurinko', name: 'Aurinko', description: 'x', distance: 0, source_docs: ['aurinko.md', 'planeetat.md'] }]
        : [],
      edges: [],
    }));
    const ctl = new EntityLayerController({
      store,
      fetchEntityGraph: async () => ({ ok: true, graph: ENTITY_GRAPH, seq: 1 }),
      fetchNeighbors: neighbors,
    });
    ctl.start();
    store.getState().setLayer('entities');
    await flush(); await flush(); await flush();
    expect(neighbors).toHaveBeenCalled();
    expect(store.getState().grounding.get('aurinko')).toEqual(['aurinko.md', 'planeetat.md']);
    // and it feeds the overlay's doc→entity highlight
    store.getState().setLayer('overlay');
    store.getState().selectDocInOverlay('aurinko.md');
    expect(store.getState().highlight.has(entityRenderId('aurinko'))).toBe(true);
    ctl.dispose();
  });
});
