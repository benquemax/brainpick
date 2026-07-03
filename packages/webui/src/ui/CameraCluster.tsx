/**
 * VIEWS cluster (bottom-right HUD): game-style camera save slots.
 * Overview fits the whole cosmos (key 0/O, RTS-style); slots 1–3 recall a
 * saved pose (keys 1–3), and saving is tap-an-empty-slot, long-press, or
 * Shift+key/click — the slot indicator fills once a pose is stored.
 */
import { useEffect, useRef, useState } from 'react';
import { BOOKMARK_SLOTS, useUI, uiStore } from '../state/store';

const LONG_PRESS_MS = 550;

export function CameraCluster() {
  const bookmarks = useUI((s) => s.bookmarks);
  const [flash, setFlash] = useState<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const prevBookmarks = useRef(bookmarks);

  // Flash a slot briefly when its pose lands (set via any path: HUD or keys).
  useEffect(() => {
    const prev = prevBookmarks.current;
    prevBookmarks.current = bookmarks;
    const changed = bookmarks.findIndex((pose, i) => pose !== null && pose !== prev[i]);
    if (changed === -1) return;
    setFlash(changed);
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [bookmarks]);

  useEffect(
    () => () => {
      if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    },
    [],
  );

  const startPress = (slot: number) => {
    longPressed.current = false;
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      uiStore.getState().requestBookmarkSave(slot);
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const onSlotClick = (slot: number, e: React.MouseEvent) => {
    if (longPressed.current) {
      longPressed.current = false; // the long press already saved
      return;
    }
    const s = uiStore.getState();
    if (e.shiftKey || s.bookmarks[slot] === null) s.requestBookmarkSave(slot);
    else s.recallBookmark(slot);
  };

  return (
    <div className="hud-cluster camera-cluster">
      <div className="cluster-frame panel">
        <div className="cluster-title">views</div>
        <div className="cluster-buttons">
          <button
            type="button"
            className="hud-btn"
            title="overview — fit the whole cosmos (0)"
            onClick={() => uiStore.getState().requestOverview()}
          >
            <span className="hud-btn-glyph">⛶</span>
            <span className="hud-btn-label">fit</span>
          </button>
          {bookmarks.slice(0, BOOKMARK_SLOTS).map((pose, slot) => {
            const filled = pose !== null;
            return (
              <button
                key={slot}
                type="button"
                className={`hud-btn slot-btn ${filled ? 'filled' : 'empty'} ${flash === slot ? 'flash' : ''}`}
                title={
                  filled
                    ? `view ${slot + 1} — recall (${slot + 1}); hold or shift+click to re-save`
                    : `view ${slot + 1} — empty; click to save this view (shift+${slot + 1})`
                }
                aria-label={filled ? `recall view ${slot + 1}` : `save view ${slot + 1}`}
                onPointerDown={() => startPress(slot)}
                onPointerUp={endPress}
                onPointerLeave={endPress}
                onPointerCancel={endPress}
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => onSlotClick(slot, e)}
              >
                <span className="slot-num">{slot + 1}</span>
                <span className={`slot-dot ${filled ? 'on' : ''}`} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
