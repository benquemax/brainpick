import { afterEach, expect, test } from "vitest";

import { posixNormpath, scan, type Document } from "../src/core/bundle";
import { cleanup, copyBundle, makeBundle } from "./helpers";

afterEach(cleanup);

function byPath(docs: Document[]): Record<string, Document> {
  return Object.fromEntries(docs.map((d) => [d.path, d]));
}

test("scan kotiaurinko", () => {
  const docs = scan(copyBundle());
  const d = byPath(docs);

  // notes.txt excluded; 10 markdown docs incl. reserved
  expect(Object.keys(d).sort()).toEqual([
    "aurinko.md",
    "index.md",
    "komeetta.md",
    "kuu.md",
    "log.md",
    "maa.md",
    "planeetat.md",
    "saaret/atolli.md",
    "saaret/laguuni.md",
    "yksinainen.md",
  ]);

  expect(d["index.md"]!.reserved).toBe(true);
  expect(d["log.md"]!.reserved).toBe(true);
  expect(d["aurinko.md"]!.reserved).toBe(false);

  // title fallbacks: frontmatter > H1 > stem
  expect(d["aurinko.md"]!.title).toBe("Aurinko");
  expect(d["kuu.md"]!.title).toBe("Kuu"); // H1 fallback (no title key)
  expect(d["index.md"]!.title).toBe("Kotiaurinko"); // H1 fallback on reserved

  // tags coerced to string lists; missing -> []
  expect(d["maa.md"]!.tags).toEqual(["planeetta", "koti"]);
  expect(d["log.md"]!.tags).toEqual([]);

  // yaml datetime normalized to ISO Z string
  expect(d["planeetat.md"]!.timestamp).toBe("2026-06-01T00:00:00Z");
  expect(d["aurinko.md"]!.timestamp).toBeNull();

  // description nullability
  expect(d["kuu.md"]!.description).toBeNull();
  expect(d["saaret/laguuni.md"]!.description).toBe("The calm water inside the ring.");
});

test("link resolution", () => {
  const d = byPath(scan(copyBundle()));

  const targets = (p: string) =>
    d[p]!.links.map((e) => [e.target, e.kind]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));

  // relative, rooted, wikilink, piped wikilink
  expect(targets("planeetat.md")).toEqual([
    ["aurinko.md", "link"],
    ["maa.md", "link"],
  ]);
  expect(targets("maa.md")).toEqual([
    ["kuu.md", "link"], // /kuu.md rooted
    ["planeetat.md", "link"],
  ]);
  expect(targets("aurinko.md")).toEqual([
    ["komeetta.md", "link"],
    ["kuu.md", "wikilink"],
    ["planeetat.md", "link"],
  ]);
  expect(targets("yksinainen.md")).toEqual([["aurinko.md", "wikilink"]]);

  // code-fenced pseudo-link must not appear anywhere
  expect(d["kuu.md"]!.links.some((l) => l.target === "ei-ole.md")).toBe(false);
  expect(d["kuu.md"]!.ghosts.some((g) => g.target === "ei-ole.md")).toBe(false);

  // ghost: unresolved relative target recorded as written
  expect(d["saaret/laguuni.md"]!.ghosts.map((g) => g.target)).toEqual(["olematon.md"]);

  // subdir relative resolution
  expect(targets("saaret/atolli.md")).toEqual([["saaret/laguuni.md", "link"]]);
});

test("str() coercion parity: booleans, floats, dates in scalar fields", () => {
  const root = makeBundle({
    "a.md": "---\ntags: [yes, no, 1.0, 2026-06-01]\ntitle: yes\n---\nbody\n",
    "b.md": "---\ntitle: 007\ntype: 1.5\ndescription: 0\ntimestamp: hello\n---\nbody\n",
    "c.md": "---\ntags: single\ntimestamp: '2026-06-01'\n---\nbody\n",
  });
  const d = byPath(scan(root));

  // Python str(True) is "True" — a YAML 1.1 `yes` inside tags becomes "True"
  expect(d["a.md"]!.tags).toEqual(["True", "False", "1.0", "2026-06-01"]);
  expect(d["a.md"]!.title).toBe("True");

  expect(d["b.md"]!.title).toBe("7"); // leading-zero octal int
  expect(d["b.md"]!.type).toBe("1.5");
  expect(d["b.md"]!.description).toBe("0");
  expect(d["b.md"]!.timestamp).toBe("hello"); // non-datetime falls back to str()

  expect(d["c.md"]!.tags).toEqual(["single"]); // scalar wraps to one-element list
  expect(d["c.md"]!.timestamp).toBe("2026-06-01"); // quoted string passes through
});

test("self-links are dropped and ..-escapes ghost", () => {
  const root = makeBundle({
    "a.md": "# A\n\n[self](a.md) [up](../outside.md) [b](b.md)\n",
    "b.md": "# B\n",
  });
  const d = byPath(scan(root));
  expect(d["a.md"]!.links.map((l) => l.target)).toEqual(["b.md"]);
  expect(d["a.md"]!.ghosts.map((g) => g.target)).toEqual(["../outside.md"]);
});

test("wikilinks resolve by stem, case-sensitive first, ambiguity ghosts", () => {
  const root = makeBundle({
    "one.md": "[[Two]] [[three]] [[dup]]\n",
    "two.md": "# t\n",
    "Three.md": "# t\n",
    "sub/dup.md": "# d\n",
    "other/dup.md": "# d\n",
  });
  const d = byPath(scan(root));
  expect(d["one.md"]!.links.map((l) => l.target).sort()).toEqual(["Three.md", "two.md"]);
  expect(d["one.md"]!.ghosts.map((g) => g.target)).toEqual(["dup"]);
});

test("excluded directories are pruned, dotfiles are scanned", () => {
  const root = makeBundle({
    "a.md": "# A\n",
    ".hidden/h.md": "# H\n",
    "node_modules/x.md": "nope\n",
    "_temp/y.md": "nope\n",
    ".git/z.md": "nope\n",
    ".brainpick/t1/w.md": "nope\n",
    "notes.txt": "not markdown\n",
  });
  expect(scan(root).map((d) => d.path)).toEqual([".hidden/h.md", "a.md"]);
});

test("posixNormpath mirrors posixpath.normpath", () => {
  expect(posixNormpath("")).toBe(".");
  expect(posixNormpath("saaret/../maa.md")).toBe("maa.md");
  expect(posixNormpath("a/./b//c")).toBe("a/b/c");
  expect(posixNormpath("../x")).toBe("../x");
  expect(posixNormpath("a/../../x")).toBe("../x");
  expect(posixNormpath("/a/../b")).toBe("/b");
  expect(posixNormpath("//a")).toBe("//a");
  expect(posixNormpath("///a")).toBe("/a");
});
