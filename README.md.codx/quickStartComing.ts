import * as fs from 'fs';
import * as path from 'path';

export const content = `## Quick start

### Give your agent a brain — paste one prompt

Agentic setup is the primary path: your coding agent installs brainpick,
compiles the brain, and wires itself to it. Paste this to the agent:

> Install brainpick (\`uv tool install brainpick\`, or \`pipx install
> brainpick\`). In the repo that holds (or should hold) the
> markdown knowledge base, run \`brainpick init\` — it detects the bundle
> (offering henxels' \`okf-llm-wiki\` scaffold if the folder is empty),
> detects an embedding backend if one is reachable, writes the config, and
> compiles tier 1. Then run \`brainpick integrate claude-code\` (or
> \`opencode\`, or \`agents-md\`) to install the Agent Skill and print the
> MCP snippet — wire it into the harness config. From then on, consult the
> brain before grepping: \`brain_overview\` first, then \`brain_search\`,
> \`brain_read\`, \`brain_neighbors\`. Finally commit the bundle and the
> brainpick config.

No server appears anywhere in that flow: agents talk to \`brainpick mcp\`
over stdio, spawned on demand by the harness itself. The read tools also
exist as plain CLI verbs (\`brainpick search\` · \`read\` · \`neighbors\` ·
\`overview\`) for shells, scripts, and CI.

### Manual install

The same journey by hand:

\`\`\`bash
uv tool install brainpick        # or: pipx install brainpick
brainpick init                   # detect bundle + backends, write config, compile T1
brainpick integrate claude-code  # Agent Skill + the MCP wiring snippet
brainpick search "anything"      # the brain answers from the terminal
\`\`\`

One-shot flavor works too: \`uvx brainpick init\`.

### No wiki yet, or a messy one? henxels drives

A brand-new brain — [henxels](https://github.com/benquemax/henxels)
scaffolds a governed OKF wiki and installs the contract that keeps every
future write true to the format:

\`\`\`bash
henxels init --template okf-llm-wiki --wiki-dir docs   # scaffold + govern docs/
\`\`\`

An existing folder of markdown: \`henxels init\` installs the contract and
\`henxels check --all\` prints your migration checklist — instructive, one
fix at a time, and an agent can work the list.

### The GUI — see what your agent sees (optional)

Everything above is the whole product as far as agents are concerned. The
GUI is for the humans: the **holographic brain** — search, spin, and
time-travel the same compiled graph the agents walk, updating live with
every write. Nice to have, never required.

- **Zero install** — the [live demo](https://benquemax.github.io/brainpick/)
  is this repo's own docs wiki, baked into a static snapshot and redeployed
  with every release: the real UI, searchable, with the full time machine,
  served by GitHub Pages with no engine behind it.
- **One command** — \`brainpick serve --root docs --open\` opens the UI over
  any compiled brain.
- **The desktop app** — grab an installer from the
  [latest release](https://github.com/benquemax/brainpick/releases): Linux
  \`Brainpick_*.AppImage\` (\`chmod +x\`, needs system \`webkit2gtk-4.1\`),
  macOS \`Brainpick_*.dmg\` (right-click → Open; the build is unsigned),
  Windows \`Brainpick_*.msi\` (SmartScreen → More info → Run anyway). First
  launch seeds a **demo brain** — remove it any time; it never comes back.
  **Add a brain** takes a repo URL or a local folder, and for a not-yet-OKF
  folder hands you a paste-ready prompt for your coding agent. Prefer a
  terminal or a NAS? The same service runs headless as \`brainpickd start\`;
  \`BRAINPICK_NO_DEMO=1\` skips the demo seed.

### Until v0.1 ships: run from a checkout

The \`brainpick\` pip package is not published yet — and the npm publish is
[deliberately parked](https://github.com/benquemax/brainpick/blob/main/docs/reference/adr/pypi-first-release.md)
until there is npm-side demand; the Node engine is a full native peer and
works from a clone today, no Python required:

\`\`\`bash
cd packages/python && uv run brainpick serve --root ../../docs --open   # Python
npm run build -w packages/node && node packages/node/dist/cli.js serve --root docs --open   # Node
\`\`\`

Once it publishes, first contact collapses to the prompt above — or
\`uvx brainpick init\` by hand.
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');
  const vision = fs.readFileSync(path.join(root, '_vision.md'), 'utf-8');

  // The pip one-liner stays in sync with _vision.md; the npm publish is
  // parked by ADR, so the quick start must say so instead of promising npx.
  for (const cmd of ['uvx brainpick']) {
    if (!content.includes(cmd)) {
      throw new Error(`Quick start must show "${cmd}"`);
    }
    if (!vision.includes(cmd)) {
      throw new Error(`Quick start promises "${cmd}" but _vision.md does not mention it`);
    }
  }
  const parkedAdr = 'docs/reference/adr/pypi-first-release.md';
  if (content.includes('npm i -g brainpick') || content.includes('npx brainpick')) {
    throw new Error(`npm install paths are parked (${parkedAdr}) — unpark the ADR before promising them`);
  }
  if (!fs.existsSync(path.join(root, ...parkedAdr.split('/')))) {
    throw new Error(`Quick start leans on ${parkedAdr} but the ADR does not exist`);
  }
  if (!content.includes('reference/adr/pypi-first-release.md')) {
    throw new Error('Quick start must link the ADR that parks the npm publish');
  }

  // The onboarding paths must name their real tools: the releases page (the
  // app), henxels' scaffold (a new brain) and check (migration).
  for (const anchor of [
    'github.com/benquemax/brainpick/releases',
    'henxels init --template okf-llm-wiki',
    'henxels check --all',
  ]) {
    if (!content.includes(anchor)) {
      throw new Error(`Quick start must document "${anchor}"`);
    }
  }

  // The documented engine commands must exist in the actual CLI — including
  // the agentic path's verbs (init, integrate, mcp, the query mirrors).
  const cli = fs.readFileSync(
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'cli.py'),
    'utf-8',
  );
  for (const flag of ['"serve"', '--root', '--open', '"init"', '"integrate"', '"mcp"', '"search"']) {
    if (!cli.includes(flag)) {
      throw new Error(`Quick start documents ${flag} but the CLI source does not define it`);
    }
  }
  for (const target of ['claude-code', 'opencode', 'agents-md']) {
    if (!cli.includes(target)) {
      throw new Error(`Quick start offers integrate target "${target}" but the CLI does not`);
    }
  }

  // The agentic prompt names MCP tools — they must exist in the MCP server.
  const mcp = fs.readFileSync(
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'mcp_server.py'),
    'utf-8',
  );
  for (const tool of ['brain_overview', 'brain_search', 'brain_read', 'brain_neighbors']) {
    if (!mcp.includes(tool)) {
      throw new Error(`Quick start names MCP tool "${tool}" but mcp_server.py does not define it`);
    }
  }

  // The live-demo promise must be backed by real machinery: the Pages URL,
  // the exporter it names, and the release job that redeploys it.
  if (!content.includes('benquemax.github.io/brainpick')) {
    throw new Error('Quick start must link the GitHub Pages live demo');
  }
  if (!fs.existsSync(path.join(root, 'scripts', 'build-static-site.mjs'))) {
    throw new Error('The live demo needs scripts/build-static-site.mjs — it is gone');
  }
  const pagesWorkflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'pages.yml'),
    'utf-8',
  );
  if (!pagesWorkflow.includes('tags: ["v*"]') || !pagesWorkflow.includes('build-static-site.mjs')) {
    throw new Error(
      '"redeployed with every release" requires pages.yml to run build-static-site.mjs on v* tags',
    );
  }

  // Self-expiring: once the Node engine can serve, the quick start must show
  // the npm-side dev path too.
  const nodeServe = path.join(root, 'packages', 'node', 'src', 'serve');
  if (fs.existsSync(nodeServe) && !content.includes('packages/node')) {
    throw new Error(
      'The Node engine serves now — add its dev quick start (node packages/node/dist/cli.js …)',
    );
  }
};

export const errorContent = `
[Validation Failed] The "Quick start" section is out of date.

The onboarding paths must name their real tools — the agentic prompt's verbs
(\`brainpick init\`, \`integrate\`, \`mcp\`, the query mirrors) and the MCP
tools it names must exist in the engine sources, henxels' scaffold and check
commands must be shown, and the uvx/npx one-liners stay in sync with
_vision.md. Edit README.md.codx/quickStartComing.ts, then run
\`npx codumentation build\`.
`;
