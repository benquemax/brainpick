/**
 * The timeline fetch orchestrator — the Time Machine's twin of live/entities.ts.
 *
 * It pulls GET /api/timeline once at start and again whenever the manifest seq
 * moves (a compile that earns a timeline entry necessarily bumps the seq, per
 * spec/90), so the brain's history stays current through a live session. The
 * timeline is advisory and cheap to fetch; a non-repo bundle serves the empty
 * shape and the feature simply hides.
 */
import type { UIStoreApi } from '../state/store';
import { fetchTimeline as defaultFetchTimeline } from './api';
import type { Timeline } from '../time/timeline';

export interface TimelineControllerOptions {
  store: UIStoreApi;
  fetchTimeline?: (bustCache: boolean) => Promise<Timeline>;
}

export class TimelineController {
  private readonly store: UIStoreApi;
  private readonly fetchTimeline: NonNullable<TimelineControllerOptions['fetchTimeline']>;

  private unsubscribe: (() => void) | null = null;
  private fetchedSeq = -1;
  private fetching = false;
  private disposed = false;

  constructor(options: TimelineControllerOptions) {
    this.store = options.store;
    this.fetchTimeline = options.fetchTimeline ?? defaultFetchTimeline;
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

  /** Fetch the timeline for the current seq if we have not already. */
  sync(): void {
    if (this.disposed || this.fetching) return;
    const s = this.store.getState();
    if (s.seq === 0) return; // no graph yet — the first snapshot brings a seq
    if (this.fetchedSeq === s.seq) return;
    void this.load(s.seq);
  }

  private async load(seq: number): Promise<void> {
    this.fetching = true;
    try {
      const timeline = await this.fetchTimeline(this.fetchedSeq >= 0);
      if (this.disposed) return;
      this.fetchedSeq = seq;
      this.store.getState().ingestTimeline(timeline);
    } catch {
      // transient — leave fetchedSeq unset so a later store change retries
    } finally {
      this.fetching = false;
    }
  }
}
