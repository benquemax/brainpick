/**
 * The zustand store: graph state (via the pure applyDelta reducer) plus UI
 * state — selection, search (query, mode, honest degradation meta), lenses,
 * ghost-edge visibility, camera bookmarks/commands, connection and tiers.
 *
 * Emphasis model: search hits and lenses both resolve to a node-id set held
 * in `highlight`; `dimOthers` tells the scene to fade everything else. One
 * mechanism, two drivers — the scene never knows which one is active.
 *
 * Built on zustand/vanilla so it is fully testable without React; components
 * consume it through the `useUI` hook below.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  CompileStatus,
  GhostEdge,
  GraphDelta,
  GraphNode,
  GraphPayload,
  HelloEvent,
  SearchHit,
  SearchMode,
  TierMap,
} from '../graph/types';
import { applyDelta, applySnapshot, emptyGraphSlice, type GraphSlice } from './applyDelta';
import { lensNodeSet, NO_LENS, sameLens, type Lens } from './lens';
import { DEFAULT_GPU_TIER, type GpuTier } from '../scene/gpuTier';
import { GPU_BUDGET } from '../scene/tuning';
import type { EntityAvailability, EntityGraph, GraphLayer } from '../graph/entities';
import { entityRenderId } from '../graph/entities';
import { entityRenderIdsForDoc } from './entityModel';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** The two faces of one brain: the flat analytic cosmos, or the 3D hologram. */
export type ViewMode = 'cosmos' | 'brain';

export interface FlyRequest {
  id: string;
  nonce: number;
}

/** Response provenance for the last search (spec/50 used_modes/degraded_from). */
export interface SearchMeta {
  usedModes: string[];
  degradedFrom: string | null;
}

/** An orthographic 2D camera pose — world center + zoom (a game save slot). */
export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
}

export type CameraCommand =
  | { kind: 'overview'; nonce: number }
  | { kind: 'pose'; pose: CameraPose; nonce: number };

export const BOOKMARK_SLOTS = 3;

export type HudPanel = 'tags' | null;

export interface UIState extends GraphSlice {
  tiers: TierMap | null;
  /** Last seq announced by the server (hello) — may lead the graph seq. */
  serverSeq: number;
  connection: ConnectionState;
  compile: CompileStatus | null;

  selection: string | null;
  hovered: string | null;

  /** LAYER: which graph the cosmos shows — links (T1) ⇄ entities (T3) ⇄ overlay. */
  layer: GraphLayer;
  /** Fetch-side entity-layer state: available only once a T3 export is fetched. */
  entityAvailability: EntityAvailability;
  /** The last fetched entity graph (GET /api/graph?layer=entities), or null. */
  entityGraph: EntityGraph | null;
  /** Manifest seq the entity graph was fetched at (cache key); 0 = none. */
  entitySeq: number;
  /** Bumped whenever entityGraph/grounding changes — the scene re-culls. */
  entityEpoch: number;
  /** Selected ENTITY id (bare, e.g. "aurinko") — opens the entity panel. */
  entitySelection: string | null;
  /** entity id → its source_docs, reconstructed from /api/neighbors. */
  grounding: ReadonlyMap<string, string[]>;
  /** In overlay: the doc whose entities are lit (clicking a doc reveals them). */
  docEntityFocus: string | null;

  searchOpen: boolean;
  searchQuery: string;
  searchMode: SearchMode;
  searchHits: SearchHit[];
  searchActive: number;
  searchMeta: SearchMeta | null;
  /** Effective emphasis set (search hits, a focused hit, or the lens). */
  highlight: ReadonlySet<string>;
  /** True while an emphasis source wants the rest of the cosmos dimmed. */
  dimOthers: boolean;
  flyTo: FlyRequest | null;

  lens: Lens;
  showGhosts: boolean;

  bookmarks: readonly (CameraPose | null)[];
  cameraCommand: CameraCommand | null;
  /** HUD/keyboard ask the camera rig to capture the current pose here. */
  bookmarkSaveRequest: { slot: number; nonce: number } | null;

  hudPanel: HudPanel;

