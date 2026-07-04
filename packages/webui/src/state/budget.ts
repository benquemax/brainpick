/**
 * GPU render budget: degree-ranked culling + per-directory cluster
 * aggregation. Given the graph and a node cap N:
 *
 *   - N >= node count -> render everything, untouched (zero proxies). The
 *     common small-brain case is a byte-identical passthrough — see the
 *     honesty test.
 *   - N < node count -> keep the top-N nodes by total degree (tie-break by id
 *     codepoint, deterministic). The culled remainder is folded into one
 *     "+N more" cluster proxy per top-level directory; edges touching a culled
 *     node rewire to that dir's proxy, deduped and weight-summed. Expanding a
 *     dir (store.expandDir) forces its nodes back in and drops its proxy.
 *
 * Pure and memoized by (seq, budget, expandedDirs) — the scene and the HUD
 * both read the same result. Node ids ARE bundle paths, so the top-level dir
 * is the first path segment (reusing tree.ts's ancestor logic).
 */
import type { GraphEdge, GraphNode } from '../graph/types';
import { ancestorDirsOf } from './tree';

/**
 * Marker that turns a directory path into a synthetic proxy node id. The NUL
 * cannot appear in a real bundle path, so proxy ids never collide with docs;
 * the "<dir>/..." shape keeps colors.ts grouping the proxy with its own dir.
 */
export const CLUSTER_MARK = '\u0000cluster';

/** The proxy node id standing in for the culled docs of a top-level dir. */
export function proxyIdForDir(dir: string): string {
  return dir === '' ? CLUSTER_MARK : `${dir}/${CLUSTER_MARK}`;
}

/** Whether an id is a cluster proxy (vs. a real doc). */
export function isClusterId(id: string): boolean {
  return id === CLUSTER_MARK || id.endsWith(`/${CLUSTER_MARK}`);
}

/** The top-level dir a cluster proxy stands for ('' for bundle-root docs). */
export function dirOfClusterId(id: string): string {
  return id === CLUSTER_MARK ? '' : id.slice(0, id.length - `/${CLUSTER_MARK}`.length);
}

/** The top-level directory of a bundle path ('' for a bundle-root doc). */
export function topLevelDir(id: string): string {
  return ancestorDirsOf(id)[0] ?? '';
}

export interface BudgetResult {
  /** Nodes to draw: kept real nodes (original order) then cluster proxies. */
  renderNodes: GraphNode[];
  /** Edges to draw: untouched real edges then weighted proxy edges. */
  renderEdges: GraphEdge[];
  /** proxyId → docs it stands in for (empty when nothing was culled). */
  aggregated: Map<string, number>;
  /** Real docs in the full graph. */
  totalNodes: number;
  /** Real (non-proxy) docs actually drawn. */
  shownNodes: number;
}

function proxyNode(dir: string, count: number, degree: number): GraphNode {
  return {
    id: proxyIdForDir(dir),
    title: dir === '' ? `+${count} more` : `${dir} +${count} more`,
    description: null,
    type: 'cluster',
    tags: [],
    timestamp: null,
    in: 0,
    // Degree drives the sprite radius — a bigger cluster reads as a bigger node.
    out: degree,
    orphan: false,
    reserved: false,
  };
}

