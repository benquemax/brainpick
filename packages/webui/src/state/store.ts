/**
 * The zustand store: graph state (via the pure applyDelta reducer) plus UI
 * state — selection, search, connection, tiers, camera flight requests.
 *
 * Built on zustand/vanilla so it is fully testable without React; components
 * consume it through the `useUI` hook below.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  CompileStatus,
  GraphDelta,
  GraphPayload,
  HelloEvent,
  SearchHit,
  TierMap,
} from '../graph/types';
import { applyDelta, applySnapshot, emptyGraphSlice, type GraphSlice } from './applyDelta';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface FlyRequest {
  id: string;
  nonce: number;
}

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
  searchHits: SearchHit[];
  searchActive: number;
  highlight: ReadonlySet<string>;
  flyTo: FlyRequest | null;

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
  setSearchHits(hits: SearchHit[]): void;
  setSearchActive(index: number): void;
  clearSearch(): void;
  focusHit(path: string): void;
}

export type UIStoreApi = StoreApi<UIState>;

const EMPTY_HIGHLIGHT: ReadonlySet<string> = new Set();

export function createUIStore(): UIStoreApi {
  return createStore<UIState>()((set, get) => ({
    ...emptyGraphSlice(),

    tiers: null,
    serverSeq: 0,
    connection: 'connecting',
    compile: null,

    selection: null,
    hovered: null,

    searchOpen: false,
    searchQuery: '',
    searchHits: [],
    searchActive: 0,
    highlight: EMPTY_HIGHLIGHT,
    flyTo: null,

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
          stats: next.stats,
          tags: next.tags,
          needsSnapshot: next.needsSnapshot,
          epoch: next.epoch,
          joins: next.joins,
          exits: next.exits,
          activity: next.activity,
          serverSeq: Math.max(state.serverSeq, delta.seq),
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
        stats: next.stats,
        tags: next.tags,
        needsSnapshot: next.needsSnapshot,
        epoch: next.epoch,
        joins: next.joins,
        exits: next.exits,
        activity: next.activity,
        serverSeq: Math.max(state.serverSeq, seq),
        selection,
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
      set({ searchOpen: true, searchActive: 0 });
    },

    closeSearch() {
      set({ searchOpen: false });
    },

    setSearchQuery(searchQuery) {
      set({ searchQuery, searchActive: 0 });
    },

    setSearchHits(searchHits) {
      set({
        searchHits,
        searchActive: 0,
        highlight: new Set(searchHits.map((h) => h.path)),
      });
    },

    setSearchActive(searchActive) {
      set({ searchActive });
    },

    clearSearch() {
      set({
        searchOpen: false,
        searchQuery: '',
        searchHits: [],
        searchActive: 0,
        highlight: EMPTY_HIGHLIGHT,
      });
    },

    focusHit(path) {
      get().select(path, true);
      set({ searchOpen: false, highlight: new Set([path]) });
    },
  }));
}

/** The app-wide store instance. Tests build their own via createUIStore(). */
export const uiStore = createUIStore();

export function useUI<T>(selector: (state: UIState) => T): T {
  return useStore(uiStore, selector);
}
