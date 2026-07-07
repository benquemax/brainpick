/**
 * A single transient toast (bottom-centre, above the mode pill): the editor's
 * "saved" confirmation and any upload/write feedback. Auto-dismisses; the store
 * holds at most one at a time.
 */
import { useEffect } from 'react';
import { uiStore, useUI } from '../state/store';

export function Toast() {
  const toast = useUI((s) => s.toast);
  const nonce = toast?.nonce;
  useEffect(() => {
    if (nonce === undefined) return;
    const timer = setTimeout(() => uiStore.getState().clearToast(nonce), 2600);
    return () => clearTimeout(timer);
  }, [nonce]);
  if (toast === null || toast === undefined) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <span className="toast-dot" />
      <span className="toast-text">{toast.text}</span>
    </div>
  );
}
