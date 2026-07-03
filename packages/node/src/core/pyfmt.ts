/** Python formatting semantics the port depends on: float repr, whitespace.
 *
 * These exist because byte parity with the Python engine hinges on details
 * like `str(1.0) == "1.0"` and `str.split()` splitting on U+001C — places
 * where the obvious JS equivalents quietly disagree.
 */

/** Python's `\s` / `str.isspace()` character set (JS `\s` differs: it lacks
 * U+001C..U+001F and U+0085 and wrongly includes U+FEFF). For use inside
 * a character class. */
export const PY_SPACE_CLASS =
  "\\t\\n\\x0b\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const PY_SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, "gu");
const PY_STRIP_EDGES = new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu");

/** Python `str.strip()` with no arguments. */
export function pyStrip(s: string): string {
  return s.replace(PY_STRIP_EDGES, "");
}

/** Python `str.split()` with no arguments: split on whitespace runs, no empties. */
export function pySplitWhitespace(s: string): string[] {
  return s.split(PY_SPACE_RUN).filter((part) => part !== "");
}

/** Python `repr(float)` / `str(float)`: shortest round-trip digits, positional
 * notation when the decimal exponent is in [-4, 16), otherwise scientific with
 * a two-digit-minimum exponent ("1e+16", "1e-07"), and a trailing ".0" on
 * integral positional values. */
export function pyFloatRepr(v: number): string {
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  if (Object.is(v, -0)) return "-0.0";
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(v.toExponential());
  if (!m) return String(v); // unreachable for finite doubles
  const sign = m[1]!;
  const digits = m[2]! + (m[3] ?? "");
  const e = parseInt(m[4]!, 10);
  if (e >= -4 && e < 16) {
    if (e >= digits.length - 1) return sign + digits + "0".repeat(e - (digits.length - 1)) + ".0";
    if (e >= 0) return sign + digits.slice(0, e + 1) + "." + digits.slice(e + 1);
    return sign + "0." + "0".repeat(-e - 1) + digits;
  }
  const mantissa = m[3] ? `${m[2]}.${m[3]}` : m[2]!;
  const exp = Math.abs(e).toString().padStart(2, "0");
  return `${sign}${mantissa}e${e < 0 ? "-" : "+"}${exp}`;
}
