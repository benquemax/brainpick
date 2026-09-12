/**
 * Per-edge style by kind (graph/types EdgeKind), pure so it is testable apart
 * from the GL layer: the flag EdgesLayer tints by, and the per-vertex color of
 * each end. A doc link is its endpoints' colors; a T3 relation dims by weight;
 * a virtual tie is a faint hint; a `depends_on` — a skill's declared
 * prerequisite (spec/20) — wears the skill tint and brightens toward the
 * prerequisite end, so the line points at what to read first.
 */
import type { EdgeKind } from '../graph/types';
import { ENTITY_EDGE, SKILL_EDGE } from './tuning';

export const EDGE_KIND = {
  link: 0,
  relation: 1,
  virtual: 2,
  dependsOn: 3,
} as const;

export type EdgeKindFlag = (typeof EDGE_KIND)[keyof typeof EDGE_KIND];

export function edgeKindFlag(kind: EdgeKind): EdgeKindFlag {
  switch (kind) {
    case 'relation':
      return EDGE_KIND.relation;
    case 'virtual':
      return EDGE_KIND.virtual;
    case 'depends_on':
      return EDGE_KIND.dependsOn;
    default:
      return EDGE_KIND.link;
  }
}

type RGB = [number, number, number];

/** The color of one edge vertex: `end` is 0 at the source, 1 at the target;
 * `node` is that endpoint's node color; `weight` the T3 relation weight. */
export function edgeVertexColor(kind: number, end: 0 | 1, node: RGB, weight: number): RGB {
  if (kind === EDGE_KIND.virtual) {
    const b = ENTITY_EDGE.virtualBright;
    return [ENTITY_EDGE.virtualTint[0] * b, ENTITY_EDGE.virtualTint[1] * b, ENTITY_EDGE.virtualTint[2] * b];
  }
  if (kind === EDGE_KIND.dependsOn) {
    const b = SKILL_EDGE.bright * (end === 1 ? 1 : SKILL_EDGE.tailFactor);
    return [SKILL_EDGE.tint[0] * b, SKILL_EDGE.tint[1] * b, SKILL_EDGE.tint[2] * b];
  }
  const bright =
    kind === EDGE_KIND.relation ? ENTITY_EDGE.relationFloor + (1 - ENTITY_EDGE.relationFloor) * weight : 1;
  return [node[0] * bright, node[1] * bright, node[2] * bright];
}
