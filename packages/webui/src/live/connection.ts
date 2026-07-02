/**
 * The /api/live SSE client (spec/60-live-deltas.md).
 *
 * Wire protocol handled here:
 *  - `hello` opens every connection with the server's current seq. If it
 *    differs from the graph seq we hold, resync via GET /api/graph. Any
 *    replayed deltas that arrive alongside are de-duplicated by the reducer
 *    (stale seq -> ignored), so an extra snapshot fetch is always safe.
 *  - `graph.delta` feeds the reducer; a seq gap raises `needsSnapshot`,
 *    which this layer observes and answers with a fresh snapshot fetch
 *    (SSE has no request channel).
 *  - `graph.snapshot` replaces the graph wholesale.
 *  - `compile.status` lands in the status HUD.
 *
 * Reconnects are managed manually with exponential backoff so behavior is
 * deterministic and testable; every (re)connect re-verifies seq via hello.
 * The PWA additionally pokes the connection on visibilitychange.
 */
import type { CompileStatus, GraphDelta, HelloEvent, SnapshotEvent } from '../graph/types';
import type { UIStoreApi } from '../state/store';
import type { GraphFetchResult } from './api';

export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}

export type SourceFactory = (url: string) => EventSourceLike;

export interface LiveConnectionOptions {
  store: UIStoreApi;
  fetchGraph: (bustCache: boolean, fallbackSeq: number) => Promise<GraphFetchResult>;
  makeSource?: SourceFactory;
  url?: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const MAX_FAILURES_BEFORE_OFFLINE = 5;

export class LiveConnection {
  private readonly store: UIStoreApi;
  private readonly fetchGraphImpl: LiveConnectionOptions['fetchGraph'];
  private readonly makeSource: SourceFactory;
  private readonly url: string;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  private source: EventSourceLike | null = null;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private fetching = false;
  private disposed = false;
  private unsubscribe: (() => void) | null = null;

  constructor(options: LiveConnectionOptions) {
    this.store = options.store;
    this.fetchGraphImpl = options.fetchGraph;
    this.makeSource = options.makeSource ?? ((url) => new EventSource(url) as unknown as EventSourceLike);
    this.url = options.url ?? '/api/live';
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
  }

  start(): void {
    if (this.disposed) throw new Error('LiveConnection was disposed');
    // Answer needsSnapshot (raised by the reducer on a seq gap) with a
    // fresh snapshot fetch.
    this.unsubscribe = this.store.subscribe((state, prev) => {
      if (state.needsSnapshot && !prev.needsSnapshot) void this.resync();
    });
    this.open();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.source?.close();
    this.source = null;
  }

  /** Called on visibilitychange: reconnect immediately if the stream died. */
  pokeVisible(): void {
    if (this.disposed) return;
    if (this.source === null) {
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.open();
    }
  }

  private open(): void {
    if (this.disposed) return;
    this.store.getState().setConnection(this.failures === 0 ? 'connecting' : 'reconnecting');
    const source = this.makeSource(this.url);
    this.source = source;

    source.addEventListener('hello', (ev) => {
      const hello = JSON.parse(ev.data) as HelloEvent;
      this.failures = 0;
      this.store.getState().ingestHello(hello);
      this.store.getState().setConnection('live');
      // Every (re)connect re-verifies the baseline. Replayed deltas the
      // server may also send are idempotent through the reducer.
      if (hello.seq !== this.store.getState().seq) {
        void this.resync(hello.seq);
      }
    });

    source.addEventListener('graph.delta', (ev) => {
      const delta = JSON.parse(ev.data) as GraphDelta;
      this.store.getState().ingestDelta(delta);
    });

    source.addEventListener('graph.snapshot', (ev) => {
      const snapshot = JSON.parse(ev.data) as SnapshotEvent;
      this.store.getState().ingestSnapshot(snapshot.graph, snapshot.seq);
    });

    source.addEventListener('compile.status', (ev) => {
      const status = JSON.parse(ev.data) as CompileStatus;
      this.store.getState().setCompile(status);
    });

    source.addEventListener('error', () => {
      if (this.source !== source) return; // an already-replaced connection
      source.close();
      this.source = null;
      this.failures += 1;
      this.store
        .getState()
        .setConnection(this.failures >= MAX_FAILURES_BEFORE_OFFLINE ? 'offline' : 'reconnecting');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.retryTimer !== null) return;
    const delay = Math.min(this.baseDelayMs * 2 ** (this.failures - 1), this.maxDelayMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  /** Fetch a fresh snapshot; used for initial sync, gaps and hello drift. */
  private async resync(fallbackSeq?: number): Promise<void> {
    if (this.fetching || this.disposed) return;
    this.fetching = true;
    try {
      const state = this.store.getState();
      // Cache-bust everything but the very first load so the service
      // worker's stale-while-revalidate copy cannot satisfy a resync.
      const bust = state.seq > 0 || state.needsSnapshot;
      const fallback = fallbackSeq ?? state.serverSeq;
      const { graph, seq } = await this.fetchGraphImpl(bust, fallback);
      this.store.getState().ingestSnapshot(graph, seq);
    } catch {
      // Snapshot fetch failed (offline, server restart…). Retry on the
      // reconnect cadence rather than looping hot.
      if (!this.disposed) {
        setTimeout(() => {
          const s = this.store.getState();
          if (s.needsSnapshot || s.seq === 0) void this.resync(fallbackSeq);
        }, this.baseDelayMs * 2);
      }
    } finally {
      this.fetching = false;
    }
    // If another gap opened while we were fetching, go again.
    if (!this.disposed && this.store.getState().needsSnapshot) {
      void this.resync();
    }
  }
}
