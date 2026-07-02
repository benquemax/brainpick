import { describe, expect, it } from 'vitest';
import { normalizeNeighbor, resolveDocLink } from './docLinks';

describe('resolveDocLink', () => {
  it('resolves relative links from the current doc directory', () => {
    expect(resolveDocLink('saaret/atolli.md', 'laguuni.md')).toBe('saaret/laguuni.md');
    expect(resolveDocLink('saaret/atolli.md', '../maa.md')).toBe('maa.md');
    expect(resolveDocLink('aurinko.md', 'planeetat.md')).toBe('planeetat.md');
  });

  it('resolves bundle-absolute links from the root', () => {
    expect(resolveDocLink('maa.md', '/kuu.md')).toBe('kuu.md');
    expect(resolveDocLink('saaret/atolli.md', '/saaret/laguuni.md')).toBe('saaret/laguuni.md');
  });

  it('strips fragments and clamps .. above the bundle root', () => {
    expect(resolveDocLink('aurinko.md', 'planeetat.md#worlds')).toBe('planeetat.md');
    expect(resolveDocLink('aurinko.md', '../../evil.md')).toBe('evil.md');
  });

  it('rejects external and non-navigable targets', () => {
    expect(resolveDocLink('aurinko.md', 'https://example.com/x.md')).toBeNull();
    expect(resolveDocLink('aurinko.md', 'mailto:someone@example.com')).toBeNull();
    expect(resolveDocLink('aurinko.md', '#top')).toBeNull();
    expect(resolveDocLink('aurinko.md', '')).toBeNull();
  });
});

describe('normalizeNeighbor', () => {
  it('accepts bare id strings', () => {
    expect(normalizeNeighbor('kuu.md')).toEqual({ path: 'kuu.md', title: 'kuu.md' });
  });

  it('accepts {path,title} objects', () => {
    expect(normalizeNeighbor({ path: 'maa.md', title: 'Maa' })).toEqual({ path: 'maa.md', title: 'Maa' });
  });

  it('accepts {id,...} objects (graph-node shaped)', () => {
    expect(normalizeNeighbor({ id: 'maa.md', title: 'Maa' })).toEqual({ path: 'maa.md', title: 'Maa' });
    expect(normalizeNeighbor({ id: 'maa.md' })).toEqual({ path: 'maa.md', title: 'maa.md' });
  });

  it('returns null for junk', () => {
    expect(normalizeNeighbor(42)).toBeNull();
    expect(normalizeNeighbor(null)).toBeNull();
    expect(normalizeNeighbor({})).toBeNull();
  });
});
