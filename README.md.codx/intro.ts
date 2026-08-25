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

**A turn-key brain stack for AI agents — plain markdown in, a living
knowledge graph out.** Your agents' knowledge lives as an
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle of plain markdown files — [henxels](https://github.com/benquemax/henxels)
keeps every writer true to the format — and brainpick compiles it into
tiered, disposable artifacts: a generated index, a link graph, semantic
vectors, an entity graph. Agents consume the compiled brain over
[MCP](https://modelcontextprotocol.io) and the CLI; everything is
local-first, deterministic wherever a model isn't needed, and no server is
ever required.

Humans get a separate, optional face: the **holographic brain**, a web UI
that renders the same compiled graph and updates live while agents write.
It is a window into the brain, never a dependency of it — see the
[live demo](https://benquemax.github.io/brainpick/), this repository's own
docs compiled and served by brainpick itself.
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
