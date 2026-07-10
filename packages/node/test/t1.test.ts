import { afterEach, expect, test } from "vitest";

import { scan } from "../src/core/bundle";
import { buildDocsRecords, buildGraph, renderIndexBlock } from "../src/compile/t1";
import { cleanup, copyBundle } from "./helpers";

afterEach(cleanup);

test("graph shape", () => {
  const g = buildGraph(scan(copyBundle()));

  expect(g.stats).toEqual({ docs: 10, edges: 20, ghosts: 1, islands: 1, orphans: 1, tags: 8 });

  const nodes = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  expect(g.nodes.map((n) => n.id)).toEqual(Object.keys(nodes).sort()); // sorted by id

  // orphan: only inbound is from reserved index.md
  expect(nodes["yksinainen.md"]!.orphan).toBe(true);
  expect(g.nodes.filter((n) => n.orphan).length).toBe(1);

  // degree bookkeeping (index links count for in/out, not orphanhood)
  expect(nodes["aurinko.md"]!.in).toBe(4);
  expect(nodes["aurinko.md"]!.out).toBe(3);
  expect(nodes["komeetta.md"]!.orphan).toBe(false); // aurinko links back to its comet
  expect(nodes["komeetta.md"]!.out).toBe(1); // two links to aurinko collapse to one edge
  expect(nodes["index.md"]!.out).toBe(8);
  expect(nodes["index.md"]!.reserved).toBe(true);

  // duplicate links collapse with count
  const edge = g.edges.find((e) => e.source === "komeetta.md")!;
  expect(edge.target).toBe("aurinko.md");
  expect(edge.count).toBe(2);
  expect(edge.kind).toBe("link");

  // islands: the saaret pair, mainland not listed
  expect(g.islands).toEqual([["saaret/atolli.md", "saaret/laguuni.md"]]);

  // ghosts
  expect(g.ghosts).toEqual([{ source: "saaret/laguuni.md", target: "olematon.md" }]);

  // tag map sorted keys and members
  expect(g.tags["saari"]).toEqual(["saaret/atolli.md", "saaret/laguuni.md"]);
  expect(Object.keys(g.tags)).toEqual([...Object.keys(g.tags)].sort());

  // about is nullable on nodes too — absent frontmatter yields null
  expect(nodes["aurinko.md"]!.about).toBe("thing");
  expect(nodes["maa.md"]!.about).toBe("place");
  expect(nodes["kuu.md"]!.about).toBeNull();

  // edges sorted by (source, target, kind)
  const keys = g.edges.map((e) => `${e.source}${e.target}${e.kind}`);
  expect(keys).toEqual([...keys].sort());
});

test("docs records", () => {
  const recs = buildDocsRecords(scan(copyBundle()));
  const paths = recs.map((r) => r.path);
  expect(paths).toEqual([...paths].sort());

  const kuu = recs.find((r) => r.path === "kuu.md")!;
  expect(kuu.title).toBe("Kuu");
  expect(kuu.description).toBeNull();
  expect(kuu.text).toContain("tides");
  expect(kuu.text).not.toContain("type: Concept");
  expect(Object.keys(kuu).sort()).toEqual([
    "about",
    "description",
    "path",
    "reserved",
    "sha256",
    "tags",
    "text",
    "timestamp",
    "title",
    "type",
  ]);

  // about is nullable — absent frontmatter yields null, present flows through
  expect(kuu.about).toBeNull();
  const aurinko = recs.find((r) => r.path === "aurinko.md")!;
  expect(aurinko.about).toBe("thing");
  const maa = recs.find((r) => r.path === "maa.md")!;
  expect(maa.about).toBe("place");
});

test("index block render", () => {
  const bundle = copyBundle();
  const block = renderIndexBlock(scan(bundle));
  const lines = block.split("\n");

  expect(lines[0]!.startsWith("<!-- brainpick:begin index (hash:")).toBe(true);
  expect(lines[lines.length - 1]).toBe("<!-- brainpick:end index -->");
  expect(lines).toContain("## concepts");
  expect(lines).toContain("## saaret");

  // reserved files never listed
  expect(lines.some((ln) => ln.includes("index.md)") || ln.includes("log.md)"))).toBe(false);

  // entry format, description omitted when null
  expect(lines).toContain("- [Aurinko](aurinko.md) — The star everything in this bundle orbits.");
  expect(lines).toContain("- [Kuu](kuu.md)");

  // entries sorted by title within group; groups ordered root-first
  expect(lines.indexOf("## concepts")).toBeLessThan(lines.indexOf("## saaret"));

  // stamp is stable across renders
  expect(renderIndexBlock(scan(bundle))).toBe(block);
});
