/**
 * The TIME MACHINE reconstructor (spec/90-timeline.md).
 *
 * `timeline.json` distills the bundle's git history into a shape the UI can
 * travel through: scrub back and the brain shrinks to its younger self, scrub
 * forward and it grows. This module is the pure, framework-free core — given a
 * timeline and a scrub position it answers "which docs/edges existed then", so
 * the scene can drive node/edge visibility without recompiling any past commit.
 *
 * Two coordinate systems meet here:
 *  - a TIME T (ms since epoch), the instant the spec reconstructs a moment at;
 *  - a fractional COMMIT INDEX in [0, N-1], the scrub bar's coordinate (evenly
 *    spaced commit stations — far more usable than a bursty time axis).
 * `indexOfTime`/`timeOfIndex` map between them (monotonic, piecewise-linear).
 *
 * Everything is a pure function of its inputs (no globals, no Date.now) so the
 * reconstruction is unit-tested directly against spec/90's boundary rules.
 */

/** One commit in the timeline (spec/90). The array is chronological, OLDEST first. */
export interface TimelineCommit {
  sha: string;
  date: string; // ISO-8601 UTC
  author: string;
  message: string;
  added: string[];
  modified: string[];
  deleted: string[];
}

/** Per-doc lifecycle derived from the commits (spec/90 `docs`). */
export interface TimelineDocLife {
  created: string;
  modified: string[];
  deleted: string | null;
}

/** The `{commits, first, last}` summary (spec/90 `span`). */
export interface TimelineSpan {
  commits: number;
  first: string;
  last: string;
}

/** The whole `timeline.json` payload (GET /api/timeline). */
export interface Timeline {
  commits: TimelineCommit[];
  docs: Record<string, TimelineDocLife>;
  span: TimelineSpan | null;
}

/** The empty shape a non-repo bundle serves (spec/50) — the feature hides on it. */
export const EMPTY_TIMELINE: Timeline = { commits: [], docs: {}, span: null };

/** ms since epoch for an ISO string (NaN for an unparseable value). */
function ms(iso: string): number {
  return Date.parse(iso);
}

/** True when the timeline carries real history to travel through. */
export function hasHistory(timeline: Timeline): boolean {
  return timeline.span !== null && timeline.commits.length > 0;
}

/**
 * Docs present at instant T (ms), per spec/90's normative rule:
 *   `created ≤ T` AND (`deleted` is null OR `deleted > T`).
 * `created` is inclusive; `deleted` is exclusive — a doc deleted exactly at T is
 * already gone. This is the exact, complete reconstruction (it includes docs
 * that were later deleted — the scene can only render the ones it still has
 * geometry for, an approximation it states in the HUD).
 */
export function presentDocsAt(timeline: Timeline, tMs: number): Set<string> {
  const present = new Set<string>();
  for (const path of Object.keys(timeline.docs)) {
    const life = timeline.docs[path]!;
    if (ms(life.created) > tMs) continue; // not created yet
    if (life.deleted !== null && ms(life.deleted) <= tMs) continue; // already deleted
    present.add(path);
  }
  return present;
}

/**
 * Edges present at T (spec/90): from the CURRENT edge set, keep an edge iff BOTH
 * endpoints are present at T. An honest approximation — the exact links at a past
 * commit would need that commit's content (a v2 refinement). Stated in the UI.
 */
export function presentEdges<E extends { source: string; target: string }>(
  edges: readonly E[],
  present: ReadonlySet<string>,
): E[] {
  return edges.filter((e) => present.has(e.source) && present.has(e.target));
}

/**
 * Map a time T (ms) to a fractional commit index in [0, N-1]: piecewise-linear
 * over the (oldest-first) commit dates, clamped at both ends. Monotonic — a later
 * T never yields a smaller index — so `uScrub >= birthIndex` in the shader agrees
 * exactly with `presentDocsAt` at the commit stations.
 */
export function indexOfTime(timeline: Timeline, tMs: number): number {
  const c = timeline.commits;
  if (c.length === 0) return 0;
  const last = c.length - 1;
  if (tMs <= ms(c[0]!.date)) return 0;
  if (tMs >= ms(c[last]!.date)) return last;
  for (let i = 0; i < last; i++) {
    const a = ms(c[i]!.date);
    const b = ms(c[i + 1]!.date);
    if (tMs >= a && tMs <= b) return b === a ? i : i + (tMs - a) / (b - a);
  }
  return last;
}

