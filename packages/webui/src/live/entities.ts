/**
 * The entity-layer fetch orchestrator — the T3 twin of live/connection.ts.
 *
 * It watches the store and, ONLY while the entity or overlay layer is active,
 * pulls what that layer needs (honesty: links mode never triggers an entity
 * fetch). Its decisions:
 *
 *  - entity graph stale/absent for the current seq → GET /api/graph?layer=entities.
 *    A 200 makes the layer available; a 404 degrades it to unavailable (the
 *    manifest's tiers.t3 is NOT trusted as the availability signal — a staged
 *    export can serve entities while the compiler still reports t3 off, so the
 *    endpoint is the source of truth).
 *  - graph present → reconstruct the doc↔entity grounding by walking
 *    /api/neighbors?id=<doc>&layer=entities over the on-screen docs (the entity
 *    graph itself omits source_docs). Capped + pooled so a big brain stays calm.
 *
 * Everything is cached by manifest seq; a new snapshot re-pulls. Nothing runs
 * in links mode (honesty: no entity fetch until the layer needs it).
 */
import type { UIStoreApi } from '../state/store';
import { budgetedGraph, isClusterId } from '../state/budget';
import { fetchEntityGraph as defaultFetchEntityGraph, fetchNeighbors as defaultFetchNeighbors } from './api';
import type { EntityGraphFetch } from './api';
import type { NeighborsResponse } from '../graph/entities';

/** Cap on docs probed for grounding, and how many probes run at once. */
export const GROUNDING_DOC_CAP = 300;
const GROUNDING_CONCURRENCY = 6;


export interface EntityLayerOptions {
  store: UIStoreApi;
  fetchEntityGraph?: (bustCache: boolean, fallbackSeq: number) => Promise<EntityGraphFetch>;
  fetchNeighbors?: (id: string, layer: 'entities', depth: number) => Promise<NeighborsResponse | null>;
}

export class EntityLayerController {
  private readonly store: UIStoreApi;
  private readonly fetchGraph: NonNullable<EntityLayerOptions['fetchEntityGraph']>;
  private readonly fetchNeighbors: NonNullable<EntityLayerOptions['fetchNeighbors']>;

  private unsubscribe: (() => void) | null = null;
  private fetchingGraph = false;
  private fetchingGrounding = false;
  /** Seq whose entity-graph question is settled (loaded OR 404'd) — a 404 must
   * not re-fetch forever while the tier stays on. */
  private resolvedGraphSeq = -1;
  private groundingSeq = -1;
  private disposed = false;

  constructor(options: EntityLayerOptions) {
    this.store = options.store;
    this.fetchGraph = options.fetchEntityGraph ?? defaultFetchEntityGraph;
    this.fetchNeighbors = options.fetchNeighbors ?? defaultFetchNeighbors;
  }

  start(): void {
    this.unsubscribe = this.store.subscribe(() => this.sync());
    this.sync();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Re-evaluate what the active layer needs. Cheap + idempotent. */
  sync(): void {
    if (this.disposed) return;
    const s = this.store.getState();
    if (s.layer === 'links') return; // honesty: no entity work in links mode
    if (s.seq === 0) return; // no graph yet — wait for the first snapshot

    // Make sure the entity graph matches the current manifest seq. Skip a seq
    // already settled (a 404 must not re-fetch in a loop).
    if (s.entitySeq !== s.seq && this.resolvedGraphSeq !== s.seq && !this.fetchingGraph) {
      void this.loadGraph(s.entitySeq > 0, s.seq);
      return;
    }
    // Graph present + current → reconstruct grounding once per seq.
    if (s.entityGraph !== null && this.groundingSeq !== s.seq && !this.fetchingGrounding) {
      void this.loadGrounding(s.seq);
    }
  }

  private async loadGraph(bust: boolean, seq: number): Promise<void> {
    this.fetchingGraph = true;
    try {
      const res = await this.fetchGraph(bust, seq);
      if (this.disposed) return;
      this.resolvedGraphSeq = seq; // settle this seq either way — no re-fetch loop
      if (res.ok) {
        this.store.getState().ingestEntityGraph(res.graph, res.seq);
        this.sync(); // now pull grounding
      } else {
        this.store.getState().setEntityUnavailable(); // 404 → no T3 export: degrade
      }
    } catch {
      // transient — leave the seq unsettled; a later store change re-syncs
    } finally {
      this.fetchingGraph = false;
    }
  }

  private async loadGrounding(seq: number): Promise<void> {
    this.fetchingGrounding = true;
    this.groundingSeq = seq; // optimistic: don't re-enter for this seq
    try {
      const s = this.store.getState();
      const view = budgetedGraph(s.nodes, s.edges, s.seq, s.nodeBudget, s.expandedDirs);
      const docs = view.renderNodes
        .filter((n) => !isClusterId(n.id) && !n.reserved)
        .map((n) => n.id)
        .slice(0, GROUNDING_DOC_CAP);

      const grounding = new Map<string, string[]>();
      await this.pool(docs, async (doc) => {
        const res = await this.fetchNeighbors(doc, 'entities', 1);
        if (!res) return;
        for (const node of res.nodes) {
          const id = node['id'];
          const sourceDocs = node['source_docs'];
          if (typeof id === 'string' && Array.isArray(sourceDocs)) {
            grounding.set(id, sourceDocs.filter((d): d is string => typeof d === 'string'));
          }
        }
      });
      if (this.disposed) return;
      if (grounding.size > 0) this.store.getState().ingestGrounding(grounding);
    } catch {
      this.groundingSeq = -1; // let a later sync retry
    } finally {
      this.fetchingGrounding = false;
    }
  }

  /** Run `task` over `items` with a fixed concurrency ceiling. */
  private async pool<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const n = Math.min(GROUNDING_CONCURRENCY, items.length);
    for (let w = 0; w < n; w++) {
      workers.push(
        (async () => {
          while (cursor < items.length && !this.disposed) {
            const item = items[cursor++];
            if (item !== undefined) await task(item);
          }
        })(),
      );
    }
    await Promise.all(workers);
  }
}