  /** NAVIGATOR: the directory-tree panel (desktop) / drawer (mobile). */
  navigatorOpen: boolean;

  /** VIEW MODE: the flat 2D cosmos (uMorph→0) or the 3D holographic brain (→1). */
  mode: ViewMode;
  /**
   * True while the brain form is on screen — set the moment brain mode is
   * entered and held until the morph eases fully back to cosmos, so the
   * perspective orbit rig + shell stay mounted through the whole transition.
   * (The per-frame morph value itself lives on the runtime, not in the store.)
   */
  morphActive: boolean;

  /** GPU performance tier (scene/gpuTier) — detected once at startup. */
  gpu: GpuTier;
  /** Active node render budget: the tier's cap, raised by "show more". */
  nodeBudget: number;
  /** Top-level dirs the user revealed by expanding a cluster proxy. */
  expandedDirs: ReadonlySet<string>;

  ingestHello(hello: HelloEvent): void;
  ingestDelta(delta: GraphDelta, now?: number): void;
  ingestSnapshot(graph: GraphPayload, seq: number, now?: number): void;
  setConnection(state: ConnectionState): void;
  setCompile(status: CompileStatus | null): void;

  select(id: string | null, fly?: boolean): void;
  /** Camera flight to a node without changing the selection (hover preview). */
  previewNode(id: string): void;
  setHovered(id: string | null): void;

  /** Switch the rendered graph layer. links clears any entity chrome. */
  setLayer(layer: GraphLayer): void;
  /** Adopt a fetched entity graph — the layer becomes truly available. */
  ingestEntityGraph(graph: EntityGraph, seq: number): void;
  /** No T3 export (404 / tiers.t3 off): the toggle tags it, the view falls back. */
  setEntityUnavailable(): void;
  /** Merge freshly discovered entity→source_docs grounding. */
  ingestGrounding(grounding: ReadonlyMap<string, string[]>): void;
  /** Select an entity (opens the entity panel, flies to its render node). */
  selectEntity(id: string | null): void;
  /** Overlay: select a doc AND light up the entities grounded in it. */
  selectDocInOverlay(path: string): void;
  /** From the entity panel: reach a source doc in the doc layer (overlay + fly). */
  selectSourceDoc(path: string): void;

  openSearch(): void;
  closeSearch(): void;
  setSearchQuery(q: string): void;
  setSearchMode(mode: SearchMode): void;
  setSearchHits(hits: SearchHit[], meta?: SearchMeta | null): void;
  setSearchActive(index: number): void;
  clearSearch(): void;
  focusHit(path: string): void;

  /** Toggle a lens: applying the active lens again releases it. */
  toggleLens(lens: Exclude<Lens, { kind: 'none' }>): void;
  clearLens(): void;
  toggleGhosts(): void;

  saveBookmark(slot: number, pose: CameraPose): void;
  requestBookmarkSave(slot: number): void;
  recallBookmark(slot: number): void;
  requestOverview(): void;

  setHudPanel(panel: HudPanel): void;
  toggleNavigator(): void;

  /** Enter/leave the holographic brain (drives the uMorph target). */
  setMode(mode: ViewMode): void;
  /** Flip cosmos ⇄ brain (HUD button, key `b`). */
  toggleMode(): void;
  /** MorphController reports when the transition is live / has fully settled. */
  setMorphActive(active: boolean): void;

  /** Adopt a detected GPU tier and its node budget (main.tsx, at startup). */
  initGpu(gpu: GpuTier): void;
  /** Override the render budget (clamped to [1, ceiling]). */
  setNodeBudget(budget: number): void;
  /** "Show more": raise the budget by the tuning factor, up to the ceiling. */
  raiseBudget(): void;
  /** Reveal a top-level dir's real docs, dropping its cluster proxy. */
  expandDir(dir: string): void;
  /** Re-collapse a previously expanded dir. */
  collapseDir(dir: string): void;
}

export type UIStoreApi = StoreApi<UIState>;

const EMPTY_HIGHLIGHT: ReadonlySet<string> = new Set();

