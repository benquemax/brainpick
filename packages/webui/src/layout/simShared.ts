/**
 * Pure helpers shared by the layout-worker plumbing on the main thread.
 * Kept worker-free and DOM-free so they are unit-testable.
 */
import type { JoinInfo } from '../state/applyDelta';

export interface GraphDiff {
  addedIds: string[];
  removedIds: string[];
  /** True when the sim must reheat: node set or edge set changed. */
  structural: boolean;
}

export function diffGraph(
  prevIds: readonly string[],
  nextIds: readonly string[],
  prevEdgeKeys: readonly string[],
  nextEdgeKeys: readonly string[],
): GraphDiff {
  const prev = new Set(prevIds);
  const next = new Set(nextIds);
  const addedIds: string[] = [];
  const removedIds: string[] = [];
  for (const id of nextIds) if (!prev.has(id)) addedIds.push(id);
  for (const id of prevIds) if (!next.has(id)) removedIds.push(id);

  let edgesChanged = prevEdgeKeys.length !== nextEdgeKeys.length;
  if (!edgesChanged) {
    const prevEdges = new Set(prevEdgeKeys);
    for (const key of nextEdgeKeys) {
      if (!prevEdges.has(key)) {
        edgesChanged = true;
        break;
      }
    }
  }
  return {
    addedIds,
    removedIds,
    structural: addedIds.length > 0 || removedIds.length > 0 || edgesChanged,
  };
}

export const JOIN_JITTER = 3;

/**
 * Seed positions (xy pairs) for the node order `ids`:
 *  - existing nodes keep their previous simulated position,
 *  - joining nodes materialize beside their linked neighbor (spec 60's
 *    entrance animation) plus a little jitter so the springs can act,
 *  - unknown nodes scatter uniformly inside the current graph radius.
 */
export function buildSeeds(
  ids: readonly string[],
  joins: ReadonlyMap<string, JoinInfo>,
  prevIndex: ReadonlyMap<string, number>,
  prevPositions: Float32Array,
  radius: number,
  rng: () => number = Math.random,
): Float32Array {
  const seeds = new Float32Array(ids.length * 2);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as string;
    const prev = prevIndex.get(id);
    if (prev !== undefined) {
      seeds[i * 2] = prevPositions[prev * 2] ?? 0;
      seeds[i * 2 + 1] = prevPositions[prev * 2 + 1] ?? 0;
      continue;
    }
    const neighborId = joins.get(id)?.neighborId ?? null;
    const neighborIndex = neighborId !== null ? prevIndex.get(neighborId) : undefined;
    if (neighborIndex !== undefined) {
      seeds[i * 2] = (prevPositions[neighborIndex * 2] ?? 0) + (rng() - 0.5) * 2 * JOIN_JITTER;
      seeds[i * 2 + 1] = (prevPositions[neighborIndex * 2 + 1] ?? 0) + (rng() - 0.5) * 2 * JOIN_JITTER;
    } else {
      const angle = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius;
      seeds[i * 2] = Math.cos(angle) * r;
      seeds[i * 2 + 1] = Math.sin(angle) * r;
    }
  }
  return seeds;
}
