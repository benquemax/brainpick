/** MCP tool payloads (spec/70): budget shaping, forgiving resolution, guarded
 * writes, base_sha conflicts (the twin of packages/python/tests/test_mcp_tools.py). */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { loadConfig } from "../src/config";
import { sha256Hex } from "../src/core/canonical";
import {
  neighborsPayload,
  overviewPayload,
  readPayload,
  searchPayload,
  showPayload,
  tokensOf,
  writePayload,
} from "../src/mcp";
import { ServeState } from "../src/serve/state";
import { cleanup, copyBundle, prependPath, stageFakeHenxels, stageT3Export, tempDir } from "./helpers";

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n# Uusi kivi\n\nNear [Kuu](kuu.md).\n";
const KUU_REWRITE =
  "---\ntype: Concept\ntags: [kuu]\ntimestamp: 2026-06-15T08:30:00Z\n---\n\n" +
  "# Kuu\n\nThe moon pulls the tides of [Maa](maa.md), rewritten.\n";

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore" },
  );
}

const savedPath = process.env["PATH"];
afterEach(() => {
  process.env["PATH"] = savedPath;
  cleanup();
});

async function makeState(root: string): Promise<ServeState> {
  const state = new ServeState(root, loadConfig(root));
  await state.load();
  return state;
}

function treeDocCount(result: Record<string, unknown>): number {
  return (result["tree"] as Array<{ docs: unknown[] }>).reduce((n, g) => n + g.docs.length, 0);
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

test("tokensOf is chars over four", () => {
  const payload = { text: "a".repeat(400) };
  // Python len(json.dumps(payload, ensure_ascii=False)) // 4 — note the default
  // ", " / ": " separators: '{"text": "' + 400 a's + '"}' = 412 chars.
  expect(tokensOf(payload)).toBe(103);
});

test("overview counts and tree", async () => {
  const root = copyBundle();
  const result = overviewPayload(await makeState(root));
  const counts = result["counts"] as Record<string, number>;
  expect(counts["docs"]).toBe(10);
  expect(counts["ghosts"]).toBe(1);
  expect(result["bundle"]).toBe("kotiaurinko");
  expect((result["tree"] as Array<{ group: string }>).map((g) => g.group)).toEqual(["concepts", "saaret"]);
  expect(result["truncated"]).toBe(false);
  expect(result["hint"]).toBeTruthy();
});

test("overview top_ghosts is the write-next queue", async () => {
  const root = copyBundle();
  const result = overviewPayload(await makeState(root));
  expect(result["top_ghosts"]).toEqual([{ target: "olematon.md", count: 1 }]);
});

test("overview budget trims tree", async () => {
  const state = await makeState(copyBundle());
  const full = overviewPayload(state);
  const slim = overviewPayload(state, 80);
  expect(slim["truncated"]).toBe(true);
  expect(treeDocCount(slim)).toBeLessThan(treeDocCount(full));
});

test("search hits have why not bodies", async () => {
  const result = await searchPayload(await makeState(copyBundle()), "aurinko");
  const hits = result["hits"] as Array<Record<string, unknown>>;
  expect(new Set(hits.map((h) => h["path"]))).toEqual(
    new Set(["aurinko.md", "komeetta.md", "planeetat.md", "yksinainen.md"]),
  );
  expect(new Set(Object.keys(hits[0]!))).toEqual(new Set(["path", "title", "description", "score", "why"]));
  expect(result["used_modes"]).toEqual(["keyword"]);
  expect(result["degraded_from"]).toBe("semantic"); // auto without T2 says so (spec/30)
  expect(result["truncated"]).toBe(false);
});

test("search budget trims hits", async () => {
  const state = await makeState(copyBundle());
  const full = await searchPayload(state, "aurinko");
  const slim = await searchPayload(state, "aurinko", "auto", 8, 40);
  expect(slim["truncated"]).toBe(true);
  const slimHits = (slim["hits"] as unknown[]).length;
  expect(slimHits).toBeGreaterThanOrEqual(1);
  expect(slimHits).toBeLessThan((full["hits"] as unknown[]).length);
  expect(slim["hint"]).toContain("budget");
});

test("search forgiving modes", async () => {
  const state = await makeState(copyBundle());
  const unknown = await searchPayload(state, "aurinko", "banana");
  expect(unknown["used_modes"]).toEqual(["keyword"]);
  expect(unknown["degraded_from"]).toBe("semantic"); // banana → auto → degraded without T2
  expect(unknown["hint"]).toContain("fell back to auto");
  const keyword = await searchPayload(state, "aurinko", "keyword");
  expect(keyword["degraded_from"]).toBeNull();
  const degraded = await searchPayload(state, "aurinko", "semantic");
  expect(degraded["used_modes"]).toEqual(["keyword"]);
  expect(degraded["degraded_from"]).toBe("semantic");
});

test("search semantic hits via mock vectors", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[models.embedding]\nkind = "mock"\n', "utf8");
  const state = await makeState(root);
  expect((state.manifest["tiers"] as Record<string, string>)["t2"]).toBe("fresh");
  const semantic = await searchPayload(state, "kuu vuorovesi maa", "semantic");
  expect(semantic["used_modes"]).toEqual(["semantic"]);
  expect(semantic["degraded_from"]).toBeNull();
  const hits = semantic["hits"] as Array<Record<string, unknown>>;
  expect(hits.length).toBeGreaterThan(0);
  for (const h of hits) {
    expect(new Set(Object.keys(h))).toEqual(new Set(["path", "title", "description", "score", "why"]));
  }
  const fused = await searchPayload(state, "aurinko", "auto");
  expect(fused["used_modes"]).toEqual(["keyword", "semantic"]);
  expect(fused["degraded_from"]).toBeNull();
});