interface EmphasisSource {
  searchOpen: boolean;
  searchHits: SearchHit[];
  /** What search last decided (live hits or a focused hit). */
  searchEmphasis: ReadonlySet<string>;
  lens: Lens;
  nodes: ReadonlyMap<string, GraphNode>;
  /** Overlay: a selected doc whose grounded entities should light up. */
  docEntityFocus: string | null;
  grounding: ReadonlyMap<string, string[]>;
}

/**
 * Resolve the effective highlight + dim from the emphasis drivers, by priority:
 * an open search with hits wins; then an active lens; then an overlay doc's
 * entities; otherwise any lingering search mark (a focused hit) stays lit
 * without dimming. One mechanism, several drivers — the scene reads `highlight`.
 */
function deriveEmphasis(src: EmphasisSource): { highlight: ReadonlySet<string>; dimOthers: boolean } {
  if (src.searchOpen && src.searchHits.length > 0) {
    return { highlight: src.searchEmphasis, dimOthers: true };
  }
  if (src.lens.kind !== 'none') {
    return { highlight: lensNodeSet(src.nodes, src.lens), dimOthers: true };
  }
  if (src.docEntityFocus !== null) {
    const set = new Set<string>([src.docEntityFocus, ...entityRenderIdsForDoc(src.grounding, src.docEntityFocus)]);
    return { highlight: set, dimOthers: true };
  }
  return { highlight: src.searchEmphasis, dimOthers: false };
}

