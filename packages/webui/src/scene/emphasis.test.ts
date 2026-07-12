import { describe, expect, it } from 'vitest';
import { EMPHASIS } from './tuning';
import { edgeLensDim, focusIndex, lensAllowsLabel, nodeHighlightLevel } from './emphasis';

describe('focusIndex', () => {
  // Tom (2026-07-12): with a node SELECTED, hovering must not steal the
  // neighbourhood — you are following the selection's connections to click
  // one, and the visual clue must hold still under the cursor.
  it('a selection anchors the neighbourhood; hover explores only when nothing is selected', () => {
    expect(focusIndex(3, 7)).toBe(7); // selection wins over a passing hover
    expect(focusIndex(3, -1)).toBe(3); // no selection → hover previews its own
    expect(focusIndex(-1, 7)).toBe(7); // nothing hovered → the selection lights its own
    expect(focusIndex(-1, -1)).toBe(-1); // idle: nothing to light
  });

  it('a lens-hidden hover never becomes the focus', () => {
    expect(focusIndex(3, -1, true)).toBe(-1); // hovering the dim wall pops nothing
    expect(focusIndex(3, 7, true)).toBe(7); // …and the selection stays the anchor
  });
});

describe('nodeHighlightLevel', () => {
  const lvl = (over: Partial<Parameters<typeof nodeHighlightLevel>[0]> = {}) =>
    nodeHighlightLevel({
      isSelection: false,
      isHovered: false,
      inSearch: false,
      isNeighbor: false,
      lensHidden: false,
      ...over,
    });

  it('ranks selection > hover > search > neighbour > idle', () => {
    expect(lvl({ isSelection: true })).toBe(EMPHASIS.selection);
    expect(lvl({ isHovered: true })).toBe(EMPHASIS.hovered);
    expect(lvl({ inSearch: true })).toBe(EMPHASIS.search);
    expect(lvl({ isNeighbor: true })).toBe(EMPHASIS.neighbor);
    expect(lvl()).toBe(0);
  });

  it('a stronger role wins when a node is both (e.g. hovered AND a neighbour)', () => {
    expect(lvl({ isHovered: true, isNeighbor: true })).toBe(EMPHASIS.hovered);
    expect(lvl({ isSelection: true, isHovered: true })).toBe(EMPHASIS.selection);
  });

  // Tom (2026-07-12): nodes outside an active lens are "hidden" — hovering
  // them must not lift them or their neighbourhood out of the dim. Only a
  // deliberate selection still reads (it was clicked on purpose).
  it('a lens-hidden node stays dim under hover and neighbourhood lift', () => {
    expect(lvl({ isHovered: true, lensHidden: true })).toBe(0);
    expect(lvl({ isNeighbor: true, lensHidden: true })).toBe(0);
    expect(lvl({ isSelection: true, lensHidden: true })).toBe(EMPHASIS.selection);
  });

  it('the emphasis ladder is calm-idle, lit-hover: hover brighter than search, than neighbour, than idle', () => {
    expect(EMPHASIS.selection).toBeGreaterThanOrEqual(EMPHASIS.hovered);
    expect(EMPHASIS.hovered).toBeGreaterThan(EMPHASIS.search);
    expect(EMPHASIS.search).toBeGreaterThan(EMPHASIS.neighbor);
    expect(EMPHASIS.neighbor).toBeGreaterThan(0);
  });
});

describe('edgeLensDim', () => {
  // The lens governs edges per-edge: connections BETWEEN lens members stay
  // full, a lens member's connections outward read at half (they answer
  // "what is this connected to"), and hidden-to-hidden fades to a whisper.
  it('grades an edge by how many endpoints the lens keeps visible', () => {
    expect(edgeLensDim(true, true)).toBe(0);
    expect(edgeLensDim(true, false)).toBe(0.5);
    expect(edgeLensDim(false, true)).toBe(0.5);
    expect(edgeLensDim(false, false)).toBe(1);
  });
});

describe('lensAllowsLabel', () => {
  // Tom (2026-07-12): with a lens active, labels of hidden nodes "make no
  // sense because the nodes aren't shown" — only lens members get named.
  it('hides labels for nodes outside an active lens', () => {
    expect(lensAllowsLabel(false, false)).toBe(true); // no lens: everyone may label
    expect(lensAllowsLabel(false, true)).toBe(true);
    expect(lensAllowsLabel(true, true)).toBe(true); // lens member: labeled
    expect(lensAllowsLabel(true, false)).toBe(false); // hidden: no name floating
  });
});
