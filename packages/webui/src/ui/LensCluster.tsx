/**
 * LENSES cluster (bottom-left HUD): tag lens (flyout), orphan lens and the
 * ghost-edges layer toggle. A lens highlights its node set and dims the rest
 * of the cosmos — same emphasis path as search. Every control is a visible,
 * labelled button (tooltips + keys); nothing hides behind gestures.
 */
import { useUI, uiStore } from '../state/store';

export function LensCluster() {
  const lens = useUI((s) => s.lens);
  const showGhosts = useUI((s) => s.showGhosts);
  const ghostCount = useUI((s) => s.stats?.ghosts ?? 0);
  const tags = useUI((s) => s.tags);
  const panelOpen = useUI((s) => s.hudPanel === 'tags');

  const tagNames = Object.keys(tags).sort();
  const activeTag = lens.kind === 'tag' ? lens.tag : null;

  return (
    <div className="hud-cluster lens-cluster">
      {panelOpen && (
        <div className="hud-flyout panel" role="menu" aria-label="tag lens">
          <div className="flyout-title">tag lens</div>
          {tagNames.length === 0 && <div className="flyout-empty">no tags in this brain</div>}
          <ul>
            {tagNames.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={tag === activeTag}
                  className={`flyout-item ${tag === activeTag ? 'active' : ''}`}
                  onClick={() => uiStore.getState().toggleLens({ kind: 'tag', tag })}
                >
                  <span className="flyout-tag">#{tag}</span>
                  <span className="flyout-count">{tags[tag]?.length ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
          {activeTag !== null && (
            <button type="button" className="flyout-clear" onClick={() => uiStore.getState().clearLens()}>
              clear lens
            </button>
          )}
        </div>
      )}
      <div className="cluster-frame panel">
        <div className="cluster-title">lenses</div>
        <div className="cluster-buttons">
          <button
            type="button"
            className={`hud-btn ${activeTag !== null ? 'active' : ''} ${panelOpen ? 'open' : ''}`}
            aria-pressed={activeTag !== null}
            aria-expanded={panelOpen}
            title="tag lens — highlight one tag, dim the rest"
            onClick={() => uiStore.getState().setHudPanel(panelOpen ? null : 'tags')}
          >
            <span className="hud-btn-glyph">◈</span>
            <span className="hud-btn-label">{activeTag !== null ? `#${activeTag}` : 'tags'}</span>
          </button>
          <button
            type="button"
            className={`hud-btn ${lens.kind === 'orphans' ? 'active' : ''}`}
            aria-pressed={lens.kind === 'orphans'}
            title="orphan lens — docs nothing links to"
            onClick={() => uiStore.getState().toggleLens({ kind: 'orphans' })}
          >
            <span className="hud-btn-glyph">◌</span>
            <span className="hud-btn-label">orphans</span>
          </button>
          <button
            type="button"
            className={`hud-btn ${showGhosts ? 'active' : ''}`}
            aria-pressed={showGhosts}
            title="ghost links — dashed trails to missing documents (G)"
            onClick={() => uiStore.getState().toggleGhosts()}
          >
            <span className="hud-btn-glyph">⌁</span>
            <span className="hud-btn-label">
              ghosts{ghostCount > 0 ? ` ${ghostCount}` : ''}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
