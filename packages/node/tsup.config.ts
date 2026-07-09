import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: false,
  clean: true,
  dts: true,
  // tsup auto-externalizes dependencies/peerDependencies but NOT
  // optionalDependencies — the lancedb and transformers.js native bindings
  // must never be bundled (both are dynamically imported and their absence
  // merely degrades T2; bundling would also drag their multi-MB platform
  // .node binaries straight into dist/cli.js).
  external: ["@lancedb/lancedb", "apache-arrow", "@huggingface/transformers"],
  // src/cli.ts carries the `#!/usr/bin/env node` shebang; esbuild keeps it
  // on the emitted entry, so dist/cli.js is directly runnable.
});
