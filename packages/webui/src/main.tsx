import { createRoot } from 'react-dom/client';
import { App } from './App';
import { fetchGraph } from './live/api';
import { LiveConnection } from './live/connection';
import { detectGpuTier, readGpuInputs } from './scene/gpuTier';
import { GraphRuntime } from './scene/runtime';
import { uiStore } from './state/store';
import './styles.css';

// Detect the GPU tier once, up front, so the very first render already uses
// the right node budget, DPR cap and bloom setting (no post-hoc reflow).
uiStore.getState().initGpu(detectGpuTier(readGpuInputs()));

// Initial load: pull the current snapshot immediately (fast first paint);
// the live connection re-verifies seq via `hello` and resyncs as needed.
void fetchGraph(false, 0)
  .then(({ graph, seq }) => {
    if (uiStore.getState().seq === 0) uiStore.getState().ingestSnapshot(graph, seq);
  })
  .catch(() => {
    /* server not up yet — the SSE reconnect loop keeps trying */
  });

const connection = new LiveConnection({ store: uiStore, fetchGraph });
connection.start();

// PWA: mobile radios drop SSE aggressively — reconnect when we come back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') connection.pokeVisible();
});

const runtime = new GraphRuntime(uiStore);

// Deterministic hook for e2e assertions (and console debugging): the store
// is the single source of truth, so tests read state instead of pixels.
declare global {
  interface Window {
    __bp_store: typeof uiStore;
  }
}
window.__bp_store = uiStore;

createRoot(document.getElementById('root') as HTMLElement).render(<App runtime={runtime} />);

// Service worker (vite-plugin-pwa): precached shell + offline graph snapshot.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
