/**
 * Pure orbit-camera math for the holographic brain, factored out of
 * BrainCameraRig.tsx so it is unit-testable without R3F/three.
 *
 * The idle "Milky Way" spin is a TURNTABLE: the azimuth advances around the
 * vertical (Y / superior–inferior) axis while the polar angle holds a gentle
 * downward tilt, so the brain turns like a galaxy seen from a few degrees above
 * its plane — and that tilt is what reveals the volume as it rotates (a pure
 * equatorial orbit of a flattish cloud reads worst).
 */

/** camera-controls spherical convention: azimuth around +Y, polar from +Y. */
export function orbitStartPosition(
  dist: number,
  azimuth: number,
  polar: number,
): [number, number, number] {
  const sp = Math.sin(polar);
  return [
    dist * sp * Math.sin(azimuth),
    dist * Math.cos(polar), // > 0 while polar < 90° → camera sits ABOVE the equator
    dist * sp * Math.cos(azimuth),
  ];
}

/** Seconds for one full idle revolution at a given azimuthal speed (rad/s). */
export function revolutionSeconds(autoRotateSpeed: number): number {
  return (2 * Math.PI) / autoRotateSpeed;
}
