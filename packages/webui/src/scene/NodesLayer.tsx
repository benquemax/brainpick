/**
 * The node cloud: one instanced quad per node, drawn as a circular sprite
 * with radial glow falloff under additive blending.
 *
 * Every instance carries TWO layout targets — iCosmos and iBrain — mixed by
 * the uMorph uniform. M1 renders the 2D cosmos only (uMorph = 0); the 3D
 * brain layout (M3) will fill iBrain and animate the morph.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { nodeStagger, type GraphRuntime } from './runtime';
import { focusIndex, lensAllowsInteraction, nodeHighlightLevel, selectionRenderId } from './emphasis';
import { BRAIN, DIM_EASE, glslFloat as f, GPU_BUDGET, NODE_GLOW, TIME_MACHINE } from './tuning';

const VERTEX = /* glsl */ `
  attribute vec3 iCosmos;
  attribute vec3 iBrain;
  attribute vec3 iColor;
  attribute float iRadius;
  attribute float iBirth;
  attribute float iDeath;
  attribute float iActivity;
  attribute float iFlags;      // bit 0 reserved · bit 1 cluster · bit 2 entity · bits 3-5 ontology shape (0-4)
  attribute float iHighlight;
  attribute float iStagger;
  attribute float iBirthIdx;   // TIME MACHINE: commit index this node is born at (−1 = always present)
  attribute float iDeathIdx;   // commit index it is deleted at (1e9 = immortal)
  attribute float iModIdx;     // commit index of its last modification (−1 = never)

  uniform float uMorph;
  uniform float uTime;
  uniform float uDim;
  uniform float uTimeTravel;   // 0 = live present, →1 = travelling history
  uniform float uScrub;        // the animated fractional commit index
  uniform float uScrubStamp;   // uTime when the scrub last moved (flash recency)

  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vAlpha;
  varying float vCluster;
  varying float vEntity;
  varying float vShape;

  void main() {
    // Per-node stagger: nodes stream into the brain in a spread, not all at once.
    float span = ${f(BRAIN.staggerSpan)};
    float m = clamp((uMorph - iStagger * span) / (1.0 - span), 0.0, 1.0);
    vec3 center = mix(iCosmos, iBrain, m);

    // Entrance: scale in from the join position (easeOutCubic).
    float grow = 1.0;
    if (iBirth >= 0.0) {
      float t = clamp((uTime - iBirth) / 0.7, 0.0, 1.0);
      grow = 1.0 - pow(1.0 - t, 3.0);
    }
    // Exit: shrink + fade after death.
    float death = 0.0;
    if (iDeath > 0.0) {
      death = clamp((uTime - iDeath) / 0.75, 0.0, 1.0);
    }
    // Recent-change pulse.
    float pulse = 0.0;
    if (iActivity >= 0.0) {
      float a = (uTime - iActivity) / 1.8;
      if (a < 1.0) pulse = (1.0 - a) * (0.65 + 0.35 * sin((uTime - iActivity) * 14.0));
    }

    float reserved = step(0.5, mod(iFlags, 2.0));
    float cluster = step(0.5, mod(floor(iFlags / 2.0), 2.0));
    float entity = step(0.5, mod(floor(iFlags / 4.0), 2.0));
    float shapeIdx = mod(floor(iFlags / 8.0), 8.0);
    vEntity = entity;
    float highlight = clamp(iHighlight, 0.0, 1.0);
    float scale = iRadius * grow * (1.0 - death)
      * (1.0 + ${f(NODE_GLOW.pulseScale)} * pulse + ${f(NODE_GLOW.highlightScale)} * highlight);

    float bright = 1.0 + ${f(NODE_GLOW.pulseBoost)} * pulse + ${f(NODE_GLOW.highlightBoost)} * highlight;
    // HUB BRIGHTNESS: a high-degree hub (bigger iRadius) reads a touch brighter, so
    // degree = relevance is legible in light as well as size (calm leaves, lit hubs).
    bright *= 1.0 + ${f(NODE_GLOW.hubBright)} * smoothstep(${f(NODE_GLOW.hubRadiusLo)}, ${f(NODE_GLOW.hubRadiusHi)}, iRadius);
    bright *= mix(1.0, ${f(NODE_GLOW.reservedFactor)}, reserved);
    bright *= mix(1.0, ${f(NODE_GLOW.dimFloor)}, uDim * (1.0 - highlight));

    // TIME MACHINE: reconstruct this node's presence at the scrub position. A node
    // fades in as the scrub crosses its birth commit and out before its death; a
    // firing pop (birth) and a gentler pulse (last modify) ripple as edits land.
    // All gated by uTimeTravel so the live present is byte-for-byte unchanged.
    float ttAlpha = 1.0;
    if (uTimeTravel > 0.001) {
      // Fade in over the window BEFORE the birth commit so the node is FULLY
      // present exactly at it (spec/90: created ≤ T is inclusive); fade out
      // before death so it is gone AT the delete commit (deleted > T, exclusive).
      float born = iBirthIdx < 0.0 ? 1.0 : smoothstep(iBirthIdx - ${f(TIME_MACHINE.fadeWindow)}, iBirthIdx, uScrub);
      float alive = 1.0 - smoothstep(iDeathIdx - ${f(TIME_MACHINE.fadeWindow)}, iDeathIdx, uScrub);
      float present = born * alive;
      float p = mix(1.0, present, uTimeTravel);
      // Flashes are gated by RECENCY of scrub movement (wall clock): full while
      // stepping/playing, easing out once the viewer stands still. Without it a
      // flash is a pure function of position and freezes at full glow ON a
      // commit — a whole-wiki commit whited out the entire brain (2026-07-12).
      float recency = 1.0 - smoothstep(${f(TIME_MACHINE.flashHold)}, ${f(TIME_MACHINE.flashHold + TIME_MACHINE.flashDecay)}, uTime - uScrubStamp);
      float bsince = uScrub - iBirthIdx;
      float bflash = recency * ((iBirthIdx >= 0.0 && bsince >= 0.0 && bsince < ${f(TIME_MACHINE.flashWindow)})
        ? (1.0 - bsince / ${f(TIME_MACHINE.flashWindow)}) : 0.0);
      float msince = uScrub - iModIdx;
      float mflash = recency * ((iModIdx >= 0.0 && msince >= 0.0 && msince < ${f(TIME_MACHINE.flashWindow)})
        ? (1.0 - msince / ${f(TIME_MACHINE.flashWindow)}) : 0.0);
      scale *= p * (1.0 + uTimeTravel * (${f(TIME_MACHINE.birthPop)} * bflash + ${f(TIME_MACHINE.modPop)} * mflash));
      bright = bright * p + uTimeTravel * p * (${f(TIME_MACHINE.birthGlow)} * bflash + ${f(TIME_MACHINE.modGlow)} * mflash);
      ttAlpha = p;
    }

    vQuad = position.xy;
    vColor = iColor;
    vIntensity = bright;
    vAlpha = (1.0 - death) * ttAlpha;
    vCluster = cluster;
    vShape = shapeIdx;

    // Billboard in VIEW space so sprites face the camera in both the ortho
    // cosmos and the perspective brain. Under the top-down ortho camera (no
    // roll/tilt) this is identical to the old world-space offset — cosmos
    // stays byte-for-byte the same.
    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    mv.xy += position.xy * scale;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBloom;

  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vAlpha;
  varying float vCluster;
  varying float vEntity;
  varying float vShape;

  // Regular-polygon SDF (n sides), normalized so a flat edge sits at ~1.0 —
  // the same threshold dCircle/dDiamond already use. Simple by design (the
  // ontology TYPE channel; docs/ontology.md): a doc's shape has no bearing
  // on identity, just legibility at a glance.
  float sdPolygon(vec2 p, float n) {
    float a = atan(p.x, p.y);
    float seg = 6.283185307 / n;
    float halfSeg = seg * 0.5;
    float ang = mod(a + halfSeg, seg) - halfSeg;
    return length(p) * cos(ang) / cos(halfSeg);
  }

  // tuning.TYPE_SHAPE: 0 circle (article/absent/unknown) · 1 triangle
  // (decision) · 2 square (playbook) · 3 pentagon (reference) · 4 ring (log).
  float sdOntologyShape(vec2 p, float shapeIdx, float dCircle) {
    if (shapeIdx < 0.5) return dCircle;
    if (shapeIdx < 1.5) return sdPolygon(p, 3.0);
    if (shapeIdx < 2.5) return sdPolygon(p, 4.0);
    if (shapeIdx < 3.5) return sdPolygon(p, 5.0);
    return abs(dCircle - 0.6) * 2.0;
  }

  void main() {
    // Docs are their ontology TYPE shape (default: disc), entities are gems
    // (diamond) — a different species, always, regardless of vShape.
    float dCircle = length(vQuad);
    float dDiamond = abs(vQuad.x) + abs(vQuad.y);
    float dDoc = sdOntologyShape(vQuad, vShape, dCircle);
    float d = mix(dDoc, dDiamond, vEntity);
    if (d > 1.0) discard;
    // Hard-ish core with a restrained radial halo (tuning.ts owns the numbers).
    float core = smoothstep(0.32, 0.06, d);
    // Cluster proxies read as a hollow ring ("a container of many"), not a star.
    float ring = smoothstep(0.12, 0.0, abs(d - 0.6));
    float shape = mix(core, ring, vCluster);
    // A vertical facet highlight sells the gem as a cut stone.
    float facet = vEntity * smoothstep(0.05, 0.0, abs(vQuad.x)) * smoothstep(0.95, 0.1, dDiamond) * 0.6;
    // uBloom scales the wide additive halo — weak GPU tiers trim overdraw.
    float glow = exp(-d * d * ${f(NODE_GLOW.haloFalloff)}) * ${f(NODE_GLOW.haloStrength)} * uBloom;
    float i = (shape * ${f(NODE_GLOW.coreIntensity)} + facet + glow) * vIntensity;
    gl_FragColor = vec4(vColor * i, i * vAlpha);
  }
`;

