/** PyYAML-compatible YAML 1.1 scalar semantics for the `yaml` package.
 *
 * The Python engine parses frontmatter with PyYAML's SafeLoader, whose
 * implicit scalar resolution deviates from both YAML 1.1 and the `yaml`
 * package's 1.1 schema in ways that leak into normative artifact bytes:
 *
 * - bare `y`/`n` are strings in PyYAML (the 1.1 spec — and the npm schema —
 *   call them booleans);
 * - `1.5e3` is a string (PyYAML's float regex demands a signed exponent);
 * - `0o777` is a string (PyYAML only knows leading-zero octal);
 * - timestamps must distinguish date-only from datetime scalars, keep their
 *   UTC offsets, and truncate (not round) sub-second digits;
 * - `=` resolves to the value tag, which SafeLoader cannot construct — the
 *   whole document errors and tolerant frontmatter collapses to `{}`.
 *
 * So the built-in bool/int/float/timestamp tags are replaced wholesale with
 * ports of PyYAML's resolver regexes and constructors. Timestamps and floats
 * resolve to wrapper classes so `str()`-coercion sites (title, type, tags…)
 * can reproduce Python's exact rendering.
 */
import type { ScalarTag, Tags } from "yaml";

import { pyFloatRepr } from "./pyfmt";

/** PyYAML `construct_yaml_timestamp` result: a `datetime.date` when
 * `dateOnly`, else a `datetime.datetime` with `tz` = null (naive) or a
 * fixed offset in minutes (0 covers both `Z` and `+00:00` — CPython's
 * `timezone(timedelta(0))` IS `timezone.utc`). */
export class YamlTimestamp {
  constructor(
    readonly dateOnly: boolean,
    readonly year: number,
    readonly month: number,
    readonly day: number,
    readonly hour: number,
    readonly minute: number,
    readonly second: number,
    readonly microsecond: number,
    readonly tz: number | null,
  ) {}

  /** The UTC fields of this instant (naive values are taken as already-UTC,
   * mirroring `_normalize_timestamp`'s `replace(tzinfo=utc)`). */
  private utcFields(): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    if (!this.tz) {
      // null (naive → assume UTC) or 0 (already UTC): fields pass through.
      return { year: this.year, month: this.month, day: this.day, hour: this.hour, minute: this.minute, second: this.second };
    }
    const base = new Date(Date.UTC(2000, this.month - 1, this.day, this.hour, this.minute, this.second));
    base.setUTCFullYear(this.year); // avoid Date.UTC's year 0-99 → 19xx mapping
    const shifted = new Date(base.getTime() - this.tz * 60_000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
  }

  /** `_normalize_timestamp`: `%Y-%m-%d` for dates, else the UTC `Z`-string at
   * second precision (microseconds truncated, exactly like strftime). */
  normalized(): string {
    if (this.dateOnly) return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
    const u = this.utcFields();
    return `${pad(u.year, 4)}-${pad(u.month, 2)}-${pad(u.day, 2)}T${pad(u.hour, 2)}:${pad(u.minute, 2)}:${pad(u.second, 2)}Z`;
  }

