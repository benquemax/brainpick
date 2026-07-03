import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { checkFresh, runCompile } from "../src/compile/pipeline";
import { cleanup, copyBundle } from "./helpers";

afterEach(cleanup);

const read = (p: string) => readFileSync(p, "utf8");

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    const rel = abs.slice(root.length + 1).replaceAll("\\", "/");
    out[rel] = readFileSync(abs).toString("base64");
  }
  return out;
}

test("fresh compile writes everything", async () => {
  const root = copyBundle();
  const result = await runCompile(root);
  expect(result.changed).toBe(true);

  const bp = join(root, ".brainpick");
  const manifest = JSON.parse(read(join(bp, "manifest.json")));
  expect(manifest.seq).toBe(1);
  expect(manifest.spec_version).toBe("0.1");
  expect(manifest.tiers).toEqual({ t1: "fresh", t2: "off", t3: "off" });
  expect(manifest.generator.impl).toBe("node");
  expect(manifest.files["notes.txt"]).toBeUndefined();
  expect(Object.keys(manifest.files).sort()).toEqual([
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

  const graph = JSON.parse(read(join(bp, "t1", "graph.json")));
  expect(graph.stats.docs).toBe(10);

  // generated section appended to index.md; preamble intact
  const idx = read(join(root, "index.md"));
  expect(idx.startsWith("---\nokf_version:")).toBe(true);
  expect(idx).toContain("hand-written and must survive");
  expect(idx).toContain("<!-- brainpick:begin index (hash:");
  expect(idx.replace(/\n+$/, "").endsWith("<!-- brainpick:end index -->")).toBe(true);

  // manifest records the post-write index hash
  expect(manifest.index_md.managed).toBe("section");
});

test("recompile is a no-op", async () => {
  const root = copyBundle();
  await runCompile(root);
  const before = snapshot(root);
  const result = await runCompile(root);
  expect(result.changed).toBe(false);
  expect(snapshot(root)).toEqual(before); // byte-stable, seq untouched
});

test("edit bumps seq and updates", async () => {
  const root = copyBundle();
  await runCompile(root);
  writeFileSync(
    join(root, "uusi.md"),
    "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n",
    "utf8",
  );
  const result = await runCompile(root);
  expect(result.changed).toBe(true);

  const manifest = JSON.parse(read(join(root, ".brainpick", "manifest.json")));
  expect(manifest.seq).toBe(2);
  expect(manifest.files["uusi.md"]).toBeDefined();
  expect(read(join(root, "index.md"))).toContain("- [Uusi](uusi.md) — New rock.");
});

test("check-fresh", async () => {
  const root = copyBundle();
  expect(checkFresh(root).fresh).toBe(false); // never compiled
  await runCompile(root);
  expect(checkFresh(root).fresh).toBe(true);

  writeFileSync(join(root, "kuu.md"), "---\ntype: Concept\n---\n\n# Kuu\n", "utf8");
  const verdict = checkFresh(root);
  expect(verdict.fresh).toBe(false);
  expect(verdict.reason).toContain("brainpick compile");
});

test("full recompile matches incremental", async () => {
  const root = copyBundle();
  await runCompile(root);
  const incremental = readFileSync(join(root, ".brainpick", "t1", "graph.json"));
  const result = await runCompile(root, true);
  expect(readFileSync(join(root, ".brainpick", "t1", "graph.json"))).toEqual(incremental);
  expect(result.seq).toBe(1); // full no-op does not bump seq
});

test("tier-status-only transition rewrites the manifest without spending a seq", async () => {
  // A manifest whose tiers differ (e.g. written by the Python engine with T2
  // fresh) is rewritten to this engine's tiers — same seq, changed=true —
  // exactly like the Python engine with the vectors module off.
  const root = copyBundle();
  await runCompile(root);
  const manifestPath = join(root, ".brainpick", "manifest.json");
  const manifest = JSON.parse(read(manifestPath));
  manifest.tiers.t2 = "fresh";
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const result = await runCompile(root);
  expect(result.changed).toBe(true);
  expect(result.seq).toBe(1); // no artifact changed — seq not spent
  expect(JSON.parse(read(manifestPath)).tiers).toEqual({ t1: "fresh", t2: "off", t3: "off" });
  expect((await runCompile(root)).changed).toBe(false); // and now it settles
});

test("delta carries cause paths and seq after a change", async () => {
  const root = copyBundle();
  await runCompile(root);
  unlinkSync(join(root, "komeetta.md"));
  const result = await runCompile(root);
  expect(result.delta).not.toBeNull();
  expect(result.delta!.seq).toBe(2);
  expect(result.delta!.cause).toEqual({ paths: ["index.md", "komeetta.md"], tier: "t1" });
  expect(result.delta!.removed.nodes).toEqual(["komeetta.md"]);
});
