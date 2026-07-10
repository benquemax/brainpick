import { describe, expect, it } from 'vitest';
import { colorForAbout, colorForGroup, colorForId, colorForNode, groupOf, hueForGroup, shapeIndexForType } from './colors';

describe('groupOf', () => {
  it('uses the top-level directory as the group', () => {
    expect(groupOf('saaret/atolli.md')).toBe('saaret');
    expect(groupOf('a/b/c.md')).toBe('a');
  });

  it('groups bundle-root documents under "."', () => {
    expect(groupOf('aurinko.md')).toBe('.');
    expect(groupOf('index.md')).toBe('.');
  });
});

describe('hueForGroup / colorForGroup', () => {
  it('is deterministic for the same group', () => {
    expect(hueForGroup('saaret')).toBe(hueForGroup('saaret'));
    expect(colorForGroup('saaret')).toEqual(colorForGroup('saaret'));
  });

  it('gives distinct hues to distinct groups', () => {
    expect(hueForGroup('.')).not.toBe(hueForGroup('saaret'));
  });

  it('keeps hue in [0, 360) and rgb components in [0, 1]', () => {
    for (const g of ['.', 'saaret', 'projects', 'notes', 'zz']) {
      const h = hueForGroup(g);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      const [r, gg, b] = colorForGroup(g);
      for (const c of [r, gg, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('colorForAbout', () => {
  it('maps each of the seven closed-set values to a distinct color', () => {
    const values = ['person', 'organization', 'place', 'thing', 'event', 'process', 'concept'];
    const colors = values.map((v) => colorForAbout(v));
    for (const c of colors) expect(c).not.toBeNull();
    const unique = new Set(colors.map((c) => c!.join(',')));
    expect(unique.size).toBe(values.length);
  });

  it('is deterministic', () => {
    expect(colorForAbout('thing')).toEqual(colorForAbout('thing'));
  });

  it('returns null for absent or unrecognized about — callers fall back to directory color', () => {
    expect(colorForAbout(null)).toBeNull();
    expect(colorForAbout('')).toBeNull();
    expect(colorForAbout('not-a-real-category')).toBeNull();
  });
});

describe('colorForNode', () => {
  it('gives a doc with a real about value its about-color, not the directory color', () => {
    const withAbout = colorForNode('aurinko.md', 'thing', 'article', false);
    expect(withAbout).toEqual(colorForAbout('thing'));
    expect(withAbout).not.toEqual(colorForId('aurinko.md'));
  });

  it('falls back to the directory color when about is absent', () => {
    expect(colorForNode('aurinko.md', null, 'article', false)).toEqual(colorForId('aurinko.md'));
  });

  it('keeps entities in their own gold family regardless of about', () => {
    expect(colorForNode('e:aurinko', 'thing', 'star', true)).toEqual(colorForNode('e:aurinko', null, 'star', true));
  });
});

describe('shapeIndexForType', () => {
  it('maps the four non-default closed-set values to distinct shape indices 1-4', () => {
    const values = ['decision', 'playbook', 'reference', 'log'];
    const indices = values.map((v) => shapeIndexForType(v));
    expect(new Set(indices).size).toBe(4);
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(4);
    }
  });

  it('is 0 (the existing circle) for "article", absent, and unrecognized values', () => {
    expect(shapeIndexForType('article')).toBe(0);
    expect(shapeIndexForType(null)).toBe(0);
    expect(shapeIndexForType('')).toBe(0);
    expect(shapeIndexForType('Concept')).toBe(0); // the pre-ontology legacy value
    expect(shapeIndexForType('not-a-real-type')).toBe(0);
  });
});
