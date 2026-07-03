/** Whole-graph diffs (spec/60): correctness never depends on watcher fidelity. */
import { cmpStr } from "./core/canonical";
import type { Graph, GraphEdge, GraphNode, GraphStats } from "./compile/t1";

export interface RemovedEdge {
  kind: string;
  source: string;
  target: string;
}

export interface GraphDelta {
  added: { edges: GraphEdge[]; nodes: GraphNode[] };
  removed: { edges: RemovedEdge[]; nodes: string[] };
  stats: GraphStats;
  updated: { nodes: GraphNode[] };
  cause?: { paths: string[]; tier: string };
  seq?: number;
}

type EdgeKey = [string, string, string];

function edgeKey(edge: GraphEdge | RemovedEdge): EdgeKey {
  return [edge.source, edge.target, edge.kind];
}

function cmpEdgeKey(a: EdgeKey, b: EdgeKey): number {
  return cmpStr(a[0], b[0]) || cmpStr(a[1], b[1]) || cmpStr(a[2], b[2]);
}

/** Value equality over JSON-shaped data — Python's `==` on parsed dicts. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

export function diffGraphs(old: Graph, next: Graph): GraphDelta {
  const oldNodes = new Map(old.nodes.map((n) => [n.id, n]));
  const newNodes = new Map(next.nodes.map((n) => [n.id, n]));

  const addedNodes = [...newNodes.keys()]
    .filter((i) => !oldNodes.has(i))
    .sort(cmpStr)
    .map((i) => newNodes.get(i)!);
  const removedNodes = [...oldNodes.keys()].filter((i) => !newNodes.has(i)).sort(cmpStr);
  const updatedNodes = [...newNodes.keys()]
    .filter((i) => oldNodes.has(i))
    .sort(cmpStr)
    .filter((i) => !deepEqual(newNodes.get(i), oldNodes.get(i)))
    .map((i) => newNodes.get(i)!);

  const keyOf = (e: GraphEdge) => e.source + "\u0000" + e.target + "\u0000" + e.kind;
  const oldEdges = new Map(old.edges.map((e) => [keyOf(e), e]));
  const newEdges = new Map(next.edges.map((e) => [keyOf(e), e]));

  const addedEdges = [...newEdges.values()].filter((e) => !oldEdges.has(keyOf(e)));
  const removedEdges: RemovedEdge[] = [...oldEdges.values()]
    .filter((e) => !newEdges.has(keyOf(e)))
    .map((e) => ({ kind: e.kind, source: e.source, target: e.target }));
  for (const [key, e] of newEdges) {
    const before = oldEdges.get(key);
    if (before && !deepEqual(e, before)) {
      // count/label changed: remove + add
      removedEdges.push({ kind: e.kind, source: e.source, target: e.target });
      addedEdges.push(e);
    }
  }
  addedEdges.sort((a, b) => cmpEdgeKey(edgeKey(a), edgeKey(b)));
  removedEdges.sort((a, b) => cmpEdgeKey(edgeKey(a), edgeKey(b)));

  return {
    added: { edges: addedEdges, nodes: addedNodes },
    removed: { edges: removedEdges, nodes: removedNodes },
    stats: next.stats,
    updated: { nodes: updatedNodes },
  };
}
