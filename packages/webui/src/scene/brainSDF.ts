/**
 * A procedural, code-generated signed distance function for an anatomical brain
 * silhouette — NO external mesh or .glb, everything computed here.
 *
 * The form is a metaball-style smooth-union (smin) of implicit primitives, in a
 * right-handed natural-unit space (roughly a unit brain):
 *   x = left(−)/right(+), y = inferior(−)/superior(+), z = posterior(−)/anterior(+)
 *
 * It is shaped to read as a BRAIN, not two round cheeks:
 *   - the cerebrum is ELONGATED antero-posterior (longer front-to-back than wide),
 *     a fuller frontal bulge tapering to a rounded occipital at the back;
 *   - two hemispheres, only modestly offset and smooth-unioned into one body, with
 *     a SUBTLE longitudinal fissure carved as a shallow groove along the top only
 *     (not a deep midline cleft);
 *   - temporal lobes bulging lower on the sides;
 *   - a flatter, tucked underside (the lower half is compressed, not a round ball);
 *   - a cerebellum tucked under-and-back, and a brain stem descending below.
 *
 * `sdf` is negative inside, positive outside. It is an approximate distance (the
 * ellipsoid term is iq's bound, not exact), which is all the containment force and
 * the shell sampler need — the sign is exact and the gradient points outward.
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

/** Distance to a capsule (line segment a→b, radius r) — the brain stem / fissure tube. */
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

/** Smooth-max — the dual of smin; used to carve the fissure (smooth subtraction). */
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Hermite smoothstep in [edge0, edge1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const HEMI_OFFSET_X = 0.19; // modest — one brain with a hint of midline, not two cheeks
const HEMI = { rx: 0.46, ry: 0.62, rz: 0.95, cy: 0.12, cz: 0.06 } as const;
const TEMPORAL = { dx: 0.42, cy: -0.16, cz: 0.08, rx: 0.26, ry: 0.3, rz: 0.52 } as const;
const CEREBELLUM = { cx: 0, cy: -0.52, cz: -0.62, rx: 0.5, ry: 0.3, rz: 0.42 } as const;
const STEM = { ax: 0, ay: -0.26, az: -0.16, bx: 0, by: -0.92, bz: -0.02, r: 0.12 } as const;
// The longitudinal fissure: a thin tube skimming ONLY the very top midline,
// subtracted — a shallow superior groove, well above the parietal seed at y≈0.44.
const FISSURE = { cy: 0.62, az: -0.5, bz: 0.66, r: 0.11 } as const;

const K_HEMI = 0.16; // hemisphere↔hemisphere: a soft seam, not a crease
const K_TEMPORAL = 0.14; // cerebrum↔temporal lobes
const K_STEM = 0.1; // cerebellum↔stem
const K_JOIN = 0.13; // cerebrum↔(cerebellum+stem)
const K_FISSURE = 0.06; // shallow, smooth groove

/** One cerebral hemisphere, tapered narrower toward the occipital (back). */
function hemisphere(x: number, y: number, z: number, side: number): number {
  const px = x - side * HEMI_OFFSET_X;
  const py = y - HEMI.cy;
  const pz = z - HEMI.cz;
  // 0 at the occipital pole (−z) → 1 at the frontal pole (+z): the back is slimmer,
  // the front stays full, so the body reads bulbous-front / tapered-back.
  const t = smoothstep(-0.9, 0.24, z);
  const rx = HEMI.rx * (0.72 + 0.28 * t);
  const ry = HEMI.ry * (0.9 + 0.1 * t);
  return sdEllipsoid(px, py, pz, rx, ry, HEMI.rz);
}

/** Signed distance to the brain, in natural units. Negative inside. */
export function sdf(x: number, y: number, z: number): number {
  // Flatten/tuck the underside: gently lift the sampled y below the centre so the
  // bottom surface reads flatter than a round ball (the cerebrum sits on a base).
  const yc = y < HEMI.cy ? HEMI.cy + (y - HEMI.cy) * 0.82 : y;

  let cerebrum = smin(hemisphere(x, yc, z, -1), hemisphere(x, yc, z, 1), K_HEMI);

  // Temporal lobes: bulges low on each side, toward the front.
  const tempL = sdEllipsoid(x + TEMPORAL.dx, yc - TEMPORAL.cy, z - TEMPORAL.cz, TEMPORAL.rx, TEMPORAL.ry, TEMPORAL.rz);
  const tempR = sdEllipsoid(x - TEMPORAL.dx, yc - TEMPORAL.cy, z - TEMPORAL.cz, TEMPORAL.rx, TEMPORAL.ry, TEMPORAL.rz);
  cerebrum = smin(cerebrum, smin(tempL, tempR, K_TEMPORAL), K_TEMPORAL);

  // Carve the longitudinal fissure — a shallow top-midline groove (smooth subtract).
  const fissure = sdCapsule(x, y - FISSURE.cy, z, 0, 0, FISSURE.az, 0, 0, FISSURE.bz, FISSURE.r);
  cerebrum = smax(cerebrum, -fissure, K_FISSURE);

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
  min: [-0.85, -1.1, -1.12] as Vec3,
  max: [0.85, 0.8, 1.05] as Vec3,
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
