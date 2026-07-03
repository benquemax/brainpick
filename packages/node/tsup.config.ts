import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: false,
  clean: true,
  dts: true,
  // src/cli.ts carries the `#!/usr/bin/env node` shebang; esbuild keeps it
  // on the emitted entry, so dist/cli.js is directly runnable.
});