test("read resolution ladder", async () => {
  const state = await makeState(copyBundle());
  expect(readPayload(state, "kuu.md")["path"]).toBe("kuu.md");
  expect(readPayload(state, "kuu")["path"]).toBe("kuu.md"); // stem
  expect(readPayload(state, "komeeta")["path"]).toBe("komeetta.md"); // fuzzy title
  const missing = readPayload(state, "olematon-zzz");
  expect(missing["error"]).toBeTruthy();
  expect((missing["suggestions"] as unknown[]).length).toBeGreaterThan(0);
});

test("read disambiguation", async () => {
  const root = copyBundle();
  for (const [rel, title] of [
    ["koru/helmi.md", "Helmi koru"],
    ["meri/helmi.md", "Helmi meri"],
  ] as const) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(
      join(root, rel),
      `---\ntype: Concept\ntitle: ${title}\ndescription: A pearl.\n---\n\n# ${title}\n\nSee [Kuu](/kuu.md).\n`,
      "utf8",
    );
  }
  const state = await makeState(root);
  const result = readPayload(state, "helmi");
  expect(new Set((result["disambiguation"] as Array<{ path: string }>).map((c) => c.path))).toEqual(
    new Set(["koru/helmi.md", "meri/helmi.md"]),
  );
  expect(result["hint"]).toBeTruthy();
});

test("read full doc shape", async () => {
  const result = readPayload(await makeState(copyBundle()), "planeetat.md");
  expect(result["truncated"]).toBe(false);
  expect(result["content"]).toContain("Every world orbits");
  expect(result["outline"]).toEqual(["# Planeetat"]);
  const frontmatter = result["frontmatter"] as Record<string, unknown>;
  expect(frontmatter["type"]).toBe("Concept");
  expect(frontmatter["timestamp"]).toBe("2026-06-01T00:00:00Z");
  const neighbors = result["neighbors"] as { in: Array<{ path: string }>; out: Array<{ path: string }> };
  expect(new Set(neighbors.out.map((n) => n.path))).toEqual(new Set(["aurinko.md", "maa.md"]));
  expect(new Set(neighbors.in.map((n) => n.path))).toEqual(new Set(["aurinko.md", "index.md", "maa.md"]));
});

test("read sections and budget", async () => {
  const root = copyBundle();
  writeFileSync(
    join(root, "osiot.md"),
    "---\ntype: Concept\ntitle: Osiot\ndescription: A sectioned doc.\n---\n\n" +
      "# Osiot\n\nIntro, see [Kuu](kuu.md).\n\n" +
      "## Alpha\n\n" +
      "Alpha text. ".repeat(120) +
      "\n\n## Beta\n\nBeta text.\n",
    "utf8",
  );
  const state = await makeState(root);
  const full = readPayload(state, "osiot.md");
  expect(full["outline"]).toEqual(["# Osiot", "## Alpha", "## Beta"]);
  const onlyBeta = readPayload(state, "osiot.md", ["Beta"]);
  expect(onlyBeta["content"]).toContain("Beta text.");
  expect(onlyBeta["content"]).not.toContain("Alpha text.");
  const slim = readPayload(state, "osiot.md", null, 60);
  expect(slim["truncated"]).toBe(true);
  expect((slim["content"] as string).length).toBeLessThan((full["content"] as string).length);
  expect(slim["hint"]).toContain("sections");
});