function buildGeometry(runtime: GraphRuntime): THREE.InstancedBufferGeometry {
  const live = runtime.liveCount;
  const total = runtime.totalCount;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = total;

  const cosmos = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  const radius = new Float32Array(total);
  const birth = new Float32Array(total).fill(-1);
  const death = new Float32Array(total);
  const activity = new Float32Array(total).fill(-1);
  const flags = new Float32Array(total);
  const highlight = new Float32Array(total);
  // TIME MACHINE per-node commit indices (sentinels: born-before-all / immortal / never-modified).
  const birthIdx = new Float32Array(total).fill(-1);
  const deathIdx = new Float32Array(total).fill(1e9);
  const modIdx = new Float32Array(total).fill(-1);

  for (let i = 0; i < live; i++) {
    cosmos[i * 3] = runtime.positions[i * 2] ?? 0;
    cosmos[i * 3 + 1] = runtime.positions[i * 2 + 1] ?? 0;
    color[i * 3] = runtime.colors[i * 3] ?? 1;
    color[i * 3 + 1] = runtime.colors[i * 3 + 1] ?? 1;
    color[i * 3 + 2] = runtime.colors[i * 3 + 2] ?? 1;
    radius[i] = runtime.radii[i] ?? 5;
    birth[i] = runtime.birth[i] ?? -1;
    activity[i] = runtime.activityAt[i] ?? -1;
    // bit 0 = reserved (index/log), bit 1 = cluster proxy, bit 2 = entity (T3 gem),
    // bits 3-5 = ontology shape index (0-4) — packed in rather than a dedicated
    // attribute to stay under software/mobile GPUs' vertex-attribute limits.
    flags[i] =
      (runtime.reserved[i] ?? 0) |
      ((runtime.cluster[i] ?? 0) << 1) |
      ((runtime.family[i] ?? 0) << 2) |
      ((runtime.shape[i] ?? 0) << 3);
    birthIdx[i] = runtime.birthIdx[i] ?? -1;
    deathIdx[i] = runtime.deathIdx[i] ?? 1e9;
    modIdx[i] = runtime.modIdx[i] ?? -1;
  }
  for (let d = 0; d < runtime.dying.length; d++) {
    const i = live + d;
    const dying = runtime.dying[d];
    if (!dying) continue;
    cosmos[i * 3] = dying.x;
    cosmos[i * 3 + 1] = dying.y;
    color[i * 3] = dying.color[0];
    color[i * 3 + 1] = dying.color[1];
    color[i * 3 + 2] = dying.color[2];
    radius[i] = dying.radius;
    birth[i] = -1;
    death[i] = dying.deathAt;
    activity[i] = -1;
  }

  // iBrain: the 3D brain-layout target for each live node (world units). Until
  // brain mode is entered runtime.brainPositions is empty, so it mirrors the
  // cosmos target — uMorph is 0 and nothing moves (cosmos byte-unchanged).
  const brain = cosmos.slice();
  const bp = runtime.brainPositions;
  if (bp.length >= live * 3) {
    for (let i = 0; i < live * 3; i++) brain[i] = bp[i]!;
  }

  // Per-node morph stagger (deterministic from the index) — the "stream in".
  const stagger = new Float32Array(total);
  for (let i = 0; i < total; i++) stagger[i] = nodeStagger(i);

  const add = (name: string, array: Float32Array, itemSize: number, dynamic = false) => {
    const attr = new THREE.InstancedBufferAttribute(array, itemSize);
    if (dynamic) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
  };
  add('iCosmos', cosmos, 3, true);
  add('iBrain', brain, 3);
  add('iColor', color, 3);
  add('iRadius', radius, 1);
  add('iBirth', birth, 1);
  add('iDeath', death, 1);
  add('iActivity', activity, 1);
  add('iFlags', flags, 1);
  add('iHighlight', highlight, 1, true);
  add('iStagger', stagger, 1);
  add('iBirthIdx', birthIdx, 1);
  add('iDeathIdx', deathIdx, 1);
  add('iModIdx', modIdx, 1);
  return geo;
}

