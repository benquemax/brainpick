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
import { edgeLensDim, focusIndex, selectionRenderId } from './emphasis';
import { BRAIN, DIM_EASE, EDGE_GLOW, ENTITY_EDGE, glslFloat as f, TIME_MACHINE } from './tuning';

const VERTEX = /* glsl */ `
  attribute vec3 aBrain;
  attribute vec3 aColor;
  attribute float aStagger;
  attribute float aEnd;    // 0 at the source vertex, 1 at the target
  attribute float aFire;   // scene-time this edge last fired (−1 = never)
  attribute float aHighlight; // 1 when this edge is incident to the focused (hover/selected) node
  attribute float aLensDim; // 0 both endpoints in the lens · 0.5 one · 1 none (scene/emphasis)
  attribute float aBirthIdx; // TIME MACHINE: commit index the edge forms at (max of endpoints)
  attribute float aDeathIdx; // commit index it breaks at (min of endpoints)
  uniform float uMorph;
  varying vec3 vColor;
  varying float vT;
  varying float vFire;
  varying float vHi;
  varying float vLensDim;
  varying float vBirthIdx;
  varying float vDeathIdx;

  void main() {
    vColor = aColor;
    vT = aEnd;
    vFire = aFire;
    vHi = aHighlight;
    vLensDim = aLensDim;
    vBirthIdx = aBirthIdx;
    vDeathIdx = aDeathIdx;
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
  uniform float uTimeTravel;  // TIME MACHINE: eased 0→1
  uniform float uScrub;       // animated fractional commit index
  uniform float uScrubStamp;  // uTime when the scrub last moved (flash recency)
  varying vec3 vColor;
  varying float vT;
  varying float vFire;
  varying float vHi;
  varying float vLensDim;
  varying float vBirthIdx;
  varying float vDeathIdx;

  void main() {
    // LENS DIM is per-edge (Tom, 2026-07-12): edges BETWEEN lens members keep
    // full strength, a member's outward connections read at half, and the
    // hidden-to-hidden web fades to a whisper — uDim eases the whole grading
    // in/out so releasing the lens restores the calm idle web smoothly.
    float lensFac = vLensDim < 0.25 ? 1.0
      : (vLensDim < 0.75 ? ${f(EDGE_GLOW.lensHalfFactor)} : ${f(EDGE_GLOW.lensHiddenFactor)});
    float k = uOpacity * mix(1.0, lensFac, uDim);
    // HOVER NEIGHBOURHOOD: the focused node's incident edges jump far above the calm
    // idle web (a big multiplier), plus an additive pop, so you SEE what it connects to.
    k *= 1.0 + ${f(EDGE_GLOW.hoverBoost)} * vHi;
    vec3 col = vColor * k;
    float a = k;
    col += vColor * vHi * ${f(EDGE_GLOW.hoverGlow)};
    a += vHi * ${f(EDGE_GLOW.hoverGlow)};
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
    // TIME MACHINE: the edge exists only while BOTH endpoints do — it fades in as
    // the later endpoint is born (aBirthIdx) and out before either dies. As it
    // forms, a pulse travels source→target: the connection lighting up.
    if (uTimeTravel > 0.001) {
      // Full exactly at the forming commit (later endpoint's birth), gone at the break.
      float born = vBirthIdx < 0.0 ? 1.0 : smoothstep(vBirthIdx - ${f(TIME_MACHINE.fadeWindow)}, vBirthIdx, uScrub);
      float alive = 1.0 - smoothstep(vDeathIdx - ${f(TIME_MACHINE.fadeWindow)}, vDeathIdx, uScrub);
      float p = mix(1.0, born * alive, uTimeTravel);
      col *= p;
      a *= p;
      float since = uScrub - vBirthIdx;
      if (vBirthIdx >= 0.0 && since >= 0.0 && since < ${f(TIME_MACHINE.flashWindow)}) {
        // Same recency gate as the node flashes: the travelling pulse rides
        // scrub MOVEMENT and eases out once the viewer stands on a commit.
        float recency = 1.0 - smoothstep(${f(TIME_MACHINE.flashHold)}, ${f(TIME_MACHINE.flashHold + TIME_MACHINE.flashDecay)}, uTime - uScrubStamp);
        float age = since / ${f(TIME_MACHINE.flashWindow)};
        float d = abs(vT - age);
        float pulse = recency * smoothstep(${f(TIME_MACHINE.edgePulseWidth)}, 0.0, d) * (1.0 - age) * uTimeTravel * ${f(TIME_MACHINE.edgePulseGlow)};
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
  // Per-vertex hover incidence (0/1), streamed in each frame the focus node changes.
  const highlight = new Float32Array(vertCount);
  // TIME MACHINE per-edge indices: the edge is born when its LATER endpoint is
  // (max) and dies when its EARLIER-dying endpoint does (min).
  const birthIdx = new Float32Array(vertCount).fill(-1);
  const deathIdx = new Float32Array(vertCount).fill(1e9);
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
    // Present iff both endpoints present: forms at the later birth, breaks at the
    // earlier death. (−1 birth means an endpoint is present throughout.)
    const edgeBirth = Math.max(runtime.birthIdx[src] ?? -1, runtime.birthIdx[tgt] ?? -1);
    const edgeDeath = Math.min(runtime.deathIdx[src] ?? 1e9, runtime.deathIdx[tgt] ?? 1e9);
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
      birthIdx[v] = edgeBirth;
      deathIdx[v] = edgeDeath;
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
  const hiAttr = new THREE.Float32BufferAttribute(highlight, 1);
  hiAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aHighlight', hiAttr);
  // Per-vertex lens grading (scene/emphasis edgeLensDim), refilled when the lens changes.
  const lensAttr = new THREE.Float32BufferAttribute(new Float32Array(vertCount), 1);
  lensAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aLensDim', lensAttr);
  geo.setAttribute('aBirthIdx', new THREE.Float32BufferAttribute(birthIdx, 1));
  geo.setAttribute('aDeathIdx', new THREE.Float32BufferAttribute(deathIdx, 1));
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
          uTimeTravel: { value: 0 },
          uScrub: { value: 0 },
          uScrubStamp: { value: -1e9 }, // uTime when the scrub last moved (flash recency)
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const tracked = useRef<{
    version: number;
    geometry: THREE.BufferGeometry | null;
    focus: number;
    lens: ReadonlySet<string> | null;
    lensDimOn: boolean;
  }>({
    version: -1,
    geometry: null,
    focus: -2,
    lens: null,
    lensDimOn: false,
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
      tracked.current.focus = -2; // force the hover-incidence buffer to recompute
      tracked.current.lens = null; // …and the lens grading (fresh geometry, fresh buffers)
      old?.dispose();
    }
    const geo = tracked.current.geometry;
    if (!geo) return;

    // Light the FOCUS node's incident edges (the selection anchors — a clicked
    // ENTITY included; hover explores only when nothing is selected, and a
    // lens-hidden hover pops nothing — see scene/emphasis). Only rewritten when
    // the focus changes — not per-frame work.
    const st = runtime.store.getState();
    const selId = selectionRenderId(st.selection, st.entitySelection);
    const hoveredIdx = st.hovered !== null ? runtime.index.get(st.hovered) ?? -1 : -1;
    const selectionIdx = selId !== null ? runtime.index.get(selId) ?? -1 : -1;
    const hoveredHidden = st.dimOthers && st.hovered !== null && !st.highlight.has(st.hovered);
    const focus = focusIndex(hoveredIdx, selectionIdx, hoveredHidden);
    if (tracked.current.focus !== focus) {
      tracked.current.focus = focus;
      const hi = geo.getAttribute('aHighlight') as THREE.BufferAttribute;
      const hiArr = hi.array as Float32Array;
      hiArr.fill(0);
      if (focus >= 0) {
        const inc = runtime.incident[focus];
        if (inc) for (const e of inc) {
          hiArr[e * 2] = 1;
          hiArr[e * 2 + 1] = 1;
        }
      }
      hi.needsUpdate = true;
    }

    // Per-edge lens grading, refilled only when the lens (highlight set / dim flag)
    // changes: 0 both endpoints visible · 0.5 one · 1 none (scene/emphasis).
    if (tracked.current.lens !== st.highlight || tracked.current.lensDimOn !== st.dimOthers) {
      tracked.current.lens = st.highlight;
      tracked.current.lensDimOn = st.dimOthers;
      const lens = geo.getAttribute('aLensDim') as THREE.BufferAttribute;
      const lensArr = lens.array as Float32Array;
      if (!st.dimOthers) {
        lensArr.fill(0);
      } else {
        for (let e = 0; e < runtime.edgeCount; e++) {
          const src = runtime.edgePairs[e * 2] ?? 0;
          const tgt = runtime.edgePairs[e * 2 + 1] ?? 0;
          const level = edgeLensDim(
            st.highlight.has(runtime.ids[src] as string),
            st.highlight.has(runtime.ids[tgt] as string),
          );
          lensArr[e * 2] = level;
          lensArr[e * 2 + 1] = level;
        }
      }
      lens.needsUpdate = true;
    }

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
    material.uniforms.uTimeTravel!.value = runtime.timeTravelAmt;
    material.uniforms.uScrub!.value = runtime.scrub;
    material.uniforms.uScrubStamp!.value = runtime.scrubStamp;
    const dimTarget = s.dimOthers ? 1 : 0;
    const dim = material.uniforms.uDim!;
    dim.value += (dimTarget - (dim.value as number)) * DIM_EASE;
  });

  return <lineSegments ref={lineRef} material={material} frustumCulled={false} renderOrder={1} />;
}
