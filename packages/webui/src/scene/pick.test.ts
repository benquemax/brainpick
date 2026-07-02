import { describe, expect, it } from 'vitest';
import { pickNearest } from './pick';

// positions: xy pairs. Three nodes at (0,0), (10,0), (0,10).
const positions = new Float32Array([0, 0, 10, 0, 0, 10]);
const radii = new Float32Array([1, 1, 5]);

describe('pickNearest', () => {
  it('returns the nearest node within the pick distance', () => {
    expect(pickNearest(positions, 3, radii, 9, 0.5, 2)).toBe(1);
    expect(pickNearest(positions, 3, radii, 0.4, -0.4, 2)).toBe(0);
  });

  it('returns -1 when nothing is close enough', () => {
    expect(pickNearest(positions, 3, radii, 5, 5, 2)).toBe(-1);
  });

  it('lets a large node win beyond the base pick distance via its radius', () => {
    // (0,10) has radius 5; a click 4 units away hits it even with maxDist 2.
    expect(pickNearest(positions, 3, radii, 4, 10, 2)).toBe(2);
  });

  it('respects the count bound (ignores stale tail entries)', () => {
    expect(pickNearest(positions, 2, radii, 0, 10, 2)).toBe(-1);
  });
});