  /** Python `str(date)` / `str(datetime)` — isoformat with a space separator,
   * original offset preserved. */
  pyStr(): string {
    if (this.dateOnly) return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
    let s =
      `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)} ` +
      `${pad(this.hour, 2)}:${pad(this.minute, 2)}:${pad(this.second, 2)}`;
    if (this.microsecond !== 0) s += "." + pad(this.microsecond, 6);
    if (this.tz !== null) {
      const abs = Math.abs(this.tz);
      s += `${this.tz < 0 ? "-" : "+"}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
    }
    return s;
  }

  /** Python `repr()` — only reachable when a timestamp is nested inside a
   * list/dict that gets `str()`-coerced. */
  pyRepr(): string {
    if (this.dateOnly) return `datetime.date(${this.year}, ${this.month}, ${this.day})`;
    const parts = [this.year, this.month, this.day, this.hour, this.minute];
    if (this.second !== 0 || this.microsecond !== 0) parts.push(this.second);
    if (this.microsecond !== 0) parts.push(this.microsecond);
    let tzinfo = "";
    if (this.tz !== null) {
      if (this.tz === 0) tzinfo = ", tzinfo=datetime.timezone.utc";
      else {
        const total = this.tz * 60;
        const days = Math.floor(total / 86_400);
        const seconds = total - days * 86_400;
        const kwargs = [days !== 0 ? `days=${days}` : "", seconds !== 0 ? `seconds=${seconds}` : ""]
          .filter(Boolean)
          .join(", ");
        tzinfo = `, tzinfo=datetime.timezone(datetime.timedelta(${kwargs || "0"}))`;
      }
    }
    return `datetime.datetime(${parts.join(", ")}${tzinfo})`;
  }
}

/** A YAML float, wrapped so `str()` coercion can render Python's repr
 * ("1.0", "1e+16", "1e-07") — `String(1.0)` in JS would drop the ".0". */
export class YamlFloat {
  constructor(readonly value: number) {}
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ---------------------------------------------------------------------------
// PyYAML resolver regexes (resolver.py), verbatim ports.

const BOOL_RESOLVE =
  /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;

const INT_RESOLVE =
  /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;

const FLOAT_RESOLVE =
  /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

// Note: the resolver requires two-digit month/day on date-only scalars
// ("2026-6-1" is a plain string) while datetimes allow one digit.
const TIMESTAMP_RESOLVE =
  /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/;

const VALUE_RESOLVE = /^=$/;

// PyYAML constructor.py timestamp_regexp (a superset of the resolver form,
// used to pick the scalar apart once resolved).
const TIMESTAMP_PARTS =
  /^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:(?:[Tt]|[ \t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\.([0-9]*))?(?:[ \t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?)?$/;

// ---------------------------------------------------------------------------
// PyYAML constructor.py ports.

function resolveBool(str: string): boolean {
  const v = str.toLowerCase();
  if (v === "yes" || v === "true" || v === "on") return true;
  if (v === "no" || v === "false" || v === "off") return false;
  throw new Error(`cannot construct a bool from ${JSON.stringify(str)}`);
}

function resolveInt(str: string): number | bigint {
  let v = str.replace(/_/g, "");
  let negative = false;
  if (v[0] === "-" || v[0] === "+") {
    negative = v[0] === "-";
    v = v.slice(1);
  }
  let n: bigint;
  if (v === "0") n = 0n;
  else if (v.startsWith("0b")) n = BigInt("0b" + v.slice(2));
  else if (v.startsWith("0x")) n = BigInt("0x" + v.slice(2));
  else if (v[0] === "0") n = BigInt("0o" + v.slice(1));
  else if (v.includes(":")) {
    n = 0n;
    for (const part of v.split(":")) n = n * 60n + BigInt(part);
  } else n = BigInt(v);
  if (negative) n = -n;
  // Python ints are arbitrary precision; stay exact beyond 2^53.
  if (n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(n);
  return n;
}

function resolveFloat(str: string): YamlFloat {
  let v = str.replace(/_/g, "").toLowerCase();
  let sign = 1;
  if (v[0] === "-") sign = -1;
  if (v[0] === "-" || v[0] === "+") v = v.slice(1);
  if (v === ".inf") return new YamlFloat(sign * Infinity);
  if (v === ".nan") return new YamlFloat(NaN);
  if (v.includes(":")) {
    // sexagesimal, accumulated least-significant first like PyYAML (the
    // floating-point addition order matters for the exact double)
    const digits = v.split(":").map((part) => parseFloat(part)).reverse();
    let base = 1;
    let value = 0;
    for (const digit of digits) {
      value += digit * base;
      base *= 60;
    }
    return new YamlFloat(sign * value);
  }
  return new YamlFloat(sign * parseFloat(v));
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) return 29;
  return DAYS_IN_MONTH[month - 1]!;
}

function resolveTimestamp(str: string): YamlTimestamp {
  const m = TIMESTAMP_PARTS.exec(str);
  if (!m) throw new Error(`cannot construct a timestamp from ${JSON.stringify(str)}`);
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  // datetime.date/datetime validation; where CPython would raise ValueError
  // (and the Python engine would crash) we throw, which tolerant frontmatter
  // downgrades to {} — see the deviation note in the frontmatter module.
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`invalid date ${JSON.stringify(str)}`);
  }
  if (!m[4]) return new YamlTimestamp(true, year, month, day, 0, 0, 0, 0, null);
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5]!, 10);
  const second = parseInt(m[6]!, 10);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`invalid time ${JSON.stringify(str)}`);
  let microsecond = 0;
  if (m[7]) microsecond = parseInt(m[7].slice(0, 6).padEnd(6, "0"), 10);
  let tz: number | null = null;
  if (m[9]) {
    const offset = parseInt(m[10]!, 10) * 60 + (m[11] ? parseInt(m[11], 10) : 0);
    if (offset >= 24 * 60) throw new Error(`invalid timezone offset in ${JSON.stringify(str)}`);
    tz = m[9] === "-" ? -offset : offset;
  } else if (m[8]) {
    tz = 0; // Z
  }
  return new YamlTimestamp(false, year, month, day, hour, minute, second, microsecond, tz);
}

// ---------------------------------------------------------------------------
// Tags.

const REPLACED_TAGS = new Set([
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
  "tag:yaml.org,2002:timestamp",
]);

const pyBool: ScalarTag = {
  tag: "tag:yaml.org,2002:bool",
  default: true,
  test: BOOL_RESOLVE,
  resolve: resolveBool,
};

const pyInt: ScalarTag = {
  tag: "tag:yaml.org,2002:int",
  default: true,
  test: INT_RESOLVE,
  resolve: resolveInt,
};

const pyFloat: ScalarTag = {
  tag: "tag:yaml.org,2002:float",
  default: true,
  test: FLOAT_RESOLVE,
  resolve: resolveFloat,
};

const pyTimestamp: ScalarTag = {
  tag: "tag:yaml.org,2002:timestamp",
  default: true,
  test: TIMESTAMP_RESOLVE,
  resolve: resolveTimestamp,
};

/** PyYAML resolves a plain `=` to the value tag, which SafeLoader has no
 * constructor for — the document fails to load and tolerant frontmatter
 * yields {}. Throwing here reproduces that. */
const pyValue: ScalarTag = {
  tag: "tag:yaml.org,2002:value",
  default: true,
  test: VALUE_RESOLVE,
  resolve(): never {
    throw new Error("could not determine a constructor for the tag 'tag:yaml.org,2002:value'");
  },
};

/** `customTags` hook: swap the npm 1.1 scalar tags for the PyYAML ports.
 * (The schema hands over resolved tag objects; the string-shorthand arm of
 * the `Tags` type never occurs here but must type-check.) */
export function pyyaml11Tags(tags: Tags): Tags {
  return [
    ...tags.filter((t) => typeof t === "string" || !REPLACED_TAGS.has(t.tag)),
    pyBool,
    pyInt,
    pyFloat,
    pyTimestamp,
    pyValue,
  ];
}

// ---------------------------------------------------------------------------
// Python str()/repr() coercion over parsed YAML values.

/** Python `str(value)` over a PyYAML-parsed value — what `bundle.py` applies
 * to `title`/`type`/`description` and each tag (str(True) is "True"). */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isInteger(v) && !Object.is(v, -0) ? String(v) : pyFloatRepr(v);
  if (v instanceof YamlFloat) return pyFloatRepr(v.value);
  if (v instanceof YamlTimestamp) return v.pyStr();
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return "{" + entries.map(([k, val]) => `${pyReprString(k)}: ${pyRepr(val)}`).join(", ") + "}";
  }
  return String(v);
}

/** Python `repr(value)` — used for elements nested inside coerced containers. */
function pyRepr(v: unknown): string {
  if (typeof v === "string") return pyReprString(v);
  if (v instanceof YamlTimestamp) return v.pyRepr();
  return pyStr(v);
}

/** Python `repr(str)`: single quotes unless the string contains a single
 * quote and no double quote; C0/C1 controls escaped as \xXX. */
function pyReprString(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || (code >= 0x7f && code <= 0xa0)) out += "\\x" + code.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + quote;
}
