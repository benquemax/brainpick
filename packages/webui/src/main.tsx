import { createRoot } from 'react-dom/client';
import { App } from './App';
import { fetchGraph, fetchStatus, writesEnabledFromStatus } from './live/api';
import { IS_STATIC } from './live/staticMode';
import { LiveConnection } from './live/connection';
import { startUrlSync, urlPinsMode } from './live/urlSync';
import { EntityLayerController } from './live/entities';
import { TimelineController } from './live/timeline';
import { detectGpuTier, isMobileViewport, readGpuInputs } from './scene/gpuTier';
import { GraphRuntime } from './scene/runtime';
import { uiStore } from './state/store';
import { parseDeepLink } from './time/timeline';
import './styles.css';

// Detect the GPU tier once, up front, so the very first render already uses
// the right node budget, DPR cap and bloom setting (no post-hoc reflow).
uiStore.getState().initGpu(detectGpuTier(readGpuInputs()));

// Shareable view URLs: apply a shared link's view to the store, then keep the
// address bar mirroring the current view (the single query-string writer).
const modePinned = urlPinsMode(window.location.search);
startUrlSync({ store: uiStore });

let connection: LiveConnection | null = null;

if (IS_STATIC) {
  // Static export (staticMode.ts): no SSE exists, so the baked /api/status
  // plays `hello` — it must land BEFORE the graph so tiers and seq are real
  // (a static server's ETag carries no seq, and without a seq the entity
  // layer and the Time Machine would silently never sync).
  void fetchStatus().then((status) => {
    const s = uiStore.getState();
    s.enterSnapshotMode(status?.tiers ?? null, status?.seq ?? 1);
    s.setWritesEnabled(writesEnabledFromStatus(status));
    s.applyServerUi(status?.ui ?? null, { isMobile: isMobileViewport(), modePinned });
    return fetchGraph(false, status?.seq ?? 1).then(({ graph, seq }) => {
      if (uiStore.getState().seq === 0) uiStore.getState().ingestSnapshot(graph, seq);
    });
  });
} else {
  // Initial load: pull the current snapshot immediately (fast first paint);
  // the live connection re-verifies seq via `hello` and resyncs as needed.
  void fetchGraph(false, 0)
    .then(({ graph, seq }) => {
      if (uiStore.getState().seq === 0) uiStore.getState().ingestSnapshot(graph, seq);
    })
    .catch(() => {
      /* server not up yet — the SSE reconnect loop keeps trying */
    });

  // GET /api/status (spec/50) carries two client policies at boot:
  //  - writes: whether the in-browser editor's save path is open (Edit / New show).
  //  - ui: the operator's [ui] block (spec/80) — the mobile node cap (preferred over
  //    the GPU-tier guess) and the opening view (cosmos / brain), applied here so the
  //    client stops guessing from the device alone.
  void fetchStatus().then((status) => {
    const s = uiStore.getState();
    s.setWritesEnabled(writesEnabledFromStatus(status));
    s.applyServerUi(status?.ui ?? null, { isMobile: isMobileViewport(), modePinned });
  });

  connection = new LiveConnection({ store: uiStore, fetchGraph });
  connection.start();
}

// The T3 entity layer fetches lazily — only once the entity/overlay layer is
// picked (links mode stays byte-for-byte the doc graph).
const entityLayer = new EntityLayerController({ store: uiStore });
entityLayer.start();

// The TIME MACHINE's git-history timeline (spec/90): fetched at startup and on
// every seq change. A non-repo bundle serves the empty shape and the feature hides.
const timelineController = new TimelineController({ store: uiStore });
timelineController.start();

// Deep-link a moment (?t=<iso> / ?commit=<sha>): the first time a timeline WITH
// history lands, open the Time Machine at that moment so a shared URL restores it.
// The initial query is captured ONCE so the scrubber's own URL rewrites can never
// feed back here, and the listener detaches BEFORE mutating (enterTimeTravel is a
// store write that would otherwise re-enter this very subscriber).
const initialSearch = window.location.search;
const applyDeepLink = (): boolean => {
  const moment = parseDeepLink(initialSearch, uiStore.getState().timeline);
  if (!moment) return false;
  uiStore.getState().enterTimeTravel(moment.index);
  return true;
};
if (parseDeepLink(initialSearch, uiStore.getState().timeline) === null) {
  const unsubDeepLink = uiStore.subscribe(() => {
    if (parseDeepLink(initialSearch, uiStore.getState().timeline) === null) return;
    unsubDeepLink();
    applyDeepLink();
  });
} else {
  applyDeepLink();
}

// PWA: mobile radios drop SSE aggressively — reconnect when we come back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') connection?.pokeVisible();
});

const runtime = new GraphRuntime(uiStore);

// Deterministic hook for e2e assertions (and console debugging): the store
// is the single source of truth, so tests read state instead of pixels. The
// runtime is exposed too so a test can assert the ACTUAL rendered set (e.g.
// that the entity layer draws entity render-nodes, not docs).
declare global {
  interface Window {
    __bp_store: typeof uiStore;
    __bp_runtime: GraphRuntime;
  }
}
window.__bp_store = uiStore;
window.__bp_runtime = runtime;

createRoot(document.getElementById('root') as HTMLElement).render(<App runtime={runtime} />);

// Service worker (vite-plugin-pwa): precached shell + offline graph snapshot.
// Static exports build without the PWA plugin — a demo page must not install
// a caching worker (and the virtual module does not exist in that build).
if (import.meta.env.PROD && !IS_STATIC && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
