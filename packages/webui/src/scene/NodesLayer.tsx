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
import type { GraphRuntime } from './runtime';
import { DIM_EASE, glslFloat as f, GPU_BUDGET, NODE_GLOW } from './tuning';

const VERTEX = /* glsl */ `
  attribute vec3 iCosmos;
  attribute vec3 iBrain;
  attribute vec3 iColor;
  attribute float iRadius;
  attribute float iBirth;
  attribute float iDeath;
  attribute float iActivity;
  attribute float iFlags;
  attribute float iHighlight;

  uniform float uMorph;
  uniform float uTime;
  uniform float uDim;

  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vAlpha;
  varying float vCluster;

  void main() {
    vec3 center = mix(iCosmos, iBrain, uMorph);

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
    float highlight = clamp(iHighlight, 0.0, 1.0);
    float scale = iRadius * grow * (1.0 - death)
      * (1.0 + ${f(NODE_GLOW.pulseScale)} * pulse + ${f(NODE_GLOW.highlightScale)} * highlight);

    float bright = 1.0 + ${f(NODE_GLOW.pulseBoost)} * pulse + ${f(NODE_GLOW.highlightBoost)} * highlight;
    bright *= mix(1.0, ${f(NODE_GLOW.reservedFactor)}, reserved);
    bright *= mix(1.0, ${f(NODE_GLOW.dimFloor)}, uDim * (1.0 - highlight));

    vQuad = position.xy;
    vColor = iColor;
    vIntensity = bright;
    vAlpha = 1.0 - death;
    vCluster = cluster;

    vec3 world = center + vec3(position.xy * scale, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
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

  void main() {
    float d = length(vQuad);
    if (d > 1.0) discard;
    // Hard-ish core with a restrained radial halo (tuning.ts owns the numbers).
    float core = smoothstep(0.32, 0.06, d);
    // Cluster proxies read as a hollow ring ("a container of many"), not a star.
    float ring = smoothstep(0.12, 0.0, abs(d - 0.6));
    float shape = mix(core, ring, vCluster);
    // uBloom scales the wide additive halo — weak GPU tiers trim overdraw.
    float glow = exp(-d * d * ${f(NODE_GLOW.haloFalloff)}) * ${f(NODE_GLOW.haloStrength)} * uBloom;
    float i = (shape * ${f(NODE_GLOW.coreIntensity)} + glow) * vIntensity;
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

  for (let i = 0; i < live; i++) {
    cosmos[i * 3] = runtime.positions[i * 2] ?? 0;
    cosmos[i * 3 + 1] = runtime.positions[i * 2 + 1] ?? 0;
    color[i * 3] = runtime.colors[i * 3] ?? 1;
    color[i * 3 + 1] = runtime.colors[i * 3 + 1] ?? 1;
    color[i * 3 + 2] = runtime.colors[i * 3 + 2] ?? 1;
    radius[i] = runtime.radii[i] ?? 5;
    birth[i] = runtime.birth[i] ?? -1;
    activity[i] = runtime.activityAt[i] ?? -1;
    // bit 0 = reserved (index/log), bit 1 = cluster proxy ("+N more").
    flags[i] = (runtime.reserved[i] ?? 0) | ((runtime.cluster[i] ?? 0) << 1);
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

  // iBrain starts as a copy of the cosmos target: uMorph is 0 in M1, and a
  // copied buffer keeps any accidental morph non-degenerate until M3.
  const brain = cosmos.slice();

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
  return geo;
}

interface HighlightStamp {
  selection: string | null;
  hovered: string | null;
  highlight: ReadonlySet<string>;
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

    // Refresh highlight values only when selection/search state changed.
    const s = runtime.store.getState();
    const stamp = tracked.current.stamp;
    if (!stamp || stamp.selection !== s.selection || stamp.hovered !== s.hovered || stamp.highlight !== s.highlight) {
      tracked.current.stamp = { selection: s.selection, hovered: s.hovered, highlight: s.highlight };
      const hl = geo.getAttribute('iHighlight') as THREE.InstancedBufferAttribute;
      const hlArr = hl.array as Float32Array;
      for (let i = 0; i < runtime.liveCount; i++) {
        const id = runtime.ids[i] as string;
        hlArr[i] =
          s.selection === id ? 1 : s.highlight.has(id) ? 0.85 : s.hovered === id ? 0.55 : 0;
      }
      hlArr.fill(0, runtime.liveCount);
      hl.needsUpdate = true;
    }

    material.uniforms.uTime!.value = runtime.now();
    material.uniforms.uBloom!.value = s.gpu.bloomEnabled ? 1 : GPU_BUDGET.bloomDisabledScale;
    const dimTarget = s.dimOthers ? 1 : 0;
    const dim = material.uniforms.uDim!;
    dim.value += (dimTarget - (dim.value as number)) * DIM_EASE;
  });

  return <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={2} />;
}
