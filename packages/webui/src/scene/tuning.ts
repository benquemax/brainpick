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
  /** Brightness of the sprite's hard core (was 1.5, then 1.35 — calmer idle field). */
  coreIntensity: 1.2,
  /** Radial falloff exponent — higher = tighter halo (was 4.5). */
  haloFalloff: 7.0,
  /** Halo amplitude added on top of the core (was 0.85, then 0.5). Lowered again so
   * the UNSELECTED field reads calm — the 2026-07-08 emphasis pass: dim idle, bright
   * hover. The hovered node and its neighbourhood provide the light now. */
  haloStrength: 0.32,
  /** Extra brightness while a node pulses with recent activity (was 1.2). */
  pulseBoost: 0.8,
  /** Extra brightness at the emphasis peak (iHighlight = 1). Raised (was 0.7) so the
   * HOVERED / selected node is clearly MORE lit than the calmer idle field. */
  highlightBoost: 0.95,
  /** Scale bump while pulsing / highlighted (pulse was 0.30; highlight was 0.30→0.24). */
  pulseScale: 0.22,
  /** Scale bump at the emphasis peak — the hovered/selected node is a touch bigger. */
  highlightScale: 0.3,
  /** Brightness factor for reserved docs (index/log) — kept muted. */
  reservedFactor: 0.5,
  /** Brightness floor for non-highlighted nodes while dimOthers is on. */
  dimFloor: 0.14,
  /** HUB BRIGHTNESS (spec: degree conveys relevance). A high-degree hub reads a
   * touch brighter than a leaf, reinforcing the size cue. Ramps by the node's own
   * world radius (which radiusForDegree drives) between these two thresholds. */
  hubBright: 0.22,
  hubRadiusLo: 12.0,
  hubRadiusHi: 24.0,
} as const;

/**
 * Per-node EMPHASIS levels (0..1) the sprite shader turns into extra glow + scale.
 * Selection/hover/search win over a neighbour lift; a plain idle node is 0. Kept
 * here beside the glow amplitudes so one taste pass tunes the whole feel; the pure
 * derivation (scene/emphasis.ts) is unit-tested against these.
 */
export const EMPHASIS = {
  /** The clicked/open node — the brightest, biggest. */
  selection: 1.0,
  /** The hovered node — clearly lit + a touch bigger, so the cursor's target pops. */
  hovered: 0.9,
  /** A search/lens hit. */
  search: 0.7,
  /** A NEIGHBOUR of the focused node (hover/selection) — a gentle lift so the local
   * neighbourhood reads instantly without shouting over the focus itself. */
  neighbor: 0.34,
} as const;

/** What fraction of a node's render quad counts as its CLICKABLE dot (Tom's aim
 * report, 2026-07-12): the fragment's solid core ends at ~0.32 of the quad and the
 * rest is faint halo — treating the whole quad as hitbox let near nodes swallow
 * clicks aimed at nodes behind/beside them. 0.45 = the core plus a little edge
 * grace; must track the fragment shader's core smoothstep if that ever moves. */
export const PICK_CORE_FRACTION = 0.45;

export const EDGE_GLOW = {
  /** Base additive opacity of link lines (was 0.3, then 0.24). A calm idle web. */
  opacity: 0.2,
  /** LENS grading, per edge (scene/emphasis edgeLensDim; Tom 2026-07-12): an edge
   * between two lens members keeps full strength; a member's outward connection
   * reads at half (it answers "what is this connected to")… */
  lensHalfFactor: 0.5,
  /** …and the hidden-to-hidden background web fades to a whisper. */
  lensHiddenFactor: 0.08,
  /** HOVER NEIGHBOURHOOD (the important one): the focused node's incident edges jump
   * far above the idle web so you can instantly SEE what a node connects to. A big
   * multiplier on the base opacity (0.2 → ~1.0, a bright lit line)… */
  hoverBoost: 4.5,
  /** …plus an extra additive pop so the lit connections truly read as lit (and, under
   * additive blending, bloom a little WIDER — the closest we get to "thicker" on GL
   * lines, where gl.lineWidth is unreliable). */
  hoverGlow: 0.5,
} as const;

