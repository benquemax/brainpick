/**
 * Helpers for the doc panel: resolving intra-bundle links clicked inside
 * rendered markdown, and normalizing the /api/docs neighbors entries.
 *
 * Spec note: 50-rest-api.md does not pin the element shape of
 * `neighbors.in/out`, so normalizeNeighbor tolerates bare id strings,
 * {path,title} objects and graph-node-shaped {id,...} objects.
 */

export interface NeighborRef {
  path: string;
  title: string;
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Resolve a link target found in a doc body against the current doc's
 * bundle path. Returns a normalized bundle-relative path, or null for
 * external / in-page targets. Mirrors spec/20-t1-artifacts.md link rules:
 * rooted targets resolve from the bundle root, relative ones from the doc's
 * directory; `..` never escapes the bundle root.
 */
export function resolveDocLink(currentPath: string, target: string): string | null {
  if (!target) return null;
  if (SCHEME_RE.test(target)) return null; // http:, mailto:, …
  const withoutFragment = target.split('#')[0] ?? '';
  if (withoutFragment === '') return null; // pure in-page fragment

  const parts: string[] = [];
  if (withoutFragment.startsWith('/')) {
    // bundle-absolute
  } else {
    const dir = currentPath.split('/').slice(0, -1);
    parts.push(...dir);
  }
  for (const segment of withoutFragment.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      parts.pop(); // clamped at the bundle root: pop on empty is a no-op
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) return null;
  return parts.join('/');
}

export function normalizeNeighbor(entry: unknown): NeighborRef | null {
  if (typeof entry === 'string') {
    return entry === '' ? null : { path: entry, title: entry };
  }
  if (entry !== null && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    const path =
      typeof record.path === 'string' ? record.path : typeof record.id === 'string' ? record.id : null;
    if (path === null || path === '') return null;
    const title = typeof record.title === 'string' && record.title !== '' ? record.title : path;
    return { path, title };
  }
  return null;
}
