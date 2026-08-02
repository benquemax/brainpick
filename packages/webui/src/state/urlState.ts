/**
 * Shareable view URLs (the address bar as state). One module owns the query
 * string: serializeViewState renders the sender's whole view — selected doc,
 * view mode, layer, lens, ghost toggle, time-machine moment — and
 * parseViewParams restores it tolerantly on the receiving end. Pure string
 * functions; the boot/subscribe wiring lives in live/urlSync.ts.
 *
 * The view mode is ALWAYS serialized: defaults differ per device (mobile
 * opens the brain), and a link is only a link if it replicates. Everything
 * else is omitted at its default so casual URLs stay short. ?commit=/?t=
 * remain the time machine's deep-link vocabulary (time/timeline.ts
 * parseDeepLink); the serializer emits commit, the parser leaves both alone.
 */
import type { GraphLayer } from '../graph/entities';
import { NO_LENS, type Lens } from './lens';
import type { ViewMode } from './store';

export interface ViewStateInput {
  selection: string | null;
  mode: ViewMode;
  layer: GraphLayer;
  lens: Lens;
  showGhosts: boolean;
  /** The rounded scrub station's commit sha while time-travelling, else null. */
  momentSha: string | null;
}

export interface ViewParams {
  doc?: string;
  view?: ViewMode;
  layer?: GraphLayer;
  lens?: Lens;
  showGhosts?: boolean;
}

const VIEWS: readonly ViewMode[] = ['cosmos', 'brain'];
const LAYERS: readonly GraphLayer[] = ['links', 'entities', 'overlay'];

/** Render the canonical query string for a view ('?…', never empty). */
export function serializeViewState(s: ViewStateInput): string {
  const q = new URLSearchParams();
  if (s.selection !== null) q.set('doc', s.selection);
  q.set('view', s.mode);
  if (s.layer !== 'links') q.set('layer', s.layer);
  if (s.lens.kind !== 'none') {
    q.set(
      'lens',
      s.lens.kind === 'tag' ? `tag:${s.lens.tag}` : s.lens.kind === 'about' ? `about:${s.lens.about}` : 'orphans',
    );
  }
  if (!s.showGhosts) q.set('ghosts', '0');
  if (s.momentSha !== null) q.set('commit', s.momentSha);
  return `?${q.toString()}`;
}

/**
 * The share button's parameter control: keep only the chosen params of a
 * serialized view. An unchecked dimension is dropped so the recipient gets
 * their own default for it. Returns '' when nothing is kept (a bare link).
 */
export function filterShareParams(query: string, include: ReadonlySet<string>): string {
  const q = new URLSearchParams(query);
  for (const key of [...q.keys()]) {
    if (!include.has(key)) q.delete(key);
  }
  const out = q.toString();
  return out === '' ? '' : `?${out}`;
}

function parseLens(raw: string): Lens | null {
  if (raw === 'orphans') return { kind: 'orphans' };
  if (raw.startsWith('tag:') && raw.length > 4) return { kind: 'tag', tag: raw.slice(4) };
  if (raw.startsWith('about:') && raw.length > 6) return { kind: 'about', about: raw.slice(6) };
  return null;
}

/** Read a shared view out of a query string; junk values are dropped, not imported. */
export function parseViewParams(search: string): ViewParams {
  const q = new URLSearchParams(search);
  const out: ViewParams = {};
  const doc = q.get('doc');
  if (doc !== null && doc !== '') out.doc = doc;
  const view = q.get('view');
  if (view !== null && (VIEWS as readonly string[]).includes(view)) out.view = view as ViewMode;
  const layer = q.get('layer');
  if (layer !== null && (LAYERS as readonly string[]).includes(layer)) out.layer = layer as GraphLayer;
  const lensRaw = q.get('lens');
  if (lensRaw !== null) {
    const lens = parseLens(lensRaw);
    if (lens !== null && lens.kind !== NO_LENS.kind) out.lens = lens;
  }
  const ghosts = q.get('ghosts');
  if (ghosts === '0') out.showGhosts = false;
  else if (ghosts === '1') out.showGhosts = true;
  return out;
}
