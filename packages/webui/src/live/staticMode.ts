/**
 * The static-snapshot adapter. A brain can be exported as a fully static site
 * (scripts/build-static-site.mjs — the GitHub Pages demo): the built UI plus a
 * baked `api/` tree of the live server's own responses. Static hosts drop
 * query strings, so everything the live API answers per-query moves either
 * into distinct baked paths (graph layers, per-doc neighbors, doc versions)
 * or client-side (search, over a baked full-text index).
 *
 * Builds gate on VITE_STATIC_SNAPSHOT at compile time — the live product
 * bundle contains no behavioral change. The helpers here are pure so the
 * contract is unit-testable without a build.
 */
/// <reference types="vite/client" />
import type { SearchMode, SearchResponse } from '../graph/types';
import type { GraphLayer } from '../graph/entities';
import { versionIndexAtScrub, versionsOf, type Timeline } from '../time/timeline';

/** True in bundles produced by the static exporter, false everywhere else. */
export const IS_STATIC = import.meta.env.VITE_STATIC_SNAPSHOT === '1';

/** The build's base URL — './' in static exports, so any subpath works. */
export const STATIC_BASE: string = import.meta.env.BASE_URL;

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** Graph layers live at distinct baked paths — `?layer=` cannot survive. */
export function staticGraphUrl(base: string, layer: GraphLayer | 'links'): string {
  return `${base}api/graph.${layer}.json`;
}

/** A doc's baked response; with `at`, the doc AS OF that commit. */
export function staticDocUrl(base: string, path: string, at?: string): string {
  const encoded = encodePath(path);
  return at !== undefined
    ? `${base}api/doc-versions/${encodeURIComponent(at)}/${encoded}`
    : `${base}api/docs/${encoded}`;
}

/** A doc's baked entity neighborhood (the only shape the UI requests). */
export function staticNeighborsUrl(base: string, id: string): string {
  return `${base}api/neighbors/${encodePath(id)}.json`;
}

/** One entry of the baked search index (api/search-index.json). */
export interface StaticSearchDoc {
  path: string;
  title: string;
  description: string | null;
  text: string;
  reserved?: boolean;
}

/**
 * Client-side keyword search over the baked index — the mirror of
 * scripts/mock-server.mjs handleSearch (the T2-less reference contract):
 * per token title×3 / description×2 / body×1, score normalized by token
 * count, snippet cut around the earliest body match. Degradation is honest:
 * a static page has no vectors and no entity walk to offer.
 */
export function staticSearch(
  index: readonly StaticSearchDoc[],
  query: string,
  mode: SearchMode,
  limit: number,
): SearchResponse {
  const degradedFrom = mode === 'keyword' ? null : mode === 'graph' ? 'graph' : 'semantic';
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const hits: SearchResponse['hits'] = [];
  if (tokens.length > 0) {
    for (const doc of index) {
      if (doc.reserved) continue;
      const title = doc.title.toLowerCase();
      const desc = (doc.description ?? '').toLowerCase();
      const text = doc.text.toLowerCase();
      let score = 0;
      let firstIdx = -1;
      for (const token of tokens) {
        if (title.includes(token)) score += 3;
        if (desc.includes(token)) score += 2;
        const idx = text.indexOf(token);
        if (idx >= 0) {
          score += 1;
          if (firstIdx < 0 || idx < firstIdx) firstIdx = idx;
        }
      }
      if (score > 0) {
        let snippet: string | null = null;
        if (firstIdx >= 0) {
          const start = Math.max(0, firstIdx - 60);
          snippet = doc.text
            .slice(start, start + 240)
            .replace(/\s+/g, ' ')
            .trim();
        }
        hits.push({
          path: doc.path,
          title: doc.title,
          description: doc.description,
          score: Number((score / tokens.length).toFixed(3)),
          snippet,
          source: 'keyword',
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }
  return { hits: hits.slice(0, limit), used_modes: ['keyword'], degraded_from: degradedFrom };
}

/**
 * The static answer to `?at=<commit>`: the exporter bakes one file per
 * DISTINCT doc version (the commits that added/modified it — timeline.ts
 * versionsOf), not one per (doc × commit). Given any station commit the
 * scrubber lands on, resolve which of the doc's own versions was in effect
 * there — exactly what `git show <commit>:<path>` would surface. Null when
 * the commit is unknown or the doc was unborn at it.
 */
export function resolveStaticVersionSha(timeline: Timeline, path: string, at: string): string | null {
  const station = timeline.commits.findIndex((c) => c.sha === at);
  if (station < 0) return null;
  const versions = versionsOf(timeline, path);
  const idx = versionIndexAtScrub(versions, station);
  return idx >= 0 ? (versions[idx]?.sha ?? null) : null;
}

let timelinePromise: Promise<Timeline | null> | null = null;

/** Fetch the baked timeline once for version resolution; a miss stays null. */
export function loadStaticTimeline(base: string = STATIC_BASE): Promise<Timeline | null> {
  timelinePromise ??= fetch(`${base}api/timeline`, { headers: { accept: 'application/json' } })
    .then((res) => (res.ok ? (res.json() as Promise<Timeline>) : null))
    .catch(() => null);
  return timelinePromise;
}

let indexPromise: Promise<readonly StaticSearchDoc[]> | null = null;

/** Fetch the baked search index once; a miss degrades to an empty index. */
export function loadStaticSearchIndex(base: string = STATIC_BASE): Promise<readonly StaticSearchDoc[]> {
  indexPromise ??= fetch(`${base}api/search-index.json`, { headers: { accept: 'application/json' } })
    .then((res) => (res.ok ? (res.json() as Promise<StaticSearchDoc[]>) : []))
    .catch(() => []);
  return indexPromise;
}
