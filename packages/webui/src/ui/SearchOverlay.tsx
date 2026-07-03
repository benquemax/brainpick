/**
 * Search overlay (keyboard: `/` opens, Esc clears). Debounced
 * GET /api/search with a mode switch (auto/keyword/semantic; graph waits for
 * T3). Honest state: when the server degraded the answer, a chip says so.
 * Hovering a hit highlights its node and flies the camera (preview); Enter
 * focuses the active (default: top) hit; clicking a row does the same.
 */
import { useEffect, useRef } from 'react';
import type { SearchMode } from '../graph/types';
import { SEARCH_MODES } from '../graph/types';
import { fetchSearch } from '../live/api';
import { useUI, uiStore } from '../state/store';

const DEBOUNCE_MS = 180;

const MODE_LABEL: Record<SearchMode, string> = {
  auto: 'auto',
  keyword: 'keyword',
  semantic: 'semantic',
  graph: 'graph',
};

const MODE_TITLE: Record<SearchMode, string> = {
  auto: 'auto — fuse every available retriever',
  keyword: 'keyword — exact words',
  semantic: 'semantic — meaning over words (T2 vectors)',
  graph: 'graph — entity walk, lands with T3',
};

/** Modes the UI lets you request today; graph stays visible but disabled. */
const ENABLED_MODES: readonly SearchMode[] = ['auto', 'keyword', 'semantic'];

export function SearchOverlay() {
  const open = useUI((s) => s.searchOpen);
  const query = useUI((s) => s.searchQuery);
  const mode = useUI((s) => s.searchMode);
  const hits = useUI((s) => s.searchHits);
  const active = useUI((s) => s.searchActive);
  const meta = useUI((s) => s.searchMeta);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(
    () => () => {
      if (debounce.current !== null) clearTimeout(debounce.current);
      abort.current?.abort();
    },
    [],
  );

  if (!open) return null;

  const fireSearch = (q: string) => {
    abort.current?.abort();
    if (q.trim() === '') {
      uiStore.getState().setSearchHits([]);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    fetchSearch(q, uiStore.getState().searchMode, 12, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          uiStore.getState().setSearchHits(res.hits, {
            usedModes: res.used_modes,
            degradedFrom: res.degraded_from,
          });
        }
      })
      .catch(() => {
        /* aborted or offline — keep previous hits */
      });
  };

  const runSearch = (q: string) => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fireSearch(q), DEBOUNCE_MS);
  };

  const switchMode = (next: SearchMode, refocusInput = false) => {
    // Refocus BEFORE the guard: even a click on the already-active mode
    // should hand the keyboard back to the query.
    if (refocusInput) inputRef.current?.focus();
    if (!ENABLED_MODES.includes(next) || next === uiStore.getState().searchMode) return;
    uiStore.getState().setSearchMode(next);
    if (debounce.current !== null) clearTimeout(debounce.current);
    fireSearch(uiStore.getState().searchQuery); // a mode switch answers immediately
  };

  const stepMode = (dir: 1 | -1) => {
    const i = ENABLED_MODES.indexOf(mode);
    const next = ENABLED_MODES[(i + dir + ENABLED_MODES.length) % ENABLED_MODES.length];
    if (next) switchMode(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const s = uiStore.getState();
    if (e.key === 'Escape') {
      e.preventDefault();
      s.clearSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length > 0) s.setSearchActive((active + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length > 0) s.setSearchActive((active - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) s.focusHit(hit.path);
    }
  };

  const onModeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepMode(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepMode(-1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      uiStore.getState().clearSearch();
    }
  };

  return (
    <div className="search-overlay" role="dialog" aria-label="search">
      <div className="search-box panel">
        <span className="search-glyph">⌕</span>
        <input
          ref={inputRef}
          value={query}
          placeholder="search the brain…"
          spellCheck={false}
          onChange={(e) => {
            uiStore.getState().setSearchQuery(e.target.value);
            runSearch(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="search-modes panel"
        role="radiogroup"
        aria-label="search mode"
        onKeyDown={onModeKeyDown}
      >
        {SEARCH_MODES.map((m) => {
          const enabled = ENABLED_MODES.includes(m);
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              className={`mode-btn ${m === mode ? 'active' : ''}`}
              disabled={!enabled}
              tabIndex={m === mode ? 0 : -1}
              title={MODE_TITLE[m]}
              onClick={() => switchMode(m, true)}
            >
              {MODE_LABEL[m]}
              {!enabled && <span className="mode-soon">T3 — coming</span>}
            </button>
          );
        })}
      </div>
      {meta?.degradedFrom != null && (
        <div className="degraded-chip" role="status">
          {meta.degradedFrom} unavailable — {meta.usedModes.join(' + ')} answered
        </div>
      )}
      {hits.length > 0 && (
        <ul className="search-hits panel">
          {hits.map((hit, i) => (
            <li
              key={hit.path}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => {
                uiStore.getState().setSearchActive(i);
                uiStore.getState().previewNode(hit.path);
              }}
              onClick={() => uiStore.getState().focusHit(hit.path)}
            >
              <div className="hit-head">
                <span className="hit-title">{hit.title}</span>
                <span className="hit-source" title={`answered by ${hit.source}`}>
                  {hit.source}
                </span>
                <span className="hit-score">{hit.score.toFixed(2)}</span>
              </div>
              {hit.description !== null && hit.description !== '' && (
                <div className="hit-desc">{hit.description}</div>
              )}
              {hit.snippet !== null && hit.snippet !== '' && <div className="hit-snippet">{hit.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
      {hits.length === 0 && query.trim() !== '' && <div className="search-empty panel">no hits</div>}
    </div>
  );
}
