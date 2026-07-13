/**
 * Right-side doc panel: opens on node selection, shows frontmatter chips,
 * the markdown body (rendered client-side) and in/out neighbor lists.
 * Intra-bundle links inside the body navigate the graph instead of the
 * browser.
 *
 * FILE-LEVEL TIME MACHINE (Tom, 2026-07-12): a doc with git history grows a
 * VERSION RAIL. Stepping it drives the whole-brain scrubber to that commit
 * (the graph shows the brain of that moment), and the panel's CONTENT always
 * follows the scrubber — one source of truth: while time-travelling, the body
 * is fetched `?at=<scrub commit>` (spec/50 "Doc versions") and is read-only.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DocResponse } from '../graph/types';
import { fetchDoc } from '../live/api';
import { useUI, uiStore } from '../state/store';
import { commitAt, versionIndexAtScrub, versionsOf } from '../time/timeline';
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
  const timeline = useUI((s) => s.timeline);
  const timeTravel = useUI((s) => s.timeTravel);
  // The scrub STATION (rounded) — content only refetches when it crosses a commit.
  const scrubStation = useUI((s) => (s.timeTravel ? Math.round(s.scrubIndex) : -1));
  const [panel, setPanel] = useState<PanelState | null>(null);

  const versions = useMemo(
    () => (selection !== null ? versionsOf(timeline, selection) : []),
    [timeline, selection],
  );
  // While travelling: the commit whose content the panel shows (the scrubber's
  // station), and which of THIS doc's versions is in effect there.
  const atCommit = timeTravel ? commitAt(timeline, scrubStation) : null;
  const versionIdx = timeTravel ? versionIndexAtScrub(versions, scrubStation) : -1;

  useEffect(() => {
    if (selection === null) {
      setPanel(null);
      return;
    }
    const controller = new AbortController();
    const at = atCommit?.sha;
    setPanel({ path: selection, doc: null, error: null, suggestions: [] });
    // A drag/play sweeps stations quickly — debounce history fetches a touch;
    // the present (at undefined) loads immediately as before.
    const delay = at === undefined ? 0 : 200;
    const timer = setTimeout(() => {
      fetchDoc(selection, controller.signal, at)
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
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selection, atCommit?.sha]);

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

  // Step the doc's OWN versions; the whole-brain scrubber is the single source
  // of truth, so stepping = driving it. ▶ past the newest returns to present.
  const stepVersion = (delta: number): void => {
    const s = uiStore.getState();
    if (!timeTravel) {
      if (delta < 0 && versions.length > 0) s.enterTimeTravel(versions[versions.length - 1]!.index);
      return;
    }
    const next = versionIdx + delta;
    if (next >= versions.length) {
      s.exitTimeTravel();
      return;
    }
    if (next < 0) return; // already before the first version
    s.enterTimeTravel(versions[next]!.index);
  };
  const currentVersion = versionIdx >= 0 ? versions[versionIdx]! : null;

  return (
    <aside className="doc-panel panel">
      <header>
        <div className="doc-title-row">
          <h2>{doc?.title ?? node?.title ?? selection}</h2>
          {/* Reserved docs (index/log) stay frontmatter-free by contract — not
              editable here. History is read-only too: no edit while travelling. */}
          {writesEnabled && node?.reserved !== true && !timeTravel && (
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
        {versions.length > 0 && (
          <div className="doc-versions" aria-label="version rail">
            <button
              type="button"
              className="doc-version-step"
              aria-label="older version"
              title="older version (drives the time machine)"
              disabled={timeTravel && versionIdx <= 0}
              onClick={() => stepVersion(-1)}
            >
              ◀
            </button>
            <span className="doc-version-label">
              {timeTravel
                ? versionIdx >= 0
                  ? `v${versionIdx + 1}/${versions.length}`
                  : 'before creation'
                : `present · ${versions.length} version${versions.length === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              className="doc-version-step"
              aria-label="newer version"
              title="newer version"
              disabled={!timeTravel}
              onClick={() => stepVersion(1)}
            >
              ▶
            </button>
            {timeTravel && (
              <button
                type="button"
                className="doc-version-present"
                onClick={() => uiStore.getState().exitTimeTravel()}
              >
                present
              </button>
            )}
          </div>
        )}
        {timeTravel && currentVersion !== null && (
          // Not an error (Tom read the first draft — a bare "date · message ·
          // read-only" strip — as one): say plainly WHAT this state is.
          <div className="doc-version-banner" title={currentVersion.sha}>
            <div className="doc-version-banner-head">
              ⏱ time machine — version from {currentVersion.date.slice(0, 10)} · read-only
            </div>
            <div className="doc-version-banner-msg">“{currentVersion.message}”</div>
          </div>
        )}
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
