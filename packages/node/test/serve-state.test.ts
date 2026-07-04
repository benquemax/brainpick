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