/**
 * The T3 entity layer's own visual family (spec/40, UI task): a coherent
 * GOLD/AMBER band so extracted entities read instantly as a different species
 * from the multicolored doc cloud — reinforced by a gem/diamond sprite (vs the
 * doc disc). Per-type hue variation stays inside the band so the family holds.
 */
export const ENTITY_COLOR = {
  /** Home hue of the entity family (gold). */
  baseHue: 44,
  /** ± hue wander per entity type, kept inside the warm band. */
  hueSpread: 30,
  saturation: 0.92,
  lightness: 0.64,
} as const;

/**
 * Entity/relation edges. A `relation` inherits its endpoints' gold and scales
 * brightness by weight; a `virtual` (entity→source-doc gravitation) is barely
 * there — a hint that pulls in the layout without cluttering the view.
 */
export const ENTITY_EDGE = {
  /** Brightness floor so a weight≈0 relation is still faintly visible. */
  relationFloor: 0.35,
  /** Virtual gravitation lines: fainter than doc links, cool grey-blue. */
  virtualBright: 0.5,
  virtualTint: [0.42, 0.52, 0.7] as [number, number, number],
} as const;

/**
 * THE TWO-AXIS ONTOLOGY lens (docs/ontology.md): COLOR = about (a page's
 * ontological subject), SHAPE = type (its document form) — orthogonal
 * fields, orthogonal visual channels. Both are OPTIONAL frontmatter; a node
 * with neither renders exactly as before (directory-hash color, circle).
 *
 * Seven `about` hues, evenly spaced (~42.8°) and confined to 75°–332°,
 * deliberately clear of the entity gold band (ENTITY_COLOR: 44° ± 30°) so a
 * doc's about-color never reads as "this is secretly an entity" — shape
 * (disc vs diamond) already carries that distinction. Chosen for calm,
 * colorblind-legible separation: no adjacent pure red/green pair, a
 * green→teal→blue→violet→rose sweep that reads apart under deuteranopia
 * and protanopia alike.
 */
export const ABOUT_COLOR = {
  place: { hue: 75, saturation: 0.62, lightness: 0.64 },
  process: { hue: 118, saturation: 0.6, lightness: 0.62 },
  thing: { hue: 161, saturation: 0.55, lightness: 0.64 },
  concept: { hue: 204, saturation: 0.62, lightness: 0.68 },
  event: { hue: 246, saturation: 0.62, lightness: 0.7 },
  organization: { hue: 289, saturation: 0.55, lightness: 0.68 },
  person: { hue: 332, saturation: 0.68, lightness: 0.68 },
} as const;

/**
 * `type` shape index (matches the fragment shader's shapeDist switch in
 * NodesLayer.tsx): 0 keeps today's circle — the default for `article` AND
 * for anything absent/unrecognized, so a bundle without the field, or a
 * value outside the closed set, renders byte-identically to before this
 * lens existed. 1-4 are simple regular-polygon / ring SDFs, deliberately
 * plain ("keep it to simple shader shapes") and distinct from the entity
 * layer's own diamond (vEntity wins over vShape — an entity is a different
 * species from any doc type, gem always).
 */
export const TYPE_SHAPE: Record<string, number> = {
  article: 0,
  decision: 1, // triangle — a fork: context/decision/alternatives
  playbook: 2, // square — a checklist of steps
  reference: 3, // pentagon — a lookup table
  log: 4, // ring — a cycle of dated entries
};

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

