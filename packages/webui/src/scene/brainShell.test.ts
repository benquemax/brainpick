import { describe, expect, it } from 'vitest';
import { sampleShellPoints } from './brainShell';
import { bounds, sdf } from './brainSDF';

describe('sampleShellPoints', () => {
  it('places points ON the surface (|sdf| small) with unit normals, inside bounds', () => {
    const { positions, normals, count } = sampleShellPoints(800, 11);
    expect(count).toBeGreaterThan(700); // the acceptance budget comfortably fills it
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
      expect(Math.abs(sdf(x, y, z))).toBeLessThan(0.03); // on the isosurface
      expect(x).toBeGreaterThanOrEqual(bounds.min[0]);
      expect(x).toBeLessThanOrEqual(bounds.max[0]);
      const nlen = Math.hypot(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!);
      expect(nlen).toBeCloseTo(1, 4);
    }
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const a = sampleShellPoints(300, 3);
    const b = sampleShellPoints(300, 3);
    const c = sampleShellPoints(300, 4);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });

  it('covers both hemispheres (points on each side of the midline)', () => {
    const { positions, count } = sampleShellPoints(600, 9);
    let left = 0, right = 0;
    for (let i = 0; i < count; i++) {
      if (positions[i * 3]! < -0.1) left++;
      else if (positions[i * 3]! > 0.1) right++;
    }
    expect(left).toBeGreaterThan(40);
    expect(right).toBeGreaterThan(40);
  });
});