/** Inverse of `indexOfTime`: a fractional commit index → time (ms), clamped. */
export function timeOfIndex(timeline: Timeline, index: number): number {
  const c = timeline.commits;
  if (c.length === 0) return 0;
  const last = c.length - 1;
  const clamped = Math.max(0, Math.min(last, index));
  const i = Math.floor(clamped);
  if (i >= last) return ms(c[last]!.date);
  const a = ms(c[i]!.date);
  const b = ms(c[i + 1]!.date);
  return a + (b - a) * (clamped - i);
}

/** The docs present at a fractional commit index (convenience over `presentDocsAt`). */
export function presentDocsAtIndex(timeline: Timeline, index: number): Set<string> {
  return presentDocsAt(timeline, timeOfIndex(timeline, index));
}

/**
 * The fractional commit index at which a doc is BORN (its `created` instant), or
 * -1 when the timeline never saw it (reserved index/log docs are excluded from
 * the timeline, and a just-written uncommitted doc has no history) — -1 means
 * "present throughout the travel", so untracked meta never blinks out.
 */
export function birthIndexOf(timeline: Timeline, path: string): number {
  const life = timeline.docs[path];
  if (!life) return -1;
  return indexOfTime(timeline, ms(life.created));
}

/** The fractional commit index at which a doc is DELETED, or +Infinity if it still lives. */
export function deathIndexOf(timeline: Timeline, path: string): number {
  const life = timeline.docs[path];
  if (!life || life.deleted === null) return Number.POSITIVE_INFINITY;
  return indexOfTime(timeline, ms(life.deleted));
}

/** The fractional commit index of a doc's LAST modification, or -1 if never modified. */
export function lastModIndexOf(timeline: Timeline, path: string): number {
  const life = timeline.docs[path];
  if (!life || life.modified.length === 0) return -1;
  return indexOfTime(timeline, ms(life.modified[life.modified.length - 1]!));
}

/** The commit nearest a fractional index (rounded), or null when there is no history. */
export function commitAt(timeline: Timeline, index: number): TimelineCommit | null {
  const c = timeline.commits;
  if (c.length === 0) return null;
  const i = Math.max(0, Math.min(c.length - 1, Math.round(index)));
  return c[i] ?? null;
}

/**
 * Advance the play head by `dt` seconds at `commitsPerSecond`. Returns the next
 * fractional index and whether playback has reached the end (and should stop).
 * Pure — the caller owns the clock, so it is trivially testable.
 */
export function advancePlay(
  index: number,
  dtSeconds: number,
  commitsPerSecond: number,
  commitCount: number,
): { index: number; done: boolean } {
  const last = Math.max(0, commitCount - 1);
  const next = index + dtSeconds * commitsPerSecond;
  if (next >= last) return { index: last, done: true };
  return { index: next, done: false };
}

/**
 * Parse a shareable moment from a URL query (spec: deep-link a moment):
 *   `?commit=<sha>` selects that commit (prefix match, either direction),
 *   `?t=<iso>`      selects the nearest commit index at/after that instant.
 * Returns the scrub index to open the time machine at, or null when neither is
 * present/resolvable (or there is no history).
 */
export function parseDeepLink(search: string, timeline: Timeline): { index: number } | null {
  if (!hasHistory(timeline)) return null;
  const params = new URLSearchParams(search);
  const commit = params.get('commit');
  if (commit) {
    const i = timeline.commits.findIndex(
      (c) => c.sha === commit || c.sha.startsWith(commit) || commit.startsWith(c.sha),
    );
    if (i >= 0) return { index: i };
  }
  const t = params.get('t');
  if (t) {
    const tMs = Date.parse(t);
    if (!Number.isNaN(tMs)) return { index: indexOfTime(timeline, tMs) };
  }
  return null;
}

/**
 * The query string that deep-links the moment at a (rounded) commit index —
 * `?commit=<sha>`, the address bar's shareable form as you scrub. Empty when
 * there is no history.
 */
export function momentQuery(timeline: Timeline, index: number): string {
  const commit = commitAt(timeline, index);
  return commit ? `?commit=${commit.sha}` : '';
}
