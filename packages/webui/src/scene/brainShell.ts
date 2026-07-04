/**
 * The brain SHELL as a cloud of surface points with outward normals — the
 * "shell of instanced points" option from the brief. We sample points ON the
 * SDF surface (deterministically) and hand the renderer a normal per point; the
 * BrainShell shader turns the grazing-angle normals into a fresnel rim, so a
 * translucent rimmed silhouette emerges from additive points — no marching-cubes
 * tables, no mesh asset, and it reuses the very SDF the nodes are contained in.
 *
 * Pure + deterministic (Newton projection onto the isosurface, seeded RNG).
 */
import { bounds, gradient, mulberry32, sdf } from './brainSDF';

export interface ShellPoints {
  /** Surface positions [x0,y0,z0,…] in SDF natural units. */
  positions: Float32Array;
  /** Unit outward normals [nx0,ny0,nz0,…], aligned to positions. */
  normals: Float32Array;
  /** How many points were actually placed (== requested unless the budget ran out). */
  count: number;
}

const SURFACE_EPS = 0.02;

/**
 * Deterministically sample `n` points on the brain surface with their outward
 * normals. Each candidate is Newton-projected onto the isosurface (p −= n·sdf),
 * which converges from either side, then accepted if it lands on the surface and
 * inside the bounds.
 */
export function sampleShellPoints(n: number, seed: number): ShellPoints {
  const rng = mulberry32(seed);
  const positions = new Float32Array(Math.max(0, n) * 3);
  const normals = new Float32Array(Math.max(0, n) * 3);
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const p: [number, number, number] = [0, 0, 0];

  let filled = 0;
  let attempts = 0;
  const maxAttempts = Math.max(256, n * 60);
  while (filled < n && attempts < maxAttempts) {
    attempts++;
    p[0] = minX + rng() * spanX;
    p[1] = minY + rng() * spanY;
    p[2] = minZ + rng() * spanZ;
    // Newton march onto the isosurface (works from inside or outside).
    let s = sdf(p[0], p[1], p[2]);
    for (let k = 0; k < 12 && Math.abs(s) > SURFACE_EPS * 0.5; k++) {
      const g = gradient(p);
      p[0] -= g[0] * s;
      p[1] -= g[1] * s;
      p[2] -= g[2] * s;
      s = sdf(p[0], p[1], p[2]);
    }
    if (Math.abs(s) > SURFACE_EPS) continue;
    if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY || p[2] < minZ || p[2] > maxZ) continue;
    const nrm = gradient(p);
    positions[filled * 3] = p[0];
    positions[filled * 3 + 1] = p[1];
    positions[filled * 3 + 2] = p[2];
    normals[filled * 3] = nrm[0];
    normals[filled * 3 + 1] = nrm[1];
    normals[filled * 3 + 2] = nrm[2];
    filled++;
  }
  return { positions, normals, count: filled };
}
