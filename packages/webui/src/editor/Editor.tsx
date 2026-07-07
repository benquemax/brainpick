/**
 * The WYSIWYG editor sheet — a full-screen surface where formatted prose is
 * typed with no raw markdown in sight, then serialized byte-cleanly to OKF
 * markdown and saved through the guarded write path (PUT /api/docs).
 *
 * Lazily loaded (App mounts it via React.lazy only when `store.editor` is set),
 * so the ProseMirror + markdown-it weight never touches the main graph bundle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { fetchDoc } from '../live/api';
import { uiStore, useUI, type EditorTarget } from '../state/store';
import { parseBody, schema, serializeBody } from './markdownIO';
import { buildPlugins } from './pmSetup';
import {
  blockActive,
  insertImage,
  insertLink,
  markActive,
  run,
  setCodeBlock,
  setHeading,
  toggleCode,
  toggleEm,
  toggleStrong,
  wrapBlockquote,
  wrapBulletList,
  wrapOrderedList,
} from './commands';
import {
  EMPTY_FRONTMATTER,
  frontmatterFromDoc,
  OKF_TYPES,
  relativeLink,
  serializeDoc,
  splitFrontmatter,
  type Frontmatter,
} from './frontmatter';
import { postAsset, putDoc } from './net';
import type { PutOutcome } from './saveFlow';

interface Banner {
  kind: 'violation' | 'writesOff' | 'auth' | 'error';
  text: string;
}
type Conflict = Extract<PutOutcome, { kind: 'conflict' }>;

interface Active {
  strong: boolean;
  em: boolean;
  code: boolean;
  heading: number | null;
  blockquote: boolean;
  codeBlock: boolean;
}

function computeActive(state: EditorState): Active {
  return {
    strong: markActive(state, schema.marks.strong),
    em: markActive(state, schema.marks.em),
    code: markActive(state, schema.marks.code),
    ...blockActive(state),
  };
}

/** A title → a kebab-case, ascii `.md` filename (henxels filename_casing). */
function kebabFilename(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return stem === '' ? '' : `${stem}.md`;
}

function isValidNewPath(path: string): boolean {
  if (!path.endsWith('.md') || path.startsWith('/') || path.includes('..')) return false;
  return path.split('/').every((seg) => seg === '' || /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.md)?$/.test(seg)) && path.length > 3;
}

const BANNER_TITLE: Record<Banner['kind'], string> = {
  violation: 'the brain kept this page out',
  writesOff: 'writing is off',
  auth: 'sign-in needed',
  error: 'the save did not land',
};

