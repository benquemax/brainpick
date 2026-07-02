/**
 * Search overlay (keyboard: `/` opens, Esc clears). Debounced
 * GET /api/search; hovering a hit highlights its node and flies the camera
 * (preview); Enter focuses the active (default: top) hit; clicking a row
 * does the same.
 */
import { useEffect, useRef } from 'react';
import { fetchSearch } from '../live/api';
import { useUI, uiStore } from '../state/store';

const DEBOUNCE_MS = 180;

export function SearchOverlay() {
  const open = useUI((s) => s.searchOpen);
  const query = useUI((s) => s.searchQuery);
  const hits = useUI((s) => s.searchHits);
  const active = useUI((s) => s.searchActive);

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

  const runSearch = (q: string) => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      abort.current?.abort();
      if (q.trim() === '') {
        uiStore.getState().setSearchHits([]);
        return;
      }
      const controller = new AbortController();
      abort.current = controller;
      fetchSearch(q, 12, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) uiStore.getState().setSearchHits(res.hits);
        })
        .catch(() => {
          /* aborted or offline — keep previous hits */
        });
    }, DEBOUNCE_MS);
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
