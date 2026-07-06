/**
 * THE TIME MACHINE (spec/90) — travel through the brain's git history.
 *
 * A time bar (bottom-centre, above the mode pill) with a commit tick for every
 * point in history, a draggable handle (mouse + touch), a play/pause button that
 * runs the growth movie, and a time readout styled like a machine display. The
 * scene (both the flat cosmos and the hologram) reconstructs the graph at the
 * scrub position — nodes fade/pop in at their birth commit, edges fire as they
 * form — so scrubbing back SHRINKS the brain to its younger self and forward GROWS
 * it. When the bundle has no git history the whole control hides (spec/90).
 *
 * Around the scene it lays a calm OSX-Time-Machine depth: a cool time-fog that
 * deepens the further back you travel, and a drifting starfield you fly through.
 */
import { useEffect, useRef } from 'react';
import { uiStore, useUI } from '../state/store';
import { TIME_MACHINE } from '../scene/tuning';
import { commitAt, hasHistory, momentQuery } from '../time/timeline';

/** A compact UTC readout: "2026-07-04 · 14:03". */
function formatMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} · ${p(d.getUTCHours())}:${p(
    d.getUTCMinutes(),
  )}`;
}

export function TimeMachine() {
  const timeline = useUI((s) => s.timeline);
  const timeTravel = useUI((s) => s.timeTravel);
  const timeTravelActive = useUI((s) => s.timeTravelActive);
  const scrubIndex = useUI((s) => s.scrubIndex);
  const playing = useUI((s) => s.playing);

  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const everActive = useRef(false); // so we only clear the URL AFTER a real visit

  const commits = timeline.commits;
  const count = commits.length;
  const last = Math.max(1, count - 1); // avoid /0 on a single-commit history
  const history = hasHistory(timeline);

  // Keep the address bar shareable: reflect the current commit as ?commit=<sha>.
  const rounded = Math.round(scrubIndex);
  useEffect(() => {
    if (!timeTravel || !history) return;
    const query = momentQuery(timeline, rounded);
    if (query) window.history.replaceState(null, '', query + window.location.hash);
    // rounded (not scrubIndex) so we only rewrite the URL once per commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounded, timeTravel, history]);

  // Clear the deep-link query on the way OUT — but only after a real visit, so a
  // ?t=/?commit= deep-link on first load survives long enough to be applied.
  useEffect(() => {
    if (timeTravelActive) everActive.current = true;
    else if (everActive.current && !timeTravel && window.location.search) {
      everActive.current = false;
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, [timeTravel, timeTravelActive]);

  if (!history) return null; // no git history → the Time Machine hides (spec/90)

  const current = commitAt(timeline, scrubIndex);
  const fraction = count <= 1 ? 1 : scrubIndex / last;

  const indexFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return scrubIndex;
    const rect = el.getBoundingClientRect();
    const frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(1, frac)) * last;
  };

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    uiStore.getState().setScrubIndex(indexFromClientX(e.clientX));
  };
  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    uiStore.getState().setScrubIndex(indexFromClientX(e.clientX));
  };
  const onTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <>
      {timeTravelActive && <TimeDepth />}

      {/* the entry pill — always available while there is history to travel */}
      <div className="hud-cluster time-cluster">
        <button
          type="button"
          className={`time-toggle ${timeTravel ? 'on' : ''}`}
          aria-pressed={timeTravel}
          aria-label={timeTravel ? 'exit time machine' : 'time machine'}
          title={
            timeTravel ? 'leave the time machine (t)' : 'travel the brain’s history — the Time Machine (t)'
          }
          onClick={() => uiStore.getState().toggleTimeTravel()}
        >
          <span className="time-glyph">◷</span>
          <span className="time-label">{timeTravel ? 'present' : 'time'}</span>
          <kbd>t</kbd>
        </button>
      </div>

      {timeTravel && (
        <div className="time-bar panel" role="group" aria-label="time machine">
          <div
            className="time-readout"
            title="Reconstructed from git history: nodes appear at the commit that created them. Links shown are the present graph's between nodes that both existed then — an honest approximation of past structure (spec/90)."
          >
            <span className="time-date">{current ? formatMoment(current.date) : '—'}</span>
            <span className="time-meta">
              <span className="time-count">
                {Math.min(count, rounded + 1)}/{count}
              </span>
              {current && <span className="time-sha">{current.sha}</span>}
            </span>
            <span className="time-msg" title={current?.message ?? ''}>
              {current?.message ?? ''}
            </span>
          </div>

          <div className="time-controls">
            <button
              type="button"
              className="time-step"
              aria-label="step back one commit"
              title="step back (←)"
              onClick={() => uiStore.getState().stepCommit(-1)}
            >
              ⏮
            </button>
            <button
              type="button"
              className={`time-play ${playing ? 'playing' : ''}`}
              aria-label={playing ? 'pause' : 'play'}
              title={playing ? 'pause the growth movie (space)' : 'play the growth movie (space)'}
              onClick={() => uiStore.getState().togglePlay()}
            >
              {playing ? '❙❙' : '▶'}
            </button>
            <button
              type="button"
              className="time-step"
              aria-label="step forward one commit"
              title="step forward (→)"
              onClick={() => uiStore.getState().stepCommit(1)}
            >
              ⏭
            </button>

            <div
              className="time-track"
              ref={trackRef}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerUp}
              role="slider"
              aria-label="scrub through history"
              aria-valuemin={0}
              aria-valuemax={last}
              aria-valuenow={Number(scrubIndex.toFixed(2))}
              aria-valuetext={current ? formatMoment(current.date) : undefined}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  uiStore.getState().stepCommit(-1);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  uiStore.getState().stepCommit(1);
                }
              }}
            >
              <div className="time-track-line" />
              <div className="time-track-fill" style={{ width: `${fraction * 100}%` }} />
              <TimeTicks count={count} last={last} activeIndex={rounded} />
              <div className="time-handle" style={{ left: `${fraction * 100}%` }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Commit stations along the track (thinned so a big history never crowds). */
function TimeTicks({ count, last, activeIndex }: { count: number; last: number; activeIndex: number }) {
  if (count <= 1) return null;
  const stride = Math.max(1, Math.ceil(count / 40)); // cap the drawn ticks
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i < count; i += stride) {
    ticks.push(
      <span
        key={i}
        className={`time-tick ${i === activeIndex ? 'active' : ''}`}
        style={{ left: `${(i / last) * 100}%` }}
      />,
    );
  }
  return <>{ticks}</>;
}

/**
 * The OSX-Time-Machine depth: a cool time-fog that deepens toward the past and a
 * drifting starfield we fly through. Pure DOM (over the canvas, under the HUD),
 * mode-agnostic and GPU-free — the depth cue without any bloom-soup.
 */
function TimeDepth() {
  const timeTravel = useUI((s) => s.timeTravel);
  const scrubIndex = useUI((s) => s.scrubIndex);
  const playing = useUI((s) => s.playing);
  const count = useUI((s) => s.timeline.commits.length);
  const last = Math.max(1, count - 1);
  // Deepest at the OLDEST commit (index 0), clear at the present (index last).
  const depth = count <= 1 ? 0 : 1 - scrubIndex / last;
  const fog = TIME_MACHINE.fogMaxOpacity * depth * (timeTravel ? 1 : 0);
  return (
    <div className={`time-depth ${timeTravel ? 'on' : ''} ${playing ? 'rushing' : ''}`} aria-hidden="true">
      <div className="time-stars" />
      <div className="time-fog" style={{ opacity: fog, ['--time-fog-tint' as string]: TIME_MACHINE.fogTint }} />
    </div>
  );
}
