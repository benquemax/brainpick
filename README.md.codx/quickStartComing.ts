import * as fs from 'fs';
import * as path from 'path';

export const content = `## Quick start (pre-release)

Nothing is on PyPI or npm yet, but the Python engine already compiles brains
from a checkout:

\`\`\`bash
cd packages/python
uv run brainpick compile --root /path/to/your/okf-bundle       # T1: graph + index
uv run brainpick compile --check-fresh --root /path/to/bundle  # commit-gate freshness
\`\`\`

Once v0.1 ships, first contact becomes:

\`\`\`bash
uvx brainpick init     # or: npx brainpick init — native in both runtimes
brainpick serve --open # the living graph, zero API keys
\`\`\`
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');
  const vision = fs.readFileSync(path.join(root, '_vision.md'), 'utf-8');

  // Both runtimes are native peers (principle 8) — the quick start shows both
  for (const cmd of ['uvx brainpick init', 'npx brainpick init']) {
    if (!content.includes(cmd)) {
      throw new Error(`Quick start must show "${cmd}" — pip and npm are native peers`);
    }
    if (!vision.includes(cmd)) {
      throw new Error(`Quick start promises "${cmd}" but _vision.md does not mention it`);
    }
  }

  // The documented commands must exist in the actual CLI
  const cli = fs.readFileSync(
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'cli.py'),
    'utf-8',
  );
  for (const flag of ['"compile"', '--check-fresh', '--root']) {
    if (!cli.includes(flag)) {
      throw new Error(`Quick start documents ${flag} but the CLI source does not define it`);
    }
  }

  // Self-expiring: once `serve` lands in the CLI, this section must show it live
  if (cli.includes('"serve"') && content.includes('Once v0.1 ships')) {
    throw new Error(
      '`brainpick serve` exists now — move it out of the "once v0.1 ships" block into the real quick start',
    );
  }
};

export const errorContent = `
[Validation Failed] The "Quick start" section is out of date.

This section must only document commands the CLI actually has (checked
against packages/python/src/brainpick/cli.py) and must keep the uvx/npx
one-liners in sync with _vision.md. Edit README.md.codx/quickStartComing.ts,
then run \`npx codumentation build\`.
`;
