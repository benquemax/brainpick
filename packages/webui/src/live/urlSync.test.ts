/**
 * urlSync: the ONE writer of the address bar. At boot it applies a shared
 * view (parseViewParams) to the store — the doc selection waiting for the
 * graph to land — and from then on mirrors the store back into the query
 * string via history.replaceState, ?commit= (the time machine's moment)
 * included. Injected location/history keep it pure enough to unit test.
 */
import { describe, expect, it } from 'vitest';
import type { GraphPayload } from '../graph/types';
import { createUIStore } from '../state/store';
import type { Timeline } from '../time/timeline';
import { startUrlSync } from './urlSync';

const makeNode = (id: string) => ({
  id,
  title: id,
  description: null,
  type: 'article',
  about: null,
  tags: [],
  timestamp: '2026-01-01T00:00:00Z',
  in: 0,
  out: 0,
  orphan: false,
  reserved: false,
});

const payload: GraphPayload = {
  nodes: [makeNode('a.md'), makeNode('b.md')],
  edges: [{ source: 'a.md', target: 'b.md', kind: 'link', label: null, count: 1 }],
  ghosts: [],
  islands: [],
  stats: { docs: 2, edges: 1, ghosts: 0, islands: 0, orphans: 0, tags: 0 },
  tags: {},
};

const TIMELINE: Timeline = {
  commits: [
    { sha: 'c1', date: '2026-01-01T00:00:00Z', author: 'a', message: 'one', added: ['a.md'], modified: [], deleted: [] },
    { sha: 'c2', date: '2026-01-02T00:00:00Z', author: 'a', message: 'two', added: ['b.md'], modified: [], deleted: [] },
  ],
  docs: {
    'a.md': { created: '2026-01-01T00:00:00Z', modified: [], deleted: null },
    'b.md': { created: '2026-01-02T00:00:00Z', modified: [], deleted: null },
  },
  span: { commits: 2, first: '2026-01-01T00:00:00Z', last: '2026-01-02T00:00:00Z' },
};

function harness(search = '') {
  const store = createUIStore();
  const writes: string[] = [];
  const stop = startUrlSync({
    store,
    location: { search, pathname: '/', hash: '' },
    history: { replaceState: (_d, _u, url) => writes.push(String(url)) },
  });
  return { store, writes, stop };
}

describe('boot apply', () => {
  it('applies view, layer, lens and ghosts immediately', () => {
    const { store, stop } = harness('?view=brain&layer=overlay&lens=orphans&ghosts=0');
    const s = store.getState();
    expect(s.mode).toBe('brain');
    expect(s.layer).toBe('overlay');
    expect(s.lens).toEqual({ kind: 'orphans' });
    expect(s.showGhosts).toBe(false);
    stop();
  });

  it('selects the linked doc once the graph lands — not before', () => {
    const { store, stop } = harness('?doc=b.md&view=cosmos');
    expect(store.getState().selection).toBeNull();
    store.getState().ingestSnapshot(payload, 1);
    expect(store.getState().selection).toBe('b.md');
    stop();
  });

  it('never steals a selection the user already made', () => {
    const { store, stop } = harness('?doc=b.md&view=cosmos');
    store.getState().ingestSnapshot(payload, 1);
    // simulate: user clicked a.md in the same tick the graph landed
    store.getState().select('a.md');
    store.getState().ingestSnapshot(payload, 2);
    expect(store.getState().selection).toBe('a.md');
    stop();
  });
});

describe('address-bar writing', () => {
  it('stays silent before the first snapshot, then mirrors the view', () => {
    const { store, writes, stop } = harness();
    store.getState().setMode('brain');
    expect(writes).toHaveLength(0); // no graph yet — nothing worth linking
    store.getState().ingestSnapshot(payload, 1);
    store.getState().select('a.md');
    expect(writes.at(-1)).toBe('/?doc=a.md&view=brain');
    stop();
  });

  it('writes each change once — no repeat on unrelated churn', () => {
    const { store, writes, stop } = harness();
    store.getState().ingestSnapshot(payload, 1);
    const n = writes.length;
    store.getState().setSearchQuery('zzz'); // not part of the URL
    expect(writes.length).toBe(n);
    stop();
  });

  it('mirrors the time-machine moment as ?commit= and clears it on exit', () => {
    const { store, writes, stop } = harness();
    store.getState().ingestSnapshot(payload, 1);
    store.getState().ingestTimeline(TIMELINE);
    store.getState().enterTimeTravel(0);
    expect(writes.at(-1)).toContain('commit=c1');
    store.getState().exitTimeTravel();
    expect(writes.at(-1)).not.toContain('commit=');
    stop();
  });

  it('stops writing after dispose', () => {
    const { store, writes, stop } = harness();
    store.getState().ingestSnapshot(payload, 1);
    stop();
    const n = writes.length;
    store.getState().setMode('brain');
    expect(writes.length).toBe(n);
  });
});
