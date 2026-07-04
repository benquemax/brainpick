import { describe, expect, it } from 'vitest';
import { bounds, gradient, isInside, sampleInsidePoints, sdf, type Vec3 } from './brainSDF';

const within = (p: Vec3): boolean =>
  p[0] >= bounds.min[0] && p[0] <= bounds.max[0] &&
  p[1] >= bounds.min[1] && p[1] <= bounds.max[1] &&
  p[2] >= bounds.min[2] && p[2] <= bounds.max[2];

describe('brainSDF classification', () => {
  it('classifies the cerebral cores as inside and far points as outside', () => {
    // A point deep in each hemisphere is inside; the origin (near the fissure/
    // corpus callosum) is inside too.
    expect(sdf(-0.4, 0.1, 0)).toBeLessThan(0); // left hemisphere
    expect(sdf(0.4, 0.1, 0)).toBeLessThan(0); // right hemisphere
    expect(sdf(0, 0, 0)).toBeLessThan(0); // centre
    expect(sdf(0, -0.56, -0.72)).toBeLessThan(0); // cerebellum
    expect(sdf(0, -0.7, -0.12)).toBeLessThan(0); // brain stem
  });

  it('classifies points well outside the bounds as outside', () => {
    expect(sdf(3, 0, 0)).toBeGreaterThan(0);
    expect(sdf(0, 3, 0)).toBeGreaterThan(0);
    expect(sdf(0, 0, 3)).toBeGreaterThan(0);
    expect(sdf(2, 2, 2)).toBeGreaterThan(0);
  });

  it('grows monotonically as a ray leaves the surface', () => {
    // Marching straight up from the top of the cerebrum, sdf must keep rising.
    let prev = -Infinity;
    for (let y = 0.85; y <= 2.5; y += 0.25) {
      const d = sdf(0, y, 0);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
    expect(prev).toBeGreaterThan(0);
  });
});

describe('brainSDF bounds', () => {
  it('every deterministically-sampled inside point falls within the declared bounds', () => {
    const pts = sampleInsidePoints(1500, 7);
    for (let i = 0; i < 1500; i++) {
      const p: Vec3 = [pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!];
      expect(within(p)).toBe(true);
      expect(isInside(p)).toBe(true); // sdf < 0
    }
  });

  it('the bounds actually enclose the form: the 8 corners are outside', () => {
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const y of [bounds.min[1], bounds.max[1]]) {
        for (const z of [bounds.min[2], bounds.max[2]]) {
          expect(sdf(x, y, z)).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('brainSDF hemispheric symmetry', () => {
  it('is mirror-symmetric across the sagittal plane x = 0', () => {
    const probes: Vec3[] = [
      [0.4, 0.1, 0], [0.25, 0.4, 0.3], [0.5, -0.2, 0.1],
      [0.3, -0.5, -0.6], [0.1, 0.6, -0.2], [0.7, 0, 0.5],
    ];
    for (const [x, y, z] of probes) {
      expect(sdf(x, y, z)).toBeCloseTo(sdf(-x, y, z), 6);
    }
  });

  it('has a symmetric gradient (the x-component flips sign across the midline)', () => {
    const g = gradient([0.45, 0.1, 0.2]);
    const gm = gradient([-0.45, 0.1, 0.2]);
    expect(gm[0]).toBeCloseTo(-g[0], 5);
    expect(gm[1]).toBeCloseTo(g[1], 5);
    expect(gm[2]).toBeCloseTo(g[2], 5);
  });

  it('shows the longitudinal fissure: the midline top dips below the hemisphere crowns', () => {
    // At a high slice the two hemispheres are inside but the midline is not —
    // the smooth-union groove between them is the fissure.
    const y = 0.62;
    expect(sdf(-0.32, y, 0)).toBeLessThan(0); // left crown, inside
    expect(sdf(0.32, y, 0)).toBeLessThan(0); // right crown, inside
    expect(sdf(0, y, 0)).toBeGreaterThan(sdf(0.32, y, 0)); // midline is higher (groove)
  });
});

describe('brainSDF gradient', () => {
  it('returns a unit outward normal that points away from the interior', () => {
    // Just outside the right hemisphere at +x, the normal should point +x-ish.
    const g = gradient([0.95, 0.05, 0]);
    expect(Math.hypot(g[0], g[1], g[2])).toBeCloseTo(1, 5);
    expect(g[0]).toBeGreaterThan(0);
  });
});

describe('brainSDF deterministic sampling', () => {
  it('is identical for the same seed and differs for another', () => {
    const a = sampleInsidePoints(400, 42);
    const b = sampleInsidePoints(400, 42);
    const c = sampleInsidePoints(400, 43);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('fills exactly n points, none NaN', () => {
    const pts = sampleInsidePoints(256, 1);
    expect(pts.length).toBe(256 * 3);
    expect(Array.from(pts).every((v) => Number.isFinite(v))).toBe(true);
  });
});
