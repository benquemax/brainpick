/**
 * The address bar as shared state — the ONE writer of the view query string.
 *
 * At boot, a shared link's params (state/urlState.ts) apply to the store:
 * view/layer/lens/ghosts immediately, the doc selection as soon as the graph
 * snapshot lands (and only if the user has not selected something first —
 * the link must never steal a click). From then on the store mirrors back
 * into the URL via history.replaceState — including the time machine's
 * ?commit=, which used to be written by TimeMachine.tsx directly; two
 * writers would fight over one query string, so it moved here.
 *
 * Writing starts only once a snapshot is in (seq > 0): before that the page
 * is still becoming the view a link would promise. ?commit=/?t= deep links
 * keep their existing reader (main.tsx parseDeepLink over the captured
 * initial search) — this module only ever REwrites the bar.
 */
import { commitAt } from '../time/timeline';
import { parseViewParams, serializeViewState } from '../state/urlState';
import type { UIStoreApi } from '../state/store';

export interface UrlSyncOptions {
  store: UIStoreApi;
  location?: { search: string; pathname: string; hash: string };
  history?: { replaceState(data: unknown, unused: string, url: string): void };
}

/** Start the boot-apply + mirror loop. Returns a disposer. */
export function startUrlSync(options: UrlSyncOptions): () => void {
  const store = options.store;
  const location = options.location ?? window.location;
  const history = options.history ?? window.history;
  const params = parseViewParams(location.search);

  const s = store.getState();
  if (params.view !== undefined && params.view !== s.mode) s.setMode(params.view);
  if (params.layer !== undefined && params.layer !== s.layer) s.setLayer(params.layer);
  if (params.lens !== undefined && params.lens.kind !== 'none') s.toggleLens(params.lens);
  if (params.showGhosts !== undefined && params.showGhosts !== s.showGhosts) s.toggleGhosts();

  // The linked doc can only be selected once it exists; a selection the user
  // makes in the meantime wins and retires the link's claim.
  let pendingDoc = params.doc ?? null;
  let lastWritten: string | null = null;

  const sync = () => {
    const state = store.getState();
    if (pendingDoc !== null) {
      if (state.selection !== null) {
        pendingDoc = null; // the user chose — the link yields
      } else if (state.nodes.has(pendingDoc)) {
        const doc = pendingDoc;
        pendingDoc = null;
        state.select(doc);
        return; // select() re-enters this subscriber with the new state
      }
    }
    if (state.seq === 0) return; // nothing worth linking yet
    const momentSha = state.timeTravel
      ? (commitAt(state.timeline, Math.round(state.scrubIndex))?.sha ?? null)
      : null;
    const query = serializeViewState({
      selection: state.selection,
      mode: state.mode,
      layer: state.layer,
      lens: state.lens,
      showGhosts: state.showGhosts,
      momentSha,
    });
    if (query === lastWritten) return;
    lastWritten = query;
    history.replaceState(null, '', location.pathname + query + location.hash);
  };

  const unsubscribe = store.subscribe(sync);
  sync();
  return unsubscribe;
}

/** Did the initial URL pin a view mode? (applyServerUi's modePinned input.) */
export function urlPinsMode(search: string): boolean {
  return parseViewParams(search).view !== undefined;
}
