/**
 * Edges as GL line segments, endpoint-colored by their nodes' group colors
 * and blended additively. Like the nodes, each vertex carries cosmos and
 * brain layout targets mixed by uMorph (0 in M1).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GraphRuntime } from './runtime';
import { DIM_EASE, EDGE_GLOW, ENTITY_EDGE, glslFloat as f } from './tuning';

const VERTEX = /* glsl */ `
  attribute vec3 aBrain;
  attribute vec3 aColor;
  uniform float uMorph;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec3 p = mix(position, aBrain, uMorph);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform float uDim;
  varying vec3 vColor;

  void main() {
    float k = uOpacity * mix(1.0, ${f(EDGE_GLOW.dimFactor)}, uDim);
    gl_FragColor = vec4(vColor * k, k);
  }
`;

function buildGeometry(runtime: GraphRuntime): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const vertCount = runtime.edgeCount * 2;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  for (let e = 0; e < runtime.edgeCount; e++) {
    // kind: 0 doc link, 1 T3 relation, 2 virtual gravitation.
    const kind = runtime.edgeKinds[e] ?? 0;
    const weight = runtime.edgeWeights[e] ?? 1;
    // Doc links: brightness 1 → byte-identical to before. Relations: scale by
    // weight above a floor ("width by weight" in an additive-glow renderer).
    const bright = kind === 1 ? ENTITY_EDGE.relationFloor + (1 - ENTITY_EDGE.relationFloor) * weight : 1;
    for (let end = 0; end < 2; end++) {
      const node = runtime.edgePairs[e * 2 + end] ?? 0;
      const v = e * 2 + end;
      positions[v * 3] = runtime.positions[node * 2] ?? 0;
      positions[v * 3 + 1] = runtime.positions[node * 2 + 1] ?? 0;
      if (kind === 2) {
        // Virtual entity→doc hints get their own faint cool tint, not the endpoint hue.
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
  geo.setAttribute('aBrain', new THREE.Float32BufferAttribute(positions.slice(), 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
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
    const dimTarget = s.dimOthers ? 1 : 0;
    const dim = material.uniforms.uDim!;
    dim.value += (dimTarget - (dim.value as number)) * DIM_EASE;
  });

  return <lineSegments ref={lineRef} material={material} frustumCulled={false} renderOrder={1} />;
}
