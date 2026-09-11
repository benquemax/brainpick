import * as fs from 'fs';
import * as path from 'path';

export const content = `## One brain: a cortex and its implants

An agent has **one brain** — but a brain is not one bundle. It is a **cortex**
plus any number of **implants**, fronted by a single MCP server, so the agent
asks once and every part of its brain answers.

- **The cortex** is the agent's own memory — at most one, marked \`--cortex\`,
  and what the \`me\` scope names. It is the brain that travels with the agent
  rather than with a project, and where an unqualified write falls back when
  the agent is not standing in a bundle.
- **An implant** is a repository's bundle plugged into the same server —
  \`--implant\`, any number of them. An implant is queried alongside the cortex
  and, like it, **writable**: a write is refused only by that repository's own
  \`[serve] writes\` setting and its own henxels contract, never the cortex's.
- **Here** — whatever bundle the working directory sits in — joins the set
  automatically, registered or not, and is where an unqualified write lands.

Every path an agent sees is qualified as \`alias:path\`
(\`acme:docs/video-gen.md\`) and is accepted back in the same form;
\`brain_search\` fans out across the set and merges hits **by rank**, because
scores are not comparable between a brain with fresh vectors and a T1-only
one. Brains load lazily, so a registry of twenty projects costs nothing until
a query actually reaches them.

\`\`\`bash
brainpick register ~/Git/acme --implant   # a project's bundle — an implant
brainpick register ~/brain --cortex       # the agent's own memory — the cortex
claude mcp add brainpick --scope user -- brainpick mcp   # one entry, every brain
\`\`\`

That single user-scope entry replaces the old wiring of one MCP server per
project; \`brainpick register --from-hosts\` migrates the existing ones in one
command, and \`brainpick mcp --root DIR\` still fronts exactly one brain for
setups that want it. The roles are ordering and write-routing only — a brain
registered with no role behaves exactly as it always did. See
[federation](https://github.com/benquemax/brainpick/blob/main/docs/federation.md)
for the full shape.
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');

  // The two roles must be real in BOTH engines — this is a spec/75 behaviour,
  // and the npm package is a native peer, never a Python shim.
  const pyCli = fs.readFileSync(
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'cli.py'),
    'utf-8',
  );
  const nodeCli = fs.readFileSync(
    path.join(root, 'packages', 'node', 'src', 'cli.ts'),
    'utf-8',
  );
  for (const flag of ['--cortex', '--implant', '--from-hosts']) {
    if (!content.includes(flag)) {
      throw new Error(`The federation section must document ${flag}`);
    }
    if (!pyCli.includes(flag)) {
      throw new Error(`README documents "register ${flag}" but the Python CLI does not define it`);
    }
    if (!nodeCli.includes(flag)) {
      throw new Error(`README documents "register ${flag}" but the Node CLI does not define it`);
    }
  }

  // The role names themselves are registry bytes — both engines must agree.
  const pyFed = fs.readFileSync(
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'federation.py'),
    'utf-8',
  );
  const nodeFed = fs.readFileSync(
    path.join(root, 'packages', 'node', 'src', 'federation.ts'),
    'utf-8',
  );
  if (!pyFed.includes('CORTEX = "cortex"') || !pyFed.includes('IMPLANT = "implant"')) {
    throw new Error('The Python engine no longer defines the cortex/implant roles the README names');
  }
  if (!nodeFed.includes('export const CORTEX') || !nodeFed.includes('export const IMPLANT')) {
    throw new Error('The Node engine no longer defines the cortex/implant roles the README names');
  }

  // "a brain registered with no role behaves exactly as it always did" rests on
  // the legacy role still being read — never written.
  if (!pyFed.includes('_LEGACY_CORTEX = "user"')) {
    throw new Error('README promises older registries keep working, but the legacy "user" role is gone');
  }

  // The section is a summary of the spec and the wiki page; both must exist and
  // must still describe the same shape.
  for (const doc of ['spec/75-federation.md', 'docs/federation.md']) {
    if (!fs.existsSync(path.join(root, ...doc.split('/')))) {
      throw new Error(`The federation section leans on ${doc} but it does not exist`);
    }
  }
  // Prose wraps and carries emphasis markers, so compare on flattened text.
  const flatten = (s: string) => s.replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const wiki = flatten(fs.readFileSync(path.join(root, 'docs', 'federation.md'), 'utf-8'));
  for (const claim of ['Cortex and implants', 'by rank', 'alias:path']) {
    if (!wiki.includes(claim)) {
      throw new Error(`README claims "${claim}" but docs/federation.md no longer says so`);
    }
  }
  if (!content.includes('docs/federation.md')) {
    throw new Error('The federation section must link the federation wiki page');
  }
};

export const errorContent = `
[Validation Failed] The "One brain: a cortex and its implants" section drifted.

A brain is one cortex plus any number of implants (spec/75). The roles, the
\`register --cortex\` / \`--implant\` flags and the legacy-role fallback must
exist in BOTH engines, and docs/federation.md must still describe the same
shape. Edit README.md.codx/cortexAndImplants.ts, then run
\`npx codumentation build\`.
`;
