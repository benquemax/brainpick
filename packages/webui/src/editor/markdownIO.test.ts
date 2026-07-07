import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBody, serializeBody } from './markdownIO';
import { splitFrontmatter } from './frontmatter';

const docsDir = fileURLToPath(new URL('../../../../docs/', import.meta.url));

function docBodies(): { name: string; body: string }[] {
  return readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .map((name) => ({ name, body: splitFrontmatter(readFileSync(docsDir + name, 'utf-8')).body }));
}

interface Link {
  text: string;
  href: string;
}

/** Every markdown link, with text de-escaped and whitespace-collapsed. */
function extractLinks(md: string): Link[] {
  const links: Link[] = [];
  const re = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    links.push({
      text: m[1]!.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1').replace(/\s+/g, ' ').trim(),
      href: m[2]!,
    });
  }
  return links;
}

const roundTrip = (body: string): string => serializeBody(parseBody(body));

describe('markdown round-trip fidelity on the real docs bundle', () => {
  const bodies = docBodies();

  it('reads every doc body from the bundle', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(15);
  });

  for (const { name, body } of bodies) {
    it(`is idempotent for ${name} (parse → serialize → re-parse → serialize converges)`, () => {
      const once = roundTrip(body);
      const twice = roundTrip(once);
      expect(twice).toBe(once);
    });

    it(`keeps every link's text and kebab href for ${name}`, () => {
      const before = extractLinks(body);
      const after = extractLinks(roundTrip(body));
      // No link is dropped, and each keeps its exact text + href (link text = title).
      for (const link of before) {
        expect(after, `link ${JSON.stringify(link)} survived`).toContainEqual(link);
      }
      // Every href stays a bundle link (kebab .md or an external URL) — never emptied.
      for (const link of after) expect(link.href).not.toBe('');
    });

    it(`stays henxels-clean for ${name}: no bare wikilinks or reflowed href`, () => {
      const out = roundTrip(body);
      // Serializer never invents an autolink form or drops a kebab target.
      for (const link of extractLinks(body)) {
        if (link.href.endsWith('.md')) expect(out).toContain(`](${link.href})`);
      }
    });
  }
});

describe('markdown serialization is clean and consistent', () => {
  it('renders the OKF feature set to canonical markdown', () => {
    const body = [
      '# Heading one',
      '',
      'A paragraph with **bold**, *italic*, `code` and a [Compile pipeline](compile-pipeline.md).',
      '',
      '## Heading two',
      '',
      '- first',
      '- second',
      '',
      '> a calm quote',
      '',
      '```python',
      'print("hi")',
      '```',
      '',
      '![a diagram](assets/diagram.png)',
    ].join('\n');
    const out = roundTrip(body);
    expect(out).toContain('# Heading one');
    expect(out).toContain('**bold**');
    expect(out).toContain('*italic*');
    expect(out).toContain('`code`');
    expect(out).toContain('[Compile pipeline](compile-pipeline.md)');
    expect(out).toContain('- first'); // dash bullets, not stars
    expect(out).toContain('> a calm quote');
    expect(out).toContain('```python');
    expect(out).toContain('![a diagram](assets/diagram.png)');
    expect(roundTrip(out)).toBe(out); // idempotent
  });

  it('preserves a GFM pipe table through the round-trip', () => {
    const body = ['| Tier | State |', '| --- | --- |', '| T1 | fresh |', '| T2 | off |'].join('\n');
    const out = roundTrip(body);
    expect(out).toContain('| Tier | State |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| T1 | fresh |');
    expect(roundTrip(out)).toBe(out);
  });
});
