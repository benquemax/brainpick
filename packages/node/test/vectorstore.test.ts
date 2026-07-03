/** LanceDB store (spec/30 layout): t2/lancedb/chunks.lance, upserts, cosine
 * queries (the twin of packages/python/tests/test_t2_store.py).
 *
 * skipIf guards machines where the optional native binding failed to install;
 * `npm install` brings the prebuilt napi, so on a healthy checkout every test
 * here runs (and the conformance mock-query cases hard-fail — never skip — if
 * lancedb is truly broken).
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { lancedbAvailable, VectorStore, type ChunkRow } from "../src/vectorstore";
import { cleanup, tempDir } from "./helpers";

afterEach(cleanup);

const available = await lancedbAvailable();

function row(chunkId: string, vector: number[], doc = "a.md", ordinal = 0, text = "t"): ChunkRow {
  return { id: chunkId, doc, ord: ordinal, text, vector };
}

describe.skipIf(!available)("vector store", () => {
  test("lancedbAvailable reports true here", () => {
    expect(available).toBe(true);
  });

  test("round-trip layout and cosine query", async () => {
    const dir = tempDir();
    const store = new VectorStore(join(dir, "t2", "lancedb"));
    await store.replaceAll(
      [
        row("a.md#x~0", [1.0, 0.0, 0.0, 0.0]),
        row("b.md#y~0", [0.0, 1.0, 0.0, 0.0], "b.md"),
        row("c.md#z~0", [0.7, 0.7, 0.0, 0.0], "c.md"),
      ],
      4,
    );
    // the spec layout: t2/lancedb/chunks.lance
    expect(statSync(join(dir, "t2", "lancedb", "chunks.lance")).isDirectory()).toBe(true);

    const hits = await store.queryVectors([1.0, 0.05, 0.0, 0.0], 2);
    expect(hits.map((h) => h["id"])).toEqual(["a.md#x~0", "c.md#z~0"]);
    for (const key of ["id", "doc", "ord", "text"]) expect(hits[0]).toHaveProperty(key);
    expect(await store.existingIds()).toEqual(new Set(["a.md#x~0", "b.md#y~0", "c.md#z~0"]));
  });

  test("store survives reopen", async () => {
    const path = join(tempDir(), "lancedb");
    await new VectorStore(path).replaceAll([row("a.md#x~0", [1.0, 0.0])], 2);
    const fresh = new VectorStore(path);
    expect(await fresh.existingIds()).toEqual(new Set(["a.md#x~0"]));
    expect((await fresh.queryVectors([1.0, 0.0], 1)).map((h) => h["id"])).toEqual(["a.md#x~0"]);
  });

  test("upsert deletes gone ids and replaces changed", async () => {
    const store = new VectorStore(join(tempDir(), "lancedb"));
    await store.replaceAll(
      [row("keep~0", [1.0, 0.0]), row("change~0", [0.0, 1.0]), row("gone~0", [0.5, 0.5])],
      2,
    );
    await store.upsert(
      [row("change~0", [1.0, 1.0]), row("new~0", [0.0, 0.5])],
      new Set(["gone~0", "change~0"]),
      2,
    );
    expect(await store.existingIds()).toEqual(new Set(["keep~0", "change~0", "new~0"]));
    const [best] = await store.queryVectors([1.0, 1.0], 1);
    expect(best!["id"]).toBe("change~0"); // the new vector answers, not the old one
  });

  test("replaceAll wipes previous vectors", async () => {
    const store = new VectorStore(join(tempDir(), "lancedb"));
    await store.replaceAll([row("old~0", [1.0, 0.0])], 2);
    await store.replaceAll([row("new~0", [1.0, 0.0, 0.0])], 3); // dim change: full rebuild
    expect(await store.existingIds()).toEqual(new Set(["new~0"]));
  });

  test("query on missing table returns empty", async () => {
    const store = new VectorStore(join(tempDir(), "nowhere"));
    expect(await store.queryVectors([1.0, 0.0], 3)).toEqual([]);
    expect(await store.existingIds()).toEqual(new Set());
  });

  test("ids with quotes delete safely", async () => {
    const store = new VectorStore(join(tempDir(), "lancedb"));
    const tricky = "a.md#it's~0";
    await store.replaceAll([row(tricky, [1.0, 0.0]), row("b~0", [0.0, 1.0])], 2);
    await store.upsert([], new Set([tricky]), 2);
    expect(await store.existingIds()).toEqual(new Set(["b~0"]));
  });
});
