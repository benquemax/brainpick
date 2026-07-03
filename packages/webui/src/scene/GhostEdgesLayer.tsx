/**
 * Ghost edges: broken links rendered as dashed, faint lines from their live
 * source node toward a phantom ring marker — the hole where the target
 * document should be. Phantom positions are deterministic offsets from the
 * source (scene/ghosts.ts); the HUD ghost toggle flips visibility, and the
 * layer dims with the rest of the cosmos under lenses/search.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GraphRuntime } from './runtime';
import { DIM_EASE, GHOST_GLOW, glslFloat as f } from './tuning';

/** Pale, desaturated tone — an absence, not a link. */
const GHOST_COLOR = 'vec3(0.55, 0.78, 0.92)';

const LINE_VERTEX = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uDim;
  varying float vT;
  void main() {
    // Dash pattern along the edge (t in [0,1]); the gap side is discarded.
    if (fract(vT * ${f(GHOST_GLOW.dashCount)}) > ${f(GHOST_GLOW.dashDuty)}) discard;
    float k = ${f(GHOST_GLOW.opacity)} * mix(1.0, ${f(GHOST_GLOW.dimFactor)}, uDim);
    // Fade slightly toward the phantom end — the trail dissolves into nothing.
    k *= mix(1.0, 0.55, vT);
    gl_FragColor = vec4(${GHOST_COLOR} * k, k);
  }
`;

const MARKER_VERTEX = /* glsl */ `
  attribute vec3 iCenter;
  varying vec2 vQuad;
  void main() {
    vQuad = position.xy;
    vec3 world = iCenter + vec3(position.xy * ${f(GHOST_GLOW.markerRadius)}, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uDim;
  varying vec2 vQuad;
  void main() {
    float d = length(vQuad);
    if (d > 1.0) discard;
    float mid = ${f((GHOST_GLOW.ringInner + GHOST_GLOW.ringOuter) / 2)};
    float halfW = ${f((GHOST_GLOW.ringOuter - GHOST_GLOW.ringInner) / 2)};
    float ring = 1.0 - smoothstep(halfW - 0.05, halfW + 0.07, abs(d - mid));
    float i = ring * ${f(GHOST_GLOW.markerIntensity)} * mix(1.0, ${f(GHOST_GLOW.dimFactor)}, uDim);
    gl_FragColor = vec4(${GHOST_COLOR} * i, i);
  }
`;

function additiveMaterial(vertexShader: string, fragmentShader: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uDim: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildLineGeometry(count: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(new Float32Array(count * 2 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', positions);
  const t = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) t[i * 2 + 1] = 1; // source 0 -> phantom 1
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  return geo;
}

function buildMarkerGeometry(count: number): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = count;
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  centers.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iCenter', centers);
  return geo;
}

export function GhostEdgesLayer({ runtime }: { runtime: GraphRuntime }) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const markerRef = useRef<THREE.Mesh>(null);
  const lineMaterial = useMemo(() => additiveMaterial(LINE_VERTEX, LINE_FRAGMENT), []);
  const markerMaterial = useMemo(() => additiveMaterial(MARKER_VERTEX, MARKER_FRAGMENT), []);
  const tracked = useRef<{
    version: number;
    line: THREE.BufferGeometry | null;
    marker: THREE.InstancedBufferGeometry | null;
  }>({ version: -1, line: null, marker: null });

  useEffect(() => {
    const current = tracked.current;
    return () => {
      current.line?.dispose();
      current.marker?.dispose();
      lineMaterial.dispose();
      markerMaterial.dispose();
    };
  }, [lineMaterial, markerMaterial]);

  useFrame(() => {
    const line = lineRef.current;
    const marker = markerRef.current;
    if (!line || !marker) return;

    const s = runtime.store.getState();
    const visible = s.showGhosts && runtime.ghostAnchors.length > 0;
    line.visible = visible;
    marker.visible = visible;

    if (tracked.current.version !== runtime.version) {
      tracked.current.line?.dispose();
      tracked.current.marker?.dispose();
      const count = runtime.ghostAnchors.length;
      const lineGeo = buildLineGeometry(count);
      const markerGeo = buildMarkerGeometry(count);
      line.geometry = lineGeo;
      marker.geometry = markerGeo;
      tracked.current = { version: runtime.version, line: lineGeo, marker: markerGeo };
    }
    if (!visible) return;

    const lineGeo = tracked.current.line;
    const markerGeo = tracked.current.marker;
    if (!lineGeo || !markerGeo) return;

    // Phantoms track their (simulated) source every frame.
    const pos = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;
    const centers = markerGeo.getAttribute('iCenter') as THREE.InstancedBufferAttribute;
    const centerArr = centers.array as Float32Array;
    for (let g = 0; g < runtime.ghostAnchors.length; g++) {
      const anchor = runtime.ghostAnchors[g];
      if (!anchor) continue;
      const sx = runtime.positions[anchor.sourceIndex * 2] ?? 0;
      const sy = runtime.positions[anchor.sourceIndex * 2 + 1] ?? 0;
      posArr[g * 6] = sx;
      posArr[g * 6 + 1] = sy;
      posArr[g * 6 + 3] = sx + anchor.dx;
      posArr[g * 6 + 4] = sy + anchor.dy;
      centerArr[g * 3] = sx + anchor.dx;
      centerArr[g * 3 + 1] = sy + anchor.dy;
    }
    pos.needsUpdate = true;
    centers.needsUpdate = true;

    const dimTarget = s.dimOthers ? 1 : 0;
    for (const material of [lineMaterial, markerMaterial]) {
      const dim = material.uniforms.uDim!;
      dim.value += (dimTarget - (dim.value as number)) * DIM_EASE;
    }
  });

  return (
    <>
      <lineSegments ref={lineRef} material={lineMaterial} frustumCulled={false} renderOrder={1} />
      <mesh ref={markerRef} material={markerMaterial} frustumCulled={false} renderOrder={1} />
    </>
  );
}
