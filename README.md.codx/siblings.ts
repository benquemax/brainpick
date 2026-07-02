import * as fs from 'fs';
import * as path from 'path';

export const content = `## Siblings

- [henxels](https://github.com/benquemax/henxels) — suspenders for your
  repo; the referee for every write brainpick compiles.
- [codumentation](https://github.com/benquemax/codumentation) — keeps this
  repository's documentation provably true.
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');

  if (!fs.existsSync(path.join(root, 'henxels.yaml'))) {
    throw new Error('Siblings claims henxels referees this repo but henxels.yaml is missing');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  if (!pkg.devDependencies?.codumentation) {
    throw new Error(
      'Siblings claims codumentation keeps these docs true but it is not a devDependency',
    );
  }
};

export const errorContent = `
[Validation Failed] The "Siblings" section drifted from reality.

This repo claims to be governed by its sibling tools: henxels.yaml must exist
at the root, and codumentation must be a devDependency in package.json. If a
sibling was intentionally removed, that is Tom's call — discuss before
editing this section.
`;
