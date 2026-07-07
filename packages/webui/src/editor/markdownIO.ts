/**
 * Markdown ⇄ ProseMirror, tuned for byte-stable OKF output.
 *
 * The BODY of a doc (frontmatter already stripped) round-trips through here:
 * `parseBody` builds a ProseMirror document the WYSIWYG edits, `serializeBody`
 * writes it back as clean, consistent markdown. The bar is idempotence — parse →
 * serialize → parse → serialize must converge, and every link keeps its text and
 * kebab href — so both directions are deterministic and the serializer is tuned
 * (bullets as `-`, GFM tables preserved) rather than left to reflow.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import {
  MarkdownParser,
  MarkdownSerializer,
  type MarkdownSerializerState,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, type CellAlign } from './schema';

// CommonMark + GFM tables only — no linkify/typographer/strikethrough, so the
// serializer never has to reproduce a feature the schema can't hold.
const markdownIt = MarkdownIt('commonmark', { html: false }).enable(['table']);

function alignAttrs(token: Token): { align: CellAlign } {
  const style = typeof token.attrGet === 'function' ? token.attrGet('style') : null;
  const match = style ? /text-align:\s*(left|center|right)/.exec(style) : null;
  return { align: match ? (match[1] as CellAlign) : null };
}

/** Base markdown tokens + the table family (thead/tbody are transparent). */
const tokens = {
  ...defaultMarkdownParser.tokens,
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: alignAttrs },
  td: { block: 'table_cell', getAttrs: alignAttrs },
};

const parser = new MarkdownParser(schema, markdownIt, tokens);

function sepFor(align: CellAlign): string {
  return align === 'center' ? ':---:' : align === 'left' ? ':---' : align === 'right' ? '---:' : '---';
}

/** One table cell's inline content → single-line markdown (pipes escaped). */
function serializeCell(cellNode: PMNode): string {
  const paragraph = schema.nodes.paragraph.create(null, cellNode.content);
  const doc = schema.nodes.doc.create(null, paragraph);
  const text = serializer.serialize(doc).replace(/\r?\n/g, ' ').trim();
  return text.replace(/\|/g, '\\|');
}

/** Emit a GFM pipe table: header row, alignment separator, body rows. */
function serializeTable(state: MarkdownSerializerState, node: PMNode): void {
  const rows: { cells: string[]; aligns: CellAlign[] }[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    const aligns: CellAlign[] = [];
    row.forEach((cellNode) => {
      cells.push(serializeCell(cellNode));
      aligns.push((cellNode.attrs.align as CellAlign) ?? null);
    });
    rows.push({ cells, aligns });
  });
  if (rows.length === 0) return;
  const header = rows[0];
  if (header === undefined) return;
  const emit = (cells: string[]) => {
    state.write(`| ${cells.join(' | ')} |`);
    state.ensureNewLine();
  };
  emit(header.cells);
  emit(header.aligns.map(sepFor));
  for (let r = 1; r < rows.length; r++) emit(rows[r]!.cells);
  state.closeBlock(node);
}

const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    // Kebab-corpus house style: `-` bullets (the default serializer emits `*`).
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    table: serializeTable,
    // Rendered by `table`; present so no node type is ever handler-less.
    table_row() {},
    table_header() {},
    table_cell() {},
  },
  defaultMarkdownSerializer.marks,
);

/** Parse a doc BODY (no frontmatter) into a ProseMirror document. */
export function parseBody(markdown: string): PMNode {
  return parser.parse(markdown) ?? schema.nodes.doc.createAndFill()!;
}

/** Serialize a ProseMirror document back to clean markdown (no trailing NL). */
export function serializeBody(doc: PMNode): string {
  return serializer.serialize(doc);
}

export { schema };
