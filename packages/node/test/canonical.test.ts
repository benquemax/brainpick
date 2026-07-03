import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { canonicalJson, canonicalJsonl, cmpStr, sha256Hex, type JsonValue } from "../src/core/canonical";
import { pyFloatRepr } from "../src/core/pyfmt";
import { EXPECTED } from "./helpers";

test("canonicalJson reproduces the golden graph.json byte for byte", () => {
  const golden = readFileSync(join(EXPECTED, "kotiaurinko", ".brainpick", "t1", "graph.json"), "utf8");
  expect(canonicalJson(JSON.parse(golden))).toBe(golden);
});

test("canonicalJson reproduces the golden manifest byte for byte", () => {
  const golden = readFileSync(join(EXPECTED, "kotiaurinko", ".brainpick", "manifest.json"), "utf8");
  expect(canonicalJson(JSON.parse(golden))).toBe(golden);
});

test("canonicalJsonl reproduces the golden docs.jsonl byte for byte", () => {
  const golden = readFileSync(join(EXPECTED, "kotiaurinko", ".brainpick", "t1", "docs.jsonl"), "utf8");
  const records = golden
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JsonValue);
  expect(canonicalJsonl(records)).toBe(golden);
});

test("keys sort in codepoint order, not JS integer-key order", () => {
  // JS object insertion order would put "2" before "10"; Python sorts "10" < "2" < "a"
  expect(canonicalJson({ a: 1, "2": 2, "10": 3 })).toBe('{\n  "10": 3,\n  "2": 2,\n  "a": 1\n}\n');
});

test("non-ASCII stays raw, controls escape like json.dumps(ensure_ascii=False)", () => {
  expect(canonicalJson({ "tähti": "pöllämystynyt — matkalainen" })).toBe(
    '{\n  "tähti": "pöllämystynyt — matkalainen"\n}\n',
  );
  expect(canonicalJsonl([{ s: "a\u001fb\u007fc" }])).toBe('{"s":"a\\u001fb\u007fc"}\n'); // C0 escapes, DEL stays raw
});

test("empty containers and nesting match json.dumps(indent=2)", () => {
  expect(canonicalJson({})).toBe("{}\n");
  expect(canonicalJson([])).toBe("[]\n");
  expect(canonicalJson({ a: [], b: {}, c: [1, [2]] })).toBe(
    '{\n  "a": [],\n  "b": {},\n  "c": [\n    1,\n    [\n      2\n    ]\n  ]\n}\n',
  );
  expect(canonicalJsonl([])).toBe("");
});

test("cmpStr orders by code point (astral above all of the BMP)", () => {
  expect(cmpStr("�", "\u{1f600}")).toBeLessThan(0); // JS unit order would flip this
  expect(["b", "a\u{1f600}", "a�"].sort(cmpStr)).toEqual(["a�", "a\u{1f600}", "b"]);
  expect(cmpStr("a", "ab")).toBeLessThan(0);
  expect(cmpStr("ab", "ab")).toBe(0);
});

test("sha256Hex over bytes and utf-8 text", () => {
  expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256Hex(Buffer.from("tähti", "utf8"))).toBe(sha256Hex("tähti"));
});

test("pyFloatRepr mirrors Python's repr(float)", () => {
  expect(pyFloatRepr(1)).toBe("1.0");
  expect(pyFloatRepr(1.5)).toBe("1.5");
  expect(pyFloatRepr(0.1)).toBe("0.1");
  expect(pyFloatRepr(1e15)).toBe("1000000000000000.0");
  expect(pyFloatRepr(1e16)).toBe("1e+16");
  expect(pyFloatRepr(1e-7)).toBe("1e-07");
  expect(pyFloatRepr(-0.5)).toBe("-0.5");
  expect(pyFloatRepr(685230.15)).toBe("685230.15");
  expect(pyFloatRepr(Infinity)).toBe("inf");
  expect(pyFloatRepr(-Infinity)).toBe("-inf");
  expect(pyFloatRepr(NaN)).toBe("nan");
});
