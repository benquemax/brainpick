/**
 * The editor's ProseMirror plugin stack: history, a markdown-shaped keymap
 * (bold/italic/code, list indent, hard breaks, code-block exit), the base keymap
 * and a gap cursor. Kept apart from the React component so the wiring is legible.
 */
import { baseKeymap, chainCommands, exitCode, toggleMark } from 'prosemirror-commands';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';
import { markdownInputRules } from './inputRules';
import { schema } from './schema';

export function buildPlugins(): Plugin[] {
  const { strong, em, code } = schema.marks;
  const { hard_break, list_item } = schema.nodes;

  const insertHardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
    return true;
  });

  const keys: Record<string, Command> = {
    'Mod-b': toggleMark(strong),
    'Mod-i': toggleMark(em),
    'Mod-`': toggleMark(code),
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    Backspace: undoInputRule,
    Enter: splitListItem(list_item),
    Tab: sinkListItem(list_item),
    'Shift-Tab': liftListItem(list_item),
    'Mod-[': liftListItem(list_item),
    'Mod-]': sinkListItem(list_item),
    'Shift-Enter': insertHardBreak,
    'Mod-Enter': exitCode,
  };

  // Order matters: list/inline keys first (they fall through when inapplicable),
  // then the base keymap, so plain Enter/Tab keep their default behaviour.
  return [markdownInputRules(), keymap(keys), keymap(baseKeymap), history(), gapCursor()];
}
