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
  // optionalDependencies — the lancedb native binding must never be bundled
  // (it is dynamically imported and its absence merely degrades T2).
  external: ["@lancedb/lancedb", "apache-arrow"],
  // src/cli.ts carries the `#!/usr/bin/env node` shebang; esbuild keeps it
  // on the emitted entry, so dist/cli.js is directly runnable.
});
