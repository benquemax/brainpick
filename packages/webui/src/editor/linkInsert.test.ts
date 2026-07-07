import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { imageTransaction, linkTransaction } from './commands';
import { serializeBody, schema } from './markdownIO';

/** A doc with one paragraph "prefix " and the cursor at the end of it. */
function stateWithCursor(text = 'prefix '): EditorState {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, text ? [schema.text(text)] : [])]);
  const state = EditorState.create({ schema, doc });
  const end = text.length + 1; // +1 for the paragraph's open boundary
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
}

describe('the link picker inserts a title-text link (the OKF killer feature)', () => {
  it("uses the target doc's TITLE as the link text, and its kebab path as the href", () => {
    const state = stateWithCursor('see ');
    const tr = linkTransaction(state, 'compile-pipeline.md', 'Compile pipeline');
    const md = serializeBody(tr.doc);
    expect(md).toBe('see [Compile pipeline](compile-pipeline.md)');
  });

  it('marks the existing selection when linking an external URL (empty text keeps the selection)', () => {
    let state = stateWithCursor('brainpick');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 10))); // select "brainpick"
    const tr = linkTransaction(state, 'https://brainpick.dev', '');
    expect(serializeBody(tr.doc)).toBe('[brainpick](https://brainpick.dev)');
  });

  it('inserts an inline image with the returned assets/ path', () => {
    const state = stateWithCursor('');
    const tr = imageTransaction(state, 'assets/reef.png', 'a reef');
    expect(serializeBody(tr.doc)).toBe('![a reef](assets/reef.png)');
  });

  it('a title-text link survives a full round-trip through the serializer', () => {
    const state = stateWithCursor('');
    const linked = linkTransaction(state, 'saaret/atolli.md', 'Atolli');
    expect(serializeBody(linked.doc)).toBe('[Atolli](saaret/atolli.md)');
  });
});