test("neighbors depth and degrade", async () => {
  const root = copyBundle();
  // graph = "off": no T3 export exists, so layer=entities degrades to links —
  // the algorithmic default would otherwise serve a real (derived) entity layer.
  writeFileSync(join(root, "brainpick.toml"), '[modules]\ngraph = "off"\n', "utf8");
  const state = await makeState(root);
  const one = neighborsPayload(state, "maa.md");
  expect(one["center"]).toBe("maa.md");
  const onePaths = new Set((one["nodes"] as Array<{ path: string }>).map((n) => n.path));
  expect(onePaths).toEqual(new Set(["maa.md", "kuu.md", "planeetat.md", "index.md"]));
  const center = (one["nodes"] as Array<{ path: string; distance: number }>).find((n) => n.path === "maa.md")!;
  expect(center.distance).toBe(0);
  const two = neighborsPayload(state, "maa.md", 2);
  const twoPaths = new Set((two["nodes"] as Array<{ path: string }>).map((n) => n.path));
  expect(twoPaths.has("aurinko.md")).toBe(true);
  expect(twoPaths.has("saaret/atolli.md")).toBe(true);
  const clamped = neighborsPayload(state, "maa.md", 9); // forgiving: clamps to 3
  const depth3 = neighborsPayload(state, "maa.md", 3);
  expect(new Set((clamped["nodes"] as Array<{ path: string }>).map((n) => n.path))).toEqual(
    new Set((depth3["nodes"] as Array<{ path: string }>).map((n) => n.path)),
  );
  const degraded = neighborsPayload(state, "maa.md", 1, "entities");
  expect(degraded["degraded_from"]).toBe("entities");
  const edges = degraded["edges"] as Array<Record<string, unknown>>;
  expect(edges.length).toBeGreaterThan(0);
  for (const e of edges) {
    expect(new Set(Object.keys(e))).toEqual(new Set(["source", "target", "kind"]));
  }
});

async function stateWithT3(root: string): Promise<ServeState> {
  const state = await makeState(root);
  stageT3Export(root);
  state.reloadArtifacts();
  return state;
}

test("neighbors entities layer over staged export", async () => {
  const state = await stateWithT3(copyBundle());
  const result = neighborsPayload(state, "kuu", 1, "entities"); // forgiving stem resolution
  expect(result["center"]).toBe("kuu.md");
  expect(result["degraded_from"]).toBeNull();
  const nodes = result["nodes"] as Array<{ id: string; distance: number; source_docs: string[] }>;
  expect(new Set(nodes.map((n) => n.id))).toEqual(new Set(["kuu", "maa", "vuorovesi", "planeetat"]));
  const kuu = nodes.find((n) => n.id === "kuu")!;
  expect(new Set(Object.keys(kuu))).toEqual(new Set(["id", "name", "description", "distance", "source_docs"]));
  expect(kuu.distance).toBe(0);
  const grounding = new Set<string>(nodes.flatMap((n) => n.source_docs));
  expect(grounding).toEqual(new Set(["aurinko.md", "kuu.md", "maa.md", "planeetat.md"]));
  expect(result["edges"]).toContainEqual({ src: "kuu", dst: "vuorovesi" });
});

test("neighbors both layer overlays tagged", async () => {
  const state = await stateWithT3(copyBundle());
  const result = neighborsPayload(state, "kuu.md", 1, "both");
  expect(result["degraded_from"]).toBeNull();
  const nodes = result["nodes"] as Array<Record<string, unknown>>;
  expect(new Set(nodes.map((n) => n["layer"]))).toEqual(new Set(["links", "entities"]));
  expect(nodes.some((n) => n["layer"] === "links" && "path" in n)).toBe(true);
  expect(nodes.some((n) => n["layer"] === "entities" && "id" in n)).toBe(true);
});

test("search graph mode over staged export", async () => {
  const state = await stateWithT3(copyBundle());
  const result = await searchPayload(state, "what orbits the star", "graph", 4);
  const hits = result["hits"] as Array<{ path: string; why: string }>;
  expect(new Set(hits.map((h) => h.path))).toEqual(
    new Set(["aurinko.md", "komeetta.md", "maa.md", "planeetat.md"]),
  );
  expect(result["used_modes"]).toEqual(["graph"]);
  expect(result["degraded_from"]).toBeNull();
  expect(hits.every((h) => h.why.includes("entity graph"))).toBe(true);
});

test("write rejects traversal", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const result = await writePayload(state, "../ulos.md", "# Ulos\n");
  expect(result["ok"]).toBe(false);
  expect(result["instruction"]).toContain("bundle");
  expect(exists(join(root, "..", "ulos.md"))).toBe(false);
});

