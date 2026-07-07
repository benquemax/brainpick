import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { morphedWorldOf } from './runtime';
import { isBehindBrainCenter, projectLabelPoint, projectLabelPointMat } from './labelProjection';

const SPAN = 0.55; // BRAIN.staggerSpan

describe('morphedWorldOf — the shared cosmos ⇄ brain position', () => {
  // Two nodes: flat cosmos [x,y] pairs and their 3D brain targets.
  const positions = new Float32Array([1, 2, 3, 4]);
  const brain = new Float32Array([10, 20, 30, 40, 50, 60]);

  it('sits on the FLAT cosmos position at morph 0 (z = 0)', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(morphedWorldOf(0, 0, positions, brain, SPAN, out)).toBe(true);
    expect(out).toEqual({ x: 1, y: 2, z: 0 });
  });

  it('sits on the 3D brain target at morph 1', () => {
    const out = { x: 0, y: 0, z: 0 };
    morphedWorldOf(0, 1, positions, brain, SPAN, out);
    expect(out).toEqual({ x: 10, y: 20, z: 30 });
    morphedWorldOf(1, 1, positions, brain, SPAN, out); // stagger < span → still fully arrived
    expect(out).toEqual({ x: 40, y: 50, z: 60 });
  });

  it('is a clean midpoint mix for a stagger-0 node (morph 0.225 → m 0.5)', () => {
    // node 0 has stagger 0, so m = clamp(morph / (1 - span)); 0.225/0.45 = 0.5.
    const out = { x: 0, y: 0, z: 0 };
    morphedWorldOf(0, 0.225, positions, brain, SPAN, out);
    expect(out.x).toBeCloseTo(5.5, 6); // 1 + (10-1)*0.5
    expect(out.y).toBeCloseTo(11, 6); // 2 + (20-2)*0.5
    expect(out.z).toBeCloseTo(15, 6); // 30*0.5
  });

  it('falls back to the flat position (z 0) and returns false with no brain slot', () => {
    const out = { x: 9, y: 9, z: 9 };
    expect(morphedWorldOf(0, 1, positions, new Float32Array(0), SPAN, out)).toBe(false);
    expect(out).toEqual({ x: 1, y: 2, z: 0 });
    expect(morphedWorldOf(-1, 1, positions, brain, SPAN, out)).toBe(false);
  });
});

describe('projectLabelPoint — a node’s morphed position → screen pixels', () => {
  function camera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  }

  it('projects the look-at point to the centre of the viewport', () => {
    const cam = camera();
    const p = projectLabelPoint(new THREE.Vector3(0, 0, 0), cam, 200, 100, new THREE.Vector3());
    expect(p.onScreen).toBe(true);
    expect(p.sx).toBeCloseTo(100, 3); // width/2
    expect(p.sy).toBeCloseTo(50, 3); // height/2
    expect(p.ndcZ).toBeLessThan(1);
  });

  it('a point below the look-at projects lower on the screen (bigger sy)', () => {
    const cam = camera();
    const below = projectLabelPoint(new THREE.Vector3(0, -1, 0), cam, 200, 100, new THREE.Vector3());
    expect(below.sy).toBeGreaterThan(50); // screen-y grows downward
    expect(below.onScreen).toBe(true);
  });

  it('culls a point BEHIND the camera (ndcZ ≥ 1, not on screen)', () => {
    const cam = camera(); // at z=10 looking toward -Z
    const behind = projectLabelPoint(new THREE.Vector3(0, 0, 20), cam, 200, 100, new THREE.Vector3());
    expect(behind.ndcZ).toBeGreaterThanOrEqual(1);
    expect(behind.onScreen).toBe(false);
  });

  it('culls a point far off to the side (off-viewport)', () => {
    const cam = camera();
    const side = projectLabelPoint(new THREE.Vector3(100, 0, 0), cam, 200, 100, new THREE.Vector3());
    expect(Math.abs(side.sx - 100)).toBeGreaterThan(100);
    expect(side.onScreen).toBe(false);
  });
});

describe('projectLabelPointMat — the same projection from a PUBLISHED pose snapshot', () => {
  // The brain labels project from a pre-composed projection·viewInverse matrix
  // (BrainCameraRig's published pose), NOT the live render camera — whose pose
  // drei's makeDefault controls reset to the origin at frame start. This proves
  // the composed-matrix path is identical to Vector3.project(camera).
  function positionedCamera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
    cam.position.set(4, 3, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true); // Camera.updateMatrixWorld refreshes matrixWorldInverse too
    return cam;
  }
  function viewProjOf(cam: THREE.PerspectiveCamera): THREE.Matrix4 {
    return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  it('matches projectLabelPoint(camera) exactly for several world points', () => {
    const cam = positionedCamera();
    const vp = viewProjOf(cam);
    for (const w of [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, -1, 3),
      new THREE.Vector3(-5, 4, -2),
    ]) {
      const live = projectLabelPoint(w.clone(), cam, 300, 150, new THREE.Vector3());
      const snap = projectLabelPointMat(w.clone(), vp, 300, 150, new THREE.Vector3());
      expect(snap.sx).toBeCloseTo(live.sx, 4);
      expect(snap.sy).toBeCloseTo(live.sy, 4);
      expect(snap.ndcZ).toBeCloseTo(live.ndcZ, 6);
      expect(snap.onScreen).toBe(live.onScreen);
    }
  });

  it('projects the eye’s look-at point to the viewport centre and culls behind-eye points', () => {
    const cam = positionedCamera();
    const vp = viewProjOf(cam);
    const centre = projectLabelPointMat(new THREE.Vector3(0, 0, 0), vp, 300, 150, new THREE.Vector3());
    expect(centre.onScreen).toBe(true);
    expect(centre.sx).toBeCloseTo(150, 3);
    expect(centre.sy).toBeCloseTo(75, 3);
    // A point beyond the origin, further from the eye along the view ray, stays in
    // front (ndcZ < 1); one behind the eye is culled.
    const behindEye = projectLabelPointMat(new THREE.Vector3(8, 6, 24), vp, 300, 150, new THREE.Vector3());
    expect(behindEye.onScreen).toBe(false);
    expect(behindEye.ndcZ).toBeGreaterThanOrEqual(1);
  });
});

describe('isBehindBrainCenter — the brain’s far-side (depth) cull', () => {
  // Camera 100 units from the brain centre (origin) it looks at.
  const cameraPos = new THREE.Vector3(0, 0, 100);
  const MARGIN = 0.2; // cull past depth 120

  it('keeps the visible front + central cloud (never culls what you see)', () => {
    expect(isBehindBrainCenter(new THREE.Vector3(0, 0, 40), cameraPos, MARGIN)).toBe(false); // depth 60 (front)
    expect(isBehindBrainCenter(new THREE.Vector3(0, 0, 0), cameraPos, MARGIN)).toBe(false); // depth 100 (centre)
    expect(isBehindBrainCenter(new THREE.Vector3(0, 0, -15), cameraPos, MARGIN)).toBe(false); // depth 115 (just behind)
    expect(isBehindBrainCenter(new THREE.Vector3(30, 0, 0), cameraPos, MARGIN)).toBe(false); // off-axis but near centre depth
  });

  it('culls a node deep on the occluded far side', () => {
    expect(isBehindBrainCenter(new THREE.Vector3(0, 0, -30), cameraPos, MARGIN)).toBe(true); // depth 130 > 120
  });
});
