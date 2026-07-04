/**
 * The translucent, fresnel-rimmed brain SHELL — a cloud of additive point
 * sprites sampled ON the SDF surface (scene/brainShell.ts), each carrying its
 * outward normal. The shader reads the grazing angle between the normal and the
 * view direction as a fresnel rim, so the silhouette glows and the front reads
 * brighter than the back (a depth cue) — a rimmed hologram surface out of points,
 * no marching-cubes tables, reusing the very SDF the nodes are contained in.
 *
 * It only appears with the morph (fades in past ~0.3) so the cosmos is unchanged,
 * and it is mounted only while the brain is on screen (CosmosCanvas gates it).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { bounds } from './brainSDF';
import { sampleShellPoints } from './brainShell';
import { BRAIN, glslFloat as f } from './tuning';
import type { GraphRuntime } from './runtime';

const VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iNormal;
  uniform float uSize;
  varying vec2 vQuad;
  varying float vFres;
  varying float vFacing;
  varying float vWorldY;

  void main() {
    vQuad = position.xy;
    vec3 world = iPos;
    vec3 viewDir = normalize(cameraPosition - world);
    float ndv = dot(normalize(iNormal), viewDir);
    vFres = pow(1.0 - abs(ndv), ${f(BRAIN.shellFresnel)});
    vFacing = ndv;              // >0 faces the camera (front), <0 the far side
    vWorldY = world.y;
    // Billboard the sprite in view space.
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uMorph;
  uniform float uTime;
  varying vec2 vQuad;
  varying float vFres;
  varying float vFacing;
  varying float vWorldY;

  void main() {
    float appear = smoothstep(0.28, 0.96, uMorph);
    if (appear <= 0.0) discard;
    float d = length(vQuad);
    if (d > 1.0) discard;
    float sprite = smoothstep(1.0, 0.0, d);
    // Fresnel rim over a faint core.
    float glow = ${f(BRAIN.shellCoreGlow)} + ${f(BRAIN.shellRimGlow)} * vFres;
    // Scanlines drifting up the form.
    float scan = 1.0 - ${f(BRAIN.shellScanDepth)} * (0.5 + 0.5 * sin(vWorldY * ${f(BRAIN.shellScanFreq)} + uTime * ${f(BRAIN.shellScanSpeed)}));
    // Depth cue: the far side of the shell dims.
    float depth = mix(1.0 - ${f(BRAIN.shellFogDepth)}, 1.0, smoothstep(-0.35, 0.35, vFacing));
    float i = sprite * glow * scan * depth * appear;
    vec3 tint = vec3(${f(BRAIN.shellTint[0])}, ${f(BRAIN.shellTint[1])}, ${f(BRAIN.shellTint[2])});
    gl_FragColor = vec4(tint * i, i);
  }
`;

export function BrainShell({ runtime }: { runtime: GraphRuntime }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const shell = sampleShellPoints(BRAIN.shellPoints, BRAIN.seed);
    const count = shell.count;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.instanceCount = count;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      pos[i] = shell.positions[i]! * BRAIN.scale; // natural units → world
      nrm[i] = shell.normals[i]!;
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iNormal', new THREE.InstancedBufferAttribute(nrm, 3));
    // A generous bound so the shell is never frustum-culled while orbiting.
    const r = BRAIN.scale * Math.max(...bounds.max.map(Math.abs), ...bounds.min.map(Math.abs)) * 1.4;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uMorph: { value: 0 },
          uTime: { value: 0 },
          uSize: { value: BRAIN.shellPointSize },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    material.uniforms.uMorph!.value = runtime.morph;
    material.uniforms.uTime!.value = runtime.now();
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />;
}
