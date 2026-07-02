/** Message protocol between the main thread and the layout worker. */

export interface WorkerLink {
  /** Indices into the ids array of the graph message. */
  source: number;
  target: number;
  count: number;
}

export interface GraphMessage {
  type: 'graph';
  /** Generation counter — stale worker output is dropped by the receiver. */
  gen: number;
  count: number;
  links: WorkerLink[];
  /** xy pairs; seeds for every node (transferred). */
  seeds: Float32Array;
  /** Alpha to (re)start the simulation with; 0 keeps it cool. */
  reheat: number;
}

export interface StopMessage {
  type: 'stop';
}

export type ToWorker = GraphMessage | StopMessage;

export interface PositionsMessage {
  type: 'positions';
  gen: number;
  /** xy pairs in the node order of the graph message (transferred). */
  positions: Float32Array;
  alpha: number;
}

export interface SettledMessage {
  type: 'settled';
  gen: number;
}

export type FromWorker = PositionsMessage | SettledMessage;
