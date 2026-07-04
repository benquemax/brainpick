/**
 * A procedural, code-generated signed distance function for an anatomical brain
 * silhouette — NO external mesh or .glb, everything computed here.
 *
 * The form is a metaball-style smooth-union (smin) of implicit primitives, in a
 * right-handed natural-unit space (roughly a unit brain):
 *   x = left(−)/right(+), y = inferior(−)/superior(+), z = posterior(−)/anterior(+)
 *
 *   - two cerebral hemispheres: ellipsoids offset ±x, overlapping at the midline
 *     so the smooth union leaves a longitudinal-fissure groove between them;
 *   - a cerebellum: a wider, flatter ellipsoid low and to the back;
 *   - a brain stem: a short capsule descending from the centre.
 *
 * `sdf` is negative inside, positive outside. It is an approximate distance
 * (the ellipsoid term is iq's bound, not exact), which is all the containment
 * force and the shell sampler need — sign is exact, the gradient points outward.
 */
import { BRAIN } from './tuning';

export type Vec3 = readonly [number, number, number];

/** iq's ellipsoid bound: negative inside, ~distance outside. Guarded at centre. */
function sdEllipsoid(px: number, py: number, pz: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  if (k0 < 1e-6) return -Math.min(rx, ry, rz); // deep inside — avoid 0/0
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return (k0 * (k0 - 1)) / k1;
}

/** Distance to a capsule (line segment a→b, radius r) — the brain stem. */
function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const baLen2 = bax * bax + bay * bay + baz * baz;
  const h = baLen2 === 0 ? 0 : Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / baLen2));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.hypot(dx, dy, dz) - r;
}

/** Polynomial smooth-min (metaball blend). k → 0 recovers a hard union. */
function smin(a: number, b: number, k: number): number {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k));
  return b + h * (a - b) - k * h * (1 - h);
}

/** Two hemispheres, offset ±x and overlapping so the union grooves at the midline. */
const HEMI_OFFSET_X = 0.4;
const HEMI = { rx: 0.6, ry: 0.72, rz: 1.0, cy: 0.05 } as const;
const CEREBELLUM = { cx: 0, cy: -0.56, cz: -0.72, rx: 0.54, ry: 0.34, rz: 0.44 } as const;
const STEM = { ax: 0, ay: -0.28, az: -0.22, bx: 0, by: -0.94, bz: -0.06, r: 0.13 } as const;

const K_HEMI = 0.14; // hemisphere↔hemisphere: keeps the fissure a groove, not a crease
const K_STEM = 0.1; // cerebellum↔stem
const K_JOIN = 0.13; // cerebrum↔(cerebellum+stem)

/** Signed distance to the brain, in natural units. Negative inside. */
export function sdf(x: number, y: number, z: number): number {
  const left = sdEllipsoid(x + HEMI_OFFSET_X, y - HEMI.cy, z, HEMI.rx, HEMI.ry, HEMI.rz);
  const right = sdEllipsoid(x - HEMI_OFFSET_X, y - HEMI.cy, z, HEMI.rx, HEMI.ry, HEMI.rz);
  const cerebrum = smin(left, right, K_HEMI);
  const cerebellum = sdEllipsoid(x - CEREBELLUM.cx, y - CEREBELLUM.cy, z - CEREBELLUM.cz, CEREBELLUM.rx, CEREBELLUM.ry, CEREBELLUM.rz);
  const stem = sdCapsule(x, y, z, STEM.ax, STEM.ay, STEM.az, STEM.bx, STEM.by, STEM.bz, STEM.r);
  const lower = smin(cerebellum, stem, K_STEM);
  return smin(cerebrum, lower, K_JOIN);
}

/** Numerical outward normal (normalized central-difference gradient). */
export function gradient(p: Vec3): Vec3 {
  const [x, y, z] = p;
  const e = 1e-3;
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
  const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
  const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const len = Math.hypot(gx, gy, gz) || 1;
  return [gx / len, gy / len, gz / len];
}

/** An axis-aligned box that fully contains the brain (with margin for the smin bulge). */
export const bounds = {
  min: [-1.15, -1.2, -1.25] as Vec3,
  max: [1.15, 0.92, 1.16] as Vec3,
} as const;

/** True when a point lies inside (or on) the surface, within an optional tolerance. */
export function isInside(p: Vec3, tolerance = 0): boolean {
  return sdf(p[0], p[1], p[2]) <= tolerance;
}

/** Deterministic PRNG (mulberry32) — no Math.random anywhere in the brain math. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically rejection-sample `n` points strictly inside the brain,
 * returned as a flat Float32Array [x0,y0,z0, x1,…] in natural units. The seed is
 * injected (workflow rule: no ambient Math.random). If the acceptance budget is
 * exhausted the remaining slots fall back to the centroid — never NaN.
 */
export function sampleInsidePoints(n: number, seed: number = BRAIN.seed): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.max(0, n) * 3);
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  let filled = 0;
  let attempts = 0;
  const maxAttempts = Math.max(64, n * 200);
  while (filled < n && attempts < maxAttempts) {
    attempts++;
    const x = minX + rng() * spanX;
    const y = minY + rng() * spanY;
    const z = minZ + rng() * spanZ;
    if (sdf(x, y, z) < 0) {
      out[filled * 3] = x;
      out[filled * 3 + 1] = y;
      out[filled * 3 + 2] = z;
      filled++;
    }
  }
  for (; filled < n; filled++) {
    out[filled * 3] = 0;
    out[filled * 3 + 1] = -0.1;
    out[filled * 3 + 2] = 0;
  }
  return out;
}
