/**
 * LAYER toggle (top-center HUD): links (T1 doc graph) ⇄ entities (T3) ⇄ overlay.
 * Availability is honest and lazy: the entity/overlay buttons start selectable,
 * and only once a fetch 404s (no T3 export) do they disable and tag themselves
 * "T3 not compiled" (mirroring the search panel's tier tag) while the cosmos
 * falls back to links. A small legend appears while the entity/overlay layer is
 * active, naming the hues + shapes.
 */
import type { GraphLayer } from '../graph/entities';
import { useUI, uiStore } from '../state/store';

const LAYER_GLYPH: Record<GraphLayer, string> = { links: '◉', entities: '◆', overlay: '⧉' };

function LayerButton({
  layer,
  active,
  disabled,
  tag,
}: {
  layer: GraphLayer;
  active: boolean;
  disabled: boolean;
  tag: string | null;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={layer}
      aria-checked={active}
      aria-disabled={disabled}
      disabled={disabled}
      className={`hud-btn ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      title={
        disabled
          ? `${layer} — T3 not compiled (run an extractor to populate the entity layer)`
          : `show the ${layer} graph`
      }
      onClick={() => uiStore.getState().setLayer(layer)}
    >
      <span className="hud-btn-glyph">{LAYER_GLYPH[layer]}</span>
      <span className="hud-btn-label">{layer}</span>
      {tag !== null && <span className="layer-tag">{tag}</span>}
    </button>
  );
}

function Legend({ overlay }: { overlay: boolean }) {
  return (
    <div className="panel layer-legend" aria-label="entity layer legend">
      {overlay && (
        <div className="legend-row">
          <span className="legend-swatch doc" />
          <span>docs — linked notes (T1)</span>
        </div>
      )}
      <div className="legend-row">
        <span className="legend-swatch entity" />
        <span>entities — extracted concepts (T3)</span>
      </div>
      <div className="legend-row">
        <span className="legend-line relation" />
        <span>relation — entity ↔ entity, thicker = stronger</span>
      </div>
      {overlay && (
        <div className="legend-row">
          <span className="legend-line virtual" />
          <span>mentions — an entity toward its source docs</span>
        </div>
      )}
    </div>
  );
}

export function LayerToggle() {
  const layer = useUI((s) => s.layer);
  const availability = useUI((s) => s.entityAvailability);

  // The endpoint is the source of truth: enabled until a fetch proves T3 absent.
  const enabled = availability !== 'unavailable';
  const tag = enabled ? null : 'T3 not compiled';
  const showLegend = enabled && layer !== 'links';

  return (
    <div className="hud-cluster layer-cluster">
      <div className="cluster-frame panel">
        <div className="cluster-title">layer</div>
        <div className="cluster-buttons" role="radiogroup" aria-label="graph layer">
          <LayerButton layer="links" active={layer === 'links'} disabled={false} tag={null} />
          <LayerButton layer="entities" active={layer === 'entities'} disabled={!enabled} tag={tag} />
          <LayerButton layer="overlay" active={layer === 'overlay'} disabled={!enabled} tag={tag} />
        </div>
      </div>
      {showLegend && <Legend overlay={layer === 'overlay'} />}
    </div>
  );
}
