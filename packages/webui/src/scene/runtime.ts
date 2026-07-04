/**
 * GraphRuntime: the imperative bridge between the zustand store, the layout
 * worker and the GPU buffers the R3F layers render. React components read it
 * through refs inside useFrame — no per-frame React state.
 *
 * Node instances are laid out as [live nodes..., dying nodes...]: removed
 * nodes linger briefly with a death timestamp so the sprite shader can fade
 * them out (spec 60 leave animation).
 */
import type { UIStoreApi } from '../state/store';
import type { UIState } from '../state/store';
import { buildSeeds, diffGraph } from '../layout/simShared';
import type { FromWorker, GraphMessage, WorkerLink } from '../layout/messages';
import { budgetedGraph, isClusterId } from '../state/budget';
import { colorForId } from './colors';
import { buildGhostAnchors, type GhostAnchor } from './ghosts';
import { GHOST_GLOW } from './tuning';

export interface DyingNode {
  x: number;
  y: number;
  color: [number, number, number];
  radius: number;
  /** Scene-clock seconds. */
  deathAt: number;
}

const DEATH_SECONDS = 0.8;

/** Halo radius from degree — the core is ~30% of this (see the shader). */
export function radiusForDegree(degree: number): number {
  return Math.min(19, 4.6 + 3.1 * Math.sqrt(Math.min(degree, 48)));
}

export class GraphRuntime {
  readonly store: UIStoreApi;

  // Live node arrays, all indexed in render order.
  ids: string[] = [];
  titles: string[] = [];
  index = new Map<string, number>();
  positions: Float32Array = new Float32Array(0);
  colors: Float32Array = new Float32Array(0);
  radii: Float32Array = new Float32Array(0);
  degrees: Float32Array = new Float32Array(0);
  reserved: Uint8Array = new Uint8Array(0);
  /** 1 for cluster-proxy nodes (aggregated "+N more"), 0 for real docs. */
  cluster: Uint8Array = new Uint8Array(0);
  birth: Float32Array = new Float32Array(0); // scene seconds; -1 = no entrance animation
  activityAt: Float32Array = new Float32Array(0); // scene seconds; -1 = none
  edgePairs: Uint32Array = new Uint32Array(0);
  edgeCount = 0;
  /** Ghost links whose source is live: index + phantom offset (scene/ghosts). */
  ghostAnchors: GhostAnchor[] = [];
  /** Node indices sorted by degree descending (label priority). */
  labelOrder: number[] = [];
  dying: DyingNode[] = [];

  /** GPU-budget summary for the current render (HUD reads the same via store). */
  aggregated: Map<string, number> = new Map();
  /** Real (non-proxy) docs drawn / total real docs — the "N of M" the HUD shows. */
  shownNodes = 0;
  totalNodes = 0;

  /** Bumped whenever the arrays above are rebuilt — scene re-uploads. */
  version = 0;
  /** Set by the camera rig after the first fit; labels scale from it. */
  fitZoom = 1;
  firstPositionsSeen = false;

  private worker: Worker | null = null;
  private gen = 0;
  private prevEdgeKeys: string[] = [];
  private unsubscribe: (() => void) | null = null;
  private lastEpoch = -1;
  private lastBudget = -1;
  private lastExpandedDirs: ReadonlySet<string> | null = null;
  private dyingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clockStartMs = performance.now();
  private readonly epochStartMs = Date.now();

