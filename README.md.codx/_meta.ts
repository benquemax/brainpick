import * as fs from 'fs';
import * as path from 'path';

const SECTIONS = ['principles', 'theTiers', 'quickStartComing', 'status', 'siblings', 'license'];
const MIN_VALIDATED_RATIO = 0.5; // At least 50% of sections should have real validations

export const content = ''; // Meta validator produces no content

export const validate = async () => {
  const codxDir = __dirname;

  // Count modules with real validations (not just TODO stubs)
  let modulesWithValidation = 0;
  let totalModules = 0;

  for (const section of SECTIONS) {
    const modulePath = path.join(codxDir, `${section}.ts`);
    if (!fs.existsSync(modulePath)) continue;

    totalModules++;
    const content = fs.readFileSync(modulePath, 'utf-8');

    // Check if validate function has actual logic (not just TODO comments)
    const validateMatch = content.match(/export const validate = async \(\) => \{([\s\S]*?)\};/);
    if (validateMatch) {
      const validateBody = validateMatch[1];
      // Has actual code beyond comments and whitespace
      const hasRealValidation = validateBody
        .split('\n')
        .some(line => {
          const trimmed = line.trim();
          return trimmed &&
                 !trimmed.startsWith('//') &&
                 !trimmed.startsWith('*') &&
                 trimmed !== '';
        });

      if (hasRealValidation) {
        modulesWithValidation++;
      }
    }
  }

  if (totalModules === 0) {
    throw new Error('No section modules found in .codx directory');
  }

  const ratio = modulesWithValidation / totalModules;

  if (ratio < MIN_VALIDATED_RATIO) {
    const needed = Math.ceil(MIN_VALIDATED_RATIO * totalModules);
    throw new Error(
      `Only ${modulesWithValidation}/${totalModules} sections have real validations. \n` +
      `Need at least ${needed} sections with validations (50%).\n\n` +
      `Add meaningful validate() functions to your section modules.\n` +
      `See .codumentation-guide.md for example validation patterns.`
    );
  }
};

export const errorContent = `
[Codumentation Setup Incomplete]
Your documentation is not fully validated yet. To complete setup:

1. Open each section module in the .codx folder
2. Add meaningful validate() functions that verify the documentation claims
3. Run 'codumentation validate' again

See .codumentation-guide.md for example validation patterns.
`;
