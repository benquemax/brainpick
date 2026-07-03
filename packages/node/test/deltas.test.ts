import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { scan } from "../src/core/bundle";
import { buildGraph } from "../src/compile/t1";
import { diffGraphs } from "../src/deltas";
import { cleanup, copyBundle } from "./helpers";

afterEach(cleanup);

test("diff add / modify / remove", () => {
  const root = copyBundle();
  const old = buildGraph(scan(root));

  writeFileSync(
    join(root, "uusi.md"),
    "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n",
    "utf8",
  );
  unlinkSync(join(root, "komeetta.md"));
  const next = buildGraph(scan(root));

  const delta = diffGraphs(old, next);

  expect(delta.added.nodes.map((n) => n.id)).toEqual(["uusi.md"]);
  expect(delta.removed.nodes).toEqual(["komeetta.md"]);
  expect(delta.added.edges).toContainEqual({
    count: 1,
    kind: "link",
    label: "Kuu",
    source: "uusi.md",
    target: "kuu.md",
  });
  expect(delta.removed.edges).toContainEqual({ kind: "link", source: "komeetta.md", target: "aurinko.md" });

  // kuu gained an inbound edge -> updated full node record
  expect(delta.updated.nodes.map((n) => n.id)).toContain("kuu.md");
  expect(delta.stats).toEqual(next.stats);
});

test("identical graphs produce an empty delta", () => {
  const g = buildGraph(scan(copyBundle()));
  const delta = diffGraphs(g, g);
  expect(delta.added).toEqual({ edges: [], nodes: [] });
  expect(delta.removed).toEqual({ edges: [], nodes: [] });
  expect(delta.updated).toEqual({ nodes: [] });
});

test("edge count change is remove plus add", () => {
  const root = copyBundle();
  const old = buildGraph(scan(root));
  const text = readFileSync(join(root, "kuu.md"), "utf8");
  writeFileSync(join(root, "kuu.md"), text + "\nAlso [Maa](maa.md) again.\n", "utf8");
  const next = buildGraph(scan(root));

  const delta = diffGraphs(old, next);
  expect(delta.removed.edges).toContainEqual({ kind: "link", source: "kuu.md", target: "maa.md" });
  const added = delta.added.edges.find((e) => e.source === "kuu.md")!;
  expect(added.count).toBe(2);
});
