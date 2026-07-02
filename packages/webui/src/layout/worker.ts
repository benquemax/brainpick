/**
 * Force-layout Web Worker. d3-force (repulsion + link springs + weak
 * centering), ticked manually so the simulation cools and pauses; the main
 * thread reheats it by sending a fresh graph message on graph changes.
 * Position Float32Arrays stream back at ~30 Hz while hot.
 */
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { FromWorker, GraphMessage, ToWorker } from './messages';

interface SimNode extends SimulationNodeDatum {
  index?: number;
}

type SimLink = SimulationLinkDatum<SimNode> & { count: number };

const TICK_MS = 16;
const ALPHA_MIN = 0.004;

let sim: Simulation<SimNode, SimLink> | null = null;
let nodes: SimNode[] = [];
let gen = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let tickParity = 0;

function post(message: FromWorker, transfer?: Transferable[]): void {
  // In a dedicated worker `self.postMessage` takes structured-clone options.
  (self as unknown as { postMessage(m: FromWorker, o?: { transfer?: Transferable[] }): void }).postMessage(
    message,
    transfer ? { transfer } : undefined,
  );
}

function snapshotPositions(): Float32Array {
  const out = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as SimNode;
    out[i * 2] = n.x ?? 0;
    out[i * 2 + 1] = n.y ?? 0;
  }
  return out;
}

function stopLoop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startLoop(): void {
  if (timer !== null || sim === null) return;
  timer = setInterval(() => {
    if (sim === null) return stopLoop();
    sim.tick();
    tickParity ^= 1;
    const alpha = sim.alpha();
    if (alpha < ALPHA_MIN) {
      stopLoop();
      const positions = snapshotPositions();
      post({ type: 'positions', gen, positions, alpha }, [positions.buffer]);
      post({ type: 'settled', gen });
      return;
    }
    if (tickParity === 0) {
      const positions = snapshotPositions();
      post({ type: 'positions', gen, positions, alpha }, [positions.buffer]);
    }
  }, TICK_MS);
}

function buildSimulation(msg: GraphMessage): void {
  nodes = new Array<SimNode>(msg.count);
  for (let i = 0; i < msg.count; i++) {
    nodes[i] = { x: msg.seeds[i * 2] ?? 0, y: msg.seeds[i * 2 + 1] ?? 0 };
  }
  const links: SimLink[] = msg.links.map((l) => ({ source: l.source, target: l.target, count: l.count }));

  sim = forceSimulation<SimNode>(nodes)
    .force(
      'charge',
      forceManyBody<SimNode>().strength(-46).theta(0.9).distanceMax(480),
    )
    .force(
      'link',
      forceLink<SimNode, SimLink>(links).distance((l) => 26 + 7 * Math.sqrt(Math.max(0, l.count - 1))),
    )
    .force('cx', forceX<SimNode>(0).strength(0.035))
    .force('cy', forceY<SimNode>(0).strength(0.035))
    .velocityDecay(0.32)
    .alphaMin(ALPHA_MIN)
    .alphaDecay(0.022)
    .stop(); // ticked manually

  sim.alpha(Math.max(msg.reheat, ALPHA_MIN * 2));
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'stop') {
    stopLoop();
    sim = null;
    nodes = [];
    return;
  }
  gen = msg.gen;
  stopLoop();
  buildSimulation(msg);
  if (msg.reheat > 0) {
    startLoop();
  } else {
    // Cold start (e.g. unchanged graph re-sent): report positions once.
    const positions = snapshotPositions();
    post({ type: 'positions', gen, positions, alpha: 0 }, [positions.buffer]);
    post({ type: 'settled', gen });
  }
};
