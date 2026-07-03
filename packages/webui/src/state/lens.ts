/**
 * Lenses: HUD-driven emphasis filters over the graph. A lens resolves to a
 * node-id set; the scene highlights that set and dims everything else through
 * the same per-node highlight + uDim path the search overlay already uses.
 */
import type { GraphNode } from '../graph/types';

export type Lens = { kind: 'none' } | { kind: 'orphans' } | { kind: 'tag'; tag: string };

export const NO_LENS: Lens = { kind: 'none' };

export function sameLens(a: Lens, b: Lens): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'tag' || b.kind !== 'tag' || a.tag === b.tag;
}

/** Resolve a lens to the node ids it emphasizes. `none` selects nothing. */
export function lensNodeSet(nodes: ReadonlyMap<string, GraphNode>, lens: Lens): Set<string> {
  const set = new Set<string>();
  if (lens.kind === 'none') return set;
  for (const node of nodes.values()) {
    if (lens.kind === 'orphans' ? node.orphan : node.tags.includes(lens.tag)) {
      set.add(node.id);
    }
  }
  return set;
}