test("write rejects non-kebab", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const result = await writePayload(state, "Kuun Vaiheet.md", "# Kuun vaiheet\n");
  expect(result["ok"]).toBe(false);
  expect(result["instruction"]).toContain("kuun-vaiheet.md");
  expect(exists(join(root, "Kuun Vaiheet.md"))).toBe(false);
});

test("write refuses clobber on create", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const result = await writePayload(state, "kuu.md", "# Kaappaus\n");
  expect(result["ok"]).toBe(false);
  expect(result["instruction"]).toContain("replace");
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toContain("tides");
});

test("write happy path bumps seq and timestamp", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const queue = state.subscribe();
  const result = await writePayload(state, "uusi-kivi", NEW_DOC);
  expect(result["ok"]).toBe(true);
  expect(result["path"]).toBe("uusi-kivi.md");
  expect(result["seq"]).toBe(2);
  expect(state.seq).toBe(2);
  const text = readFileSync(join(root, "uusi-kivi.md"), "utf8");
  expect(text).toMatch(/^timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  expect(queue.drain().map(([name]) => name)).toContain("graph.delta"); // went out the shared path
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("- [Uusi kivi](uusi-kivi.md)");
});

test("write append_section", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const result = await writePayload(state, "kuu.md", "## Nousuvesi\n\nSpring tides.\n", "append_section");
  expect(result["ok"]).toBe(true);
  const text = readFileSync(join(root, "kuu.md"), "utf8");
  expect(text).toContain("## Nousuvesi");
  expect(text).toContain("The moon pulls"); // the original body survives
});

test("write gate refusal", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const result = await writePayload(state, "uusi.md", "# X\n", "create", {
    refusal: 'writes are off — set [serve] writes = "guarded"',
  });
  expect(result["ok"]).toBe(false);
  expect(result["instruction"]).toContain("guarded");
  expect(exists(join(root, "uusi.md"))).toBe(false);
});

test("write henxels violation restores", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "henxels.yaml"), "henxels: []\n", "utf8");
  const bin = stageFakeHenxels(join(tempDir(), "bin"), "kebab-case or bust");
  process.env["PATH"] = prependPath(savedPath, bin);
  const state = await makeState(root);

  const created = await writePayload(state, "uusi.md", "# X\n");
  expect(created["ok"]).toBe(false);
  expect((created["instruction"] as string).trim()).toBe("kebab-case or bust");
  expect(exists(join(root, "uusi.md"))).toBe(false); // created file rolled back

  const replaced = await writePayload(state, "kuu.md", "# Kuu\n\nClobbered.\n", "replace");
  expect(replaced["ok"]).toBe(false);
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toContain("tides"); // bytes restored
  expect(state.seq).toBe(1);
});

test("write henxels missing warns", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "henxels.yaml"), "henxels: []\n", "utf8");
  const empty = join(tempDir(), "emptybin");
  mkdirSync(empty, { recursive: true });
  process.env["PATH"] = empty;
  const state = await makeState(root);
  const result = await writePayload(state, "uusi-kivi.md", NEW_DOC);
  expect(result["ok"]).toBe(true);
  expect(result["warning"]).toBeTruthy();
  expect(statSync(join(root, "uusi-kivi.md")).isFile()).toBe(true);
});

// -- base_sha (spec/70 optimistic concurrency, detection half) ----------------------

test("write with stale base_sha conflicts without writing", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const before = readFileSync(join(root, "kuu.md"));
  const result = await writePayload(state, "kuu.md", "# Kuu\n\nRewritten.\n", "replace", {
    baseSha: "0".repeat(64),
  });
  expect(result["ok"]).toBe(false);
  expect(result["conflict"]).toBe(true);
  expect(result["current_sha"]).toBe(sha256Hex(before));
  expect(result["theirs"]).toContain("tides");
  expect(result["instruction"]).toContain("re-read");
  expect(result["merged"]).toBeUndefined(); // no git base, no model → the manual path
  expect(readFileSync(join(root, "kuu.md"))).toEqual(before); // nothing written
  expect(state.seq).toBe(1);
});

test("write with matching base_sha proceeds", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const currentSha = sha256Hex(readFileSync(join(root, "kuu.md")));
  const result = await writePayload(state, "kuu.md", "# Kuu\n\nRewritten, honestly.\n", "replace", {
    baseSha: currentSha,
  });
  expect(result["ok"]).toBe(true);
  expect(result["seq"]).toBe(2);
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toContain("Rewritten, honestly.");
});

