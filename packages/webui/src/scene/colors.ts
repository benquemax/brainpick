/**
 * Node coloring: deterministic hash of the top-level directory group to a
 * hue, rendered in the dark sci-fi palette (saturated, luminous, additive).
 */
import { ABOUT_COLOR, ENTITY_COLOR, TYPE_SHAPE } from './tuning';

/** Top-level directory of a bundle path; bundle-root docs group under ".". */
export function groupOf(id: string): string {
  const slash = id.indexOf('/');
  return slash === -1 ? '.' : id.slice(0, slash);
}

/** FNV-1a 32-bit — stable across sessions and engines. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hueForGroup(group: string): number {
  // Golden-angle spread over the hash keeps neighboring group names apart.
  return (fnv1a(group) * 137.508) % 360;
}

/** HSL -> linear-ish RGB triple in [0,1] for the sprite shader. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

const cache = new Map<string, [number, number, number]>();

export function colorForGroup(group: string): [number, number, number] {
  let color = cache.get(group);
  if (!color) {
    // High saturation, mid-high lightness: glows well under additive blending
    // against the near-black background.
    color = hslToRgb(hueForGroup(group), 0.85, 0.66);
    cache.set(group, color);
  }
  return color;
}

export function colorForId(id: string): [number, number, number] {
  return colorForGroup(groupOf(id));
}

/** CSS color for HTML overlays (labels, chips) matching the node color. */
export function cssColorForId(id: string): string {
  return `hsl(${hueForGroup(groupOf(id)).toFixed(1)}deg 85% 70%)`;
}

const entityCache = new Map<string, [number, number, number]>();

/**
 * The color of an entity node — the gold/amber family (tuning.ENTITY_COLOR),
 * with a small per-type hue wander that stays inside the band. A distinct
 * species from the doc palette (which spans the whole wheel by dir hash).
 */
export function entityColorForType(type: string | null): [number, number, number] {
  const key = type && type.length > 0 ? type : 'entity';
  let color = entityCache.get(key);
  if (!color) {
    const t = (fnv1a(key) % 4096) / 4096; // deterministic 0..1
    const hue = ENTITY_COLOR.baseHue + (t - 0.5) * 2 * ENTITY_COLOR.hueSpread;
    color = hslToRgb(hue, ENTITY_COLOR.saturation, ENTITY_COLOR.lightness);
    entityCache.set(key, color);
  }
  return color;
}

/** A linear-ish RGB triple ([0,1]) as a CSS color — for labels of any family. */
export function rgbToCss([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${c(r)} ${c(g)} ${c(b)})`;
}

const aboutCache = new Map<string, [number, number, number]>();

/**
 * The two-axis ontology's COLOR channel (docs/ontology.md, tuning.ABOUT_COLOR):
 * a page's `about` maps to a fixed, distinct hue. Returns null for absent or
 * unrecognized values — the caller's cue to fall back to today's directory
 * color, so a bundle without the field renders byte-identically to before.
 */
export function colorForAbout(about: string | null | undefined): [number, number, number] | null {
  if (!about) return null;
  const spec = (ABOUT_COLOR as Record<string, { hue: number; saturation: number; lightness: number } | undefined>)[
    about
  ];
  if (!spec) return null;
  let color = aboutCache.get(about);
  if (!color) {
    color = hslToRgb(spec.hue, spec.saturation, spec.lightness);
    aboutCache.set(about, color);
  }
  return color;
}

/** CSS color for the about legend/HTML overlays, matching colorForAbout. */
export function cssColorForAbout(about: string): string | null {
  const color = colorForAbout(about);
  return color ? rgbToCss(color) : null;
}

/**
 * The color of a render node: entities keep their own gold family regardless
 * of `about` (a different species, never confused with a doc's ontology
 * color); a doc's `about` color wins when present, falling back to the
 * existing directory-hash color so an ontology-less bundle is unaffected.
 */
export function colorForNode(
  id: string,
  about: string | null | undefined,
  type: string | null,
  isEntity: boolean,
): [number, number, number] {
  if (isEntity) return entityColorForType(type);
  return colorForAbout(about) ?? colorForId(id);
}

/**
 * The two-axis ontology's SHAPE channel (tuning.TYPE_SHAPE): a page's `type`
 * maps to a shape index the NodesLayer fragment shader switches on. 0 (the
 * existing circle) for `article`, absent, or any value outside the closed
 * set — the legacy "Concept"/"Reference"/... capitalized values from before
 * the two-axis migration fall through to 0 too, same as a bundle that never
 * adopts the ontology at all.
 */
export function shapeIndexForType(type: string | null | undefined): number {
  if (!type) return 0;
  return TYPE_SHAPE[type] ?? 0;
}
