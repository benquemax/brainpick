import { describe, expect, it } from 'vitest';
import {
  EMPTY_TIMELINE,
  advancePlay,
  birthIndexOf,
  commitAt,
  deathIndexOf,
  flashRecency,
  hasHistory,
  indexOfTime,
  lastModIndexOf,
  momentQuery,
  parseDeepLink,
  presentDocsAt,
  presentDocsAtIndex,
  presentEdges,
  timeOfIndex,
  versionIndexAtScrub,
  versionsOf,
  type Timeline,
} from './timeline';

/**
 * A three-commit history:
 *   c0 @ T0  adds a.md
 *   c1 @ T1  adds b.md, modifies a.md
 *   c2 @ T2  adds c.md, deletes b.md
 * so at T1 the brain is {a,b}, and b lives only across [T1, T2).
 */
const T0 = '2026-07-02T00:00:00Z';
const T1 = '2026-07-04T00:00:00Z';
const T2 = '2026-07-06T00:00:00Z';
const t0 = Date.parse(T0);
const t1 = Date.parse(T1);
const t2 = Date.parse(T2);

const timeline: Timeline = {
  commits: [
    { sha: 'aaaaaaa', date: T0, author: 'Tom', message: 'born', added: ['a.md'], modified: [], deleted: [] },
    { sha: 'bbbbbbb', date: T1, author: 'Tom', message: 'grow', added: ['b.md'], modified: ['a.md'], deleted: [] },
    { sha: 'ccccccc', date: T2, author: 'Tom', message: 'churn', added: ['c.md'], modified: [], deleted: ['b.md'] },
  ],
  docs: {
    'a.md': { created: T0, modified: [T1], deleted: null },
    'b.md': { created: T1, modified: [], deleted: T2 },
    'c.md': { created: T2, modified: [], deleted: null },
  },
  span: { commits: 3, first: T0, last: T2 },
};

describe('hasHistory', () => {
  it('is false for the empty (non-repo) shape and true for real history', () => {
    expect(hasHistory(EMPTY_TIMELINE)).toBe(false);
    expect(hasHistory({ commits: [], docs: {}, span: null })).toBe(false);
    expect(hasHistory(timeline)).toBe(true);
  });
});

describe('presentDocsAt — spec/90 boundary rules', () => {
  it('created ≤ T is INCLUSIVE: a doc is present exactly at its creation instant', () => {
    // just before a is born → empty; exactly at t0 → a is present.
    expect([...presentDocsAt(timeline, t0 - 1)]).toEqual([]);
    expect(presentDocsAt(timeline, t0).has('a.md')).toBe(true);
  });

  it('deleted > T is EXCLUSIVE: a doc deleted exactly at T is already gone', () => {
    // b born at t1, deleted at t2. Present across [t1, t2); gone at t2 exactly.
    expect(presentDocsAt(timeline, t1).has('b.md')).toBe(true);
    expect(presentDocsAt(timeline, t2 - 1).has('b.md')).toBe(true);
    expect(presentDocsAt(timeline, t2).has('b.md')).toBe(false); // deleted == T → absent
  });

  it('reconstructs the full membership at each commit instant', () => {
    expect([...presentDocsAt(timeline, t0)].sort()).toEqual(['a.md']);
    expect([...presentDocsAt(timeline, t1)].sort()).toEqual(['a.md', 'b.md']);
    // at t2: c born, b deleted → {a, c}
    expect([...presentDocsAt(timeline, t2)].sort()).toEqual(['a.md', 'c.md']);
  });

  it('before all history everything is absent; after all history the survivors remain', () => {
    expect(presentDocsAt(timeline, t0 - 1_000).size).toBe(0);
    expect([...presentDocsAt(timeline, t2 + 1_000_000)].sort()).toEqual(['a.md', 'c.md']);
  });
});

