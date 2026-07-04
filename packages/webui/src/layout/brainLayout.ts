/**
 * The 3D brain layout: a force relaxation CONSTRAINED inside the brain SDF, seeded
 * to fill the VOLUME (not a flat sheet).
 *
 * The old layout dropped every node on its lobe's centroid POINT plus small
 * jitter, so a small graph (one or two communities, whose first anatomical lobes
 * — frontal-L/R — share a y and z and differ only in x) relaxed into a near-planar
 * disc: orbiting it read as "a 2D plane spinning in 3D". The fix seeds every node
 * at a real 3D point sampled INSIDE the SDF within a box around its lobe centroid,
 * with the box growing as the community count drops so even a 10-node graph
 * scatters through the brain volume. Relaxation then only refines: short-range
 * repulsion spaces the cloud, gentle link springs keep clusters together, and a
 * home anchor pulls each node back toward its own volumetric seed (never the
 * shared centroid) so the 3D spread is preserved instead of collapsing. A
 * CONTAINMENT force is the last word each round: sample the SDF and, if a node has
 * drifted to or past the surface, push it back along −gradient to a hair inside.
 * The result is a Float32Array of 3D positions aligned to the renderer's node order.
 *
 * Pure and deterministic given the graph + seed (mulberry32, no ambient random),
 * so it is fully unit-testable — the containment invariant and the anti-planar
 * variance ratio are the key tests.
 */
import { gradient, mulberry32, sdf, type Vec3 } from '../scene/brainSDF';
import { BRAIN } from '../scene/tuning';

/** How many anatomical lobes the community mapping spreads over (communities.ts). */
const LOBE_COUNT = 7;

export interface BrainLayoutInput {
  /** Node count = ids.length; only the count matters here (order is the seeds'). */
  count: number;
  /** Undirected edges as index pairs into the node order. */
  edges: ReadonlyArray<readonly [number, number]>;
  /** Per-node lobe centroid (SDF natural units) — the community seed positions. */
  seeds: ReadonlyArray<Vec3>;
  /** Deterministic seed. */
  seed?: number;
  /** World-units multiplier applied to the natural-unit result. */
  scale?: number;
  /** Override the (otherwise node-count-adaptive) relaxation round count. */
  iterations?: number;
}

/** Adaptive round count: full detail on small brains, fewer on huge ones. */
function roundsFor(count: number): number {
  const full = BRAIN.layoutIterations;
  const adaptive = Math.round((full * 500) / (count + 500));
  return Math.max(24, Math.min(full, adaptive));
}

/** Push a point to just inside the surface (a few Newton steps along −gradient). */
function projectInside(p: [number, number, number], margin: number): void {
  for (let k = 0; k < 6; k++) {
    const s = sdf(p[0], p[1], p[2]);
    if (s <= -margin) return;
    const g = gradient(p);
    const step = s + margin;
    p[0] -= g[0] * step;
    p[1] -= g[1] * step;
    p[2] -= g[2] * step;
  }
}

/** Distinct lobe centroids among the seeds — the effective community/lobe count. */
function distinctLobes(seeds: ReadonlyArray<Vec3>, n: number): number {
  const keys = new Set<string>();
  for (let i = 0; i < n; i++) {
    const c = seeds[i];
    if (!c) continue;
    // round to a hair so float noise never splits a shared centroid.
    keys.add(`${Math.round(c[0] * 1e3)},${Math.round(c[1] * 1e3)},${Math.round(c[2] * 1e3)}`);
  }
  return Math.max(1, keys.size);
}

/**
 * The volumetric seed for one node: rejection-sample a point strictly inside the
 * SDF within a SPHERE of radius `radius` around the sampling centre. A sphere (not
 * a box) keeps the cloud round — box corners would reach the brain's elongated
 * front/back ends and stretch a small cluster along one axis. Because the sphere
 * around a near-surface centre pokes OUT of the brain, accepted points skew toward
 * the interior — that is exactly where the depth the old flat layout lacked comes
 * from. Deterministic: consumes the injected rng in a fixed order. Falls back to
 * the centre projected inside if the sphere never lands (tiny lobe on the surface).
 */
function seedInVolume(
  out: [number, number, number],
  rng: () => number,
  cx: number, cy: number, cz: number,
  radius: number, margin: number,
): void {
  const r2 = radius * radius;
  for (let t = 0; t < 64; t++) {
    const ox = (rng() - 0.5) * 2 * radius;
    const oy = (rng() - 0.5) * 2 * radius;
    const oz = (rng() - 0.5) * 2 * radius;
    if (ox * ox + oy * oy + oz * oz > r2) continue; // keep the ball round
    const x = cx + ox, y = cy + oy, z = cz + oz;
    if (sdf(x, y, z) < -margin) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return;
    }
  }
  out[0] = cx + (rng() - 0.5) * 0.1;
  out[1] = cy + (rng() - 0.5) * 0.1;
  out[2] = cz + (rng() - 0.5) * 0.1;
  projectInside(out, margin);
}

/**
 * Compute positionBrain for every node. Returns [x0,y0,z0, x1,…] in WORLD units
 * (natural-unit layout × scale). Deterministic for a given input + seed.
 */
