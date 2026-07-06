/**
 * MODE toggle — the signature control: morph the flat 2D cosmos into the
 * floating holographic brain and back. One prominent pill (bottom-centre) plus
 * the `b` key. Same game-HUD language as the rest of the cockpit.
 *
 * Its sibling below the pill is the TIME MACHINE (ui/TimeMachine.tsx, key `t`):
 * the timeline.json artifact now exists, so the deferred time scrubber is real —
 * scrub the brain's git history and watch it grow, in both cosmos and brain modes.
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
