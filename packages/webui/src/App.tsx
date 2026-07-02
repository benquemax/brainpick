import { useEffect, useState } from 'react';
import { CosmosCanvas } from './scene/CosmosCanvas';
import type { GraphRuntime } from './scene/runtime';
import { uiStore } from './state/store';
import { DocPanel } from './ui/DocPanel';
import { SearchOverlay } from './ui/SearchOverlay';
import { StatusHUD } from './ui/StatusHUD';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function App({ runtime }: { runtime: GraphRuntime }) {
  const [labelContainer, setLabelContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        uiStore.getState().openSearch();
      } else if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        const s = uiStore.getState();
        if (s.searchOpen || s.searchHits.length > 0) s.clearSearch();
        else if (s.selection !== null) s.select(null);
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
      <SearchOverlay />
      <DocPanel />
      <div className="hint-bar">
        <kbd>/</kbd> search · drag to pan · wheel / pinch to zoom · click a node to read
      </div>
    </div>
  );
}