export function computeBrainLayout(input: BrainLayoutInput): Float32Array {
  const n = Math.max(0, input.count);
  const scale = input.scale ?? 1;
  const seed = input.seed ?? BRAIN.seed;
  const iterations = input.iterations ?? roundsFor(n);
  const rng = mulberry32(seed);
  const out = new Float32Array(n * 3);
  if (n === 0) return out;

  const margin = BRAIN.layoutContainMargin;
  const repelR = BRAIN.layoutRepelRadius;

  // Adaptive seed spread: FEW communities → a big box so a lone cluster fills the
  // brain volume; the full set of 7 lobes already spans 3D, so the box shrinks.
  const lobes = distinctLobes(input.seeds, n);
  const fill = Math.min(1, Math.max(0, (LOBE_COUNT - lobes) / (LOBE_COUNT - 1)));
  const half = BRAIN.layoutSeedSpreadMin + fill * BRAIN.layoutSeedSpreadGain;

  // The first anatomical lobes (frontal-L/R) share a y and z and differ only in x,
  // so seeding a 1–2 community graph AT them leaves a near-coronal disc. With few
  // communities we therefore also slide each sampling CENTRE toward the brain's
  // interior core (which is genuinely 3D-symmetric) so the box fills real depth
  // rather than the flat anterior surface. With many communities the pull → 0 and
  // the crisp anatomical lobes are kept.
  const CORE: Vec3 = [0, -0.05, -0.05];
  const centrePull = fill;

  // Seed every node at a real 3D point inside the form, and remember it as `home`.
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  const hz = new Float64Array(n);
  const scratch: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const c = input.seeds[i] ?? ([0, -0.1, 0] as Vec3);
    const bx = c[0] + (CORE[0] - c[0]) * centrePull;
    const by = c[1] + (CORE[1] - c[1]) * centrePull;
    const bz = c[2] + (CORE[2] - c[2]) * centrePull;
    seedInVolume(scratch, rng, bx, by, bz, half, margin);
    px[i] = hx[i] = scratch[0];
    py[i] = hy[i] = scratch[1];
    pz[i] = hz[i] = scratch[2];
  }

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const dz = new Float64Array(n);
  const cell = repelR;
  const maxStep = repelR; // clamp per-round travel so nothing overshoots the form

  for (let round = 0; round < iterations; round++) {
    dx.fill(0);
    dy.fill(0);
    dz.fill(0);

    // Short-range repulsion via a spatial hash (O(n) average) so lobes breathe.
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(px[i]! / cell)},${Math.floor(py[i]! / cell)},${Math.floor(pz[i]! / cell)}`;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }
    for (let i = 0; i < n; i++) {
      const gxi = Math.floor(px[i]! / cell);
      const gyi = Math.floor(py[i]! / cell);
      const gzi = Math.floor(pz[i]! / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const bucket = grid.get(`${gxi + ox},${gyi + oy},${gzi + oz}`);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              let ddx = px[i]! - px[j]!;
              let ddy = py[i]! - py[j]!;
              let ddz = pz[i]! - pz[j]!;
              let d = Math.hypot(ddx, ddy, ddz);
              if (d >= repelR) continue;
              if (d < 1e-5) {
                // Coincident (same seed landing): a deterministic tiny 3D nudge.
                ddx = ((i % 7) - 3) * 1e-3;
                ddy = ((j % 5) - 2) * 1e-3;
                ddz = ((i + j) % 3 === 0 ? 1 : -1) * 1e-3;
                d = Math.hypot(ddx, ddy, ddz) || 1e-3;
              }
              const f = (BRAIN.layoutRepulsion * (1 - d / repelR)) / d;
              dx[i]! += ddx * f;
              dy[i]! += ddy * f;
              dz[i]! += ddz * f;
              dx[j]! -= ddx * f;
              dy[j]! -= ddy * f;
              dz[j]! -= ddz * f;
            }
          }
        }
      }
    }

    // Link springs toward a rest length (kept gentle so link rings do not flatten).
    for (const [a, b] of input.edges) {
      if (a < 0 || b < 0 || a >= n || b >= n || a === b) continue;
      const ddx = px[b]! - px[a]!;
      const ddy = py[b]! - py[a]!;
      const ddz = pz[b]! - pz[a]!;
      const d = Math.hypot(ddx, ddy, ddz) || 1e-5;
      const f = (BRAIN.layoutLinkStrength * (d - BRAIN.layoutLinkRest)) / d;
      dx[a]! += ddx * f;
      dy[a]! += ddy * f;
      dz[a]! += ddz * f;
      dx[b]! -= ddx * f;
      dy[b]! -= ddy * f;
      dz[b]! -= ddz * f;
    }

    // Home anchor: a gentle pull toward the node's OWN volumetric seed — this is
    // what keeps the cloud 3D (springs + repulsion refine, they don't collapse it).
    for (let i = 0; i < n; i++) {
      dx[i]! += (hx[i]! - px[i]!) * BRAIN.layoutHomePull;
      dy[i]! += (hy[i]! - py[i]!) * BRAIN.layoutHomePull;
      dz[i]! += (hz[i]! - pz[i]!) * BRAIN.layoutHomePull;
    }

    // Apply (clamped) then contain: the surface push is the last word each round.
    for (let i = 0; i < n; i++) {
      let sx = dx[i]!;
      let sy = dy[i]!;
      let sz = dz[i]!;
      const mag = Math.hypot(sx, sy, sz);
      if (mag > maxStep) {
        const k = maxStep / mag;
        sx *= k;
        sy *= k;
        sz *= k;
      }
      scratch[0] = px[i]! + sx;
      scratch[1] = py[i]! + sy;
      scratch[2] = pz[i]! + sz;
      projectInside(scratch, margin);
      px[i] = scratch[0];
      py[i] = scratch[1];
      pz[i] = scratch[2];
    }
  }

  for (let i = 0; i < n; i++) {
    out[i * 3] = px[i]! * scale;
    out[i * 3 + 1] = py[i]! * scale;
    out[i * 3 + 2] = pz[i]! * scale;
  }
  return out;
}
