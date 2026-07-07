import { describe, expect, it } from 'vitest';
import {
  frontmatterFromDoc,
  relativeLink,
  serializeDoc,
  splitFrontmatter,
  type Frontmatter,
} from './frontmatter';

const TS = '2026-07-07T10:00:00Z';

describe('frontmatter form ⇄ document', () => {
  it('reads the form model from a GET /api/docs response', () => {
    const fm = frontmatterFromDoc(
      { type: 'Concept', title: 'Guarded writes', description: 'One sentence.', tags: ['write', 'okf'] },
      'fallback',
    );
    expect(fm).toEqual({ type: 'Concept', title: 'Guarded writes', description: 'One sentence.', tags: ['write', 'okf'] });
  });

  it('falls back to the graph title when frontmatter omits it', () => {
    expect(frontmatterFromDoc({ type: 'Concept', description: 'x' }, 'The Title').title).toBe('The Title');
  });

  it('assembles a full doc: frontmatter block, blank line, body, trailing newline', () => {
    const fm: Frontmatter = { type: 'Concept', title: 'Kuu', description: 'The moon.', tags: [] };
    const out = serializeDoc(fm, '# Kuu\n\nThe moon pulls the tides.', TS);
    expect(out).toBe(
      ['---', 'type: Concept', 'title: Kuu', 'description: The moon.', `timestamp: ${TS}`, '---', '', '# Kuu', '', 'The moon pulls the tides.', ''].join('\n'),
    );
  });

  it('emits tags only when present, as a flow list', () => {
    const withTags = serializeDoc({ type: 'Concept', title: 'A', description: 'b', tags: ['one', 'two'] }, 'body', TS);
    expect(withTags).toContain('tags: [one, two]');
    const without = serializeDoc({ type: 'Concept', title: 'A', description: 'b', tags: [] }, 'body', TS);
    expect(without).not.toContain('tags:');
  });

  it('quotes YAML-unsafe titles and descriptions (colons, leading dashes)', () => {
    const out = serializeDoc(
      { type: 'Concept', title: 'brain_write: the fifth tool', description: '- a dash-led sentence', tags: [] },
      'body',
      TS,
    );
    expect(out).toContain('title: "brain_write: the fifth tool"');
    expect(out).toContain('description: "- a dash-led sentence"');
  });

  it('round-trips: serializeDoc → splitFrontmatter recovers every field + body', () => {
    const fm: Frontmatter = {
      type: 'Playbook',
      title: 'Wiki conventions',
      description: 'How concepts are written: one sentence — with punctuation.',
      tags: ['okf', 'style'],
    };
    const body = '# Wiki conventions\n\nOne concept, one page. See [the tiers](the-tiers.md).';
    const full = serializeDoc(fm, body, TS);
    const { data, body: recovered } = splitFrontmatter(full);
    expect(data.type).toBe('Playbook');
    expect(data.title).toBe('Wiki conventions');
    expect(data.description).toBe('How concepts are written: one sentence — with punctuation.');
    expect(data.tags).toEqual(['okf', 'style']);
    expect(data.timestamp).toBe(TS);
    // The body carries the conventional blank line after the frontmatter (as the
    // engine's split_frontmatter leaves it) — insignificant markdown whitespace.
    expect(recovered.trim()).toBe(body);
    // frontmatterFromDoc reads the recovered data back to the identical form model.
    expect(frontmatterFromDoc(data)).toEqual(fm);
  });

  it('splits a block-style tag list too (tolerant like the engine)', () => {
    const doc = ['---', 'type: Concept', 'title: T', 'description: d', 'tags:', '  - a', '  - b', '---', '', 'body'].join('\n');
    expect(splitFrontmatter(doc).data.tags).toEqual(['a', 'b']);
  });

  it('preserves a frontmatter-free body verbatim', () => {
    expect(splitFrontmatter('# No frontmatter\n\nbody')).toEqual({ data: {}, body: '# No frontmatter\n\nbody' });
  });
});

describe('relativeLink keeps OKF links resolvable', () => {
  it('links to a sibling by bare filename', () => {
    expect(relativeLink('guarded-writes.md', 'compile-pipeline.md')).toBe('compile-pipeline.md');
  });
  it('descends into a subdirectory', () => {
    expect(relativeLink('index.md', 'saaret/atolli.md')).toBe('saaret/atolli.md');
  });
  it('links within the same subdirectory by bare filename', () => {
    expect(relativeLink('saaret/laguuni.md', 'saaret/atolli.md')).toBe('atolli.md');
  });
  it('climbs out of a subdirectory with ../', () => {
    expect(relativeLink('saaret/laguuni.md', 'aurinko.md')).toBe('../aurinko.md');
  });
  it('points a subdir doc at a root asset with ../', () => {
    expect(relativeLink('saaret/laguuni.md', 'assets/reef.png')).toBe('../assets/reef.png');
    expect(relativeLink('aurinko.md', 'assets/reef.png')).toBe('assets/reef.png');
  });
});