export function createUIStore(): UIStoreApi {
  // The search-owned emphasis set, tracked outside the public state so the
  // derived `highlight` is the only set the scene ever reads.
  let searchEmphasis: ReadonlySet<string> = EMPTY_HIGHLIGHT;

  return createStore<UIState>()((set, get) => {
    const emphasisOf = (over: Partial<EmphasisSource> = {}) => {
      const s = get();
      return deriveEmphasis({
        searchOpen: s.searchOpen,
        searchHits: s.searchHits,
        searchEmphasis,
        lens: s.lens,
        nodes: s.nodes,
        docEntityFocus: s.docEntityFocus,
        grounding: s.grounding,
        ...over,
      });
    };

    const nextCameraNonce = () => (get().cameraCommand?.nonce ?? 0) + 1;

    return {
      ...emptyGraphSlice(),

      tiers: null,
      serverSeq: 0,
      connection: 'connecting',
      compile: null,

      selection: null,
      hovered: null,

      layer: 'links',
      entityAvailability: 'unknown',
      entityGraph: null,
      entitySeq: 0,
      entityEpoch: 0,
      entitySelection: null,
      grounding: new Map<string, string[]>(),
      docEntityFocus: null,

      searchOpen: false,
      searchQuery: '',
      searchMode: 'auto',
      searchHits: [],
      searchActive: 0,
      searchMeta: null,
      highlight: EMPTY_HIGHLIGHT,
      dimOthers: false,
      flyTo: null,

      lens: NO_LENS,
      showGhosts: true,

      bookmarks: Object.freeze(new Array<CameraPose | null>(BOOKMARK_SLOTS).fill(null)),
      cameraCommand: null,
      bookmarkSaveRequest: null,

      hudPanel: null,

      navigatorOpen: false,

      mode: 'cosmos',
      morphActive: false,

      gpu: DEFAULT_GPU_TIER,
      nodeBudget: DEFAULT_GPU_TIER.nodeBudget,
      expandedDirs: new Set<string>(),

      ingestHello(hello) {
        set({ tiers: hello.tiers, serverSeq: hello.seq });
      },

      ingestDelta(delta, now = Date.now()) {
        const state = get();
        const next = applyDelta(state, delta, now);
        if (next !== state) {
          set({
            seq: next.seq,
            nodes: next.nodes,
            edges: next.edges,
            ghosts: next.ghosts,
            stats: next.stats,
            tags: next.tags,
            needsSnapshot: next.needsSnapshot,
            epoch: next.epoch,
            joins: next.joins,
            exits: next.exits,
            activity: next.activity,
            serverSeq: Math.max(state.serverSeq, delta.seq),
            // lens membership may have changed with the graph
            ...emphasisOf({ nodes: next.nodes }),
          });
        }
      },

      ingestSnapshot(graph, seq, now = Date.now()) {
        const state = get();
        const next = applySnapshot(state, graph, seq, now);
        const selection = state.selection !== null && next.nodes.has(state.selection) ? state.selection : null;
        set({
          seq: next.seq,
          nodes: next.nodes,
          edges: next.edges,
          ghosts: next.ghosts,
          stats: next.stats,
          tags: next.tags,
          needsSnapshot: next.needsSnapshot,
          epoch: next.epoch,
          joins: next.joins,
          exits: next.exits,
          activity: next.activity,
          serverSeq: Math.max(state.serverSeq, seq),
          selection,
          ...emphasisOf({ nodes: next.nodes }),
        });
      },

      setConnection(connection) {
        set({ connection });
      },

      setCompile(compile) {
        set({ compile });
      },

      select(id, fly = true) {
        if (id === null) {
          set({ selection: null, entitySelection: null, docEntityFocus: null, ...emphasisOf({ docEntityFocus: null }) });
          return;
        }
        const state = get();
        const flyTo =
          fly && state.nodes.has(id) ? { id, nonce: (state.flyTo?.nonce ?? 0) + 1 } : state.flyTo;
        // Selecting a doc closes any entity selection / overlay focus.
        set({ selection: id, entitySelection: null, docEntityFocus: null, flyTo, ...emphasisOf({ docEntityFocus: null }) });
      },

      previewNode(id) {
        const state = get();
        if (!state.nodes.has(id)) return;
        set({ flyTo: { id, nonce: (state.flyTo?.nonce ?? 0) + 1 } });
      },

      setHovered(hovered) {
        set({ hovered });
      },

      setLayer(layer) {
        const state = get();
        if (state.layer === layer) return;
        // A confirmed-unavailable entity layer can't be entered — nothing to show.
        if (layer !== 'links' && state.entityAvailability === 'unavailable') return;
        if (layer === 'links') {
          // links mode shows no entity chrome — drop selection/focus.
          set({ layer, entitySelection: null, docEntityFocus: null, ...emphasisOf({ docEntityFocus: null }) });
        } else {
          set({ layer });
        }
      },

      ingestEntityGraph(graph, seq) {
        set({
          entityGraph: graph,
          entitySeq: seq,
          entityAvailability: 'available',
          entityEpoch: get().entityEpoch + 1,
        });
      },

      setEntityUnavailable() {
        // No T3 export (404): fall the view back to links and drop entity chrome.
        set({
          entityAvailability: 'unavailable',
          entityGraph: null,
          entitySeq: 0,
          entitySelection: null,
          docEntityFocus: null,
          layer: 'links',
          entityEpoch: get().entityEpoch + 1,
          ...emphasisOf({ docEntityFocus: null }),
        });
      },

      ingestGrounding(grounding) {
        const next = new Map(get().grounding);
        for (const [id, docs] of grounding) next.set(id, docs);
        // Pass the fresh map into the emphasis derivation — get() still holds the old one.
        set({ grounding: next, entityEpoch: get().entityEpoch + 1, ...emphasisOf({ grounding: next }) });
      },

      selectEntity(id) {
        if (id === null) {
          set({ entitySelection: null });
          return;
        }
        const state = get();
        set({
          entitySelection: id,
          selection: null,
          docEntityFocus: null,
          flyTo: { id: entityRenderId(id), nonce: (state.flyTo?.nonce ?? 0) + 1 },
          ...emphasisOf({ docEntityFocus: null }),
        });
      },

      selectDocInOverlay(path) {
        const state = get();
        set({
          selection: path,
          entitySelection: null,
          docEntityFocus: path,
          flyTo: state.nodes.has(path) ? { id: path, nonce: (state.flyTo?.nonce ?? 0) + 1 } : state.flyTo,
          ...emphasisOf({ docEntityFocus: path }),
        });
      },

      selectSourceDoc(path) {
        get().setLayer('overlay');
        get().select(path, true);
      },

      openSearch() {
        set({ searchOpen: true, searchActive: 0, ...emphasisOf({ searchOpen: true }) });
      },

      closeSearch() {
        set({ searchOpen: false, ...emphasisOf({ searchOpen: false }) });
      },

      setSearchQuery(searchQuery) {
        set({ searchQuery, searchActive: 0 });
      },

      setSearchMode(searchMode) {
        set({ searchMode });
      },

      setSearchHits(searchHits, meta = null) {
        searchEmphasis = new Set(searchHits.map((h) => h.path));
        set({
          searchHits,
          searchActive: 0,
          searchMeta: meta,
          ...emphasisOf({ searchHits }),
        });
      },

      setSearchActive(searchActive) {
        set({ searchActive });
      },

      clearSearch() {
        searchEmphasis = EMPTY_HIGHLIGHT;
        set({
          searchOpen: false,
          searchQuery: '',
          searchHits: [],
          searchActive: 0,
          searchMeta: null,
          ...emphasisOf({ searchOpen: false, searchHits: [] }),
        });
      },

      focusHit(path) {
        get().select(path, true);
        searchEmphasis = new Set([path]);
        set({ searchOpen: false, ...emphasisOf({ searchOpen: false }) });
      },

      toggleLens(lens) {
        const next: Lens = sameLens(get().lens, lens) ? NO_LENS : lens;
        set({ lens: next, ...emphasisOf({ lens: next }) });
      },

      clearLens() {
        set({ lens: NO_LENS, ...emphasisOf({ lens: NO_LENS }) });
      },

      toggleGhosts() {
        set({ showGhosts: !get().showGhosts });
      },

      saveBookmark(slot, pose) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= BOOKMARK_SLOTS) return;
        const bookmarks = [...get().bookmarks];
        bookmarks[slot] = pose;
        set({ bookmarks });
      },

      requestBookmarkSave(slot) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= BOOKMARK_SLOTS) return;
        set({ bookmarkSaveRequest: { slot, nonce: (get().bookmarkSaveRequest?.nonce ?? 0) + 1 } });
      },

      recallBookmark(slot) {
        const pose = get().bookmarks[slot];
        if (!pose) return;
        set({ cameraCommand: { kind: 'pose', pose, nonce: nextCameraNonce() } });
      },

      requestOverview() {
        set({ cameraCommand: { kind: 'overview', nonce: nextCameraNonce() } });
      },

      setHudPanel(hudPanel) {
        set({ hudPanel });
      },

      toggleNavigator() {
        set({ navigatorOpen: !get().navigatorOpen });
      },

      setMode(mode) {
        if (get().mode === mode) return;
        // Entering the brain: mark the transition active NOW so the perspective
        // rig + shell mount for the whole morph. Leaving: keep it active until
        // MorphController sees uMorph reach 0 and calls setMorphActive(false).
        set(mode === 'brain' ? { mode, morphActive: true } : { mode });
      },

      toggleMode() {
        get().setMode(get().mode === 'brain' ? 'cosmos' : 'brain');
      },

      setMorphActive(active) {
        if (get().morphActive !== active) set({ morphActive: active });
      },

      initGpu(gpu) {
        set({ gpu, nodeBudget: gpu.nodeBudget });
      },

      setNodeBudget(budget) {
        const clamped = Math.max(1, Math.min(GPU_BUDGET.budgetCeiling, Math.round(budget)));
        if (clamped !== get().nodeBudget) set({ nodeBudget: clamped });
      },

      raiseBudget() {
        get().setNodeBudget(get().nodeBudget * GPU_BUDGET.showMoreFactor);
      },

      expandDir(dir) {
        const current = get().expandedDirs;
        if (current.has(dir)) return;
        const next = new Set(current);
        next.add(dir);
        set({ expandedDirs: next });
      },

      collapseDir(dir) {
        const current = get().expandedDirs;
        if (!current.has(dir)) return;
        const next = new Set(current);
        next.delete(dir);
        set({ expandedDirs: next });
      },
    };
  });
}

/** The app-wide store instance. Tests build their own via createUIStore(). */
export const uiStore = createUIStore();

export function useUI<T>(selector: (state: UIState) => T): T {
  return useStore(uiStore, selector);
}

export type { GhostEdge, Lens };
