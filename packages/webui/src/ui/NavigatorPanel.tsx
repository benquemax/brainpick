/**
 * NAVIGATOR cluster + panel: the bundle as a live directory tree — for when
 * you know exactly what you are looking for and the tree beats the cosmos.
 * Desktop: a left-side collapsible panel; mobile: a full-height slide-in
 * drawer (scrim tap, swipe-left or ✕ closes). Selecting a doc goes through
 * the same store action the graph uses (select -> DocPanel + flyTo), so the
 * tree and the cosmos always agree. Everything is client-side: the tree
 * derives from the graph nodes already in the store (state/tree.ts).
 *
 * Keyboard (gamepad-style, matching the search overlay's conventions):
 * `n` toggles; ArrowUp/Down walk the visible rows, ArrowRight/Left
 * expand/collapse (Left from a leaf climbs to its dir), Enter selects,
 * Escape closes.
 */
import { useEffect, useRef, useState } from 'react';
import { useUI, uiStore } from '../state/store';
import {
  AUTO_EXPAND_MAX_DIRS,
  ancestorDirsOf,
  countDirs,
  flattenVisible,
  treeForGraph,
  type TreeDir,
  type TreeDoc,
} from '../state/tree';

/** The drawer breakpoint — keep in sync with the media query in styles.css. */
const MOBILE_QUERY = '(max-width: 640px)';

interface RowCtx {
  isExpanded(dirPath: string): boolean;
  toggleDir(dirPath: string): void;
  selectDoc(path: string): void;
  selection: string | null;
  tabPath: string | null;
  onRowFocus(path: string): void;
  registerRow(path: string, el: HTMLButtonElement | null): void;
}

function DirRow({ dir, ctx }: { dir: TreeDir; ctx: RowCtx }) {
  const expanded = ctx.isExpanded(dir.path);
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        className="nav-row nav-dir"
        data-path={dir.path}
        tabIndex={dir.path === ctx.tabPath ? 0 : -1}
        title={`${dir.path}/ — ${dir.docCount} docs`}
        onClick={() => ctx.toggleDir(dir.path)}
        onFocus={() => ctx.onRowFocus(dir.path)}
        ref={(el) => {
          ctx.registerRow(dir.path, el);
        }}
      >
        <span className="nav-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="nav-name">{dir.name}</span>
        <span className="nav-count">{dir.docCount}</span>
      </button>
      {expanded && (
        <ul role="group" className="nav-children">
          <TreeChildren dir={dir} ctx={ctx} />
        </ul>
      )}
    </li>
  );
}

function DocRow({ doc, ctx }: { doc: TreeDoc; ctx: RowCtx }) {
  const selected = doc.path === ctx.selection;
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-selected={selected}
        className={`nav-row nav-doc ${selected ? 'selected' : ''} ${doc.reserved ? 'reserved' : ''}`}
        data-path={doc.path}
        tabIndex={doc.path === ctx.tabPath ? 0 : -1}
        title={doc.path}
        onClick={() => ctx.selectDoc(doc.path)}
        onFocus={() => ctx.onRowFocus(doc.path)}
        ref={(el) => {
          ctx.registerRow(doc.path, el);
        }}
      >
        <span className="nav-doc-name">{doc.title}</span>
        {doc.orphan && <span className="orphan-dot" title="orphan — nothing links here" aria-hidden="true" />}
      </button>
    </li>
  );
}

function TreeChildren({ dir, ctx }: { dir: TreeDir; ctx: RowCtx }) {
  return (
    <>
      {dir.children.map((entry) =>
        entry.kind === 'dir' ? (
          <DirRow key={entry.path} dir={entry} ctx={ctx} />
        ) : (
          <DocRow key={entry.path} doc={entry} ctx={ctx} />
        ),
      )}
    </>
  );
}

