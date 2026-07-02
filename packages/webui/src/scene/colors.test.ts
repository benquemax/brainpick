import { describe, expect, it } from 'vitest';
import { colorForGroup, groupOf, hueForGroup } from './colors';

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