  constructor(store: UIStoreApi, makeWorker?: () => Worker) {
    this.store = store;
    try {
      this.worker = makeWorker
        ? makeWorker()
        : new Worker(new URL('../layout/worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorkerMessage(ev.data);
    } catch {
      this.worker = null; // non-worker environment; positions stay at seeds
    }
    this.unsubscribe = store.subscribe((state) => {
      // The rendered set depends on the graph (epoch) AND the GPU budget /
      // revealed dirs — a "show more" or a proxy expand must re-cull too.
      if (
        state.epoch !== this.lastEpoch ||
        state.nodeBudget !== this.lastBudget ||
        state.expandedDirs !== this.lastExpandedDirs
      ) {
        this.rebuild(state);
      }
    });
    const initial = store.getState();
    this.lastEpoch = initial.epoch;
    this.lastBudget = initial.nodeBudget;
    this.lastExpandedDirs = initial.expandedDirs;
    if (initial.nodes.size > 0) this.rebuild(initial);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    if (this.dyingTimer !== null) clearTimeout(this.dyingTimer);
  }

  /** Scene-clock now, in seconds. */
  now(): number {
    return (performance.now() - this.clockStartMs) / 1000;
  }

  /** Convert a Date.now() ms timestamp into scene-clock seconds. */
  sceneTime(epochMs: number): number {
    return (epochMs - this.epochStartMs) / 1000;
  }

  get liveCount(): number {
    return this.ids.length;
  }

  get totalCount(): number {
    return this.ids.length + this.dying.length;
  }

  boundsRadius(): number {
    let r = 0;
    for (let i = 0; i < this.ids.length; i++) {
      r = Math.max(r, Math.abs(this.positions[i * 2] ?? 0), Math.abs(this.positions[i * 2 + 1] ?? 0));
    }
    return r;
  }

  positionOf(id: string): [number, number] | null {
    const i = this.index.get(id);
    if (i === undefined) return null;
    return [this.positions[i * 2] ?? 0, this.positions[i * 2 + 1] ?? 0];
  }

  private onWorkerMessage(msg: FromWorker): void {
    if (msg.gen !== this.gen) return; // stale generation
    if (msg.type === 'positions') {
      if (msg.positions.length === this.ids.length * 2) {
        this.positions = msg.positions;
        this.firstPositionsSeen = true;
      }
    }
  }

  private rebuild(state: UIState): void {
    this.lastEpoch = state.epoch;
    this.lastBudget = state.nodeBudget;
    this.lastExpandedDirs = state.expandedDirs;

    // Apply the GPU budget: below the cap this is a passthrough (identical
    // set); above it, degree-ranked culling + per-dir cluster proxies. The HUD
    // reads the same memoized view, so its "N of M" always matches the scene.
    const view = budgetedGraph(state.nodes, state.edges, state.seq, state.nodeBudget, state.expandedDirs);
    this.aggregated = view.aggregated;
    this.shownNodes = view.shownNodes;
    this.totalNodes = view.totalNodes;

    const prevIds = this.ids;
    const prevIndex = this.index;
    const prevPositions = this.positions;
    const prevColors = this.colors;
    const prevRadii = this.radii;

    const ids: string[] = [];
    const titles: string[] = [];
    const index = new Map<string, number>();
    for (const node of view.renderNodes) {
      index.set(node.id, ids.length);
      ids.push(node.id);
      titles.push(node.title);
    }

    const n = ids.length;
    const colors = new Float32Array(n * 3);
    const radii = new Float32Array(n);
    const degrees = new Float32Array(n);
    const reserved = new Uint8Array(n);
    const cluster = new Uint8Array(n);
    const birth = new Float32Array(n).fill(-1);
    const activityAt = new Float32Array(n).fill(-1);

    for (const node of view.renderNodes) {
      const i = index.get(node.id) as number;
      const [r, g, b] = colorForId(node.id);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      const degree = node.in + node.out;
      degrees[i] = degree;
      radii[i] = radiusForDegree(degree);
      reserved[i] = node.reserved ? 1 : 0;
      cluster[i] = isClusterId(node.id) ? 1 : 0;
      const join = state.joins.get(node.id);
      if (join) birth[i] = this.sceneTime(join.at);
      const activity = state.activity.get(node.id);
      if (activity !== undefined) activityAt[i] = this.sceneTime(activity);
    }

    // Edges whose endpoints both exist, as index pairs + structural keys.
    const edgeKeys: string[] = [];
    const pairs: number[] = [];
    const links: WorkerLink[] = [];
    for (const edge of view.renderEdges) {
      const s = index.get(edge.source);
      const t = index.get(edge.target);
      if (s === undefined || t === undefined) continue;
      pairs.push(s, t);
      links.push({ source: s, target: t, count: edge.count });
      edgeKeys.push(`${edge.source}${edge.target}${edge.kind}${edge.count}`);
    }

    const diff = diffGraph(prevIds, ids, this.prevEdgeKeys, edgeKeys);
    this.prevEdgeKeys = edgeKeys;

    // Capture dying nodes at their last simulated position.
    const nowScene = this.now();
    for (const id of diff.removedIds) {
      const i = prevIndex.get(id);
      if (i === undefined) continue;
      this.dying.push({
        x: prevPositions[i * 2] ?? 0,
        y: prevPositions[i * 2 + 1] ?? 0,
        color: [prevColors[i * 3] ?? 0.5, prevColors[i * 3 + 1] ?? 0.8, prevColors[i * 3 + 2] ?? 1],
        radius: prevRadii[i] ?? 6,
        deathAt: nowScene,
      });
    }
    this.pruneDying(nowScene);

    const radius = Math.max(60, this.boundsRadiusOf(prevPositions, prevIds.length));
    const seeds = buildSeeds(ids, state.joins, prevIndex, prevPositions, radius);

    this.ids = ids;
    this.titles = titles;
    this.index = index;
    this.positions = seeds.slice();
    this.colors = colors;
    this.radii = radii;
    this.degrees = degrees;
    this.reserved = reserved;
    this.cluster = cluster;
    this.birth = birth;
    this.activityAt = activityAt;
    this.edgePairs = Uint32Array.from(pairs);
    this.edgeCount = links.length;
    this.ghostAnchors = buildGhostAnchors(state.ghosts, index, GHOST_GLOW.phantomDistance);
    this.labelOrder = ids
      .map((_, i) => i)
      .sort((a, b) => (degrees[b] ?? 0) - (degrees[a] ?? 0) || (ids[a] as string).localeCompare(ids[b] as string));
    this.version += 1;

    this.gen += 1;
    const message: GraphMessage = {
      type: 'graph',
      gen: this.gen,
      count: n,
      links,
      seeds,
      // Full reheat on first load, gentler on incremental changes.
      reheat: prevIds.length === 0 ? 1 : diff.structural ? 0.5 : 0,
    };
    this.worker?.postMessage(message, [seeds.buffer]);
  }

  private boundsRadiusOf(positions: Float32Array, count: number): number {
    let r = 0;
    for (let i = 0; i < count; i++) {
      r = Math.max(r, Math.abs(positions[i * 2] ?? 0), Math.abs(positions[i * 2 + 1] ?? 0));
    }
    return r;
  }

  private pruneDying(nowScene: number): void {
    this.dying = this.dying.filter((d) => nowScene - d.deathAt < DEATH_SECONDS);
    if (this.dying.length > 0 && this.dyingTimer === null) {
      this.dyingTimer = setTimeout(() => {
        this.dyingTimer = null;
        this.pruneDying(this.now());
        this.version += 1; // trigger a scene re-upload without the dead tail
      }, DEATH_SECONDS * 1000 + 100);
    }
  }
}
