/**
 * Entity panel: the T3 sibling of DocPanel. Opens on entity selection and
 * shows the extracted entity's name / type / description, plus the source docs
 * it was mined from as clickable links — selecting one reaches that doc in the
 * doc layer (the store switches to overlay and flies there).
 */
import { useUI, uiStore } from '../state/store';
import { docsForEntity } from '../state/entityModel';

export function EntityPanel() {
  const entitySelection = useUI((s) => s.entitySelection);
  const entityGraph = useUI((s) => s.entityGraph);
  const grounding = useUI((s) => s.grounding);
  const groundingLoaded = useUI((s) => s.grounding.size > 0);

  if (entitySelection === null) return null;
  const node = entityGraph?.nodes.find((n) => n.id === entitySelection) ?? null;
  const sources = docsForEntity(grounding, entitySelection);

  return (
    <aside className="doc-panel entity-panel panel">
      <header>
        <div className="doc-title-row">
          <h2>{node?.name ?? entitySelection}</h2>
          <button
            type="button"
            className="close"
            aria-label="close"
            onClick={() => uiStore.getState().selectEntity(null)}
          >
            ×
          </button>
        </div>
        <div className="doc-path">entity · {entitySelection}</div>
        <div className="chips">
          <span className="chip chip-entity">entity</span>
          {node?.type != null && node.type !== '' && <span className="chip chip-type">{node.type}</span>}
        </div>
      </header>

      {node?.description != null && node.description !== '' && (
        <p className="entity-description">{node.description}</p>
      )}

      <div className="neighbors">
        <h3>source docs</h3>
        {sources.length > 0 ? (
          <ul>
            {sources.map((path) => (
              <li key={path}>
                <button type="button" onClick={() => uiStore.getState().selectSourceDoc(path)}>
                  {path}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="entity-sources-empty">{groundingLoaded ? 'no source docs on record' : 'finding sources…'}</p>
        )}
      </div>
    </aside>
  );
}
