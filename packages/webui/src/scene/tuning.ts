/**
 * Visual tuning constants for the 2.5D scene — THE one file a taste pass
 * touches. Every glow/bloom/dim number the shaders use lives here; the
 * layers inline them into GLSL at material creation (they are compile-time
 * constants, not uniforms — changing them means changing this file).
 *
 * 2026-07-03 taste pass: "slightly too much glow" — the halo falloff got
 * tighter (4.5 -> 7.0) and the additive amplitudes came down across the
 * board. Keep the sci-fi soul; lose the bloom soup.
 */

/** Format a number as a GLSL float literal. */
export function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

export const NODE_GLOW = {
  /** Brightness of the sprite's hard core (was 1.5). */
  coreIntensity: 1.35,
  /** Radial falloff exponent — higher = tighter halo (was 4.5). */
  haloFalloff: 7.0,
  /** Halo amplitude added on top of the core (was 0.85). */
  haloStrength: 0.5,
  /** Extra brightness while a node pulses with recent activity (was 1.2). */
  pulseBoost: 0.8,
  /** Extra brightness for highlighted/selected nodes (was 0.9). */
  highlightBoost: 0.7,
  /** Scale bump while pulsing / highlighted (were 0.30 / 0.30). */
  pulseScale: 0.22,
  highlightScale: 0.24,
  /** Brightness factor for reserved docs (index/log) — kept muted. */
  reservedFactor: 0.5,
  /** Brightness floor for non-highlighted nodes while dimOthers is on. */
  dimFloor: 0.14,
} as const;

export const EDGE_GLOW = {
  /** Base additive opacity of link lines (was 0.3). */
  opacity: 0.24,
  /** Opacity factor while dimOthers is on. */
  dimFactor: 0.22,
} as const;

export const GHOST_GLOW = {
  /** Ghost edges are quieter than real links — they are absences. */
  opacity: 0.34,
  /** Dash count along a ghost edge (fraction lit per dash in duty). */
  dashCount: 7.0,
  dashDuty: 0.52,
  /** World-space distance from the source node to the phantom marker. */
  phantomDistance: 30,
  /** Phantom marker: ring radius (world units) and ring thickness (0..1). */
  markerRadius: 3.4,
  ringInner: 0.62,
  ringOuter: 0.86,
  markerIntensity: 0.8,
  /** Opacity factor while dimOthers is on. */
  dimFactor: 0.22,
} as const;

/** Per-frame lerp factor easing the dim uniform toward its target. */
export const DIM_EASE = 0.14;
