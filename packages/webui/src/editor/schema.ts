/**
 * The WYSIWYG editor's ProseMirror schema — the markdown schema shipped by
 * prosemirror-markdown (doc/paragraph/heading/blockquote/code_block/lists/
 * image/hard_break; marks em/strong/code/link) EXTENDED with GFM pipe tables.
 *
 * Tables are added as plain nodes (no prosemirror-tables dependency): the two
 * reference docs in the bundle (the-tiers.md, runtime-parity.md) carry matrices,
 * and the round-trip fidelity bar is "every docs/*.md survives" — so the editor
 * must at least preserve a table through a save, not mangle it into paragraphs.
 */
import { Schema, type NodeSpec } from 'prosemirror-model';
import { schema as markdownSchema } from 'prosemirror-markdown';

/** A GFM cell alignment, mirrored from the header separator (`:--`, `--:`, `:-:`). */
export type CellAlign = 'left' | 'center' | 'right' | null;

function cellStyle(align: CellAlign): { [k: string]: string } | null {
  return align ? { style: `text-align:${align}` } : null;
}

function alignFromDom(dom: HTMLElement): CellAlign {
  const raw = (dom.style.textAlign || dom.getAttribute('align') || '').toLowerCase();
  return raw === 'left' || raw === 'center' || raw === 'right' ? raw : null;
}

const cell = (tag: 'td' | 'th'): NodeSpec => ({
  content: 'inline*',
  attrs: { align: { default: null } },
  isolating: true,
  parseDOM: [{ tag, getAttrs: (dom) => ({ align: alignFromDom(dom as HTMLElement) }) }],
  toDOM(node) {
    const attrs = cellStyle(node.attrs.align as CellAlign);
    return [tag, attrs ?? {}, 0];
  },
});

const tableNodes: Record<string, NodeSpec> = {
  table: {
    content: 'table_row+',
    group: 'block',
    isolating: true,
    parseDOM: [{ tag: 'table' }],
    toDOM: () => ['table', ['tbody', 0]],
  },
  table_row: {
    content: '(table_cell | table_header)+',
    parseDOM: [{ tag: 'tr' }],
    toDOM: () => ['tr', 0],
  },
  table_cell: cell('td'),
  table_header: cell('th'),
};

/** The editor schema: markdown nodes + tables, markdown marks unchanged. */
export const schema = new Schema({
  nodes: markdownSchema.spec.nodes.append(tableNodes),
  marks: markdownSchema.spec.marks,
});
