/** ServeState: artifact loading, the delta ring + replay, broadcast, manifest rescans
 * (the twin of packages/python/tests/test_serve_state.py). */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { loadConfig } from "../src/config";
import { resolveDoc, ServeState, suggestPaths, type ServeEvent } from "../src/serve/state";
import { recompileAndBroadcast } from "../src/serve/watcher";
import { cleanup, copyBundle, stageT3Export } from "./helpers";

afterEach(cleanup);

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n";

async function makeState(root: string): Promise<ServeState> {
  const state = new ServeState(root, loadConfig(root));
  await state.load();
  return state;
}

test("load compiles and holds artifacts", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  expect(state.seq).toBe(1);
  expect(state.graph.stats.docs).toBe(10);
  expect(state.records.some((r) => r.path === "kuu.md")).toBe(true);
  expect(state.manifest["tiers"]).toEqual({ t1: "fresh", t2: "off", t3: "off" });
});

test("kg absent by default", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  expect(state.kg).toBeNull(); // no T3 export → unavailable, and graphFn signals it
  expect(state.graphFn()).toBeNull();
  expect((state.manifest["tiers"] as Record<string, string>)["t3"]).toBe("off");
});

test("kg loads from a staged export", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  stageT3Export(root);
  state.reloadArtifacts(); // re-read: the flipped manifest + the staged export
  expect(state.kg).not.toBeNull();
  expect((state.manifest["tiers"] as Record<string, string>)["t3"]).toBe("fresh");
  const run = state.graphFn()!;
  const hits = run("vuorovesi", 8);
  expect(new Set(hits.map((h) => h.path))).toEqual(new Set(["kuu.md", "aurinko.md", "maa.md"]));
  expect(hits.every((h) => h.source === "graph")).toBe(true);
});

test("applyCompileResult updates state and ring", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
  state.applyCompileResult(await runCompile(root));
  expect(state.seq).toBe(2);
  expect(state.ring.map(([seq]) => seq)).toEqual([2]);
  expect(state.graph.nodes.some((n) => n.id === "uusi.md")).toBe(true);
});

test("recompileAndBroadcast event order", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const queue = state.subscribe();
  writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
  const result = await recompileAndBroadcast(state);
  expect(result.changed).toBe(true);
  const events = queue.drain();
  expect(events.map(([name]) => name)).toEqual(["compile.status", "graph.delta", "compile.status"]);
  const [running, delta, done] = events.map(([, , data]) => JSON.parse(data) as Record<string, unknown>);
  expect(running).toEqual({ seq: 2, state: "running", tier: "t1" });
  expect(done).toEqual({ seq: 2, state: "done", tier: "t1" });
  expect(delta!["seq"]).toBe(2);
  expect((delta!["cause"] as { paths: string[] }).paths).toEqual(["index.md", "uusi.md"]);
  expect(events[1]![1]).toBe(2); // the SSE id equals seq
});

test("no-op recompile stays silent", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const queue = state.subscribe();
  const result = await recompileAndBroadcast(state);
  expect(result.changed).toBe(false);
  expect(queue.drain()).toEqual([]);
  expect(state.seq).toBe(1);
  expect(state.ring.length).toBe(0);
});

test("replay contiguous else snapshot", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
  state.applyCompileResult(await runCompile(root)); // seq 2
  writeFileSync(join(root, "uusi.md"), NEW_DOC + "\nMore rock.\n", "utf8");
  state.applyCompileResult(await runCompile(root)); // seq 3

  const replay = state.replayEvents(1)!;
  expect(replay.map(([, id]) => id)).toEqual([2, 3]);
  expect(state.replayEvents(3)).toEqual([]); // nothing missed
  expect(state.replayEvents(2)!.map((e: ServeEvent) => e[1])).toEqual([3]);
  expect(state.replayEvents(0)).toBeNull(); // seq 1 predates the ring -> snapshot
  expect(state.replayEvents(99)).toBeNull(); // an id from the future -> snapshot
});

test("rescanFromManifest emits delta for foreign compiles", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  const queue = state.subscribe();
  writeFileSync(join(root, "uusi.md"), NEW_DOC, "utf8");
  await runCompile(root); // "another process" compiled behind our back
  state.rescanFromManifest();
  expect(state.seq).toBe(2);
  const events = queue.drain();
  expect(events.length).toBe(1);
  const [name, eventId, data] = events[0]!;
  expect(name).toBe("graph.delta");
  expect(eventId).toBe(2);
  const delta = JSON.parse(data) as { cause: { paths: string[] }; added: { nodes: Array<{ id: string }> } };
  expect(delta.cause.paths).toContain("uusi.md");
  expect(delta.added.nodes.some((n) => n.id === "uusi.md")).toBe(true);
  // a second rescan without a newer manifest is a no-op
  state.rescanFromManifest();
  expect(queue.drain()).toEqual([]);
});

