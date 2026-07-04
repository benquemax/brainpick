import { describe, expect, it } from 'vitest';
import { orbitStartPosition, revolutionSeconds } from './brainCamera';
import { BRAIN_CAMERA } from './tuning';

describe('brain orbit camera — the Milky Way turntable', () => {
  it('spins one revolution in a galaxy-slow 30–45 s', () => {
    const period = revolutionSeconds(BRAIN_CAMERA.autoRotateSpeed);
    expect(period).toBeGreaterThan(30);
    expect(period).toBeLessThan(45);
  });

  it('starts tilted DOWN off the equator so the spin reveals depth', () => {
    // A depth-revealing tilt sits well off both the equator (90°) and straight
    // down (0°): roughly a 15–35° downward look → polar 55°..75° from vertical.
    const deg = (BRAIN_CAMERA.startPolarAngle * 180) / Math.PI;
    expect(deg).toBeGreaterThan(55);
    expect(deg).toBeLessThan(75);
  });

  it('places the camera ABOVE the equatorial plane at the start (y > 0)', () => {
    const dist = 200;
    const [x, y, z] = orbitStartPosition(dist, BRAIN_CAMERA.startAzimuthAngle, BRAIN_CAMERA.startPolarAngle);
    expect(y).toBeGreaterThan(0.15 * dist); // a clear elevation, not near-equatorial
    // and the pose keeps the requested dolly distance from the origin.
    expect(Math.hypot(x, y, z)).toBeCloseTo(dist, 6);
  });

  it('azimuth 0 looks straight down +Z; a positive azimuth swings toward +X', () => {
    const [x0, , z0] = orbitStartPosition(100, 0, Math.PI / 2);
    expect(z0).toBeCloseTo(100, 6);
    expect(x0).toBeCloseTo(0, 6);
    const [x1] = orbitStartPosition(100, 0.6, Math.PI / 2);
    expect(x1).toBeGreaterThan(0); // azimuth rotates around the vertical axis
  });
});
