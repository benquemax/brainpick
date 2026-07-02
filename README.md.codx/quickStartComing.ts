import * as fs from 'fs';
import * as path from 'path';

export const content = `## Quick start (coming)

Nothing is published yet — this is the founding commit. The intended first
contact, once v0.1 ships:

\`\`\`bash
uvx brainpick init     # or: npx brainpick init — native in both runtimes
brainpick serve --open # the living graph, zero API keys
\`\`\`
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');
  const vision = fs.readFileSync(path.join(root, '_vision.md'), 'utf-8');

  // Both runtimes are native peers (principle 8) — the quick start must show both
  for (const cmd of ['uvx brainpick init', 'npx brainpick init']) {
    if (!content.includes(cmd)) {
      throw new Error(`Quick start must show "${cmd}" — pip and npm are native peers`);
    }
    if (!vision.includes(cmd)) {
      throw new Error(`Quick start promises "${cmd}" but _vision.md does not mention it`);
    }
  }

  // Self-expiring: the section claims nothing is implemented yet. The moment
  // the Python package exists, this section must become a real quick start.
  if (fs.existsSync(path.join(root, 'packages', 'python', 'pyproject.toml'))) {
    throw new Error(
      'packages/python exists — "Quick start (coming)" is stale; rewrite it as the real quick start',
    );
  }
};

export const errorContent = `
[Validation Failed] The "Quick start (coming)" section is out of date.

This section promises what v0.1 will feel like. Keep the uvx and npx
one-liners in sync with _vision.md — and once packages/python exists, replace
the whole section with the real, tested quick start (edit
README.md.codx/quickStartComing.ts, then run \`codumentation build\`).
`;
