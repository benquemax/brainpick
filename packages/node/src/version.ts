/** brainpick — a turn-key brain stack for agents (native Node engine). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SPEC_VERSION = "0.1";

// Both src/ and the bundled dist/ sit one level below the package root, so
// the relative URL resolves from either — the same trick VERSION uses.
export const PACKAGE_ROOT: string = fileURLToPath(new URL("..", import.meta.url));

// Read at runtime so the version has one home (package.json). Both src/ and
// the bundled dist/ sit one level below the package root, so the relative
// URL resolves from either.
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