/**
 * THE HOLOGRAPHIC BRAIN (spec: holographic-brain.md). The cosmos morphs from
 * the flat 2D star map into a floating anatomical brain: a procedural SDF form
 * (scene/brainSDF.ts), topic clusters gathered into lobes (state/communities.ts)
 * via a containment force layout (layout/brainLayout.ts), spun with a perspective
 * orbit camera. Every constant the brain visuals use lives here with the rest.
 *
 * The SDF works in natural units (roughly a unit brain, ±1); BRAIN.scale maps it
 * into world space so the node radii (world units) read proportional to the form.
 */
export const BRAIN = {
  /** World units per SDF natural unit — the brain's overall size in the scene. */
  scale: 96,
  /** Seed for every deterministic brain computation (layout jitter, sampling). */
  seed: 0xb7a11,
  /** Per-frame ease factor for uMorph toward its 0/1 target (cosmos⇄brain). */
  morphEase: 0.055,
  /** Below this the morph is treated as fully cosmos (perspective rig unmounts). */
  morphRestEps: 0.002,
  /** Per-node morph stagger: nodes stream in over this fraction of the travel. */
  staggerSpan: 0.55,

  /** Force layout: relaxation rounds (scaled down as the node count grows). */
  layoutIterations: 110,
  /** Repulsion strength between nearby nodes — enough to fill the volume. */
  layoutRepulsion: 0.012,
  /** Radius within which nodes repel each other (natural units). */
  layoutRepelRadius: 0.62,
  /** Link spring: pull linked nodes toward this rest length (natural units).
   * Deliberately gentle — a stiff ring of links relaxes to a FLAT polygon, so
   * the spring must not overpower the volumetric seed + home anchor below. */
  layoutLinkRest: 0.24,
  layoutLinkStrength: 0.04,
  /** VOLUMETRIC SEED (the anti-flat-sheet fix). Each node is rejection-sampled
   * to a real 3D point INSIDE the SDF within a SPHERE around its (core-biased)
   * lobe centroid — not dropped on the centroid point. The sphere radius (natural
   * units) is `min + gain × fill`, where `fill`→1 when there are FEW communities
   * so a lone cluster scatters through a fat central ball of the brain volume (a
   * 10-node graph still reads volumetric), and `fill`→0 when the 7 anatomical
   * lobes already span 3D and each keeps a tight, crisp sub-volume. */
  layoutSeedSpreadMin: 0.3,
  layoutSeedSpreadGain: 0.36,
  /** Home anchor: a gentle spring pulling each node back toward its own
   * volumetric seed (NOT the shared centroid). This preserves the 3D spread the
   * seeding created — repulsion + links refine spacing without collapsing the
   * cloud into a plane or a point. Replaces the old collapse-to-centroid pull. */
  layoutHomePull: 0.055,
  /** Keep points this far inside the surface when the containment force bites. */
  layoutContainMargin: 0.06,

  /** The fresnel-rimmed point shell: how many surface points sample the form. */
  shellPoints: 3800,
  /** Shell point sprite size (world units). */
  shellPointSize: 2.3,
  /** Fresnel exponent — higher = a thinner, brighter silhouette rim. */
  shellFresnel: 2.2,
  /** Base (non-rim) shell brightness and rim brightness (additive, restrained). */
  shellCoreGlow: 0.06,
  shellRimGlow: 0.62,
  /** Cool hologram tint of the shell (linear-ish RGB). */
  shellTint: [0.42, 0.72, 1.0] as [number, number, number],
  /** Scanline spatial frequency (per world unit) and drift speed, and depth. */
  shellScanFreq: 0.14,
  shellScanSpeed: 0.9,
  shellScanDepth: 0.35,
  /** Depth fog: the far side of the shell dims by up to this much. */
  shellFogDepth: 0.55,

  /** Firing pulse (brain mode): duration and the width of the travelling glow. */
  pulseSeconds: 1.6,
  pulseWidth: 0.16,
  pulseGlow: 1.4,

  /** HOLOGRAM LABELS. The flat cosmos earns labels from semantic zoom; the
   * perspective brain has no ortho zoom, so it labels a fixed handful of the
   * top hubs (plus the hovered/selected node), capped by the GPU tier's ceiling.
   * Kept small so names stay legible over the 3D dot cloud. */
  labelBudget: 22,
  /** Extra pixels lifting a hologram label above its (distance-scaled) dot. */
  labelLift: 7,
  /**
   * Far-side label cull: a node whose camera-distance exceeds the brain centre's
   * by more than this fraction sits deep on the occluded back of the hologram, so
   * its name is hidden. Depth-based (not a hemisphere split through the origin), so
   * the visible front + central cloud — most of a volumetric brain — always labels.
   */
  labelBackMargin: 0.2,
  /** Label hysteresis (2026-07-08): a label ALREADY shown survives the far-side cull a
   * little deeper than this before it drops, so a slowly spinning brain does not blink
   * its names on/off at the exact hemisphere boundary. */
  labelBackHysteresis: 0.14,
} as const;

