/** The single R3F scene: edges under nodes, 2D ortho camera, HTML labels. */
import { Canvas } from '@react-three/fiber';
import { CameraRig } from './CameraRig';
import { EdgesLayer } from './EdgesLayer';
import { GhostEdgesLayer } from './GhostEdgesLayer';
import { LabelsLayer } from './LabelsLayer';
import { NodesLayer } from './NodesLayer';
import { PointerControls } from './PointerControls';
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
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 100], zoom: 5, near: 0.1, far: 2000 }}
      dpr={[1, dprCap]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#04060c']} />
      <EdgesLayer runtime={runtime} />
      <GhostEdgesLayer runtime={runtime} />
      <NodesLayer runtime={runtime} />
      <CameraRig runtime={runtime} />
      <PointerControls runtime={runtime} />
      {labelContainer !== null && <LabelsLayer runtime={runtime} container={labelContainer} />}
    </Canvas>
  );
}
