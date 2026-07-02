import * as fs from 'fs';
import * as path from 'path';

export const content = `<!-- markdownlint-disable -->
\`\`\`
   ╭────────────────────╮
   │      ●───●         │
   │     ╱ ╲ ╱ ╲        │   b r a i n p i c k
   │    ●───●───●       │   pick your agent's brain
   │     ╲ ╱ ╲ ╱ ⛏      │   plain markdown in · a living brain out
   │      ●───●         │
   ╰────────────────────╯
\`\`\`
<!-- markdownlint-enable -->

# brainpick

**A turn-key brain stack for agents.** Knowledge lives as an
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle of plain markdown, [henxels](https://github.com/benquemax/henxels)
keeps every writer true to the format, and brainpick compiles the bundle into
tiered, disposable artifacts — a generated index, a link graph, vectors, an
entity graph — then serves them to agents (MCP + CLI) and to humans (a
holographic-brain web UI that updates live while agents write).
`;

export const validate = async () => {
  // TODO: Add validation for this section
  //
  // Based on this section's content, consider validating:
  // - Verify 'typescript' is in package.json devDependencies
  // - Check that mentioned file paths and directories actually exist
  // - Think creatively: what hidden rules, patterns, or standards should be validated?
  //
  // See .codumentation-guide.md for more validation patterns and examples
};

export const errorContent = `
[Validation Failed] The "intro" section validation failed.

Review this section and ensure the documentation matches the actual codebase state.
`;
