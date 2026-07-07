/**
 * Toolbar commands over the editor schema. The link + image builders are pure
 * `Transaction` factories (no EditorView, no DOM) so the OKF "link text = target
 * title" guarantee is unit-tested directly; the view wrappers just dispatch them.
 */
import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';

const { strong, em, code, link } = schema.marks;
const { heading, paragraph, code_block, blockquote, bullet_list, ordered_list, image } = schema.nodes;

export const toggleStrong: Command = toggleMark(strong);
export const toggleEm: Command = toggleMark(em);
export const toggleCode: Command = toggleMark(code);
export const wrapBlockquote: Command = wrapIn(blockquote);
export const wrapBulletList: Command = wrapInList(bullet_list);
export const wrapOrderedList: Command = wrapInList(ordered_list);
export const setCodeBlock: Command = setBlockType(code_block);

/** Set the block to a heading level, or back to a paragraph when re-applied. */
export function setHeading(level: number): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    const active = $from.parent.type === heading && $from.parent.attrs.level === level;
    return active
      ? setBlockType(paragraph)(state, dispatch, view)
      : setBlockType(heading, { level })(state, dispatch, view);
  };
}

/** Is a mark active across the current selection (for toolbar highlighting)? */
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** Which block type the cursor sits in — drives the heading/quote/code toolbar state. */
export function blockActive(state: EditorState): { heading: number | null; blockquote: boolean; codeBlock: boolean } {
  const { $from } = state.selection;
  const parent = $from.parent;
  const wrappedInQuote = (() => {
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === blockquote) return true;
    return false;
  })();
  return {
    heading: parent.type === heading ? (parent.attrs.level as number) : null,
    blockquote: wrappedInQuote,
    codeBlock: parent.type === code_block,
  };
}

/**
 * Replace the selection with a link whose TEXT is `text` and whose href is
 * `href` — the OKF invariant (link text = the target doc's title) made literal.
 * An empty `text` (external link over a selection) keeps the selected text.
 */
export function linkTransaction(state: EditorState, href: string, text: string): Transaction {
  const mark = link.create({ href, title: null });
  const { from, to, empty } = state.selection;
  let tr = state.tr;
  if (text !== '') {
    tr = tr.replaceRangeWith(from, to, schema.text(text, [mark]));
    tr = tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  } else if (!empty) {
    tr = tr.addMark(from, to, mark);
  }
  return tr;
}

/** Insert an inline image (`![alt](src)`) at the cursor. */
export function imageTransaction(state: EditorState, src: string, alt: string): Transaction {
  return state.tr.replaceSelectionWith(image.create({ src, alt: alt || null, title: null }), false);
}

export function insertLink(view: EditorView, href: string, text: string): void {
  view.dispatch(linkTransaction(view.state, href, text).scrollIntoView());
  view.focus();
}

export function insertImage(view: EditorView, src: string, alt: string): void {
  view.dispatch(imageTransaction(view.state, src, alt).scrollIntoView());
  view.focus();
}

export function run(view: EditorView, command: Command): void {
  command(view.state, view.dispatch, view);
  view.focus();
}
