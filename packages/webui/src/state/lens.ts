/**
 * Lenses: HUD-driven emphasis filters over the graph. A lens resolves to a
 * node-id set; the scene highlights that set and dims everything else through
 * the same per-node highlight + uDim path the search overlay already uses.
 */
import type { GraphNode } from '../graph/types';

export type Lens =
  | { kind: 'none' }
  | { kind: 'orphans' }
  | { kind: 'tag'; tag: string }
  | { kind: 'about'; about: string };

export const NO_LENS: Lens = { kind: 'none' };

export function sameLens(a: Lens, b: Lens): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag;
  if (a.kind === 'about' && b.kind === 'about') return a.about === b.about;
  return true;
}

/** Resolve a lens to the node ids it emphasizes. `none` selects nothing. */
export function lensNodeSet(nodes: ReadonlyMap<string, GraphNode>, lens: Lens): Set<string> {
  const set = new Set<string>();
  if (lens.kind === 'none') return set;
  for (const node of nodes.values()) {
    const hit =
      lens.kind === 'orphans'
        ? node.orphan
        : lens.kind === 'tag'
          ? node.tags.includes(lens.tag)
          : node.about === lens.about;
    if (hit) set.add(node.id);
  }
  return set;
}
