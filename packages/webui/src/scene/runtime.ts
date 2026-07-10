/**
 * GraphRuntime: the imperative bridge between the zustand store, the layout
 * worker and the GPU buffers the R3F layers render. React components read it
 * through refs inside useFrame — no per-frame React state.
 *
 * Node instances are laid out as [live nodes..., dying nodes...]: removed
 * nodes linger briefly with a death timestamp so the sprite shader can fade
 * them out (spec 60 leave animation).
 */
import type { UIStoreApi, ViewMode } from '../state/store';
import type { UIState } from '../state/store';
import { buildSeeds, diffGraph } from '../layout/simShared';
import { computeBrainLayout } from '../layout/brainLayout';
import type { FromWorker, GraphMessage, WorkerLink } from '../layout/messages';
import { budgetedGraph, isClusterId } from '../state/budget';
import { activeRenderGraph } from '../state/entityModel';
import { communityLobes } from '../state/communities';
import type { Vec3 } from './brainSDF';
import { isEntityRenderId } from '../graph/entities';
import { colorForNode, shapeIndexForType } from './colors';
import { buildGhostAnchors, type GhostAnchor } from './ghosts';
import { buildAdjacency } from './adjacency';
import { BRAIN, GHOST_GLOW } from './tuning';
import { birthIndexOf, deathIndexOf, hasHistory, lastModIndexOf, type Timeline } from '../time/timeline';

/** Sentinel birth index for a node the timeline never saw — "present throughout". */
const UNTRACKED_BIRTH = -1;
/** Sentinel death index for a node that never dies (kept finite for the GPU float). */
const NO_DEATH = 1e9;

/**
 * Per-node morph stagger in [0,1): a golden-ratio walk over the index spreads
 * the "stream into the brain" evenly. Shared by the node + edge layers so an
 * edge's endpoints morph in lockstep with the nodes they connect (edges stay
 * attached through the whole transition).
 */
export function nodeStagger(i: number): number {
  return (i * 0.618033988749895) % 1;
}

/** Minimal 3-component sink so the morph projection needs no `three` import here. */
export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A live node's CURRENT world position under the morph: the mix of its flat
 * cosmos target (`positions[i*2..]`, z = 0) and its 3D brain target
 * (`brainPositions[i*3..]`), with the SAME per-node stagger the sprite shader,
 * the 3D picker (PointerControls) and the hologram labels (LabelsLayer) all
 * share — one source for the "stream into the brain" math. Writes into `out`;
 * returns true when a brain slot existed (false → it fell back to the flat
 * cosmos position with z = 0, e.g. before the brain layout is computed).
 */
export function morphedWorldOf(
  i: number,
  morph: number,
  positions: Float32Array,
  brainPositions: Float32Array,
  staggerSpan: number,
  out: MutableVec3,
): boolean {
  const cx = positions[i * 2] ?? 0;
  const cy = positions[i * 2 + 1] ?? 0;
  if (i < 0 || brainPositions.length < (i + 1) * 3) {
    out.x = cx;
    out.y = cy;
    out.z = 0;
    return false;
  }
  const m = Math.min(1, Math.max(0, (morph - nodeStagger(i) * staggerSpan) / (1 - staggerSpan)));
  out.x = cx + ((brainPositions[i * 3] ?? 0) - cx) * m;
  out.y = cy + ((brainPositions[i * 3 + 1] ?? 0) - cy) * m;
  out.z = (brainPositions[i * 3 + 2] ?? 0) * m;
  return true;
}

export interface DyingNode {
  x: number;
  y: number;
  color: [number, number, number];
  radius: number;
  /** Scene-clock seconds. */
  deathAt: number;
}

const DEATH_SECONDS = 0.8;