test("write with base_sha against a vanished doc conflicts", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const result = await writePayload(state, "poistettu.md", "# Uusi\n", "replace", {
    baseSha: "a".repeat(64),
  });
  expect(result["ok"]).toBe(false);
  expect(result["conflict"]).toBe(true);
  expect(result["current_sha"]).toBeNull();
  expect(result["theirs"]).toBeNull();
  expect(exists(join(root, "poistettu.md"))).toBe(false);
});

test("conflict theirs is budget-shaped", async () => {
  const root = copyBundle();
  writeFileSync(
    join(root, "pitka.md"),
    "---\ntype: Concept\ntitle: Pitka\ndescription: Long.\n---\n\n# Pitka\n\n" + "sana ".repeat(3000),
    "utf8",
  );
  const state = await makeState(root);
  const result = await writePayload(state, "pitka.md", "# Pitka\n", "replace", {
    baseSha: "0".repeat(64),
    budgetTokens: 200,
  });
  expect(result["conflict"]).toBe(true);
  expect(result["truncated"]).toBe(true);
  const theirs = result["theirs"] as string;
  expect(theirs.endsWith(" …")).toBe(true);
  expect(theirs.length).toBeLessThan(3000 * 5);
  expect(result["current_sha"]).toBe(sha256Hex(readFileSync(join(root, "pitka.md")))); // retry key never trimmed
});

// -- the merge ladder on a stale write (spec/70): three-way | llm | manual ------------

test("conflict merged proposal from the configured model", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.local.toml"), '[models.extraction]\nkind = "mock"\n', "utf8");
  const state = await makeState(root);
  const result = await writePayload(state, "kuu.md", KUU_REWRITE, "replace", { baseSha: "0".repeat(64) });
  expect(result["conflict"]).toBe(true);
  const merged = result["merged"] as { strategy: string; content: string };
  expect(merged.strategy).toBe("llm"); // no git base → the two-input model merge
  expect(merged.content).toBe(KUU_REWRITE); // MockChat echoes the YOURS section
  expect(result["hint"]).toContain("proposal");
  expect(readFileSync(join(root, "kuu.md"), "utf8")).not.toContain("rewritten"); // never applied
});

test("conflict three-way from a git base", async () => {
  const root = copyBundle();
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const baseBytes = readFileSync(join(root, "kuu.md"));
  const baseText = baseBytes.toString("utf8");

  // A foreign writer edits the tides line after our writer read the doc.
  const theirs = baseText.replaceAll(
    "The moon pulls the tides of [Maa](maa.md).",
    "The moon pulls the spring tides of [Maa](maa.md).",
  );
  writeFileSync(join(root, "kuu.md"), theirs, "utf8");

  const state = await makeState(root);
  const yours = baseText + "\n## Vaiheet\n\nNew moon, then full moon.\n";
  const result = await writePayload(state, "kuu.md", yours, "replace", { baseSha: sha256Hex(baseBytes) });
  expect(result["conflict"]).toBe(true);
  const merged = result["merged"] as { strategy: string; content: string };
  expect(merged.strategy).toBe("three-way"); // git HEAD supplied the verified base
  expect(merged.content).toContain("spring tides"); // their edit survives
  expect(merged.content).toContain("## Vaiheet"); // your edit survives
  expect(readFileSync(join(root, "kuu.md"), "utf8")).not.toContain("## Vaiheet"); // proposal only
});

// -- brain_show (spec/95): the 6th tool — ephemeral presentations, not write-gated --

test("showPayload reports shown, dropped, seq, and a hint", async () => {
  const state = await makeState(copyBundle());
  const queue = state.subscribe();
  const result = showPayload(state, ["aurinko.md", "ei-ole"], null, null, "hi");
  expect(result["ok"]).toBe(true);
  expect(result["shown"]).toBe(1);
  expect(result["dropped"]).toEqual(["ei-ole"]);
  expect(result["seq"]).toBe(1);
  // the exact hint — pinned so it stays byte-identical to the Python twin (parity)
  expect(result["hint"]).toBe(
    "showing 1 node(s) live in every open UI — " +
      "call brain_show again to change it, or with clear:true to dismiss. (dropped 1: ei-ole)",
  );
  expect(queue.drain().map((e) => e[0])).toEqual(["brain.show"]); // the open UIs light up
  expect(state.seq).toBe(1); // never writes / compiles
});

test("showPayload clear has a dedicated hint", async () => {
  const state = await makeState(copyBundle());
  const result = showPayload(state, null, null, null, null, true);
  expect(result).toEqual({
    ok: true,
    shown: 0,
    dropped: [],
    seq: 1,
    hint: "cleared — every open UI dropped its spotlight and caption.",
  });
});
