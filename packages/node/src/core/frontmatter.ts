/** Tolerant YAML frontmatter splitting (OKF: consumers tolerate almost anything). */
import { parseDocument } from "yaml";

import { pyyaml11Tags, YamlFloat, YamlTimestamp } from "./yaml11";

/** Return [frontmatter mapping, body]. Never throws: absent, unterminated,
 * unparseable, or non-mapping frontmatter yields {} — the body is preserved.
 *
 * Parsed with YAML 1.1 semantics matched to PyYAML's SafeLoader (see
 * yaml11.ts): duplicate keys last-wins, unknown tags are fatal-to-{} (PyYAML
 * raises ConstructorError where the npm package would only warn), alias
 * expansion unlimited. One deliberate deviation: inputs where PyYAML would
 * crash the whole compile with a non-YAMLError (e.g. `timestamp: 2026-02-31`
 * raises ValueError) degrade to {} here — the spec's tolerance rule, not the
 * reference's traceback.
 */
export function splitFrontmatter(text: string): [Record<string, unknown>, string] {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.startsWith("---\n")) return [{}, text];

  const end = text.indexOf("\n---\n", 3);
  let raw: string;
  let body: string;
  if (end === -1) {
    if (text.endsWith("\n---")) {
      raw = text.slice(4, -4);
      body = "";
    } else {
      return [{}, text];
    }
  } else {
    raw = text.slice(4, end);
    body = text.slice(end + 5);
  }

  let meta: unknown;
  try {
    const doc = parseDocument(raw, {
      version: "1.1",
      customTags: pyyaml11Tags,
      uniqueKeys: false, // PyYAML: duplicate keys are last-wins, not an error
    });
    if (doc.errors.length > 0) return [{}, body];
    // PyYAML raises ConstructorError on unknown tags; the npm package only
    // warns and falls back to a string — treat that warning as the error.
    if (doc.warnings.some((w) => w.code === "TAG_RESOLVE_FAILED")) return [{}, body];
    meta = doc.toJS({ maxAliasCount: -1 }); // PyYAML has no alias budget
  } catch {
    return [{}, body];
  }
  if (!isPlainMapping(meta)) return [{}, body];
  return [meta as Record<string, unknown>, body];
}

function isPlainMapping(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v) || v instanceof YamlFloat || v instanceof YamlTimestamp) return false;
  // !!set / !!omap toJS() to Set/Map — not dicts in the Python sense either
  return Object.prototype.toString.call(v) === "[object Object]";
}
