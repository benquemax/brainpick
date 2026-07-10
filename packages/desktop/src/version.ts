/** brainpickd — the daemon (_todo.md). */
import { readFileSync } from "node:fs";

// Read at runtime so the version has one home (package.json). Both src/ and
// the bundled dist/ sit one level below the package root, so the relative
// URL resolves from either (the same trick packages/node/src/version.ts uses).
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
