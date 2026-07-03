import { afterEach, expect, test } from "vitest";

import { scan } from "../src/core/bundle";
import { buildDocsRecords } from "../src/compile/t1";
import { search, tokenize } from "../src/query/keyword";
import { cleanup, copyBundle } from "./helpers";

afterEach(cleanup);

test("tokenizer parity vector with Python's [^\\W_]+", () => {
  // Shared unit vector: underscore is a boundary, hyphen splits, digits kept
  expect(tokenize("Aurinko-itse_kuu 123 tähti")).toEqual(["aurinko", "itse", "kuu", "123", "tähti"]);
  expect(tokenize("__init__")).toEqual(["init"]);
  expect(tokenize("...")).toEqual([]);
});

test("keyword search set", () => {
  const records = buildDocsRecords(scan(copyBundle()));
  const hits = search(records, "aurinko", 8);
  expect(new Set(hits.map((h) => h.path))).toEqual(
    new Set(["aurinko.md", "komeetta.md", "planeetat.md", "yksinainen.md"]),
  );
  // the doc titled Aurinko outranks passing mentions
  expect(hits[0]!.path).toBe("aurinko.md");
  // reserved docs never surface (index.md links everything)
  expect(hits.every((h) => !h.path.endsWith("index.md"))).toBe(true);
});

test("search result shape", () => {
  const records = buildDocsRecords(scan(copyBundle()));
  const kuuHits = search(records, "tides", 3).filter((h) => h.path === "kuu.md");
  expect(kuuHits).toHaveLength(1);
  const hit = kuuHits[0]!;
  expect(Object.keys(hit).sort()).toEqual(["description", "path", "score", "snippet", "source", "title"]);
  expect(hit.source).toBe("keyword");
  expect(hit.snippet).toContain("tides");
});

test("no hits", () => {
  const records = buildDocsRecords(scan(copyBundle()));
  expect(search(records, "zzzzz kuulumaton", 5)).toEqual([]);
});
