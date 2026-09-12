import { afterEach, expect, test } from "vitest";

import { scan } from "../src/core/bundle";
import { buildDocsRecords } from "../src/compile/t1";
import { search, searchTerms, tokenize } from "../src/query/keyword";
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

// -- tags and stem terms (spec/50) ---------------------------------------------

test("searchTerms adds a 4-char prefix for tokens of 5+", () => {
  expect(searchTerms("kahvia kahvi Agents cup")).toEqual(["kahvia", "kahv", "kahvi", "kahv", "agents", "agen", "cup"]);
  expect(searchTerms("a bb ccc dddd")).toEqual(["a", "bb", "ccc", "dddd"]); // < 5 chars: untouched
});

test("tags are searchable", () => {
  const records = buildDocsRecords(scan(copyBundle("kotiaivot"), undefined, ["raw/*"]));
  // `vesi` is veden-keitto's TAG only — not in title, description or body
  expect(search(records, "vesi", 8).map((h) => h.path)).toEqual(["skills/veden-keitto.md"]);
});

test("an inflected query reaches its stem", () => {
  const records = buildDocsRecords(scan(copyBundle("kotiaivot"), undefined, ["raw/*"]));
  expect(new Set(search(records, "kahvia", 8).map((h) => h.path))).toEqual(
    new Set([
      "knowledge/kahvi.md",
      "knowledge/vieraat.md",
      "skills/kahvin-keitto.md",
      "skills/veden-keitto.md",
      "todo/archive/2026-07-01.md",
    ]),
  );
});

test("an exact token still outranks a stem-only match", () => {
  const records = buildDocsRecords(scan(copyBundle()));
  const exact = search(records, "aurinko", 8);
  expect(exact[0]!.path).toBe("aurinko.md");
  const stem = search(records, "aurinkoa", 8);
  expect(new Set(stem.map((h) => h.path))).toEqual(new Set(exact.map((h) => h.path)));
  expect(stem[0]!.score).toBeLessThan(exact[0]!.score);
});
