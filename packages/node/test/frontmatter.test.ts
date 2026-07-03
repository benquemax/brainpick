import { describe, expect, test } from "vitest";

import { splitFrontmatter } from "../src/core/frontmatter";
import { YamlFloat, YamlTimestamp } from "../src/core/yaml11";

test("basic frontmatter", () => {
  const [meta, body] = splitFrontmatter("---\ntitle: Kuu\ntags: [a, b]\n---\n\n# Kuu\n");
  expect(meta).toEqual({ title: "Kuu", tags: ["a", "b"] });
  expect(body).toBe("\n# Kuu\n");
});

test("no frontmatter", () => {
  const [meta, body] = splitFrontmatter("# Just a heading\n");
  expect(meta).toEqual({});
  expect(body).toBe("# Just a heading\n");
});

test("unparseable yaml is tolerated", () => {
  const [meta, body] = splitFrontmatter("---\n: [unbalanced\n---\nbody\n");
  expect(meta).toEqual({});
  expect(body).toBe("body\n");
});

test("non-mapping yaml is tolerated", () => {
  const [meta, body] = splitFrontmatter("---\n- just\n- a list\n---\nbody\n");
  expect(meta).toEqual({});
  expect(body).toBe("body\n");
});

test("unterminated frontmatter is body", () => {
  const [meta, body] = splitFrontmatter("---\ntitle: x\nno end fence\n");
  expect(meta).toEqual({});
  expect(body).toBe("---\ntitle: x\nno end fence\n");
});

test("crlf normalized", () => {
  const [meta, body] = splitFrontmatter("---\r\ntitle: x\r\n---\r\nbody\r\n");
  expect(meta).toEqual({ title: "x" });
  expect(body).toBe("body\n");
});

describe("PyYAML 1.1 scalar parity", () => {
  const meta = (yaml: string) => splitFrontmatter(`---\n${yaml}\n---\nbody\n`)[0];

  test("ISO datetime parses to a timestamp that normalizes to a Z-string", () => {
    const v = meta("timestamp: 2026-06-01T00:00:00Z")["timestamp"];
    expect(v).toBeInstanceOf(YamlTimestamp);
    expect((v as YamlTimestamp).normalized()).toBe("2026-06-01T00:00:00Z");
  });

  test("bare date stays a date (not midnight UTC)", () => {
    const v = meta("timestamp: 2026-06-01")["timestamp"];
    expect(v).toBeInstanceOf(YamlTimestamp);
    expect((v as YamlTimestamp).dateOnly).toBe(true);
    expect((v as YamlTimestamp).normalized()).toBe("2026-06-01");
  });

  test("offset datetimes convert to UTC", () => {
    const v = meta("timestamp: 2026-06-01T03:00:00+03:00")["timestamp"] as YamlTimestamp;
    expect(v.normalized()).toBe("2026-06-01T00:00:00Z");
    expect(v.pyStr()).toBe("2026-06-01 03:00:00+03:00"); // str() keeps the offset
  });

  test("naive datetimes are assumed UTC; fractions truncate", () => {
    const v = meta("timestamp: 2026-06-01 08:30:59.9999999")["timestamp"] as YamlTimestamp;
    expect(v.normalized()).toBe("2026-06-01T08:30:59Z"); // never rounds up
  });

  test("quoted scalars stay strings", () => {
    expect(meta('timestamp: "2026-06-01"')["timestamp"]).toBe("2026-06-01");
    expect(meta('a: "yes"')["a"]).toBe("yes");
  });

  test("yes/no/on/off are booleans, bare y/n are strings (PyYAML deviates from YAML 1.1)", () => {
    expect(meta("a: yes")["a"]).toBe(true);
    expect(meta("a: Off")["a"]).toBe(false);
    expect(meta("a: y")["a"]).toBe("y");
    expect(meta("a: N")["a"]).toBe("N");
  });

  test("PyYAML float quirks: unsigned exponents and 0o-octals are strings", () => {
    expect(meta("a: 1.5e3")["a"]).toBe("1.5e3"); // PyYAML wants a signed exponent
    const f = meta("a: 1.5e+3")["a"];
    expect(f).toBeInstanceOf(YamlFloat);
    expect((f as YamlFloat).value).toBe(1500);
    expect(meta("a: 0o777")["a"]).toBe("0o777");
    expect(meta("a: 0777")["a"]).toBe(511); // leading-zero octal
    expect(meta("a: 1:30")["a"]).toBe(90); // sexagesimal int
  });

  test("duplicate keys are last-wins, not an error", () => {
    expect(meta("a: 1\na: 2")["a"]).toBe(2);
  });

  test("a plain = errors the document like SafeLoader's missing value constructor", () => {
    const [m, body] = splitFrontmatter("---\na: =\ntitle: x\n---\nbody\n");
    expect(m).toEqual({});
    expect(body).toBe("body\n");
  });

  test("unknown tags collapse the mapping to {} (PyYAML raises ConstructorError)", () => {
    expect(meta("a: !foo 1")).toEqual({});
    expect(meta("a: !!python/object:os.system x")).toEqual({});
  });

  test("huge integers keep every digit", () => {
    expect(String(meta("a: 123456789012345678901234567890")["a"])).toBe("123456789012345678901234567890");
  });
});
