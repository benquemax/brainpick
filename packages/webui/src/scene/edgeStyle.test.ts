import { describe, expect, it } from 'vitest';
import { edgeKindFlag, edgeVertexColor, EDGE_KIND } from './edgeStyle';
import { ENTITY_EDGE, SKILL_EDGE } from './tuning';

const node: [number, number, number] = [0.2, 0.4, 0.8];

describe('edgeKindFlag', () => {
  it('maps every EdgeKind to its per-edge flag, doc links to 0', () => {
    expect(edgeKindFlag('link')).toBe(EDGE_KIND.link);
    expect(edgeKindFlag('wikilink')).toBe(EDGE_KIND.link);
    expect(edgeKindFlag('relation')).toBe(EDGE_KIND.relation);
    expect(edgeKindFlag('virtual')).toBe(EDGE_KIND.virtual);
    expect(edgeKindFlag('depends_on')).toBe(EDGE_KIND.dependsOn);
    expect(EDGE_KIND.link).toBe(0);
  });
});

describe('edgeVertexColor', () => {
  it('a doc link carries its endpoint node color at full brightness', () => {
    expect(edgeVertexColor(EDGE_KIND.link, 0, node, 1)).toEqual(node);
    expect(edgeVertexColor(EDGE_KIND.link, 1, node, 1)).toEqual(node);
  });

  it('a relation scales its endpoint color by weight above the floor', () => {
    const [r] = edgeVertexColor(EDGE_KIND.relation, 0, node, 0);
    expect(r).toBeCloseTo(node[0] * ENTITY_EDGE.relationFloor);
    const [r1] = edgeVertexColor(EDGE_KIND.relation, 0, node, 1);
    expect(r1).toBeCloseTo(node[0]);
  });

  it('a virtual tie is the faint grey-blue hint regardless of its endpoints', () => {
    const expected = ENTITY_EDGE.virtualTint.map((c) => c * ENTITY_EDGE.virtualBright);
    expect(edgeVertexColor(EDGE_KIND.virtual, 0, node, 1)).toEqual(expected);
  });

  it('a depends_on edge wears the skill tint and brightens toward its prerequisite', () => {
    // source (end 0) is the skill, target (end 1) the prerequisite it reads first:
    // the line points at what to read, so the target end is the bright one.
    const atSkill = edgeVertexColor(EDGE_KIND.dependsOn, 0, node, 1);
    const atPrerequisite = edgeVertexColor(EDGE_KIND.dependsOn, 1, node, 1);
    SKILL_EDGE.tint.forEach((c, i) => {
      expect(atPrerequisite[i]).toBeCloseTo(c * SKILL_EDGE.bright);
      expect(atSkill[i]).toBeCloseTo(c * SKILL_EDGE.bright * SKILL_EDGE.tailFactor);
    });
    expect(SKILL_EDGE.tailFactor).toBeLessThan(1);
    expect(SKILL_EDGE.bright).toBeGreaterThan(1); // a prerequisite line is bolder than the idle web
    // and it never borrows the endpoint's about-color: the style is the kind's own
    expect(atPrerequisite).not.toEqual(node);
  });
});
