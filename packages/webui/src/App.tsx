import { useEffect, useState } from 'react';
import { CosmosCanvas } from './scene/CosmosCanvas';
import type { GraphRuntime } from './scene/runtime';
import type { GraphLayer } from './graph/entities';
import { uiStore, useUI } from './state/store';
import { CameraCluster } from './ui/CameraCluster';
import { DocPanel } from './ui/DocPanel';
import { EntityPanel } from './ui/EntityPanel';
import { LayerToggle } from './ui/LayerToggle';
import { LensCluster } from './ui/LensCluster';
import { NavigatorPanel } from './ui/NavigatorPanel';
import { SearchOverlay } from './ui/SearchOverlay';
import { StatusHUD } from './ui/StatusHUD';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** Physical digit for game-style bindings (Shift+1 must still read as 1). */
function digitOf(code: string): number | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return m && m[1] !== undefined ? Number(m[1]) : null;
}

export function App({ runtime }: { runtime: GraphRuntime }) {
  const [labelContainer, setLabelContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = uiStore.getState();
      const digit = digitOf(e.code);
      if (e.key === '/') {
        e.preventDefault();
        s.openSearch();
      } else if (e.key === 'Escape') {
        if (s.hudPanel !== null) s.setHudPanel(null);
        else if (s.searchOpen || s.searchHits.length > 0) s.clearSearch();
        else if (s.lens.kind !== 'none') s.clearLens();
        else if (s.selection !== null) s.select(null);
        else if (s.navigatorOpen) s.toggleNavigator();
      } else if (s.searchOpen) {
        // While the search overlay is up, letters/digits belong to the query
        // (even if focus briefly sits on a mode button) — no camera hotkeys.
        return;
      } else if (digit === 0 || e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        s.requestOverview();
      } else if (digit !== null && digit >= 1 && digit <= 3) {
        e.preventDefault();
        if (e.shiftKey) s.requestBookmarkSave(digit - 1);
        else s.recallBookmark(digit - 1);
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        s.toggleGhosts();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        s.toggleNavigator();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        // Cycle links → entities → overlay, skipping the entity layers once a
        // 404 has proven T3 absent (setLayer also guards this).
        const order: GraphLayer[] = s.entityAvailability === 'unavailable' ? ['links'] : ['links', 'entities', 'overlay'];
        const next = order[(order.indexOf(s.layer) + 1) % order.length] ?? 'links';
        s.setLayer(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <CosmosCanvas runtime={runtime} labelContainer={labelContainer} />
      <div className="labels-layer" ref={setLabelContainer} />
      <StatusHUD />
      <LayerToggle />
      <SearchButton />
      <SearchOverlay />
      <DocPanel />
      <EntityPanel />
      <NavigatorPanel />
      <LensCluster />
      <CameraCluster />
      <div className="hint-bar">
        <kbd>/</kbd> search · <kbd>n</kbd> tree · <kbd>l</kbd> layer · <kbd>0</kbd> overview · <kbd>1–3</kbd> views (
        <kbd>shift</kbd> saves) · <kbd>g</kbd> ghosts · click a node to read
      </div>
    </div>
  );
}

/** Visible entry point for search — the only way in on touch devices. */
function SearchButton() {
  const searchOpen = useUI((s) => s.searchOpen);
  if (searchOpen) return null; // the overlay takes its spot
  return (
    <button
      type="button"
      className="search-fab"
      title="search the brain (/)"
      onClick={() => uiStore.getState().openSearch()}
    >
      <span className="search-fab-glyph">⌕</span>
      <span className="search-fab-label">search</span>
      <kbd>/</kbd>
    </button>
  );
}
