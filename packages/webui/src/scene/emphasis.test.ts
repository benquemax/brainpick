import { describe, expect, it } from 'vitest';
import { EMPHASIS } from './tuning';
import { focusIndex, nodeHighlightLevel } from './emphasis';

describe('focusIndex', () => {
  it('prefers hover over selection, falls back to selection, else -1', () => {
    expect(focusIndex(3, 7)).toBe(3); // hovering explores, over the resting selection
    expect(focusIndex(-1, 7)).toBe(7); // nothing hovered → the selection lights its own
    expect(focusIndex(-1, -1)).toBe(-1); // idle: nothing to light
  });
});

describe('nodeHighlightLevel', () => {
  const lvl = (over: Partial<Parameters<typeof nodeHighlightLevel>[0]> = {}) =>
    nodeHighlightLevel({ isSelection: false, isHovered: false, inSearch: false, isNeighbor: false, ...over });

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

  it('the emphasis ladder is calm-idle, lit-hover: hover brighter than search, than neighbour, than idle', () => {
    expect(EMPHASIS.selection).toBeGreaterThanOrEqual(EMPHASIS.hovered);
    expect(EMPHASIS.hovered).toBeGreaterThan(EMPHASIS.search);
    expect(EMPHASIS.search).toBeGreaterThan(EMPHASIS.neighbor);
    expect(EMPHASIS.neighbor).toBeGreaterThan(0);
  });
});