/**
 * The perspective orbit camera for brain mode (drei's makeDefault only swaps
 * controls, not the render camera — BrainCameraRig owns a perspective camera it
 * installs as the default while mounted). Touch-first: one-finger orbit, pinch
 * dolly + two-finger twist; a slow idle auto-rotation that pauses on interaction.
 */
export const BRAIN_CAMERA = {
  fov: 46,
  near: 1,
  far: 8000,
  /** Initial + resting dolly distance, in multiples of the brain's world radius. */
  distanceFactor: 2.05,
  minDistanceFactor: 1.05,
  maxDistanceFactor: 6.0,
  /**
   * The TURNTABLE / "Milky Way" idle spin. `autoRotateSpeed` (rad/sec) advances
   * the AZIMUTH around the vertical (Y) axis; 0.16 ≈ a full revolution every ~39s
   * — a slow galaxy turn. It resumes `autoRotateResumeMs` after a gesture and is
   * active immediately on entering brain mode.
   */
  autoRotateSpeed: 0.16,
  autoRotateResumeMs: 2600,
  /**
   * SEARCH-AS-FLIGHT. A search focus / entity select in brain mode re-centres the
   * orbit on the hit's 3D position and dollies to this distance (× brain radius) —
   * the perspective-camera mirror of the cosmos flyTo. Between min (1.05) and the
   * resting 2.05 so the hit reads prominent without the camera diving inside.
   */
  focusDistanceFactor: 1.5,
  /**
   * The starting (and reference) orbit orientation, in camera-controls spherical
   * coords. The polar angle is a gentle DOWNWARD tilt — well off the equator — so
   * the turntable spin reveals the brain's depth (front/back, top) instead of
   * sweeping a flat disc edge-on. startPolarAngle ≈ 1.15 rad ≈ 66° from vertical
   * (≈24° looking down); startAzimuthAngle ≈ 0.52 rad ≈ 30° for a 3/4 view.
   */
  startAzimuthAngle: 0.52,
  startPolarAngle: 1.15,
  /** Smooth-time (sec) for the camera-controls damping. */
  smoothTime: 0.28,
} as const;

/**
 * THE TIME MACHINE (spec/90-timeline.md). Scrub through the bundle's git history
 * and watch the brain grow: nodes fade/pop in as the scrub crosses their birth
 * commit, edges fire as they form, the whole thing receding into a cool time-fog
 * like OSX Time Machine — but calm, not bloom-soup (honoring the 2026-07-03 taste
 * pass). The scene is driven entirely by two uniforms (uTimeTravel, uScrub) into
 * static per-node birth/death indices, so scrubbing rebuilds no GPU buffers.
 *
 * All coordinates are in FRACTIONAL COMMIT INDEX space (see time/timeline.ts):
 * a `fadeWindow` of 0.4 means a node fades in over ~0.4 of a commit-gap.
 */
