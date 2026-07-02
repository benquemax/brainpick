import * as fs from 'fs';
import * as path from 'path';

export const content = `## License

MIT.
`;

export const validate = async () => {
  const licensePath = path.join(__dirname, '..', 'LICENSE');
  if (!fs.existsSync(licensePath)) {
    throw new Error('README says MIT but there is no LICENSE file at the repo root');
  }
  const license = fs.readFileSync(licensePath, 'utf-8');
  if (!license.startsWith('MIT License')) {
    throw new Error('README says MIT but LICENSE does not contain the MIT license text');
  }
};

export const errorContent = `
[Validation Failed] The "License" section drifted from reality.

The README claims MIT; the LICENSE file at the repo root must exist and start
with "MIT License". Note: a license change is never an agent's call.
`;
