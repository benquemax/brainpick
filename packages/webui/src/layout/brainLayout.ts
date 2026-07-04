/**
 * The 3D brain layout: a force relaxation CONSTRAINED inside the brain SDF.
 *
 * Every node is seeded at its community's lobe centroid (state/communities.ts)
 * plus deterministic jitter, then a handful of relaxation rounds spread the
 * cloud with link springs + short-range repulsion while a CONTAINMENT force
 * keeps every node inside the form: sample the SDF, and if a node has drifted to
 * or past the surface, push it back along −gradient to a hair inside. The result
 * is a Float32Array of 3D positions aligned to the renderer's node index order.
 *
 * Pure and deterministic given the graph + seed (mulberry32, no ambient random),
 * so it is fully unit-testable — the containment invariant is the key test.
 */
import { gradient, mulberry32, sdf, type Vec3 } from '../scene/brainSDF';
import { BRAIN } from '../scene/tuning';

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
  const jitter = BRAIN.layoutSeedJitter;
  const repelR = BRAIN.layoutRepelRadius;

  // Seed at the lobe centroid + deterministic jitter, projected inside.
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const cz = new Float64Array(n);
  const scratch: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const c = input.seeds[i] ?? ([0, -0.1, 0] as Vec3);
    cx[i] = c[0];
    cy[i] = c[1];
    cz[i] = c[2];
    scratch[0] = c[0] + (rng() - 0.5) * 2 * jitter;
    scratch[1] = c[1] + (rng() - 0.5) * 2 * jitter;
    scratch[2] = c[2] + (rng() - 0.5) * 2 * jitter;
    projectInside(scratch, margin);
    px[i] = scratch[0];
    py[i] = scratch[1];
    pz[i] = scratch[2];
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
                // Coincident (same centroid seed): deterministic tiny nudge.
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

    // Link springs toward a rest length.
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

    // Lobe cohesion: a gentle pull toward the community centroid.
    for (let i = 0; i < n; i++) {
      dx[i]! += (cx[i]! - px[i]!) * BRAIN.layoutLobePull;
      dy[i]! += (cy[i]! - py[i]!) * BRAIN.layoutLobePull;
      dz[i]! += (cz[i]! - pz[i]!) * BRAIN.layoutLobePull;
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