export const TIME_MACHINE = {
  /** Per-frame ease of the animated scrub toward its logical target (buttery drag/step). */
  scrubEase: 0.2,
  /** Per-frame ease of uTimeTravel 0⇄1 (the dissolve as history switches on/off). */
  toggleEase: 0.14,
  /** Below this uTimeTravel the field layer + fog unmount (fully back in the present). */
  restEps: 0.004,
  /** Play speed: commits advanced per second — a watchable growth movie. */
  commitsPerSecond: 1.15,

  /** A node fades in over this many commit-indices once born (and out before death). */
  fadeWindow: 0.4,
  /** Birth/modified flash lasts this many commit-indices — the firing pop as it appears. */
  flashWindow: 0.6,
  /** Flashes stay live this many wall-clock seconds after the scrub stops moving… */
  flashHold: 0.35,
  /** …then ease out over this many more (time/timeline.ts flashRecency): standing ON
   * a commit settles to true colors instead of freezing every touched node at full
   * glow — a whole-wiki commit used to white out the entire brain. */
  flashDecay: 1.2,
  /** Extra scale + additive glow at the peak of a birth flash. */
  birthPop: 0.5,
  birthGlow: 1.3,
  /** A gentler pop + glow when the scrub crosses a doc's last modification. */
  modPop: 0.28,
  modGlow: 0.8,

  /** The forming-edge pulse that travels source→target as an edge is born. */
  edgePulseWidth: 0.2,
  edgePulseGlow: 1.2,

  /** TIME FOG: the screen tints deeper into this cool haze the further back you scrub. */
  fogTint: 'rgba(10, 22, 48, 0.62)',
  /** Max fog opacity, reached at the OLDEST commit (0 at the present). */
  fogMaxOpacity: 0.5,

  /** THE STARFIELD tunnel behind the brain — depth we fly through when travelling. */
  starCount: 320,
  /** Star field half-extent in world units (a box centred on the brain). */
  starSpread: 2600,
  /** Star sprite size (world units) and their cool tint. */
  starSize: 5.5,
  starTint: [0.55, 0.72, 1.0] as [number, number, number],
  /** Idle drift speed (world units/sec toward the viewer) and its brightness. */
  starDrift: 34,
  starGlow: 0.5,
} as const;

/**
 * GPU performance budget — how much the cosmos is allowed to render so weak /
 * mobile GPUs stay smooth. A detected tier (scene/gpuTier.ts) picks a node
 * cap; beyond it, degree-ranked culling + per-directory cluster aggregation
 * keep the view honest (state/budget.ts). Numbers live here with the rest of
 * the visual constants.
 *
 * NOTE: config carries `[ui] max_nodes_mobile` (default 8000), but no engine
 * ships it to the client today (neither /api/status nor the SSE hello include
 * a ui block — verified 2026-07-04). Until one does, the cap is derived here;
 * `mid` deliberately equals that 8000 default so the two agree by design.
 */
export const GPU_BUDGET = {
  /** Node-count cap per tier — the most nodes drawn before aggregation. */
  nodeBudget: { low: 2_500, mid: 8_000, high: 40_000 },
  /** devicePixelRatio ceiling per tier — weak GPUs render fewer pixels. */
  dprCap: { low: 1, mid: 1.5, high: 2 },
  /** Label ceiling per tier, capping semanticZoom's own zoom-driven budget. */
  labelBudget: { low: 32, mid: 96, high: 144 },
  /** Additive halo ("bloom") on per tier — off trims overdraw on weak GPUs. */
  bloomEnabled: { low: false, mid: true, high: true },
  /** Halo-strength multiplier when a tier disables bloom (a soft core stays). */
  bloomDisabledScale: 0.35,
  /** Upper bound the manual "show more" control may raise the budget to. */
  budgetCeiling: 40_000,
  /** Factor the budget grows by on each "show more" press. */
  showMoreFactor: 2,
} as const;
