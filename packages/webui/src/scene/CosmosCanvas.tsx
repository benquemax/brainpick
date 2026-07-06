/** The single R3F scene: edges under nodes, 2D ortho camera, HTML labels — and
 * the holographic brain (shell + perspective orbit rig) while the morph is on. */
import { Canvas } from '@react-three/fiber';
import { BrainCameraRig } from './BrainCameraRig';
import { BrainShell } from './BrainShell';
import { CameraRig } from './CameraRig';
import { EdgesLayer } from './EdgesLayer';
import { GhostEdgesLayer } from './GhostEdgesLayer';
import { LabelsLayer } from './LabelsLayer';
import { MorphController } from './MorphController';
import { NodesLayer } from './NodesLayer';
import { PointerControls } from './PointerControls';
import { TimeController } from './TimeController';
import type { GraphRuntime } from './runtime';
import { useUI } from '../state/store';

export function CosmosCanvas({
  runtime,
  labelContainer,
}: {
  runtime: GraphRuntime;
  labelContainer: HTMLDivElement | null;
}) {
  // Weak GPU tiers cap devicePixelRatio — fewer pixels, steadier frames.
  const dprCap = useUI((s) => s.gpu.dprCap);
  // The brain shell + perspective orbit rig mount only while the morph is on
  // screen; cosmos-only sessions never pay for them (and never compute a layout).
  const brainActive = useUI((s) => s.morphActive);
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 100], zoom: 5, near: 0.1, far: 2000 }}
      dpr={[1, dprCap]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#04060c']} />
      {brainActive && <BrainShell runtime={runtime} />}
      <EdgesLayer runtime={runtime} />
      <GhostEdgesLayer runtime={runtime} />
      <NodesLayer runtime={runtime} />
      <CameraRig runtime={runtime} />
      {brainActive && <BrainCameraRig runtime={runtime} />}
      <MorphController runtime={runtime} />
      <TimeController runtime={runtime} />
      <PointerControls runtime={runtime} />
      {labelContainer !== null && <LabelsLayer runtime={runtime} container={labelContainer} />}
    </Canvas>
  );
}