describe('presentEdges — both endpoints must be present', () => {
  const edges = [
    { source: 'a.md', target: 'b.md' },
    { source: 'a.md', target: 'c.md' },
    { source: 'b.md', target: 'c.md' },
  ];
  it('keeps an edge only when both endpoints exist at T', () => {
    // at t0 only a → no edges
    expect(presentEdges(edges, presentDocsAt(timeline, t0))).toEqual([]);
    // at t1 {a,b} → only a-b
    expect(presentEdges(edges, presentDocsAt(timeline, t1))).toEqual([{ source: 'a.md', target: 'b.md' }]);
    // at t2 {a,c} → only a-c (b-c drops because b is gone)
    expect(presentEdges(edges, presentDocsAt(timeline, t2))).toEqual([{ source: 'a.md', target: 'c.md' }]);
  });
});

describe('indexOfTime / timeOfIndex — the scrub-bar coordinate', () => {
  it('maps commit instants to their integer index (and clamps the ends)', () => {
    expect(indexOfTime(timeline, t0)).toBe(0);
    expect(indexOfTime(timeline, t1)).toBe(1);
    expect(indexOfTime(timeline, t2)).toBe(2);
    expect(indexOfTime(timeline, t0 - 1_000)).toBe(0); // clamp low
    expect(indexOfTime(timeline, t2 + 1_000)).toBe(2); // clamp high
  });

  it('is piecewise-linear between commits (halfway in time → halfway in index)', () => {
    const mid = (t0 + t1) / 2;
    expect(indexOfTime(timeline, mid)).toBeCloseTo(0.5, 6);
  });

  it('timeOfIndex is the inverse and round-trips', () => {
    expect(timeOfIndex(timeline, 0)).toBe(t0);
    expect(timeOfIndex(timeline, 1)).toBe(t1);
    expect(timeOfIndex(timeline, 2)).toBe(t2);
    expect(timeOfIndex(timeline, 0.5)).toBeCloseTo((t0 + t1) / 2, 6);
    expect(indexOfTime(timeline, timeOfIndex(timeline, 1.5))).toBeCloseTo(1.5, 6);
  });

  it('presentDocsAtIndex agrees with presentDocsAt at the stations', () => {
    expect([...presentDocsAtIndex(timeline, 1)].sort()).toEqual(['a.md', 'b.md']);
  });
});

