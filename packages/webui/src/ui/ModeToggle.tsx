/**
 * MODE toggle — the signature control: morph the flat 2D cosmos into the
 * floating holographic brain and back. One prominent pill (bottom-centre) plus
 * the `b` key. Same game-HUD language as the rest of the cockpit.
 *
 * TODO (deferred, see _todo.md): a TIME SCRUBBER belongs next to this control —
 * it would replay the brain's growth over its history. It needs a per-seq
 * `timeline.json` artifact that NEITHER engine emits yet (T1 compile currently
 * drops the advisory timeline), so it is intentionally NOT built here — no faked
 * scrubber over data we do not have. Wire the artifact first, then add it.
 */
import { useUI, uiStore } from '../state/store';

export function ModeToggle() {
  const brain = useUI((s) => s.mode === 'brain');
  return (
    <div className="hud-cluster mode-cluster">
      <button
        type="button"
        className={`mode-toggle ${brain ? 'brain' : ''}`}
        aria-pressed={brain}
        aria-label={brain ? 'cosmos' : 'brain'}
        title={brain ? 'collapse back to the 2D cosmos (b)' : 'morph into the holographic brain (b)'}
        onClick={() => uiStore.getState().toggleMode()}
      >
        <span className="mode-glyph">{brain ? '◉' : '✸'}</span>
        <span className="mode-label">{brain ? 'cosmos' : 'brain'}</span>
        <kbd>b</kbd>
      </button>
    </div>
  );
}
