import * as fs from 'fs';
import * as path from 'path';

export const content = `## The tiers

| Tier | What | Needs |
|------|------|-------|
| T0 | grep/glob over the files | nothing |
| T1 | generated \`index.md\`, link graph, backlinks, tags | nothing (deterministic) |
| T2 | vector search over chunks | an embedding model |
| T3 | entity/relation graph (ghosts, tags, co-occurrence) | nothing by default; a small LLM for richer extraction |
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');
  const vision = fs.readFileSync(path.join(root, '_vision.md'), 'utf-8');

  for (const tier of ['T0', 'T1', 'T2', 'T3']) {
    if (!new RegExp(`^\\| ${tier} \\|`, 'm').test(content)) {
      throw new Error(`The README tier table is missing a row for ${tier}`);
    }
    if (!new RegExp(`^\\| ${tier} \\|`, 'm').test(vision)) {
      throw new Error(`Tier ${tier} is in the README but missing from _vision.md's tier table`);
    }
  }
};

export const errorContent = `
[Validation Failed] The tier tables drifted apart.

The README and _vision.md must describe the same four tiers (T0-T3). Update
both documents together: the table lives in README.md.codx/theTiers.ts and in
_vision.md under "## The tiers".
`;
