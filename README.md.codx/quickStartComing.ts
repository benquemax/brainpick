import * as fs from 'fs';
import * as path from 'path';

export const content = `## Quick start

### 1 · Install the app and see a brain immediately

The fastest path is the desktop app — a single file that runs the brainpick
service and shows the holographic brain. Grab the installer for your OS from
the [latest release](https://github.com/benquemax/brainpick/releases):

- **Linux** — \`Brainpick_*.AppImage\` (\`chmod +x\`, then run; needs system
  \`webkit2gtk-4.1\`, the standard Tauri Linux prerequisite).
- **macOS** — \`Brainpick_*.dmg\` (Apple Silicon; first launch: right-click →
  Open, since the build is unsigned).
- **Windows** — \`Brainpick_*.msi\` (SmartScreen → More info → Run anyway).

On first launch it seeds a **demo brain** — this repository's own docs wiki,
cloned from GitHub — so you land on a real, link-rich, spinnable brain with
zero setup. Remove it any time; it never comes back.

> Prefer the terminal, a NAS, or a scriptable setup? The same service runs
> headless as \`brainpickd start\` (each brain serves its own port; other
> machines need only a browser). Set \`BRAINPICK_NO_DEMO=1\` to skip the demo
> seed.

### 2 · Start a brand-new brain (empty GitHub repo + henxels)

[henxels](https://github.com/benquemax/henxels) scaffolds a governed OKF wiki
and installs the contract that keeps every future write true to the format:

\`\`\`bash
# create an empty repo on GitHub, then:
git clone git@github.com:you/my-brain.git && cd my-brain
henxels init --template okf-llm-wiki --wiki-dir docs   # scaffold + govern docs/
git add -A && git commit -m "scaffold brain" && git push
\`\`\`

Now **Add a brain** in the app (paste the repo URL — a public repo clones as
is; a private one gets a one-click deploy key), or point a bare engine at it:
\`brainpick serve --root docs --open\`.

### 3 · Migrate an existing repo (henxels does the driving)

Any folder of markdown can become a governed brain. \`henxels\` installs the
contract and its \`check\` output *is* your migration checklist — instructive,
one fix at a time:

\`\`\`bash
cd your-existing-repo
henxels init                 # install the contract
henxels check --all          # the fix-list = exactly what to fix, and why
# work the list until it is green (an agent can do this — see below)
brainpick serve --root docs --open
\`\`\`

Don't want to work the list by hand? Add the folder in the app anyway: for a
not-yet-OKF bundle the wizard hands you a **paste-ready prompt** that steers
your coding agent to make it Brainpick-compatible.

### Running the engines from a checkout

The \`brainpick\` pip/npm packages are not published yet, but both engines
already work from a clone — Python (the reference) and native Node, no Python
required:

\`\`\`bash
cd packages/python && uv run brainpick serve --root ../../docs --open   # Python
npm run build -w packages/node && node packages/node/dist/cli.js serve --root docs --open   # Node
\`\`\`

Once they publish, first contact collapses to \`uvx brainpick serve --open\`
(or \`npx brainpick serve\` — pip and npm are native peers).
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');
  const vision = fs.readFileSync(path.join(root, '_vision.md'), 'utf-8');

  // Both runtimes are native peers (principle 8) — the published one-liners
  // stay in sync with _vision.md.
  for (const cmd of ['uvx brainpick', 'npx brainpick']) {
    if (!content.includes(cmd)) {
      throw new Error(`Quick start must show "${cmd}" — pip and npm are native peers`);
    }
    if (!vision.includes(cmd)) {
      throw new Error(`Quick start promises "${cmd}" but _vision.md does not mention it`);
    }
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

  // The documented engine commands must exist in the actual CLI.
  const cli = fs.readFileSync(
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'cli.py'),
    'utf-8',
  );
  for (const flag of ['"serve"', '--root', '--open']) {
    if (!cli.includes(flag)) {
      throw new Error(`Quick start documents ${flag} but the CLI source does not define it`);
    }
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

The three onboarding paths must name their real tools — the releases page,
\`henxels init --template okf-llm-wiki\` (new brain) and \`henxels check --all\`
(migration) — document only engine commands the CLIs actually have (checked
against packages/python/src/brainpick/cli.py), and keep the uvx/npx one-liners
in sync with _vision.md. Edit README.md.codx/quickStartComing.ts, then run
\`npx codumentation build\`.
`;
