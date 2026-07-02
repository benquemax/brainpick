import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, GraphPayload } from '../graph/types';
import { createUIStore } from '../state/store';
import { LiveConnection, type EventSourceLike } from './connection';

function makeNode(id: string): GraphNode {
  return {
    id,
    title: id,
    description: null,
    type: null,
    tags: [],
    timestamp: null,
    in: 0,
    out: 0,
    orphan: false,
    reserved: false,
  };
}

function payloadWith(ids: string[]): GraphPayload {
  return {
    nodes: ids.map(makeNode),
    edges: [],
    ghosts: [],
    islands: [],
    stats: { docs: ids.length, edges: 0, ghosts: 0, islands: 0, orphans: 0, tags: 0 },
    tags: {},
  };
}

class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }

  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    const ev = { data: data === undefined ? '' : JSON.stringify(data) } as MessageEvent<string>;
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  static latest(): FakeEventSource {
    const es = FakeEventSource.all[FakeEventSource.all.length - 1];
    if (!es) throw new Error('no FakeEventSource created');
    return es;
  }
}

function delta(seq: number, addedIds: string[] = []) {
  return {
    seq,
    added: { nodes: addedIds.map(makeNode), edges: [] },
    removed: { nodes: [], edges: [] },
    updated: { nodes: [] },
    stats: { docs: 0, edges: 0, ghosts: 0, islands: 0, orphans: 0, tags: 0 },
    cause: { paths: [], tier: 't1' as const },
  };
}

const hello = (seq: number) => ({ seq, spec_version: '0.1', tiers: { t1: 'fresh', t2: 'off', t3: 'off' } });

describe('LiveConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.all = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(snapshots: Array<{ graph: GraphPayload; seq: number }>) {
    const store = createUIStore();
    const fetches: number[] = [];
    const fetchGraph = vi.fn(async () => {
      fetches.push(Date.now());
      const next = snapshots.shift();
      if (!next) throw new Error('no snapshot scripted');
      return next;
    });
    const conn = new LiveConnection({
      store,
      fetchGraph,
      makeSource: (url) => new FakeEventSource(url),
      baseDelayMs: 500,
      maxDelayMs: 8000,
    });
    return { store, conn, fetchGraph };
  }

  it('fetches a snapshot when hello reports a seq ahead of the store', async () => {
    const { store, conn, fetchGraph } = setup([{ graph: payloadWith(['a.md']), seq: 4212 }]);
    conn.start();
    FakeEventSource.latest().emit('open');
    FakeEventSource.latest().emit('hello', hello(4212));
    await vi.runAllTimersAsync();
    expect(fetchGraph).toHaveBeenCalledTimes(1);
    expect(store.getState().seq).toBe(4212);
    expect(store.getState().nodes.has('a.md')).toBe(true);
    expect(store.getState().connection).toBe('live');
    conn.dispose();
  });

  it('applies in-order deltas without refetching', async () => {
    const { store, conn, fetchGraph } = setup([{ graph: payloadWith(['a.md']), seq: 10 }]);
    conn.start();
    FakeEventSource.latest().emit('hello', hello(10));
    await vi.runAllTimersAsync();
    FakeEventSource.latest().emit('graph.delta', delta(11, ['b.md']));
    FakeEventSource.latest().emit('graph.delta', delta(12, ['c.md']));
    await vi.runAllTimersAsync();
    expect(store.getState().seq).toBe(12);
    expect(store.getState().nodes.size).toBe(3);
    expect(fetchGraph).toHaveBeenCalledTimes(1); // only the initial one
    conn.dispose();
  });

  it('refetches a fresh snapshot when a delta gap raises needsSnapshot', async () => {
    const { store, conn, fetchGraph } = setup([
      { graph: payloadWith(['a.md']), seq: 10 },
      { graph: payloadWith(['a.md', 'b.md', 'z.md']), seq: 20 },
    ]);
    conn.start();
    FakeEventSource.latest().emit('hello', hello(10));
    await vi.runAllTimersAsync();
    FakeEventSource.latest().emit('graph.delta', delta(20, ['z.md'])); // gap: 10 -> 20
    await vi.runAllTimersAsync();
    expect(fetchGraph).toHaveBeenCalledTimes(2);
    expect(store.getState().needsSnapshot).toBe(false);
    expect(store.getState().seq).toBe(20);
    expect(store.getState().nodes.has('z.md')).toBe(true);
    conn.dispose();
  });

  it('applies a graph.snapshot event wholesale', async () => {
    const { store, conn } = setup([{ graph: payloadWith(['a.md']), seq: 10 }]);
    conn.start();
    FakeEventSource.latest().emit('hello', hello(10));
    await vi.runAllTimersAsync();
    FakeEventSource.latest().emit('graph.snapshot', { seq: 30, graph: payloadWith(['q.md']) });
    expect(store.getState().seq).toBe(30);
    expect([...store.getState().nodes.keys()]).toEqual(['q.md']);
    conn.dispose();
  });

  it('routes compile.status into the store', async () => {
    const { store, conn } = setup([{ graph: payloadWith([]), seq: 1 }]);
    conn.start();
    FakeEventSource.latest().emit('compile.status', { seq: 1, state: 'running', tier: 't1' });
    expect(store.getState().compile).toEqual({ seq: 1, state: 'running', tier: 't1' });
    conn.dispose();
  });

  it('reconnects with backoff after errors', async () => {
    const { store, conn } = setup([{ graph: payloadWith(['a.md']), seq: 10 }]);
    conn.start();
    expect(FakeEventSource.all.length).toBe(1);
    FakeEventSource.latest().emit('error');
    expect(store.getState().connection).toBe('reconnecting');
    expect(FakeEventSource.latest().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeEventSource.all.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.all.length).toBe(2); // first retry after baseDelay
    FakeEventSource.latest().emit('error');
    await vi.advanceTimersByTimeAsync(1000); // second retry doubles
    expect(FakeEventSource.all.length).toBe(3);
    FakeEventSource.latest().emit('hello', hello(10));
    await vi.runAllTimersAsync();
    expect(store.getState().connection).toBe('live');
    conn.dispose();
  });

  it('pokeVisible reopens a dead connection immediately', async () => {
    const { conn } = setup([{ graph: payloadWith(['a.md']), seq: 10 }]);
    conn.start();
    FakeEventSource.latest().emit('error');
    expect(FakeEventSource.all.length).toBe(1);
    conn.pokeVisible(); // e.g. tab became visible again
    expect(FakeEventSource.all.length).toBe(2);
    conn.dispose();
  });
});
