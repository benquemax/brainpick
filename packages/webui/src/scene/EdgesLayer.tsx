/**
 * Edges as GL line segments, endpoint-colored by their nodes' group colors
 * and blended additively. Each vertex carries cosmos and brain layout targets
 * mixed by a per-endpoint staggered uMorph, so an edge stays attached to its
 * nodes as they stream into the brain. In brain mode a firing pulse — driven by
 * the endpoints' recent-activity timestamps — travels the edge (an agent
 * writing makes the brain fire); it is gated by uMorph, so cosmos is unchanged.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { nodeStagger, type GraphRuntime } from './runtime';
import { BRAIN, DIM_EASE, EDGE_GLOW, ENTITY_EDGE, glslFloat as f } from './tuning';

const VERTEX = /* glsl */ `
  attribute vec3 aBrain;
  attribute vec3 aColor;
  attribute float aStagger;
  attribute float aEnd;    // 0 at the source vertex, 1 at the target
  attribute float aFire;   // scene-time this edge last fired (−1 = never)
  uniform float uMorph;
  varying vec3 vColor;
  varying float vT;
  varying float vFire;

  void main() {
    vColor = aColor;
    vT = aEnd;
    vFire = aFire;
    float span = ${f(BRAIN.staggerSpan)};
    float m = clamp((uMorph - aStagger * span) / (1.0 - span), 0.0, 1.0);
    vec3 p = mix(position, aBrain, m);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform float uDim;
  uniform float uMorph;
  uniform float uTime;
  varying vec3 vColor;
  varying float vT;
  varying float vFire;

  void main() {
    float k = uOpacity * mix(1.0, ${f(EDGE_GLOW.dimFactor)}, uDim);
    vec3 col = vColor * k;
    float a = k;
    // Firing pulse — brain mode only. A glow travels source→target after the
    // edge's endpoints saw recent activity, fading over its lifetime.
    if (uMorph > 0.01 && vFire >= 0.0) {
      float age = (uTime - vFire) / ${f(BRAIN.pulseSeconds)};
      if (age >= 0.0 && age <= 1.0) {
        float d = abs(vT - age);
        float pulse = smoothstep(${f(BRAIN.pulseWidth)}, 0.0, d) * (1.0 - age) * uMorph * ${f(BRAIN.pulseGlow)};
        col += vColor * pulse;
        a += pulse;
      }
    }
    gl_FragColor = vec4(col, a);
  }
`;

function buildGeometry(runtime: GraphRuntime): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const vertCount = runtime.edgeCount * 2;
  const positions = new Float32Array(vertCount * 3);
  const brain = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const stagger = new Float32Array(vertCount);
  const ends = new Float32Array(vertCount);
  const fire = new Float32Array(vertCount).fill(-1);
  const bp = runtime.brainPositions;
  const hasBrain = bp.length >= runtime.liveCount * 3;

  for (let e = 0; e < runtime.edgeCount; e++) {
    // kind: 0 doc link, 1 T3 relation, 2 virtual gravitation.
    const kind = runtime.edgeKinds[e] ?? 0;
    const weight = runtime.edgeWeights[e] ?? 1;
    const bright = kind === 1 ? ENTITY_EDGE.relationFloor + (1 - ENTITY_EDGE.relationFloor) * weight : 1;
    const src = runtime.edgePairs[e * 2] ?? 0;
    const tgt = runtime.edgePairs[e * 2 + 1] ?? 0;
    // The edge fires from whichever endpoint saw activity most recently.
    const edgeFire = Math.max(runtime.activityAt[src] ?? -1, runtime.activityAt[tgt] ?? -1);
    for (let end = 0; end < 2; end++) {
      const node = end === 0 ? src : tgt;
      const v = e * 2 + end;
      positions[v * 3] = runtime.positions[node * 2] ?? 0;
      positions[v * 3 + 1] = runtime.positions[node * 2 + 1] ?? 0;
      if (hasBrain) {
        brain[v * 3] = bp[node * 3] ?? 0;
        brain[v * 3 + 1] = bp[node * 3 + 1] ?? 0;
        brain[v * 3 + 2] = bp[node * 3 + 2] ?? 0;
      } else {
        brain[v * 3] = positions[v * 3];
        brain[v * 3 + 1] = positions[v * 3 + 1];
      }
      stagger[v] = nodeStagger(node);
      ends[v] = end;
      fire[v] = edgeFire;
      if (kind === 2) {
        colors[v * 3] = ENTITY_EDGE.virtualTint[0] * ENTITY_EDGE.virtualBright;
        colors[v * 3 + 1] = ENTITY_EDGE.virtualTint[1] * ENTITY_EDGE.virtualBright;
        colors[v * 3 + 2] = ENTITY_EDGE.virtualTint[2] * ENTITY_EDGE.virtualBright;
      } else {
        colors[v * 3] = (runtime.colors[node * 3] ?? 0.6) * bright;
        colors[v * 3 + 1] = (runtime.colors[node * 3 + 1] ?? 0.8) * bright;
        colors[v * 3 + 2] = (runtime.colors[node * 3 + 2] ?? 1) * bright;
      }
    }
  }
  const posAttr = new THREE.Float32BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aBrain', new THREE.Float32BufferAttribute(brain, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aStagger', new THREE.Float32BufferAttribute(stagger, 1));
  geo.setAttribute('aEnd', new THREE.Float32BufferAttribute(ends, 1));
  geo.setAttribute('aFire', new THREE.Float32BufferAttribute(fire, 1));
  return geo;
}

export function EdgesLayer({ runtime }: { runtime: GraphRuntime }) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uMorph: { value: 0 },
          uOpacity: { value: EDGE_GLOW.opacity },
          uDim: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const tracked = useRef<{ version: number; geometry: THREE.BufferGeometry | null }>({
    version: -1,
    geometry: null,
  });

  useEffect(() => {
    const current = tracked.current;
    return () => {
      current.geometry?.dispose();
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;
    if (tracked.current.version !== runtime.version) {
      const old = tracked.current.geometry;
      const geo = buildGeometry(runtime);
      line.geometry = geo;
      tracked.current.geometry = geo;
      tracked.current.version = runtime.version;
      old?.dispose();
    }
    const geo = tracked.current.geometry;
    if (!geo) return;

    // Stream the latest cosmos endpoints (the brain targets are static per build).
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let e = 0; e < runtime.edgeCount; e++) {
      for (let end = 0; end < 2; end++) {
        const node = runtime.edgePairs[e * 2 + end] ?? 0;
        const v = e * 2 + end;
        arr[v * 3] = runtime.positions[node * 2] ?? 0;
        arr[v * 3 + 1] = runtime.positions[node * 2 + 1] ?? 0;
      }
    }
    pos.needsUpdate = true;

    const s = runtime.store.getState();
    material.uniforms.uMorph!.value = runtime.morph;
    material.uniforms.uTime!.value = runtime.now();
    const dimTarget = s.dimOthers ? 1 : 0;
    const dim = material.uniforms.uDim!;
    dim.value += (dimTarget - (dim.value as number)) * DIM_EASE;
  });

  return <lineSegments ref={lineRef} material={material} frustumCulled={false} renderOrder={1} />;
}
