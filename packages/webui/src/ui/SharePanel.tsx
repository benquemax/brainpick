/**
 * SHARE (bottom-right HUD, beside the views cluster): turn the current view
 * into a link. The address bar already IS the sender's view (live/urlSync.ts);
 * this panel adds control — every dimension of the view is a checkbox, all
 * checked by default (= exactly what the sender sees), and unchecking one
 * drops its param so the recipient gets their own default for it. The link
 * preview updates live; copy lands it on the clipboard with a toast.
 */
import { useState } from 'react';
import { commitAt } from '../time/timeline';
import { filterShareParams, serializeViewState } from '../state/urlState';
import { uiStore, useUI } from '../state/store';

interface ShareDimension {
  key: string;
  label: string;
}

export function SharePanel() {
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  const selection = useUI((s) => s.selection);
  const mode = useUI((s) => s.mode);
  const layer = useUI((s) => s.layer);
  const lens = useUI((s) => s.lens);
  const showGhosts = useUI((s) => s.showGhosts);
  const timeTravel = useUI((s) => s.timeTravel);
  const scrubIndex = useUI((s) => s.scrubIndex);
  const timeline = useUI((s) => s.timeline);

  const momentSha = timeTravel ? (commitAt(timeline, Math.round(scrubIndex))?.sha ?? null) : null;
  const fullQuery = serializeViewState({ selection, mode, layer, lens, showGhosts, momentSha });

  // Only dimensions PRESENT in the current view are offered — a default
  // carries no param, so there is nothing to include or exclude.
  const dimensions: ShareDimension[] = [
    ...(selection !== null ? [{ key: 'doc', label: `node · ${selection}` }] : []),
    { key: 'view', label: `view · ${mode}` },
    ...(layer !== 'links' ? [{ key: 'layer', label: `layer · ${layer}` }] : []),
    ...(lens.kind !== 'none'
      ? [{ key: 'lens', label: `lens · ${lens.kind === 'tag' ? `tag ${lens.tag}` : lens.kind === 'about' ? `about ${lens.about}` : 'orphans'}` }]
      : []),
    ...(!showGhosts ? [{ key: 'ghosts', label: 'ghosts · hidden' }] : []),
    ...(momentSha !== null ? [{ key: 'commit', label: `moment · ${momentSha.slice(0, 8)}` }] : []),
  ];

  const included = new Set(dimensions.map((d) => d.key).filter((k) => !excluded.has(k)));
  const query = filterShareParams(fullQuery, included);
  const url = window.location.origin + window.location.pathname + query + window.location.hash;

  const toggle = (key: string) => {
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExcluded(next);
  };

  const copy = () => {
    void navigator.clipboard
      .writeText(url)
      .then(() => uiStore.getState().showToast('link copied'))
      .catch(() => uiStore.getState().showToast('could not reach the clipboard', 'error'));
  };

  return (
    <div className="hud-cluster share-cluster">
      <div className="cluster-frame panel">
        <div className="cluster-title">share</div>
        <div className="cluster-buttons">
          <button
            type="button"
            className="hud-btn"
            title="share this view as a link"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="hud-btn-glyph">⎘</span>
            <span className="hud-btn-label">link</span>
          </button>
        </div>
        {open && (
          <div className="share-pop panel" role="dialog" aria-label="share this view">
            {dimensions.map((d) => (
              <label key={d.key} className="share-dim">
                <input type="checkbox" checked={!excluded.has(d.key)} onChange={() => toggle(d.key)} />
                <span>{d.label}</span>
              </label>
            ))}
            <input className="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="hud-btn share-copy" onClick={copy}>
              copy link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
