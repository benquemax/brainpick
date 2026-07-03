import { expect, test } from "vitest";

import { extractLinks } from "../src/core/links";

const links = extractLinks;

test("markdown link", () => {
  expect(links("see [Maa](maa.md) now")).toEqual([{ kind: "link", target: "maa.md", text: "Maa" }]);
});

test("url and fragment targets skipped", () => {
  expect(links("[x](https://example.com) [y](mailto:a@b.c) [z](#section)")).toEqual([]);
});

test("fragment is stripped", () => {
  expect(links("[Maa](maa.md#tides)")).toEqual([{ kind: "link", target: "maa.md", text: "Maa" }]);
});

test("fenced code excluded", () => {
  const body = "```\n[ei](ei.md)\n```\nreal [Maa](maa.md)\n";
  expect(links(body)).toEqual([{ kind: "link", target: "maa.md", text: "Maa" }]);
});

test("inline code excluded", () => {
  expect(links("`[ei](ei.md)` and [Maa](maa.md)")).toEqual([{ kind: "link", target: "maa.md", text: "Maa" }]);
});

test("images excluded by the lookbehind", () => {
  expect(links("![alt](kuva.png) and [Maa](maa.md)")).toEqual([{ kind: "link", target: "maa.md", text: "Maa" }]);
});

test("wikilink plain and piped", () => {
  expect(links("[[kuu]] and [[aurinko|Aurinko itse]]")).toEqual([
    { kind: "wikilink", target: "kuu", text: "kuu" },
    { kind: "wikilink", target: "aurinko", text: "Aurinko itse" },
  ]);
});

test("rooted target kept verbatim", () => {
  expect(links("[Kuu](/kuu.md)")).toEqual([{ kind: "link", target: "/kuu.md", text: "Kuu" }]);
});

test("document order is preserved across kinds", () => {
  expect(links("[A](a.md) then [[b]] then [C](c.md)").map((l) => l.target)).toEqual(["a.md", "b", "c.md"]);
});
