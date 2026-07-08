import { describe, expect, it } from 'vitest';
import { pickNearest, pickNearest3D, type Projected } from './pick';

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

  it('a dot the cursor is genuinely inside beats a closer dot it only grazes', () => {
    // Big dot A (r5) at the origin; tiny dot B (r0.3) whose CENTRE is nearer the cursor.
    // The cursor (4,0) is inside A but not on B. The old fat-tolerance nearest-centre
    // rule grabbed B; now being ON a dot wins — precision at density.
    const pos = new Float32Array([0, 0, 4.5, 0]);
    const rad = new Float32Array([5, 0.3]);
    expect(pickNearest(pos, 2, rad, 4, 0, 2)).toBe(0);
  });

  it('picks nothing on empty space beyond the small floor (no fat grab)', () => {
    // Far from every dot: the tight fallback floor must not reach out and grab one.
    expect(pickNearest(positions, 3, radii, 20, 20, 2)).toBe(-1);
  });
});

describe('pickNearest3D (brain-mode screen-space pick)', () => {
  // Three dots projected to the screen: two near (100,100), one far away.
  const dots: Record<number, Projected> = {
    0: { sx: 100, sy: 100, radiusPx: 10, depth: 50, visible: true },
    1: { sx: 105, sy: 100, radiusPx: 10, depth: 20, visible: true }, // in FRONT of 0
    2: { sx: 400, sy: 400, radiusPx: 10, depth: 30, visible: true },
  };
  const project = (i: number): Projected | null => dots[i] ?? null;

  it('selects the dot under the cursor', () => {
    expect(pickNearest3D(3, project, 398, 401, 12)).toBe(2);
  });

  it('resolves overlapping dots to the FRONT-most (smallest depth)', () => {
    // The cursor sits over both 0 and 1; 1 is nearer the camera, so it wins.
    expect(pickNearest3D(3, project, 102, 100, 12)).toBe(1);
  });

  it('returns -1 when the tap is beyond every dot radius', () => {
    expect(pickNearest3D(3, project, 250, 250, 12)).toBe(-1);
  });

  it('honours a minimum pick radius so small far dots stay tappable', () => {
    const tiny = { 0: { sx: 100, sy: 100, radiusPx: 1, depth: 40, visible: true } } as Record<number, Projected>;
    expect(pickNearest3D(1, (i) => tiny[i] ?? null, 108, 100, 16)).toBe(0); // within the 16px floor
    expect(pickNearest3D(1, (i) => tiny[i] ?? null, 108, 100, 4)).toBe(-1); // outside a 4px floor
  });

  it('skips dots behind the camera (not visible)', () => {
    const hidden = { 0: { sx: 100, sy: 100, radiusPx: 20, depth: 5, visible: false } } as Record<number, Projected>;
    expect(pickNearest3D(1, (i) => hidden[i] ?? null, 100, 100, 12)).toBe(-1);
  });

  it('picks the dot the cursor is ON, not a nearer-camera dot it only grazes', () => {
    // The precision fix: a background dot A the cursor is genuinely inside, and a
    // foreground dot B (nearer the camera) the cursor is NOT inside but within the min
    // floor. The old front-most rule stole the pick for B; now contained A wins.
    const dots: Record<number, Projected> = {
      0: { sx: 100, sy: 100, radiusPx: 12, depth: 50, visible: true }, // A: cursor inside
      1: { sx: 115, sy: 100, radiusPx: 3, depth: 5, visible: true }, // B: in front, not under cursor
    };
    const project = (i: number): Projected | null => dots[i] ?? null;
    expect(pickNearest3D(2, project, 103, 100, 16)).toBe(0);
  });
});
