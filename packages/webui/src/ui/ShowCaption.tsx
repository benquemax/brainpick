/**
 * The agent-presentation caption (spec/95, brain.show). When an agent spotlights
 * a subgraph and captions it, this dismissible banner shows the caption over the
 * scene with a clear "◆ presented by an agent" marker — sci-fi calm, top-centre,
 * below the HUD. The ✕ dismisses the CAPTION only; the spotlight remains until the
 * agent replaces or clears the presentation. Shows nothing when there is no
 * annotation. Mode-agnostic: it rides over cosmos, hologram and time travel alike.
 */
import { uiStore, useUI } from '../state/store';

export function ShowCaption() {
  const presentation = useUI((s) => s.presentation);
  const visible = useUI((s) => s.presentationCaptionVisible);
  const annotation = presentation?.annotation ?? null;
  if (!visible || annotation === null) return null;
  return (
    <div className="show-caption panel" role="status" aria-live="polite">
      <span className="show-marker" title="this view was pushed live by an agent">
        <span className="show-diamond" aria-hidden="true">
          ◆
        </span>
        presented by an agent
      </span>
      <p className="show-annotation">{annotation}</p>
      <button
        type="button"
        className="show-dismiss"
        aria-label="dismiss the caption"
        title="dismiss the caption (the spotlight stays)"
        onClick={() => uiStore.getState().dismissCaption()}
      >
        ✕
      </button>
    </div>
  );
}
