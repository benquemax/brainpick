/** Canonical serialization (spec/10) — what makes cross-runtime byte-golden real.
 *
 * Mirrors the Python reference byte for byte:
 * - `canonicalJson` ≡ `json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n"`
 * - `canonicalJsonl` ≡ compact separators (`,`/`:`), sorted keys, one record per line
 *
 * String escaping relies on V8's JSON.stringify, which matches CPython's
 * `ensure_ascii=False` escaping exactly: `"` and `\` escaped, C0 controls as
 * `\b \t \n \f \r` or lowercase `\u00xx`, DEL/C1/U+2028/U+2029 left raw.
 */
import { createHash } from "node:crypto";

import { pyFloatRepr } from "./pyfmt";

export type JsonValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Compare strings by Unicode code point — Python's `str` ordering and the
 * spec's "codepoint order". JS `<`/default `Array.sort` compare UTF-16 code
 * units, which misorders astral characters against high-BMP ones (e.g. an
 * emoji would sort before U+FFFD). Every artifact-producing sort uses this. */
export function cmpStr(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

function scalarJson(v: null | boolean | number | bigint | string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "string":
      return JSON.stringify(v);
    case "bigint":
      return v.toString();
    default: {
      // 0.1 artifacts only ever contain integers; the float path mirrors
      // json.dumps (repr(float), Infinity/NaN literals) defensively.
      if (Number.isNaN(v)) return "NaN";
      if (v === Infinity) return "Infinity";
      if (v === -Infinity) return "-Infinity";
      if (Number.isInteger(v) && !Object.is(v, -0)) return String(v);
      return pyFloatRepr(v);
    }
  }
}

function renderJson(value: JsonValue, compact: boolean, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (compact) return "[" + value.map((v) => renderJson(v, true, 0)).join(",") + "]";
    const pad = "  ".repeat(depth + 1);
    const items = value.map((v) => pad + renderJson(v, false, depth + 1));
    return "[\n" + items.join(",\n") + "\n" + "  ".repeat(depth) + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort(cmpStr);
    if (keys.length === 0) return "{}";
    if (compact) {
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + renderJson(value[k]!, true, 0)).join(",") + "}";
    }
    const pad = "  ".repeat(depth + 1);
    const items = keys.map((k) => pad + JSON.stringify(k) + ": " + renderJson(value[k]!, false, depth + 1));
    return "{\n" + items.join(",\n") + "\n" + "  ".repeat(depth) + "}";
  }
  return scalarJson(value);
}

export function canonicalJson(obj: JsonValue): string {
  return renderJson(obj, false, 0) + "\n";
}

export function canonicalJsonl(records: JsonValue[]): string {
  if (records.length === 0) return "";
  return records.map((r) => renderJson(r, true, 0)).join("\n") + "\n";
}

export function sha256Hex(data: Uint8Array | string): string {
  const hash = createHash("sha256");
  if (typeof data === "string") hash.update(data, "utf8");
  else hash.update(data);
  return hash.digest("hex");
}
