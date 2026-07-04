import type { GraphDelta, GraphPayload } from '../src/graph/types';

export declare const BASE_SEQ: number;
export declare const STEP_COUNT: number;

export declare function initialGraph(): GraphPayload;
export declare function nextDelta(graph: GraphPayload, seq: number, stepIndex: number): GraphDelta;
export declare function applyDeltaToGraph(graph: GraphPayload, delta: GraphDelta): GraphPayload;

export interface MockDoc {
  path: string;
  title: string;
  description: string | null;
  type: string | null;
  tags: string[];
  timestamp: string | null;
  reserved: boolean;
  text: string;
}
export declare function mockDocs(): MockDoc[];

export interface MockEntityGraph {
  nodes: Array<{ id: string; name: string; type: string | null; description: string | null; degree: number }>;
  edges: Array<{ src: string; dst: string; weight: number }>;
}
export declare function entityGraph(): MockEntityGraph;
export declare function entityNeighbors(
  doc: string,
  depth?: number,
): {
  center: string;
  nodes: Array<{ id: string; name: string; description: string | null; distance: number; source_docs: string[] }>;
  edges: Array<{ src: string; dst: string }>;
};