export default function Editor({ target }: { target: EditorTarget }) {
  const create = target.mode === 'create';
  const nodes = useUI((s) => s.nodes);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<string>('');

  const [ready, setReady] = useState(create);
  const [fm, setFm] = useState<Frontmatter>(create ? { ...EMPTY_FRONTMATTER, title: target.title } : EMPTY_FRONTMATTER);
  const [path, setPath] = useState(create ? kebabFilename(target.title) : target.path);
  const [pathTouched, setPathTouched] = useState(false);
  const [baseSha, setBaseSha] = useState<string | null>(null);
  const [active, setActive] = useState<Active>({ strong: false, em: false, code: false, heading: null, blockquote: false, codeBlock: false });
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const savePath = create ? path : target.path;
  // The mount effect captures handlers once; a ref keeps the save path current
  // for paste/drop uploads even as a new page's path changes under the writer.
  const savePathRef = useRef(savePath);
  savePathRef.current = savePath;

  // Load an existing doc: frontmatter → the form, body → the WYSIWYG, sha → base_sha.
  useEffect(() => {
    if (create) return;
    const controller = new AbortController();
    fetchDoc(target.path, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.ok) {
          setFm(frontmatterFromDoc(res.doc.frontmatter, res.doc.title));
          setBaseSha(res.doc.sha ?? null);
          bodyRef.current = res.doc.text;
          setReady(true);
        } else {
          setLoadError(res.body.error);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError('could not load this page to edit');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.path]);

  // Mount the ProseMirror view once the body is ready; tear it down on close.
  useEffect(() => {
    if (!ready || surfaceRef.current === null) return;
    const view = new EditorView(surfaceRef.current, {
      state: EditorState.create({ doc: parseBody(bodyRef.current), plugins: buildPlugins() }),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        setActive(computeActive(next));
      },
      handlePaste: (_v, event) => {
        const file = imageFrom(event.clipboardData);
        if (!file) return false;
        event.preventDefault();
        void uploadAndInsert(file);
        return true;
      },
      handleDrop: (_v, event) => {
        const file = imageFrom(event.dataTransfer);
        if (!file) return false;
        event.preventDefault();
        void uploadAndInsert(file);
        return true;
      },
    });
    viewRef.current = view;
    setActive(computeActive(view.state));
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const requestClose = useCallback(() => uiStore.getState().closeEditor(), []);

  // Keep the path in step with the title for a new page, until the user edits it.
  useEffect(() => {
    if (create && !pathTouched) setPath(kebabFilename(fm.title));
  }, [create, pathTouched, fm.title]);

  const imageFrom = (dt: DataTransfer | null): File | null => {
    for (const file of dt?.files ?? []) if (file.type.startsWith('image/')) return file;
    return null;
  };

  const uploadAndInsert = useCallback(async (file: File) => {
    setUploading(true);
    setBanner(null);
    const outcome = await postAsset(file);
    setUploading(false);
    const view = viewRef.current;
    if (outcome.kind === 'ok' && view) {
      const src = relativeLink(savePathRef.current || 'index.md', outcome.path);
      insertImage(view, src, file.name.replace(/\.[^.]+$/, ''));
    } else if (outcome.kind === 'writesOff') {
      setBanner({ kind: 'writesOff', text: outcome.message });
    } else if (outcome.kind === 'auth') {
      setBanner({ kind: 'auth', text: outcome.message });
    } else if (outcome.kind !== 'ok') {
      setBanner({ kind: 'error', text: outcome.message });
    }
  }, []);

  const loadContent = useCallback((fullText: string, sha: string | null) => {
    const { data, body } = splitFrontmatter(fullText);
    setFm((prev) => frontmatterFromDoc(data, prev.title));
    setBaseSha(sha);
    const view = viewRef.current;
    if (view) view.updateState(EditorState.create({ doc: parseBody(body), plugins: buildPlugins() }));
    setConflict(null);
    setBanner(null);
  }, []);

  const applyOutcome = useCallback(
    (outcome: PutOutcome) => {
      switch (outcome.kind) {
        case 'ok':
          uiStore.getState().showToast(create ? 'page created' : 'saved', 'ok');
          uiStore.getState().closeEditor();
          uiStore.getState().select(savePath, true); // open the saved doc; the delta pulses its node
          break;
        case 'violation':
          setConflict(null);
          setBanner({ kind: 'violation', text: outcome.instruction });
          break;
        case 'conflict':
          setBanner(null);
          setConflict(outcome);
          break;
        case 'writesOff':
          setBanner({ kind: 'writesOff', text: outcome.message });
          break;
        case 'auth':
          setBanner({ kind: 'auth', text: outcome.message });
          break;
        default:
          setBanner({ kind: 'error', text: outcome.message });
      }
    },
    [create, savePath],
  );

  const onSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view || saving) return;
    if (create && !isValidNewPath(path)) {
      setBanner({ kind: 'error', text: 'choose a kebab-case filename ending in .md (e.g. my-new-page.md)' });
      return;
    }
    if (fm.title.trim() === '') {
      setBanner({ kind: 'error', text: 'a page needs a title — the graph and search show it first' });
      return;
    }
    const content = serializeDoc(fm, serializeBody(view.state.doc));
    setSaving(true);
    setBanner(null);
    const outcome = await putDoc(savePath, { content, baseSha: create ? null : baseSha, mode: target.mode });
    setSaving(false);
    applyOutcome(outcome);
  }, [applyOutcome, baseSha, create, fm, path, saving, savePath, target.mode]);

  // Cmd/Ctrl-S saves from anywhere in the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void onSave();
      } else if (e.key === 'Escape' && !linkOpen) {
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onSave, linkOpen, requestClose]);

  const knownTypes = useMemo(() => {
    const set = new Set<string>(OKF_TYPES);
    for (const node of nodes.values()) if (node.type) set.add(node.type);
    return [...set].sort();
  }, [nodes]);

  const view = () => viewRef.current;
  const cmd = (c: Parameters<typeof run>[1]) => () => {
    const v = view();
    if (v) run(v, c);
  };

  return (
    <div className="editor-sheet panel" role="dialog" aria-label={create ? 'new page' : 'edit page'}>
      <header className="editor-head">
        <div className="editor-head-titles">
          <span className="editor-kicker">{create ? 'new page' : 'editing'}</span>
          <span className="editor-path" title={savePath}>
            {savePath || 'choose a filename below'}
          </span>
        </div>
        <div className="editor-head-actions">
          <button type="button" className="editor-cancel" onClick={requestClose}>
            Cancel
          </button>
          <button type="button" className="editor-save" onClick={() => void onSave()} disabled={saving} aria-label="save">
            {saving ? 'Saving…' : create ? 'Create' : 'Save'}
          </button>
          <button type="button" className="editor-close" aria-label="close editor" onClick={requestClose}>
            ×
          </button>
        </div>
      </header>

      {banner !== null && (
        <div className={`editor-banner banner-${banner.kind}`} role="alert">
          <span className="banner-title">{BANNER_TITLE[banner.kind]}</span>
          <p className="banner-text">{banner.text}</p>
        </div>
      )}

      {conflict !== null && (
        <ConflictPanel
          conflict={conflict}
          onUseMerged={loadContent}
          onReloadTheirs={loadContent}
          onKeepMine={(sha) => {
            setBaseSha(sha);
            setConflict(null);
          }}
          onDismiss={() => setConflict(null)}
        />
      )}

      <div className="editor-scroll">
        <FrontmatterForm
          fm={fm}
          setFm={setFm}
          create={create}
          path={path}
          onPath={(p) => {
            setPath(p);
            setPathTouched(true);
          }}
          pathValid={!create || isValidNewPath(path)}
          knownTypes={knownTypes}
        />

        <Toolbar
          active={active}
          cmd={cmd}
          onLink={() => setLinkOpen(true)}
          onImage={() => fileInputRef.current?.click()}
          uploading={uploading}
        />

        {loadError !== null ? (
          <div className="editor-loaderror">{loadError}</div>
        ) : !ready ? (
          <div className="editor-loading">loading the page…</div>
        ) : (
          <div className="editor-surface" ref={surfaceRef} />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadAndInsert(file);
          e.target.value = '';
        }}
      />

      {linkOpen && (
        <LinkPicker
          fromPath={savePath || 'index.md'}
          onClose={() => {
            setLinkOpen(false);
            view()?.focus();
          }}
          onInsertDoc={(toPath, title) => {
            const v = view();
            if (v) insertLink(v, relativeLink(savePath || 'index.md', toPath), title);
            setLinkOpen(false);
          }}
          onInsertUrl={(url, text) => {
            const v = view();
            if (v) insertLink(v, url, text);
            setLinkOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---- toolbar --------------------------------------------------------------

function Toolbar({
  active,
  cmd,
  onLink,
  onImage,
  uploading,
}: {
  active: Active;
  cmd: (c: Parameters<typeof run>[1]) => () => void;
  onLink: () => void;
  onImage: () => void;
  uploading: boolean;
}) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="formatting">
      <div className="tool-group">
        {[1, 2, 3].map((level) => (
          <button
            key={level}
            type="button"
            className={`tool-btn ${active.heading === level ? 'on' : ''}`}
            aria-label={`heading ${level}`}
            aria-pressed={active.heading === level}
            title={`Heading ${level}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={cmd(setHeading(level))}
          >
            H{level}
          </button>
        ))}
      </div>
      <div className="tool-group">
        <ToolButton label="bold" title="Bold (⌘B)" on={active.strong} glyph="B" strong onDo={cmd(toggleStrong)} />
        <ToolButton label="italic" title="Italic (⌘I)" on={active.em} glyph="I" italic onDo={cmd(toggleEm)} />
        <ToolButton label="inline code" title="Code (⌘`)" on={active.code} glyph="‹›" mono onDo={cmd(toggleCode)} />
      </div>
      <div className="tool-group">
        <ToolButton label="bullet list" title="Bullet list" glyph="•—" onDo={cmd(wrapBulletList)} />
        <ToolButton label="numbered list" title="Numbered list" glyph="1." onDo={cmd(wrapOrderedList)} />
        <ToolButton label="quote" title="Blockquote" on={active.blockquote} glyph="❝" onDo={cmd(wrapBlockquote)} />
        <ToolButton label="code block" title="Code block" on={active.codeBlock} glyph="{ }" mono onDo={cmd(setCodeBlock)} />
      </div>
      <div className="tool-group">
        <ToolButton label="link" title="Insert a link to another page or a URL" glyph="🔗" onDo={onLink} />
        <button
          type="button"
          className={`tool-btn ${uploading ? 'busy' : ''}`}
          aria-label="image"
          title="Insert an image (upload, or drag / paste)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onImage}
        >
          {uploading ? '…' : '🖼'}
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  title,
  glyph,
  on,
  strong,
  italic,
  mono,
  onDo,
}: {
  label: string;
  title: string;
  glyph: string;
  on?: boolean;
  strong?: boolean;
  italic?: boolean;
  mono?: boolean;
  onDo: () => void;
}) {
  const cls = ['tool-btn', on ? 'on' : '', strong ? 'is-strong' : '', italic ? 'is-italic' : '', mono ? 'is-mono' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      aria-pressed={on ?? undefined}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onDo}
    >
      {glyph}
    </button>
  );
}

// ---- frontmatter form -----------------------------------------------------

function FrontmatterForm({
  fm,
  setFm,
  create,
  path,
  onPath,
  pathValid,
  knownTypes,
}: {
  fm: Frontmatter;
  setFm: (fn: (prev: Frontmatter) => Frontmatter) => void;
  create: boolean;
  path: string;
  onPath: (p: string) => void;
  pathValid: boolean;
  knownTypes: string[];
}) {
  return (
    <div className="editor-frontmatter">
      {create && (
        <label className="fm-field fm-path">
          <span className="fm-label">path</span>
          <input
            className={`fm-input ${pathValid ? '' : 'invalid'}`}
            value={path}
            spellCheck={false}
            placeholder="my-new-page.md"
            aria-label="path"
            onChange={(e) => onPath(e.target.value.trim())}
          />
        </label>
      )}
      <div className="fm-row">
        <label className="fm-field fm-title">
          <span className="fm-label">title</span>
          <input
            className="fm-input"
            value={fm.title}
            placeholder="A clear, findable title"
            aria-label="title"
            onChange={(e) => setFm((p) => ({ ...p, title: e.target.value }))}
          />
        </label>
        <label className="fm-field fm-type">
          <span className="fm-label">type</span>
          <input
            className="fm-input"
            value={fm.type}
            list="okf-types"
            placeholder="Concept"
            aria-label="type"
            onChange={(e) => setFm((p) => ({ ...p, type: e.target.value }))}
          />
          <datalist id="okf-types">
            {knownTypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="fm-field">
        <span className="fm-label">description</span>
        <input
          className="fm-input"
          value={fm.description}
          placeholder="One sentence — this feeds the index and every search result"
          aria-label="description"
          onChange={(e) => setFm((p) => ({ ...p, description: e.target.value }))}
        />
      </label>
      <TagInput tags={fm.tags} onChange={(tags) => setFm((p) => ({ ...p, tags }))} />
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '');
    if (tag !== '' && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft('');
  };
  return (
    <div className="fm-field">
      <span className="fm-label">tags</span>
      <div className="fm-tags">
        {tags.map((t) => (
          <span key={t} className="fm-tag">
            #{t}
            <button type="button" aria-label={`remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="fm-tag-input"
          value={draft}
          placeholder={tags.length === 0 ? 'add a tag…' : ''}
          aria-label="add tag"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
        />
      </div>
    </div>
  );
}

// ---- link picker ----------------------------------------------------------

function LinkPicker({
  fromPath,
  onClose,
  onInsertDoc,
  onInsertUrl,
}: {
  fromPath: string;
  onClose: () => void;
  onInsertDoc: (toPath: string, title: string) => void;
  onInsertUrl: (url: string, text: string) => void;
}) {
  const nodes = useUI((s) => s.nodes);
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [urlText, setUrlText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...nodes.values()]
      .filter((n) => n.id !== fromPath && !n.reserved)
      .filter((n) => q === '' || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 40);
  }, [nodes, query, fromPath]);

  return (
    <div className="link-picker-scrim" onClick={onClose}>
      <div className="link-picker panel" role="dialog" aria-label="insert link" onClick={(e) => e.stopPropagation()}>
        <header className="link-picker-head">
          <span className="link-picker-title">link to a page</span>
          <button type="button" className="editor-close" aria-label="close link picker" onClick={onClose}>
            ×
          </button>
        </header>
        <input
          ref={inputRef}
          className="link-picker-search"
          value={query}
          placeholder="find a page — its title becomes the link text"
          aria-label="find a page"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && options[0]) onInsertDoc(options[0].id, options[0].title);
            else if (e.key === 'Escape') onClose();
          }}
        />
        <ul className="link-options">
          {options.map((n) => (
            <li key={n.id}>
              <button type="button" className="link-option" onClick={() => onInsertDoc(n.id, n.title)}>
                <span className="link-option-title">{n.title}</span>
                <span className="link-option-path">{n.id}</span>
              </button>
            </li>
          ))}
          {options.length === 0 && <li className="link-empty">no page matches — try a URL below</li>}
        </ul>
        <div className="link-external">
          <span className="fm-label">or an external URL</span>
          <div className="link-external-row">
            <input
              className="fm-input"
              value={url}
              placeholder="https://…"
              aria-label="external url"
              onChange={(e) => setUrl(e.target.value)}
            />
            <input
              className="fm-input"
              value={urlText}
              placeholder="link text"
              aria-label="link text"
              onChange={(e) => setUrlText(e.target.value)}
            />
            <button
              type="button"
              className="editor-save"
              disabled={!/^https?:\/\//i.test(url)}
              onClick={() => onInsertUrl(url.trim(), urlText.trim() || url.trim())}
            >
              add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- conflict panel (409) -------------------------------------------------

function ConflictPanel({
  conflict,
  onUseMerged,
  onReloadTheirs,
  onKeepMine,
  onDismiss,
}: {
  conflict: Conflict;
  onUseMerged: (content: string, sha: string | null) => void;
  onReloadTheirs: (content: string, sha: string | null) => void;
  onKeepMine: (sha: string | null) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="editor-conflict" role="alert">
      <span className="banner-title">this page changed since you opened it</span>
      <p className="banner-text">{conflict.instruction}</p>
      <div className="conflict-actions">
        {conflict.merged && (
          <button type="button" className="editor-save" onClick={() => onUseMerged(conflict.merged!.content, conflict.currentSha)}>
            use merged ({conflict.merged.strategy})
          </button>
        )}
        <button type="button" className="tool-btn wide" onClick={() => onKeepMine(conflict.currentSha)}>
          keep mine
        </button>
        <button type="button" className="tool-btn wide" onClick={() => onReloadTheirs(conflict.theirs, conflict.currentSha)}>
          reload theirs
        </button>
        <button type="button" className="tool-btn wide" onClick={onDismiss}>
          dismiss
        </button>
      </div>
    </div>
  );
}
