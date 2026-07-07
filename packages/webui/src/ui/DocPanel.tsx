/**
 * Right-side doc panel: opens on node selection, shows frontmatter chips,
 * the markdown body (rendered client-side) and in/out neighbor lists.
 * Intra-bundle links inside the body navigate the graph instead of the
 * browser.
 */
import { useEffect, useState } from 'react';
import type { DocResponse } from '../graph/types';
import { fetchDoc } from '../live/api';
import { useUI, uiStore } from '../state/store';
import { normalizeNeighbor, resolveDocLink, type NeighborRef } from './docLinks';
import { renderMarkdown } from './markdown';

interface PanelState {
  path: string;
  doc: DocResponse | null;
  error: string | null;
  suggestions: string[];
}

function goTo(path: string): void {
  const s = uiStore.getState();
  if (s.nodes.has(path)) s.select(path, true);
}

function NeighborList({ title, entries }: { title: string; entries: unknown[] }) {
  const refs = entries.map(normalizeNeighbor).filter((n): n is NeighborRef => n !== null);
  if (refs.length === 0) return null;
  return (
    <div className="neighbors">
      <h3>{title}</h3>
      <ul>
        {refs.map((n) => (
          <li key={n.path}>
            <button type="button" onClick={() => goTo(n.path)}>
              {n.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocPanel() {
  const selection = useUI((s) => s.selection);
  const node = useUI((s) => (s.selection !== null ? s.nodes.get(s.selection) ?? null : null));
  const writesEnabled = useUI((s) => s.writesEnabled);
  const [panel, setPanel] = useState<PanelState | null>(null);

  useEffect(() => {
    if (selection === null) {
      setPanel(null);
      return;
    }
    const controller = new AbortController();
    setPanel({ path: selection, doc: null, error: null, suggestions: [] });
    fetchDoc(selection, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.ok) setPanel({ path: selection, doc: res.doc, error: null, suggestions: [] });
        else {
          setPanel({
            path: selection,
            doc: null,
            error: res.body.error,
            suggestions: res.body.suggestions ?? [],
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPanel({ path: selection, doc: null, error: 'could not load the document', suggestions: [] });
        }
      });
    return () => controller.abort();
  }, [selection]);

  if (selection === null || panel === null) return null;
  const doc = panel.doc;

  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    const resolved = resolveDocLink(panel.path, href);
    if (resolved === null) {
      // external link: open safely outside the app
      if (/^https?:/i.test(href)) {
        e.preventDefault();
        window.open(href, '_blank', 'noopener');
      }
      return;
    }
    e.preventDefault();
    const s = uiStore.getState();
    const target = s.nodes.has(resolved) ? resolved : s.nodes.has(`${resolved}.md`) ? `${resolved}.md` : null;
    if (target !== null) goTo(target);
  };

  const timestamp = doc?.frontmatter?.timestamp ?? node?.timestamp ?? null;
  const type = (doc?.frontmatter?.type as string | undefined) ?? node?.type ?? null;
  const tags = node?.tags ?? [];

  return (
    <aside className="doc-panel panel">
      <header>
        <div className="doc-title-row">
          <h2>{doc?.title ?? node?.title ?? selection}</h2>
          {/* Reserved docs (index/log) stay frontmatter-free by contract — not editable here. */}
          {writesEnabled && node?.reserved !== true && (
            <button
              type="button"
              className="doc-edit"
              aria-label="edit"
              title="edit this page in the browser"
              onClick={() =>
                uiStore.getState().openEditor({ path: selection, mode: 'replace', title: doc?.title ?? node?.title ?? selection })
              }
            >
              ✎ edit
            </button>
          )}
          <button type="button" className="close" aria-label="close" onClick={() => uiStore.getState().select(null)}>
            ×
          </button>
        </div>
        <div className="doc-path">{selection}</div>
        <div className="chips">
          {type !== null && <span className="chip chip-type">{type}</span>}
          {typeof timestamp === 'string' && (
            <span className="chip chip-time" title={timestamp}>
              {timestamp.slice(0, 10)}
            </span>
          )}
          {tags.map((t) => (
            <span key={t} className="chip chip-tag">
              #{t}
            </span>
          ))}
          {node?.orphan === true && <span className="chip chip-warn">orphan</span>}
          {node?.reserved === true && <span className="chip chip-dim">reserved</span>}
        </div>
      </header>

      {doc !== null && (
        <>
          <div
            className="doc-body"
            onClick={onBodyClick}
            // rendered from the user's own bundle, sanitized in markdown.ts
            dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.text) }}
          />
          <NeighborList title="links in" entries={doc.neighbors.in} />
          <NeighborList title="links out" entries={doc.neighbors.out} />
        </>
      )}

      {panel.error !== null && (
        <div className="doc-error">
          <p>{panel.error}</p>
          {panel.suggestions.length > 0 && (
            <ul>
              {panel.suggestions.map((sug) => (
                <li key={sug}>
                  <button type="button" onClick={() => goTo(sug)}>
                    {sug}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {doc === null && panel.error === null && <div className="doc-loading">loading…</div>}
    </aside>
  );
}