export function NavigatorPanel() {
  const open = useUI((s) => s.navigatorOpen);
  const selection = useUI((s) => s.selection);
  const nodes = useUI((s) => s.nodes);
  const seq = useUI((s) => s.seq);
  const tree = treeForGraph(nodes, seq);

  // Small bundles read best fully open; big ones start folded.
  const defaultExpanded = countDirs(tree) <= AUTO_EXPAND_MAX_DIRS;
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLUListElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const isExpanded = (dirPath: string) => overrides.get(dirPath) ?? defaultExpanded;

  const setDirExpanded = (dirPath: string, value: boolean) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(dirPath, value);
      return next;
    });
  };

  // Keep the current selection visible: unfold its ancestors, scroll it in.
  useEffect(() => {
    if (!open || selection === null) return;
    setOverrides((prev) => {
      const missing = ancestorDirsOf(selection).filter((dir) => !(prev.get(dir) ?? defaultExpanded));
      if (missing.length === 0) return prev;
      const next = new Map(prev);
      for (const dir of missing) next.set(dir, true);
      return next;
    });
    const raf = requestAnimationFrame(() => {
      rowRefs.current.get(selection)?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, selection, defaultExpanded]);

  // Opening hands the gamepad to the tree: focus the entry row.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return <NavigatorCluster open={false} />;

  const visible = flattenVisible(tree, isExpanded);
  const visiblePaths = new Set(visible.map((r) => r.entry.path));
  const tabPath =
    focusPath !== null && visiblePaths.has(focusPath)
      ? focusPath
      : selection !== null && visiblePaths.has(selection)
        ? selection
        : (visible[0]?.entry.path ?? null);

  const ctx: RowCtx = {
    isExpanded,
    toggleDir: (dirPath) => setDirExpanded(dirPath, !isExpanded(dirPath)),
    selectDoc: (path) => {
      uiStore.getState().select(path, true);
      // The drawer covers the doc panel on phones — step aside once chosen.
      if (window.matchMedia(MOBILE_QUERY).matches) uiStore.getState().toggleNavigator();
    },
    selection,
    tabPath,
    onRowFocus: setFocusPath,
    registerRow: (path, el) => {
      if (el === null) rowRefs.current.delete(path);
      else rowRefs.current.set(path, el);
    },
  };

  const focusRowAt = (index: number) => {
    const row = visible[Math.max(0, Math.min(visible.length - 1, index))];
    if (row) rowRefs.current.get(row.entry.path)?.focus();
  };

  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const path = (e.target as HTMLElement).closest('[data-path]')?.getAttribute('data-path') ?? null;
    const index = path === null ? -1 : visible.findIndex((r) => r.entry.path === path);
    const row = index >= 0 ? visible[index] : undefined;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRowAt(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRowAt(index - 1);
    } else if (e.key === 'ArrowRight') {
      if (row?.entry.kind !== 'dir') return;
      e.preventDefault();
      if (isExpanded(row.entry.path)) focusRowAt(index + 1); // dive into the first child
      else setDirExpanded(row.entry.path, true);
    } else if (e.key === 'ArrowLeft') {
      if (row === undefined) return;
      e.preventDefault();
      if (row.entry.kind === 'dir' && isExpanded(row.entry.path)) {
        setDirExpanded(row.entry.path, false);
      } else {
        const parent = ancestorDirsOf(row.entry.path).pop();
        if (parent !== undefined) rowRefs.current.get(parent)?.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // close the panel only — not the lens/selection chain
      uiStore.getState().toggleNavigator();
    }
  };

  return (
    <>
      <NavigatorCluster open />
      {/* mobile-only backdrop; display:none on desktop */}
      <div className="nav-scrim" onClick={() => uiStore.getState().toggleNavigator()} />
      <aside
        className="navigator-panel panel"
        aria-label="navigator"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = t !== undefined ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          const t = e.changedTouches[0];
          if (start === null || t === undefined) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (dx < -48 && Math.abs(dx) > Math.abs(dy) * 1.4) uiStore.getState().toggleNavigator();
        }}
      >
        <header className="nav-head">
          <span className="nav-title">navigator</span>
          <span className="nav-total">{tree.docCount} docs</span>
          <button
            type="button"
            className="close"
            aria-label="close navigator"
            onClick={() => uiStore.getState().toggleNavigator()}
          >
            ×
          </button>
        </header>
        {tree.docCount === 0 ? (
          <div className="nav-empty">no documents yet — the tree grows with the brain</div>
        ) : (
          <ul role="tree" aria-label="bundle tree" className="nav-tree" ref={listRef} onKeyDown={onTreeKeyDown}>
            <TreeChildren dir={tree} ctx={ctx} />
          </ul>
        )}
      </aside>
    </>
  );
}

/** The corner cluster (bottom-left, above LENSES) holding the toggle. */
function NavigatorCluster({ open }: { open: boolean }) {
  return (
    <div className="hud-cluster nav-cluster">
      <div className="cluster-frame panel">
        <div className="cluster-title">navigator</div>
        <div className="cluster-buttons">
          <button
            type="button"
            className={`hud-btn ${open ? 'active' : ''}`}
            aria-pressed={open}
            aria-expanded={open}
            title="tree — the bundle as a directory tree (N)"
            onClick={() => uiStore.getState().toggleNavigator()}
          >
            <span className="hud-btn-glyph">├</span>
            <span className="hud-btn-label">tree</span>
          </button>
        </div>
      </div>
    </div>
  );
}