describe('birth / death / modified indices (drive the shader fade)', () => {
  it('reports the commit index a doc is born, dies, and last modified at', () => {
    expect(birthIndexOf(timeline, 'a.md')).toBe(0);
    expect(birthIndexOf(timeline, 'b.md')).toBe(1);
    expect(birthIndexOf(timeline, 'c.md')).toBe(2);
    expect(deathIndexOf(timeline, 'b.md')).toBe(2);
    expect(deathIndexOf(timeline, 'a.md')).toBe(Number.POSITIVE_INFINITY);
    expect(lastModIndexOf(timeline, 'a.md')).toBe(1);
    expect(lastModIndexOf(timeline, 'b.md')).toBe(-1);
  });

  it('untracked docs are born at -1 (present throughout, never blink out)', () => {
    expect(birthIndexOf(timeline, 'index.md')).toBe(-1);
    expect(deathIndexOf(timeline, 'index.md')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('advancePlay — the growth-movie stepping', () => {
  it('advances by dt·rate and stops (done) at the last commit', () => {
    const a = advancePlay(0, 1, 1, 3); // 1s at 1 commit/s over 3 commits (last=2)
    expect(a).toEqual({ index: 1, done: false });
    const b = advancePlay(1.5, 1, 1, 3);
    expect(b).toEqual({ index: 2, done: true }); // reaches the end → stop
    const c = advancePlay(1.9, 0.05, 2, 3); // 0.05s·2 = 0.1 → 2.0 → clamps + done
    expect(c).toEqual({ index: 2, done: true });
  });
});

describe('deep-linking a moment', () => {
  it('parses ?commit=<sha> (prefix match either way)', () => {
    expect(parseDeepLink('?commit=bbbbbbb', timeline)).toEqual({ index: 1 });
    expect(parseDeepLink('?commit=ccc', timeline)).toEqual({ index: 2 }); // short prefix
  });

  it('parses ?t=<iso> to the nearest commit index', () => {
    expect(parseDeepLink(`?t=${T1}`, timeline)).toEqual({ index: 1 });
    const mid = new Date((t0 + t1) / 2).toISOString();
    expect(parseDeepLink(`?t=${mid}`, timeline)?.index).toBeCloseTo(0.5, 6);
  });

  it('returns null with no matching param or no history', () => {
    expect(parseDeepLink('?foo=bar', timeline)).toBeNull();
    expect(parseDeepLink('?commit=zzz', timeline)).toBeNull();
    expect(parseDeepLink(`?t=${T1}`, EMPTY_TIMELINE)).toBeNull();
  });

  it('momentQuery round-trips through parseDeepLink', () => {
    const q = momentQuery(timeline, 1);
    expect(q).toBe('?commit=bbbbbbb');
    expect(parseDeepLink(q, timeline)).toEqual({ index: 1 });
    expect(momentQuery(EMPTY_TIMELINE, 0)).toBe('');
  });
});

describe('commitAt', () => {
  it('returns the nearest commit (rounded) or null without history', () => {
    expect(commitAt(timeline, 0.4)?.sha).toBe('aaaaaaa');
    expect(commitAt(timeline, 1.6)?.sha).toBe('ccccccc');
    expect(commitAt(EMPTY_TIMELINE, 0)).toBeNull();
  });
});

describe('versionsOf / versionIndexAtScrub (the file-level Time Machine)', () => {
  it("a doc's versions are the commits that added or modified it, with scrub indices", () => {
    expect(versionsOf(timeline, 'a.md')).toEqual([
      { sha: 'aaaaaaa', date: T0, message: 'born', index: 0 },
      { sha: 'bbbbbbb', date: T1, message: 'grow', index: 1 },
    ]);
    expect(versionsOf(timeline, 'b.md')).toEqual([{ sha: 'bbbbbbb', date: T1, message: 'grow', index: 1 }]);
    expect(versionsOf(timeline, 'nope.md')).toEqual([]);
    expect(versionsOf(EMPTY_TIMELINE, 'a.md')).toEqual([]);
  });

  it('the version in effect at a scrub position is the last one at or before it', () => {
    const versions = versionsOf(timeline, 'a.md');
    expect(versionIndexAtScrub(versions, 0)).toBe(0); // v1 just landed
    expect(versionIndexAtScrub(versions, 0.7)).toBe(0); // between commits: still v1
    expect(versionIndexAtScrub(versions, 1)).toBe(1); // v2 exactly at its commit
    expect(versionIndexAtScrub(versions, 2)).toBe(1); // later commits don't change the file
    const late = versionsOf(timeline, 'c.md');
    expect(versionIndexAtScrub(late, 0)).toBe(-1); // unborn at the first commit
  });
});

describe('flashRecency', () => {
  // Found live (2026-07-12): birth/mod flashes were a pure function of scrub
  // POSITION, so standing on a commit held them at full glow forever — a
  // whole-wiki commit turned every node white until you scrubbed away.
  // Recency gates flashes by wall-clock time since the scrub last MOVED.
  it('holds full flash briefly, then decays to zero once the scrub rests', () => {
    expect(flashRecency(0, 0.35, 1.2)).toBe(1);
    expect(flashRecency(0.35, 0.35, 1.2)).toBe(1); // still inside the hold
    const mid = flashRecency(0.95, 0.35, 1.2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(flashRecency(1.55, 0.35, 1.2)).toBe(0); // hold + decay elapsed
    expect(flashRecency(60, 0.35, 1.2)).toBe(0);
  });

  it('a scrub that never moved reads as fully decayed', () => {
    expect(flashRecency(Number.POSITIVE_INFINITY, 0.35, 1.2)).toBe(0);
  });
});
