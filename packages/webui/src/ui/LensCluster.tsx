/**
 * LENSES cluster (bottom-left HUD): tag lens (flyout), the ontology lens
 * (flyout — per-`about` toggles + a color/shape legend), orphan lens and the
 * ghost-edges layer toggle. A lens highlights its node set and dims the rest
 * of the cosmos — same emphasis path as search. Every control is a visible,
 * labelled button (tooltips + keys); nothing hides behind gestures.
 */
import { useMemo } from 'react';
import { useUI, uiStore } from '../state/store';
import { cssColorForAbout } from '../scene/colors';
import { ABOUT_COLOR, TYPE_SHAPE } from '../scene/tuning';

const ABOUT_VALUES = Object.keys(ABOUT_COLOR);

// Plural display labels — a naive `${about}s` suffix mangles "process".
const ABOUT_PLURAL: Record<string, string> = {
  place: 'places',
  process: 'processes',
  thing: 'things',
  concept: 'concepts',
  event: 'events',
  organization: 'organizations',
  person: 'persons',
};

// tuning.TYPE_SHAPE's own glyphs, for the legend half of the ontology flyout.
const SHAPE_GLYPH: Record<string, string> = {
  article: '●',
  decision: '▲',
  playbook: '■',
  reference: '⬟',
  log: '◎',
};
const SHAPE_VALUES = Object.keys(TYPE_SHAPE);

export function LensCluster() {
  const lens = useUI((s) => s.lens);
  const showGhosts = useUI((s) => s.showGhosts);
  const ghostCount = useUI((s) => s.stats?.ghosts ?? 0);
  const tags = useUI((s) => s.tags);
  const nodes = useUI((s) => s.nodes);
  const hudPanel = useUI((s) => s.hudPanel);
  const tagsOpen = hudPanel === 'tags';
  const ontologyOpen = hudPanel === 'ontology';

  const tagNames = Object.keys(tags).sort();
  const activeTag = lens.kind === 'tag' ? lens.tag : null;
  const activeAbout = lens.kind === 'about' ? lens.about : null;

  const aboutCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes.values()) {
      if (node.about) counts.set(node.about, (counts.get(node.about) ?? 0) + 1);
    }
    return counts;
  }, [nodes]);

  return (
    <div className="hud-cluster lens-cluster">
      {tagsOpen && (
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
      {ontologyOpen && (
        <div className="hud-flyout panel" role="menu" aria-label="ontology lens">
          <div className="flyout-title">ontology lens — about</div>
          <ul>
            {ABOUT_VALUES.map((about) => (
              <li key={about}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={about === activeAbout}
                  className={`flyout-item ${about === activeAbout ? 'active' : ''}`}
                  onClick={() => uiStore.getState().toggleLens({ kind: 'about', about })}
                >
                  <span className="legend-swatch about" style={{ background: cssColorForAbout(about) ?? undefined }} />
                  <span className="flyout-tag">all {ABOUT_PLURAL[about] ?? `${about}s`}</span>
                  <span className="flyout-count">{aboutCounts.get(about) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
          {activeAbout !== null && (
            <button type="button" className="flyout-clear" onClick={() => uiStore.getState().clearLens()}>
              clear lens
            </button>
          )}
          <div className="flyout-title">type — shape key</div>
          <div className="legend-shapes-row">
            {SHAPE_VALUES.map((type) => (
              <span key={type} className="legend-shape-item" title={type}>
                <span className="legend-shape-glyph">{SHAPE_GLYPH[type]}</span> {type}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="cluster-frame panel">
        <div className="cluster-title">lenses</div>
        <div className="cluster-buttons">
          <button
            type="button"
            className={`hud-btn ${activeTag !== null ? 'active' : ''} ${tagsOpen ? 'open' : ''}`}
            aria-pressed={activeTag !== null}
            aria-expanded={tagsOpen}
            title="tag lens — highlight one tag, dim the rest"
            onClick={() => uiStore.getState().setHudPanel(tagsOpen ? null : 'tags')}
          >
            <span className="hud-btn-glyph">◈</span>
            <span className="hud-btn-label">{activeTag !== null ? `#${activeTag}` : 'tags'}</span>
          </button>
          <button
            type="button"
            className={`hud-btn ${activeAbout !== null ? 'active' : ''} ${ontologyOpen ? 'open' : ''}`}
            aria-pressed={activeAbout !== null}
            aria-expanded={ontologyOpen}
            title="ontology lens — highlight one ontology subject (about), dim the rest; legend for the type shapes"
            onClick={() => uiStore.getState().setHudPanel(ontologyOpen ? null : 'ontology')}
          >
            <span className="hud-btn-glyph">⬢</span>
            <span className="hud-btn-label">{activeAbout !== null ? activeAbout : 'ontology'}</span>
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
