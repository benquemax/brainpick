/**
 * Shareable view URLs: the single serializer/parser for the address bar.
 * The query string IS the sender's view — doc, view mode, layer, lens,
 * ghost toggle, and the time-machine moment — so a copy-pasted URL
 * replicates the view, live or on the static Pages demo alike. The
 * serializer is the ONE writer of these params (TimeMachine's ?commit=
 * rides through it too); the parser is tolerant of junk.
 */
import { describe, expect, it } from 'vitest';
import { NO_LENS } from './lens';
import { filterShareParams, parseViewParams, serializeViewState, type ViewStateInput } from './urlState';

const BASE: ViewStateInput = {
  selection: null,
  mode: 'cosmos',
  layer: 'links',
  lens: NO_LENS,
  showGhosts: true,
  momentSha: null,
};

describe('serializeViewState', () => {
  it('always pins the view mode — that is what makes a link replicable', () => {
    expect(serializeViewState(BASE)).toBe('?view=cosmos');
    expect(serializeViewState({ ...BASE, mode: 'brain' })).toBe('?view=brain');
  });

  it('carries the selected doc, path-encoded', () => {
    expect(serializeViewState({ ...BASE, selection: 'reference/adr/two-axis-ontology.md' })).toBe(
      '?doc=reference%2Fadr%2Ftwo-axis-ontology.md&view=cosmos',
    );
  });

  it('omits defaults: links layer, no lens, ghosts on, present time', () => {
    const q = serializeViewState(BASE);
    expect(q).not.toContain('layer=');
    expect(q).not.toContain('lens=');
    expect(q).not.toContain('ghosts=');
    expect(q).not.toContain('commit=');
  });

  it('serializes layer, lens variants, ghosts-off and the moment', () => {
    expect(
      serializeViewState({
        ...BASE,
        selection: 'aurinko.md',
        mode: 'brain',
        layer: 'entities',
        lens: { kind: 'tag', tag: 'agents' },
        showGhosts: false,
        momentSha: 'abc123',
      }),
    ).toBe('?doc=aurinko.md&view=brain&layer=entities&lens=tag%3Aagents&ghosts=0&commit=abc123');
    expect(serializeViewState({ ...BASE, lens: { kind: 'orphans' } })).toContain('lens=orphans');
    expect(serializeViewState({ ...BASE, lens: { kind: 'about', about: 'concept' } })).toContain(
      'lens=about%3Aconcept',
    );
  });
});

describe('filterShareParams', () => {
  const FULL = '?doc=aurinko.md&view=brain&layer=entities&lens=orphans&ghosts=0&commit=abc';

  it('keeps only the chosen params, order preserved', () => {
    expect(filterShareParams(FULL, new Set(['doc', 'view']))).toBe('?doc=aurinko.md&view=brain');
    expect(filterShareParams(FULL, new Set(['commit']))).toBe('?commit=abc');
  });

  it('an empty choice yields a bare link', () => {
    expect(filterShareParams(FULL, new Set())).toBe('');
  });
});

describe('parseViewParams', () => {
  it('round-trips what the serializer wrote', () => {
    const input: ViewStateInput = {
      selection: 'saaret/atolli.md',
      mode: 'brain',
      layer: 'overlay',
      lens: { kind: 'about', about: 'place' },
      showGhosts: false,
      momentSha: null,
    };
    const parsed = parseViewParams(serializeViewState(input));
    expect(parsed).toEqual({
      doc: 'saaret/atolli.md',
      view: 'brain',
      layer: 'overlay',
      lens: { kind: 'about', about: 'place' },
      showGhosts: false,
    });
  });

  it('returns the empty object for an empty or foreign query', () => {
    expect(parseViewParams('')).toEqual({});
    // commit/t belong to the time-machine deep link (parseDeepLink) — not ours
    expect(parseViewParams('?commit=abc123&t=2026-01-01')).toEqual({});
  });

  it('ignores junk values instead of importing them', () => {
    expect(parseViewParams('?view=hologram&layer=lasagne&lens=vibes:cool&ghosts=maybe')).toEqual({});
    expect(parseViewParams('?view=brain&layer=lasagne')).toEqual({ view: 'brain' });
  });

  it('parses every lens kind', () => {
    expect(parseViewParams('?lens=orphans')).toEqual({ lens: { kind: 'orphans' } });
    expect(parseViewParams('?lens=tag%3Aagents')).toEqual({ lens: { kind: 'tag', tag: 'agents' } });
    expect(parseViewParams('?lens=about%3Athing')).toEqual({ lens: { kind: 'about', about: 'thing' } });
  });
});
