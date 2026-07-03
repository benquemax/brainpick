import { describe, expect, it } from 'vitest';
import { buildGhostAnchors, phantomOffset } from './ghosts';

describe('phantomOffset', () => {
  it('is deterministic for a target id and sits at the requested distance', () => {
    const [ax, ay] = phantomOffset('olematon.md', 26);
    const [bx, by] = phantomOffset('olematon.md', 26);
    expect(ax).toBe(bx);
    expect(ay).toBe(by);
    expect(Math.hypot(ax, ay)).toBeCloseTo(26, 6);
  });

  it('spreads different phantom targets to different directions', () => {
    const a = phantomOffset('olematon.md', 26);
    const b = phantomOffset('toinen.md', 26);
    const angleA = Math.atan2(a[1], a[0]);
    const angleB = Math.atan2(b[1], b[0]);
    expect(Math.abs(angleA - angleB)).toBeGreaterThan(0.05);
  });
});

describe('buildGhostAnchors', () => {
  const index = new Map([
    ['a.md', 0],
    ['b.md', 1],
  ]);

  it('anchors each ghost to its live source with a deterministic offset', () => {
    const anchors = buildGhostAnchors(
      [
        { source: 'a.md', target: 'olematon.md' },
        { source: 'b.md', target: 'toinen.md' },
      ],
      index,
      26,
    );
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.sourceIndex).toBe(0);
    expect(anchors[1]?.sourceIndex).toBe(1);
    const [dx, dy] = phantomOffset('olematon.md', 26);
    expect(anchors[0]?.dx).toBe(dx);
    expect(anchors[0]?.dy).toBe(dy);
  });

  it('skips ghosts whose source node is not in the scene', () => {
    const anchors = buildGhostAnchors([{ source: 'missing.md', target: 'x.md' }], index, 26);
    expect(anchors).toHaveLength(0);
  });
});