interface HighlightStamp {
  selection: string | null;
  hovered: string | null;
  highlight: ReadonlySet<string>;
  dim: boolean; // dimOthers can flip while the highlight set identity stays
}

export function NodesLayer({ runtime }: { runtime: GraphRuntime }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uMorph: { value: 0 }, // 2D cosmos; the M3 brain layout animates this
          uDim: { value: 0 },
          uBloom: { value: 1 }, // additive-halo strength; the GPU tier sets it
          uTimeTravel: { value: 0 }, // TIME MACHINE: eased 0→1 by TimeController
          uScrub: { value: 0 }, // the animated fractional commit index
          uScrubStamp: { value: -1e9 }, // uTime when the scrub last moved (flash recency)
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const tracked = useRef<{ version: number; geometry: THREE.InstancedBufferGeometry | null; stamp: HighlightStamp | null }>({
    version: -1,
    geometry: null,
    stamp: null,
  });

  useEffect(() => {
    const current = tracked.current;
    return () => {
      current.geometry?.dispose();
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (tracked.current.version !== runtime.version) {
      const old = tracked.current.geometry;
      const geo = buildGeometry(runtime);
      mesh.geometry = geo;
      tracked.current.geometry = geo;
      tracked.current.version = runtime.version;
      tracked.current.stamp = null;
      old?.dispose();
    }
    const geo = tracked.current.geometry;
    if (!geo) return;

    // Stream the latest simulated positions into the cosmos target.
    const cosmos = geo.getAttribute('iCosmos') as THREE.InstancedBufferAttribute;
    const arr = cosmos.array as Float32Array;
    for (let i = 0; i < runtime.liveCount; i++) {
      arr[i * 3] = runtime.positions[i * 2] ?? 0;
      arr[i * 3 + 1] = runtime.positions[i * 2 + 1] ?? 0;
    }
    cosmos.needsUpdate = true;

    // Refresh highlight values only when selection/search state changed. The hovered
    // (or, when nothing is hovered, the selected) node is the FOCUS: its neighbours
    // lift so the local neighbourhood reads instantly on hover (scene/emphasis).
    const s = runtime.store.getState();
    // A clicked ENTITY is a selection too — resolve both kinds to one render id.
    const selId = selectionRenderId(s.selection, s.entitySelection);
    const stamp = tracked.current.stamp;
    if (
      !stamp ||
      stamp.selection !== selId ||
      stamp.hovered !== s.hovered ||
      stamp.highlight !== s.highlight ||
      stamp.dim !== s.dimOthers
    ) {
      tracked.current.stamp = { selection: selId, hovered: s.hovered, highlight: s.highlight, dim: s.dimOthers };
      const hl = geo.getAttribute('iHighlight') as THREE.InstancedBufferAttribute;
      const hlArr = hl.array as Float32Array;
      const hoveredIdx = s.hovered !== null ? runtime.index.get(s.hovered) ?? -1 : -1;
      const selectionIdx = selId !== null ? runtime.index.get(selId) ?? -1 : -1;
      // A lens-hidden hover never becomes the focus (and a selection anchors it).
      const hoveredHidden = s.dimOthers && s.hovered !== null && !s.highlight.has(s.hovered);
      const focus = focusIndex(hoveredIdx, selectionIdx, hoveredHidden);
      const neighborSet = focus >= 0 ? new Set(runtime.neighbors[focus] ?? []) : null;
      for (let i = 0; i < runtime.liveCount; i++) {
        const id = runtime.ids[i] as string;
        const isNeighbor = neighborSet !== null && neighborSet.has(i);
        const isSelection = selId === id;
        hlArr[i] = nodeHighlightLevel({
          isSelection,
          isHovered: s.hovered === id,
          inSearch: s.highlight.has(id),
          isNeighbor,
          // One rule (scene/emphasis): the focus's neighbours PIERCE the lens —
          // its connections must point at visible nodes, not empty space.
          lensHidden: !lensAllowsInteraction({
            dimOthers: s.dimOthers,
            inHighlight: s.highlight.has(id),
            isSelection,
            isFocusNeighbor: isNeighbor,
          }),
        });
      }
      hlArr.fill(0, runtime.liveCount);
      hl.needsUpdate = true;
    }

    material.uniforms.uTime!.value = runtime.now();
    material.uniforms.uMorph!.value = runtime.morph;
    material.uniforms.uTimeTravel!.value = runtime.timeTravelAmt;
    material.uniforms.uScrub!.value = runtime.scrub;
    material.uniforms.uScrubStamp!.value = runtime.scrubStamp;
    material.uniforms.uBloom!.value = s.gpu.bloomEnabled ? 1 : GPU_BUDGET.bloomDisabledScale;
    const dimTarget = s.dimOthers ? 1 : 0;
    const dim = material.uniforms.uDim!;
    dim.value += (dimTarget - (dim.value as number)) * DIM_EASE;
  });

  return <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={2} />;
}