/** Culling + aggregation for a single (nodes, edges, budget, expandedDirs). */
export function computeBudget(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, GraphEdge>,
  budget: number,
  expandedDirs: ReadonlySet<string>,
): BudgetResult {
  const allNodes = [...nodes.values()];
  const total = allNodes.length;

  // Passthrough: nothing to cull. Same node objects, same order, same edges —
  // proven identical by the honesty test. No proxies, no HUD budget line.
  if (total <= budget) {
    return {
      renderNodes: allNodes,
      renderEdges: [...edges.values()],
      aggregated: new Map(),
      totalNodes: total,
      shownNodes: total,
    };
  }

  // Forced-kept: every doc under an expanded top-level dir is revealed.
  const forced = new Set<string>();
  for (const n of allNodes) {
    if (expandedDirs.has(topLevelDir(n.id))) forced.add(n.id);
  }

  // Rank the rest by total degree desc, tie-break id codepoint asc.
  const rest = allNodes.filter((n) => !forced.has(n.id));
  rest.sort((a, b) => {
    const d = b.in + b.out - (a.in + a.out);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const kept = new Set(forced);
  for (const n of rest) {
    if (kept.size >= budget) break;
    kept.add(n.id);
  }

  // Kept nodes in original insertion order — stable scene ordering.
  const keptNodes = allNodes.filter((n) => kept.has(n.id));

  // Tally culled docs per top-level dir.
  const culledPerDir = new Map<string, number>();
  for (const n of allNodes) {
    if (kept.has(n.id)) continue;
    const dir = topLevelDir(n.id);
    culledPerDir.set(dir, (culledPerDir.get(dir) ?? 0) + 1);
  }

  const rep = (id: string): string => (kept.has(id) ? id : proxyIdForDir(topLevelDir(id)));

  // Rewire edges. Both-endpoints-kept edges pass through untouched; anything
  // touching a culled doc folds into deduped, weight-summed proxy edges keyed
  // by unordered endpoint pair. Edges wholly inside one cluster vanish.
  const realEdges: GraphEdge[] = [];
  const proxyEdges = new Map<string, GraphEdge>();
  const proxyDegree = new Map<string, number>();
  for (const e of edges.values()) {
    const s = rep(e.source);
    const t = rep(e.target);
    if (s === e.source && t === e.target) {
      realEdges.push(e);
      continue;
    }
    if (s === t) continue; // internal to one cluster — no visible edge
    const key = JSON.stringify(s < t ? [s, t] : [t, s]);
    const existing = proxyEdges.get(key);
    if (existing) {
      existing.count += e.count;
      continue;
    }
    proxyEdges.set(key, { source: s, target: t, kind: 'link', label: null, count: e.count });
    if (isClusterId(s)) proxyDegree.set(s, (proxyDegree.get(s) ?? 0) + 1);
    if (isClusterId(t)) proxyDegree.set(t, (proxyDegree.get(t) ?? 0) + 1);
  }

  // Proxy nodes in deterministic dir-codepoint order.
  const aggregated = new Map<string, number>();
  const proxyNodes: GraphNode[] = [];
  for (const dir of [...culledPerDir.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const count = culledPerDir.get(dir) as number;
    const id = proxyIdForDir(dir);
    // Radius reflects the cluster: at least its member count, or its edge degree.
    proxyNodes.push(proxyNode(dir, count, Math.max(proxyDegree.get(id) ?? 0, count)));
    aggregated.set(id, count);
  }

  return {
    renderNodes: [...keptNodes, ...proxyNodes],
    renderEdges: [...realEdges, ...proxyEdges.values()],
    aggregated,
    totalNodes: total,
    shownNodes: keptNodes.length,
  };
}

// One-slot memo: nodes/edges Maps and the expandedDirs Set are replaced (not
// mutated) by the store, so identity + seq + budget is a complete change
// signature — the budgeted view rebuilds exactly once per relevant change and
// the scene + HUD share the object. Mirrors tree.ts's treeForGraph.
let memo:
  | {
      nodes: ReadonlyMap<string, GraphNode>;
      edges: ReadonlyMap<string, GraphEdge>;
      seq: number;
      budget: number;
      expandedDirs: ReadonlySet<string>;
      result: BudgetResult;
    }
  | null = null;

/** The budgeted view for the store's current graph — memoized. */
export function budgetedGraph(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, GraphEdge>,
  seq: number,
  budget: number,
  expandedDirs: ReadonlySet<string>,
): BudgetResult {
  if (
    memo === null ||
    memo.nodes !== nodes ||
    memo.edges !== edges ||
    memo.seq !== seq ||
    memo.budget !== budget ||
    memo.expandedDirs !== expandedDirs
  ) {
    memo = { nodes, edges, seq, budget, expandedDirs, result: computeBudget(nodes, edges, budget, expandedDirs) };
  }
  return memo.result;
}
