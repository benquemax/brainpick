import * as fs from 'fs';
import * as path from 'path';

export const content = `## Status

**Early.** The full stack is built and the desktop app is downloadable from
[Releases](https://github.com/benquemax/brainpick/releases) for early testers.
The vision is committed in
[\`_vision.md\`](https://github.com/benquemax/brainpick/blob/main/_vision.md);
the milestones (Ensilento → Kaksoisveto → Hologrammi) landed. The \`brainpick\`
pip and npm packages are not published yet — the names are reserved for the
v0.1 release.
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');

  if (!fs.existsSync(path.join(root, '_vision.md'))) {
    throw new Error('Status links to _vision.md but the file does not exist');
  }

  // _todo.md is gitignored (absent in CI checkouts) — verify only when present
  const todoPath = path.join(root, '_todo.md');
  if (fs.existsSync(todoPath)) {
    const todo = fs.readFileSync(todoPath, 'utf-8');
    for (const milestone of ['Ensilento', 'Kaksoisveto', 'Hologrammi']) {
      if (!todo.includes(milestone)) {
        throw new Error(`Status names milestone "${milestone}" but _todo.md does not mention it`);
      }
    }
  }
};

export const errorContent = `
[Validation Failed] The "Status" section drifted from reality.

_vision.md must exist (it is the committed north star), and the milestones
named here (Ensilento, Kaksoisveto, Hologrammi) must match the parking lot in
_todo.md. Update whichever side actually changed.
`;
