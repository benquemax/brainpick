import * as fs from 'fs';
import * as path from 'path';

export const content = `## The stack

Five layers, each optional, each a strict superset of the one below — the
whole point is that you can stop at any layer and nothing above is owed.

\`\`\`mermaid
block-beta
  columns 1
  H["brainpick for humans — the holographic brain (web UI, PWA, desktop app)"]
  A["brainpick for agents — MCP tools + CLI over the compiled tiers (T1–T3)"]
  B["the brain format — an opinionated OKF bundle: memory-type folders, grounding, data flow, identity"]
  O["OKF — the Open Knowledge Format: markdown + frontmatter, index.md and log.md"]
  X["henxels — the referee: a contract on the repo that keeps every writer true to the format"]
  style X fill:#1f2937,stroke:#111827,color:#fff
  style O fill:#374151,stroke:#111827,color:#fff
  style B fill:#4b5563,stroke:#111827,color:#fff
  style A fill:#6b7280,stroke:#111827,color:#fff
  style H fill:#9ca3af,stroke:#111827,color:#111
\`\`\`

- **henxels** is the foundation: a
  [contract](https://github.com/benquemax/henxels) that makes the layers above
  it *hold* under agent writes — from a git hook or from \`brain_write\` alike.
  Brainpick itself never requires it (a hand-tended OKF folder compiles fine);
  without it the format is a hope, with it the format is a fact. It also ships
  the templates: \`okf-llm-wiki\` for a wiki, \`brainpick-brain\` for a brain.
- **OKF** is the file format: plain markdown, a frontmatter \`type\`, an
  \`index.md\`, a \`log.md\`. Any OKF bundle — a wiki, a docs folder, a pile of
  notes with \`type:\` — is a valid input to everything above.
- **The brain format** ([spec/85](https://github.com/benquemax/brainpick/blob/main/spec/85-brain-format.md))
  is OKF plus opinions: folders as memory types (\`knowledge/ skills/
  journals/ vision/ plans/\`, \`raw/\` for source material), inline grounding,
  a data-flow architecture (journals → knowledge → skills, read in reverse),
  subsidiarity between brains, and an identity other brains can address.
  Brainpick reads it through frontmatter only — the folders are the
  template's, so the format can evolve without breaking older brains.
- **Brainpick for agents** compiles any bundle into the tiers below and
  serves them over MCP and the CLI. Deterministic tiers need nothing;
  vectors need an embedding model; every tier degrades to the one beneath.
- **Brainpick for humans** renders the same compiled graph as a live
  holographic brain — a window, never a dependency.

Read it bottom-up as adoption: govern a folder → make it OKF → shape it as a
brain → give it to your agent → look at it. Read it top-down as
dependency: nothing above depends on anything more than the layer below.
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');

  // Bottom-up order is the claim: henxels, OKF, brain format, agents, humans.
  const layers = ['henxels —', 'OKF —', 'the brain format —', 'brainpick for agents —', 'brainpick for humans —'];
  const diagram = content.slice(content.indexOf('```mermaid'), content.indexOf('```', content.indexOf('```mermaid') + 3));
  const positions = layers.map((l) => diagram.indexOf(l));
  if (positions.some((p) => p < 0)) {
    throw new Error('The stack diagram must name all five layers');
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] > positions[i - 1]) {
      throw new Error('The stack diagram lists layers top-down (humans first, henxels last)');
    }
  }

  // The brain-format layer is a real spec section and both engines hand off to
  // the two named henxels templates when there is no bundle yet.
  if (!fs.existsSync(path.join(root, 'spec', '85-brain-format.md'))) {
    throw new Error('The stack points at spec/85 but it does not exist');
  }
  for (const engine of [
    path.join(root, 'packages', 'python', 'src', 'brainpick', 'scaffold.py'),
    path.join(root, 'packages', 'node', 'src', 'scaffold.ts'),
  ]) {
    const src = fs.readFileSync(engine, 'utf-8');
    for (const template of ['okf-llm-wiki', 'brainpick-brain']) {
      if (!src.includes(`--template ${template}`)) {
        throw new Error(`The stack names the henxels template "${template}" but ${path.basename(engine)} never hands off to it`);
      }
    }
  }
};

export const errorContent = `
[Validation Failed] The "The stack" section drifted from reality.

The diagram must list the five layers bottom-up (henxels at the bottom), spec/85
must exist, and both engines' scaffold code must hand off to the henxels
templates the section names (okf-llm-wiki, brainpick-brain). Fix the code or
the section in README.md.codx/theStack.ts.
`;