test("suggestPaths fuzzy", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  expect(suggestPaths(state.records, "kuu")[0]).toBe("kuu.md");
  expect(suggestPaths(state.records, "atolli")[0]).toBe("saaret/atolli.md");
  expect(suggestPaths(state.records, "a").length).toBeLessThanOrEqual(5);
});

test("resolveDoc ladder", () => {
  const records = [
    { path: "kuu.md", title: "Kuu" },
    { path: "saaret/atolli.md", title: "Atolli" },
    { path: "komeetta.md", title: "Komeetta" },
  ];
  expect(resolveDoc(records, "kuu.md")).toEqual(["ok", records[0]]); // exact path
  expect(resolveDoc(records, "kuu")).toEqual(["ok", records[0]]); // path minus extension
  expect(resolveDoc(records, "atolli")).toEqual(["ok", records[1]]); // unique stem
  expect(resolveDoc(records, "komeeta")).toEqual(["ok", records[2]]); // fuzzy title typo
  const [status, suggestions] = resolveDoc(records, "zzz-ei-ole");
  expect(status).toBe("miss");
  expect(Array.isArray(suggestions)).toBe(true);
});

test("resolveDoc ambiguous stem", () => {
  const records = [
    { path: "koru/helmi.md", title: "Helmi koru" },
    { path: "meri/helmi.md", title: "Helmi meri" },
  ];
  const [status, candidates] = resolveDoc(records, "helmi");
  expect(status).toBe("ambiguous");
  expect(new Set((candidates as Array<{ path: string }>).map((c) => c.path))).toEqual(
    new Set(["koru/helmi.md", "meri/helmi.md"]),
  );
});

// -- presentations (spec/95): brain_show resolves + broadcasts an ephemeral view ----

test("present resolves docs, defaults focus, and broadcasts brain.show", async () => {
  const state = await makeState(copyBundle());
  const queue = state.subscribe();
  const [presentation, dropped] = state.present(["aurinko.md", "kuu"], null, null, "the star");
  expect(dropped).toEqual([]);
  expect(presentation).toEqual({
    annotation: "the star",
    focus: "aurinko.md", // defaults to the first resolved node
    mode: null,
    nodes: ["aurinko.md", "kuu.md"], // "kuu" fuzzy-resolves like brain_read
    seq: 1,
  });
  // broadcast as brain.show carrying NO SSE id — so it never lands in the delta
  // ring / Last-Event-ID replay (spec/60)
  const events = queue.drain();
  expect(events.map((e) => e[0])).toEqual(["brain.show"]);
  const [, eventId, data] = events[0]!;
  expect(eventId).toBeNull();
  expect(JSON.parse(data)).toEqual(presentation);
  expect(state.ring).toEqual([]); // brain.show is excluded from the delta ring
});

test("present seq is monotonic and separate from the manifest seq", async () => {
  const state = await makeState(copyBundle());
  expect(state.seq).toBe(1);
  const [first] = state.present(["aurinko.md"]);
  const [second] = state.present(["maa.md"], null, "brain");
  expect([first["seq"], second["seq"]]).toEqual([1, 2]);
  expect(second["mode"]).toBe("brain");
  expect(state.seq).toBe(1); // no compile, no delta — the manifest seq is untouched
});

test("present drops unresolved node tokens and lists them", async () => {
  const state = await makeState(copyBundle());
  const [presentation, dropped] = state.present(["aurinko.md", "olematon-kappale"]);
  expect(presentation["nodes"]).toEqual(["aurinko.md"]);
  expect(dropped).toEqual(["olematon-kappale"]);
  expect(presentation["focus"]).toBe("aurinko.md");
});

test("present resolves entity names over the T3 export", async () => {
  const root = copyBundle();
  const state = await makeState(root);
  stageT3Export(root);
  state.reloadArtifacts();
  const [presentation, dropped] = state.present(["Vuorovesi", "kuu.md"], "maa");
  expect(dropped).toEqual([]);
  expect(presentation["nodes"]).toEqual(["vuorovesi", "kuu.md"]); // entity slug + doc path
  expect(presentation["focus"]).toBe("maa.md"); // explicit focus resolves too
});

test("present clear and an empty call broadcast the cleared shape", async () => {
  const state = await makeState(copyBundle());
  state.present(["aurinko.md"]); // seq 1
  const [cleared, dropped] = state.present(null, null, null, null, true); // seq 2 — explicit clear
  expect(dropped).toEqual([]);
  expect(cleared).toEqual({ annotation: null, focus: null, mode: null, nodes: [], seq: 2 });
  const [empty] = state.present(); // seq 3 — an otherwise-empty call also clears
  expect(empty).toEqual({ annotation: null, focus: null, mode: null, nodes: [], seq: 3 });
  expect(state.presentation).toEqual(empty); // the held presentation is the latest
});

test("present deduplicates ids and ignores blank tokens", async () => {
  const state = await makeState(copyBundle());
  const [presentation, dropped] = state.present(["aurinko.md", "aurinko", "", "  "]);
  expect(presentation["nodes"]).toEqual(["aurinko.md"]); // "aurinko" stems to the same id
  expect(dropped).toEqual([]);
});
