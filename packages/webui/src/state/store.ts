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

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

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

  ingestHello(hello: HelloEvent): void;
  ingestDelta(delta: GraphDelta, now?: number): void;
  ingestSnapshot(graph: GraphPayload, seq: number, now?: number): void;
  setConnection(state: ConnectionState): void;
  setCompile(status: CompileStatus | null): void;

  select(id: string | null, fly?: boolean): void;
  /** Camera flight to a node without changing the selection (hover preview). */
  previewNode(id: string): void;
  setHovered(id: string | null): void;

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
}

/**
 * Resolve the effective highlight + dim from the two emphasis drivers.
 * An open search with hits wins; otherwise an active lens; otherwise any
 * lingering search mark (a focused hit) stays lit without dimming.
 */
function deriveEmphasis(src: EmphasisSource): { highlight: ReadonlySet<string>; dimOthers: boolean } {
  if (src.searchOpen && src.searchHits.length > 0) {
    return { highlight: src.searchEmphasis, dimOthers: true };
  }
  if (src.lens.kind !== 'none') {
    return { highlight: lensNodeSet(src.nodes, src.lens), dimOthers: true };
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
          set({ selection: null });
          return;
        }
        const state = get();
        const flyTo =
          fly && state.nodes.has(id) ? { id, nonce: (state.flyTo?.nonce ?? 0) + 1 } : state.flyTo;
        set({ selection: id, flyTo });
      },

      previewNode(id) {
        const state = get();
        if (!state.nodes.has(id)) return;
        set({ flyTo: { id, nonce: (state.flyTo?.nonce ?? 0) + 1 } });
      },

      setHovered(hovered) {
        set({ hovered });
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
    };
  });
}

/** The app-wide store instance. Tests build their own via createUIStore(). */
export const uiStore = createUIStore();

export function useUI<T>(selector: (state: UIState) => T): T {
  return useStore(uiStore, selector);
}

export type { GhostEdge, Lens };
