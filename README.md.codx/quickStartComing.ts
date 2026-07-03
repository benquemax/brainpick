import * as fs from 'fs';
import * as path from 'path';

export const content = `## Quick start (pre-release)

Nothing is on PyPI or npm yet, but the engines already work from a checkout:

\`\`\`bash
cd packages/python
uv run brainpick init --root /path/to/your/okf-bundle    # detect, config, compile
uv run brainpick serve --root /path/to/bundle --open     # the living graph
uv run brainpick compile --check-fresh --root /path/to/bundle   # commit gate
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
  for (const flag of ['"compile"', '"serve"', '"init"', '--check-fresh', '--root', '--open']) {
    if (!cli.includes(flag)) {
      throw new Error(`Quick start documents ${flag} but the CLI source does not define it`);
    }
  }

  // Self-expiring: once the Node engine can serve, the quick start must show
  // the npm-side dev path too (today it only compiles).
  const nodeServe = path.join(root, 'packages', 'node', 'src', 'serve');
  if (fs.existsSync(nodeServe) && !content.includes('packages/node')) {
    throw new Error(
      'The Node engine serves now — add its dev quick start (node packages/node/dist/cli.js …)',
    );
  }
};

export const errorContent = `
[Validation Failed] The "Quick start" section is out of date.

This section must only document commands the CLIs actually have (checked
against packages/python/src/brainpick/cli.py) and must keep the uvx/npx
one-liners in sync with _vision.md. When the Node engine gains serve, the
npm dev path joins the block. Edit README.md.codx/quickStartComing.ts, then
run \`npx codumentation build\`.
`;
