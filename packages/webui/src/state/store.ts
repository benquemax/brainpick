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
import { DEFAULT_GPU_TIER, mobileNodeBudget, type GpuTier } from '../scene/gpuTier';
import { GPU_BUDGET } from '../scene/tuning';
import type { StatusUi } from '../live/api';
import type { EntityAvailability, EntityGraph, GraphLayer } from '../graph/entities';
import { entityRenderId } from '../graph/entities';
import { entityRenderIdsForDoc } from './entityModel';
import { EMPTY_TIMELINE, hasHistory, type Timeline } from '../time/timeline';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** The two faces of one brain: the flat analytic cosmos, or the 3D hologram. */
export type ViewMode = 'cosmos' | 'brain';

/**
 * The WYSIWYG editor's target. `replace` edits an existing doc (base_sha guards
 * the save); `create` is a new page at a kebab path. Held in the store so the
 * DocPanel's Edit button, the navigator's New page action and Escape all agree.
 */
export interface EditorTarget {
  path: string;
  mode: 'create' | 'replace';
  /** Seed title for a fresh page (the create prompt's stem, humanised). */
  title: string;
}

/** A transient status message (save succeeded, upload failed, …). */
export interface Toast {
  text: string;
  kind: 'ok' | 'warn' | 'error';
  nonce: number;
}

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

  /** TIME MACHINE (spec/90): the bundle's git history distilled for time travel. */
  timeline: Timeline;
  /** True while scrubbing history — the brain reconstructs a past moment. */
  timeTravel: boolean;
  /**
   * True while the time-travel visuals are on screen — set on enter, held until
   * the reconstruction eases fully back to the present (TimeController clears it),
   * so the starfield/field layer stays mounted through the whole fade-out.
   */
  timeTravelActive: boolean;
  /**
   * The scrub position as a FRACTIONAL COMMIT INDEX in [0, commits-1] (the LOGICAL
   * target; the scene eases an animated `runtime.scrub` toward it). At integer i
   * the brain is "as of commit i". Meaningless without history.
   */
  scrubIndex: number;
  /** True while the growth movie auto-advances (space / the play button). */
  playing: boolean;

  /** GPU performance tier (scene/gpuTier) — detected once at startup. */
  gpu: GpuTier;
  /** Active node render budget: the tier's cap, raised by "show more". */
  nodeBudget: number;
  /** Top-level dirs the user revealed by expanding a cluster proxy. */
  expandedDirs: ReadonlySet<string>;
  /** The operator's `[ui]` policy from GET /api/status once applied, or null. */
  serverUi: StatusUi | null;

  /** EDITOR: writes are exposed by the server (spec/50 [serve] writes = "guarded"). */
  writesEnabled: boolean;
  /** The open WYSIWYG editor's target, or null when it is closed. */
  editor: EditorTarget | null;
  /** A transient toast (save/upload feedback); the Toast view auto-dismisses it. */
  toast: Toast | null;

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

  /** Adopt a fetched timeline; if we were scrubbing, re-clamp to the new range. */
  ingestTimeline(timeline: Timeline): void;
  /** Enter time travel at a given commit index (default: the present / last commit). No-op without history. */
  enterTimeTravel(index?: number): void;
  /** Leave time travel, stop playback, restore the live present. */
  exitTimeTravel(): void;
  /** Flip time travel on/off (key `t`, the pill). */
  toggleTimeTravel(): void;
  /** Set the scrub position (clamped to [0, commits-1]); stops playback on a manual scrub. */
  setScrubIndex(index: number, fromPlay?: boolean): void;
  /** Step by whole commits (←/→): rounds to the nearest integer commit then ±delta. */
  stepCommit(delta: number): void;
  /** Start/stop the growth movie; play from the start when already at the end. */
  setPlaying(playing: boolean): void;
  togglePlay(): void;
  /** TimeController reports when the time-travel visuals have eased fully out. */
  setTimeTravelActive(active: boolean): void;

  /** Adopt a detected GPU tier and its node budget (main.tsx, at startup). */
  initGpu(gpu: GpuTier): void;
  /**
   * Adopt the operator's `[ui]` policy from /api/status (spec/80): prefer its
   * mobile node cap over the GPU guess (GPU tier stays the secondary safety cap),
   * and honor its opening view on first load. Absent/null → the GPU guess stands.
   */
  applyServerUi(ui: StatusUi | null, env: { isMobile: boolean }): void;
  /** Override the render budget (clamped to [1, ceiling]). */
  setNodeBudget(budget: number): void;
  /** "Show more": raise the budget by the tuning factor, up to the ceiling. */
  raiseBudget(): void;
  /** Reveal a top-level dir's real docs, dropping its cluster proxy. */
  expandDir(dir: string): void;
  /** Re-collapse a previously expanded dir. */
  collapseDir(dir: string): void;

  /** Adopt the server's write-availability (from GET /api/status at boot). */
  setWritesEnabled(enabled: boolean): void;
  /** Open the WYSIWYG editor on a target (Edit a doc, or a new page). */
  openEditor(target: EditorTarget): void;
  /** Close the editor without saving. */
  closeEditor(): void;
  /** Flash a transient toast; the Toast view clears it. */
  showToast(text: string, kind?: Toast['kind']): void;
  /** Clear the current toast (its timer fired, or it was dismissed). */
  clearToast(nonce: number): void;
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

      timeline: EMPTY_TIMELINE,
      timeTravel: false,
      timeTravelActive: false,
      scrubIndex: 0,
      playing: false,

      gpu: DEFAULT_GPU_TIER,
      nodeBudget: DEFAULT_GPU_TIER.nodeBudget,
      expandedDirs: new Set<string>(),
      serverUi: null,

      writesEnabled: false,
      editor: null,
      toast: null,

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

      ingestTimeline(timeline) {
        const state = get();
        // If we were travelling, keep the same commit under the handle where we can,
        // and drop out of time travel if the new timeline lost its history.
        const lastIndex = Math.max(0, timeline.commits.length - 1);
        const scrubIndex = Math.min(state.scrubIndex, lastIndex);
        const timeTravel = state.timeTravel && hasHistory(timeline);
        set({ timeline, scrubIndex, timeTravel, playing: timeTravel && state.playing });
      },

      enterTimeTravel(index) {
        const state = get();
        if (!hasHistory(state.timeline)) return; // the control hides without history
        const last = state.timeline.commits.length - 1;
        const at = index === undefined ? last : Math.max(0, Math.min(last, index));
        set({ timeTravel: true, timeTravelActive: true, scrubIndex: at, playing: false });
      },

      exitTimeTravel() {
        set({ timeTravel: false, playing: false });
      },

      toggleTimeTravel() {
        if (get().timeTravel) get().exitTimeTravel();
        else get().enterTimeTravel();
      },

      setScrubIndex(index, fromPlay = false) {
        const state = get();
        const last = Math.max(0, state.timeline.commits.length - 1);
        const clamped = Math.max(0, Math.min(last, index));
        // A manual scrub takes the wheel from playback; a play tick keeps playing.
        const playing = fromPlay ? state.playing : false;
        if (clamped !== state.scrubIndex || playing !== state.playing) {
          set({ scrubIndex: clamped, playing });
        }
      },

      stepCommit(delta) {
        const state = get();
        if (!state.timeTravel) return;
        state.setScrubIndex(Math.round(state.scrubIndex) + delta);
      },

      setPlaying(playing) {
        const state = get();
        if (!state.timeTravel || !hasHistory(state.timeline)) return;
        const last = state.timeline.commits.length - 1;
        // Pressing play at (or past) the end restarts the growth movie from the start.
        if (playing && state.scrubIndex >= last) {
          set({ scrubIndex: 0, playing: true });
        } else if (playing !== state.playing) {
          set({ playing });
        }
      },

      togglePlay() {
        get().setPlaying(!get().playing);
      },

      setTimeTravelActive(active) {
        if (get().timeTravelActive !== active) set({ timeTravelActive: active });
      },

      initGpu(gpu) {
        set({ gpu, nodeBudget: gpu.nodeBudget });
      },

      applyServerUi(ui, env) {
        const firstApply = get().serverUi === null;
        const budget = mobileNodeBudget(get().gpu, ui?.max_nodes_mobile, env.isMobile);
        set({ serverUi: ui });
        get().setNodeBudget(budget); // no-op when it equals the GPU-tier value
        // Honor the operator's opening view ONCE, on first load — never yank a
        // view the user has since chosen for themselves.
        if (firstApply && (ui?.default_mode === 'brain' || ui?.default_mode === 'cosmos')) {
          get().setMode(ui.default_mode);
        }
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

      setWritesEnabled(writesEnabled) {
        if (get().writesEnabled !== writesEnabled) set({ writesEnabled });
      },

      openEditor(target) {
        // Opening the editor lifts any transient toast; the sheet owns the screen.
        set({ editor: target, toast: null });
      },

      closeEditor() {
        set({ editor: null });
      },

      showToast(text, kind = 'ok') {
        set({ toast: { text, kind, nonce: (get().toast?.nonce ?? 0) + 1 } });
      },

      clearToast(nonce) {
        if (get().toast?.nonce === nonce) set({ toast: null });
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
export type { Timeline };