/**
 * Halo radius from degree — the core is ~30% of this (see the shader). PRONOUNCED
 * by design (2026-07-08): a hub must read as REMARKABLY bigger than a leaf so the
 * graph conveys its hub structure at a glance. The old `4.6 + 3.1·√min(d,48)` capped
 * at 19 flattened everything past degree 21 into one size — on the 114-node brain
 * that made the deg-111 index and a deg-9 leaf near-indistinguishable.
 *
 * The curve now: a small leaf base, a super-linear-ish `d^0.62` growth (steeper than
 * √), the degree clamped at 60 so a pathological super-hub saturates instead of
 * blowing out, and a higher cap. On the docs brain this lands leaf(deg1) ≈ 5.2,
 * median(deg9) ≈ 10.5, hub(deg30) ≈ 17.9, big hub(deg54) ≈ 24, super-hub ≈ 25 —
 * a clear, legible size gradient (~5× leaf→hub).
 */
export function radiusForDegree(degree: number): number {
  const d = Math.max(0, Math.min(degree, 60));
  return Math.min(27, 3.4 + 1.85 * Math.pow(d, 0.62));
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
  /** 1 for entity nodes (T3 gem sprite), 0 for docs (disc). */
  family: Uint8Array = new Uint8Array(0);
  /** The two-axis ontology's SHAPE channel (tuning.TYPE_SHAPE): 0 for a doc's
   * `type` absent/unrecognized/"article" (the existing circle) or for any
   * entity (always the gem, this value is ignored), 1-4 otherwise. */
  shape: Uint8Array = new Uint8Array(0);
  birth: Float32Array = new Float32Array(0); // scene seconds; -1 = no entrance animation
  activityAt: Float32Array = new Float32Array(0); // scene seconds; -1 = none
  /**
   * TIME MACHINE (spec/90): per live node, the FRACTIONAL COMMIT INDEX at which
   * it is born / dies / was last modified. The node shader fades a node in as the
   * scrub crosses birthIdx, out at deathIdx, and flashes at birth/mod — all from
   * these static attributes + two uniforms, so scrubbing rebuilds no buffers.
   * birthIdx = -1 → present throughout (untracked meta); deathIdx = 1e9 → immortal.
   */
  birthIdx: Float32Array = new Float32Array(0);
  deathIdx: Float32Array = new Float32Array(0);
  modIdx: Float32Array = new Float32Array(0);
  edgePairs: Uint32Array = new Uint32Array(0);
  /** Per-edge brightness weight (relation weight / virtual hint / 1 for links). */
  edgeWeights: Float32Array = new Float32Array(0);
  /** Per-edge kind flag: 0 link, 1 relation, 2 virtual — EdgesLayer tints by it. */
  edgeKinds: Uint8Array = new Uint8Array(0);
  edgeCount = 0;
  /** Ghost links whose source is live: index + phantom offset (scene/ghosts). */
  ghostAnchors: GhostAnchor[] = [];
  /** Node indices sorted by degree descending (label priority). */
  labelOrder: number[] = [];
  /**
   * Undirected adjacency over the rendered edges (scene/adjacency), rebuilt with the
   * graph: `incident[i]` are the edge indices touching node i, `neighbors[i]` its
   * adjacent node indices. Hover/selection reads these to light a node's connections
   * and lift its neighbourhood in O(degree) per frame.
   */
  neighbors: number[][] = [];
  incident: number[][] = [];
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

  // ---- Time Machine (per-frame animated values; eased by TimeController) ----
  /** Animated scrub position (fractional commit index), eased toward store.scrubIndex. */
  scrub = 0;
  /** Animated 0→1 time-travel amount (uTimeTravel); eases the whole reconstruction in/out. */
  timeTravelAmt = 0;

  // ---- Holographic brain (lazy; nothing computed until the first toggle) ----
  /** Current animated morph 0 (cosmos) → 1 (brain); eased by MorphController. */
  morph = 0;
  /** World-space brain layout [x,y,z per live node]; empty until brain entered. */
  brainPositions: Float32Array = new Float32Array(0);
  /** True once a brain layout matching the current graph has been computed. */
  brainReady = false;
  /** e2e/debug: the orbit camera's azimuth, and whether it has been dragged. */
  brainAzimuth = 0;
  orbited = false;
  /**
   * e2e/debug: the orbit camera's current look-at target in brain mode. A
   * search-as-flight (BrainCameraRig) moves it toward the focused hit's 3D
   * position, so a test can prove the camera flew without reading pixels.
   */
  brainTarget: MutableVec3 = { x: 0, y: 0, z: 0 };
  /**
   * e2e/debug: project a live node's CURRENT (morphed) 3D position to client
   * pixels, or null if off-screen. Installed by BrainCameraRig while brain mode
   * is mounted (it owns the perspective camera); null in the flat cosmos.
   */
  projectNodeToScreen: ((i: number) => { x: number; y: number } | null) | null = null;
  /**
   * The brain orbit camera's authoritative pose, PUBLISHED by BrainCameraRig at
   * the end of its per-frame update (after it positions the camera). The hologram
   * labels (LabelsLayer) project from this snapshot — never from the live render
   * camera, whose pose drei's makeDefault CameraControls reset to the origin at the
   * top of every frame (BrainCameraRig restores it only later in the frame, so a
   * mid-frame read of the live camera sees it parked at the origin and every label
   * is culled). `brainViewProj` is projectionMatrix·matrixWorldInverse (16 floats,
   * column-major); `brainCamPos` the world eye; `brainCamRight` its world X axis
   * (dot-radius lift). Valid only while brain mode is mounted.
   */
  brainCamValid = false;
  brainCamPos: MutableVec3 = { x: 0, y: 0, z: 0 };
  brainCamRight: MutableVec3 = { x: 0, y: 0, z: 0 };
  brainViewProj: Float32Array = new Float32Array(16);
  /**
   * e2e/debug: a per-frame mirror of the ACTIVE R3F render camera — the exact
   * camera the scene was drawn with this frame (PointerControls refreshes it).
   * `ortho` tells the flat cosmos camera from the perspective brain camera; a
   * flat cosmos rendered by a perspective camera is the return-morph regression.
   * `frustumAspect` (ortho (right-left)/(top-bottom)) must equal `viewportAspect`
   * or the dots are horizontally stretched — the stretch sentinel.
   */
  activeCamera: {
    ortho: boolean;
    zoom: number;
    frustumAspect: number;
    viewportAspect: number;
  } | null = null;
  private brainEpoch = -1;
  private brainCount = -1;
  private lastMode: ViewMode = 'cosmos';

  private worker: Worker | null = null;
  private gen = 0;
  private prevEdgeKeys: string[] = [];
  private unsubscribe: (() => void) | null = null;
  private lastEpoch = -1;
  private lastBudget = -1;
  private lastExpandedDirs: ReadonlySet<string> | null = null;
  private lastLayer: string | null = null;
  private lastEntityEpoch = -1;
  private lastAvailability: string | null = null;
  private lastTimeline: Timeline | null = null;
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
      // revealed dirs — a "show more" or a proxy expand must re-cull too. The
      // active LAYER (links/entities/overlay), the entity graph/grounding
      // (entityEpoch) and its availability likewise change what is drawn.
      if (
        state.epoch !== this.lastEpoch ||
        state.nodeBudget !== this.lastBudget ||
        state.expandedDirs !== this.lastExpandedDirs ||
        state.layer !== this.lastLayer ||
        state.entityEpoch !== this.lastEntityEpoch ||
        state.entityAvailability !== this.lastAvailability
      ) {
        this.rebuild(state);
      } else if (state.timeline !== this.lastTimeline) {
        // The graph is unchanged but a fresh timeline arrived (or grew): recompute
        // only the per-node birth/death indices and re-upload — no worker reheat.
        this.lastTimeline = state.timeline;
        this.computeTimeArrays(state);
        this.version += 1;
      }
      // Entering the brain computes its layout lazily (the very first time only);
      // cosmos stays byte-for-byte untouched until then.
      if (state.mode !== this.lastMode) {
        this.lastMode = state.mode;
        if (state.mode === 'brain') this.ensureBrainLayout(state);
      }
    });
    const initial = store.getState();
    this.lastEpoch = initial.epoch;
    this.lastBudget = initial.nodeBudget;
    this.lastExpandedDirs = initial.expandedDirs;
    this.lastLayer = initial.layer;
    this.lastEntityEpoch = initial.entityEpoch;
    this.lastAvailability = initial.entityAvailability;
    this.lastTimeline = initial.timeline;
    this.lastMode = initial.mode;
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

  /**
   * e2e/debug: how many live render-nodes are present at the current LOGICAL scrub
   * position (spec/90's membership: born ≤ index < death). Equals liveCount when
   * not travelling. A pixel-free way for a test to prove the brain shrinks in the
   * past and grows toward the present.
   */
  presentCount(index?: number): number {
    const s = this.store.getState();
    if (!s.timeTravel) return this.ids.length;
    const idx = index ?? s.scrubIndex;
    let n = 0;
    for (let i = 0; i < this.ids.length; i++) {
      const birth = this.birthIdx[i] ?? UNTRACKED_BIRTH;
      const death = this.deathIdx[i] ?? NO_DEATH;
      if ((birth < 0 || idx >= birth) && idx < death) n += 1;
    }
    return n;
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
    this.lastLayer = state.layer;
    this.lastEntityEpoch = state.entityEpoch;
    this.lastAvailability = state.entityAvailability;
    this.lastTimeline = state.timeline;

    // Resolve the active layer into ONE render node/edge set — links (the doc
    // graph, untouched), entities, or the overlay of both — then feed it
    // through the SAME budget + scene path (no forked renderer, spec/40).
    const active = activeRenderGraph({
      layer: state.layer,
      available: state.entityAvailability === 'available',
      docNodes: state.nodes,
      docEdges: state.edges,
      entityGraph: state.entityGraph,
      grounding: state.grounding,
    });

    // Apply the GPU budget: below the cap this is a passthrough (identical
    // set); above it, degree-ranked culling + per-dir cluster proxies. The HUD
    // reads the same memoized view, so its "N of M" always matches the scene.
    const view = budgetedGraph(active.nodes, active.edges, active.version, state.nodeBudget, state.expandedDirs);
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
    const family = new Uint8Array(n);
    const shape = new Uint8Array(n);
    const birth = new Float32Array(n).fill(-1);
    const activityAt = new Float32Array(n).fill(-1);

    for (const node of view.renderNodes) {
      const i = index.get(node.id) as number;
      // Entities are their own species: gold gem, doc paths keep the dir
      // palette UNLESS `about` is present — the two-axis ontology's color
      // channel then wins (colorForNode), same node still just a disc.
      const entity = isEntityRenderId(node.id);
      const [r, g, b] = colorForNode(node.id, node.about, node.type, entity);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      const degree = node.in + node.out;
      degrees[i] = degree;
      radii[i] = radiusForDegree(degree);
      reserved[i] = node.reserved ? 1 : 0;
      cluster[i] = isClusterId(node.id) ? 1 : 0;
      family[i] = entity ? 1 : 0;
      // The ontology SHAPE channel is doc-only — an entity is always the gem
      // (vEntity wins in the fragment shader regardless of this value).
      shape[i] = entity ? 0 : shapeIndexForType(node.type);
      const join = state.joins.get(node.id);
      if (join) birth[i] = this.sceneTime(join.at);
      const activity = state.activity.get(node.id);
      if (activity !== undefined) activityAt[i] = this.sceneTime(activity);
    }

    // Edges whose endpoints both exist, as index pairs + structural keys.
    // edgeWeights carries per-edge brightness (relation weight, virtual hint,
    // or 1 for doc links → identical to before); edgeKinds tints them.
    const edgeKeys: string[] = [];
    const pairs: number[] = [];
    const links: WorkerLink[] = [];
    const weights: number[] = [];
    const kinds: number[] = [];
    for (const edge of view.renderEdges) {
      const s = index.get(edge.source);
      const t = index.get(edge.target);
      if (s === undefined || t === undefined) continue;
      pairs.push(s, t);
      links.push({ source: s, target: t, count: edge.count });
      weights.push(edge.weight ?? 1);
      kinds.push(edge.kind === 'relation' ? 1 : edge.kind === 'virtual' ? 2 : 0);
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
    this.family = family;
    this.shape = shape;
    this.birth = birth;
    this.activityAt = activityAt;
    this.edgePairs = Uint32Array.from(pairs);
    this.edgeWeights = Float32Array.from(weights);
    this.edgeKinds = Uint8Array.from(kinds);
    this.edgeCount = links.length;
    const adjacency = buildAdjacency(this.edgePairs, this.edgeCount, n);
    this.neighbors = adjacency.neighbors;
    this.incident = adjacency.incident;
    this.ghostAnchors = buildGhostAnchors(state.ghosts, index, GHOST_GLOW.phantomDistance);
    this.labelOrder = ids
      .map((_, i) => i)
      .sort((a, b) => (degrees[b] ?? 0) - (degrees[a] ?? 0) || (ids[a] as string).localeCompare(ids[b] as string));

    // Time Machine: recompute each node's birth/death/mod commit index for the
    // new id set (a no-op set of sentinels when there is no history).
    this.computeTimeArrays(state);

    // In brain mode, keep the 3D layout in step with the live graph so new
    // nodes stream into their lobe too (recomputed before the version bump).
    if (this.lastMode === 'brain') this.computeBrainPositions(state);
    else this.brainReady = false; // stale once the graph moved; recompute on re-entry
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

  /**
   * Compute positionBrain for the current (budgeted) node set: detect
   * communities on the render edges, map them to lobe centroids, and relax a
   * force layout constrained inside the SDF (all deterministic). Recomputed only
   * when the graph the last layout saw is stale.
   */
  ensureBrainLayout(state: UIState): void {
    if (this.brainReady && this.brainEpoch === state.epoch && this.brainCount === this.ids.length) return;
    this.computeBrainPositions(state);
    this.version += 1; // rebuild geometry with the fresh iBrain targets
  }

  private computeBrainPositions(state: UIState): void {
    const n = this.ids.length;
    this.brainEpoch = state.epoch;
    this.brainCount = n;
    this.brainReady = true;
    if (n === 0) {
      this.brainPositions = new Float32Array(0);
      return;
    }
    const idEdges: { source: string; target: string }[] = [];
    const pairs: Array<[number, number]> = [];
    for (let e = 0; e < this.edgeCount; e++) {
      const a = this.edgePairs[e * 2] ?? 0;
      const b = this.edgePairs[e * 2 + 1] ?? 0;
      pairs.push([a, b]);
      idEdges.push({ source: this.ids[a] as string, target: this.ids[b] as string });
    }
    const { centroidOf } = communityLobes(this.ids, idEdges);
    const fallback: Vec3 = [0, -0.1, 0];
    const seeds = this.ids.map((id) => centroidOf.get(id) ?? fallback);
    this.brainPositions = computeBrainLayout({
      count: n,
      edges: pairs,
      seeds,
      seed: BRAIN.seed,
      scale: BRAIN.scale,
    });
  }

  /**
   * Compute the per-node birth/death/last-modified commit indices for the current
   * id set from the store's timeline (spec/90). Cheap (one pass over the render
   * nodes); recomputed on a graph change or when a fresh timeline arrives. Without
   * history everything is a sentinel (birth -1 = always present), so the shader's
   * time-travel path is a no-op even if it somehow runs.
   */
  private computeTimeArrays(state: UIState): void {
    const n = this.ids.length;
    const birthIdx = new Float32Array(n).fill(UNTRACKED_BIRTH);
    const deathIdx = new Float32Array(n).fill(NO_DEATH);
    const modIdx = new Float32Array(n).fill(-1);
    const timeline = state.timeline;
    if (hasHistory(timeline)) {
      for (let i = 0; i < n; i++) {
        const id = this.ids[i] as string;
        birthIdx[i] = birthIndexOf(timeline, id);
        const d = deathIndexOf(timeline, id);
        deathIdx[i] = Number.isFinite(d) ? d : NO_DEATH;
        modIdx[i] = lastModIndexOf(timeline, id);
      }
    }
    this.birthIdx = birthIdx;
    this.deathIdx = deathIdx;
    this.modIdx = modIdx;
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
