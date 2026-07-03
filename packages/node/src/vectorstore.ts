/** The LanceDB chunk store (spec/30, layout normative): t2/lancedb/chunks.lance.
 *
 * Import-guarded — @lancedb/lancedb ships as an optionalDependency, and every
 * entry point degrades with an instruction instead of a module-not-found
 * crash. The on-disk Lance dataset is the cross-runtime interoperability
 * point: either engine may compile it, either may query it.
 */
import { mkdirSync, statSync } from "node:fs";

import type { Connection, Table } from "@lancedb/lancedb";
import type { Schema } from "apache-arrow";

import { cmpStr, sha256Hex } from "./core/canonical";

export const TABLE = "chunks";
const DELETE_BATCH = 500; // keep the SQL predicate bounded

/** lancedb is missing or the dataset is unreadable — message is an instruction. */
export class VectorStoreUnavailable extends Error {}

type LancedbModule = typeof import("@lancedb/lancedb");

let lancedbModule: LancedbModule | null | undefined;

async function importLancedb(): Promise<LancedbModule | null> {
  if (lancedbModule === undefined) {
    try {
      lancedbModule = await import("@lancedb/lancedb");
    } catch {
      lancedbModule = null; // absent or its native binding failed to load
    }
  }
  return lancedbModule;
}

export async function lancedbAvailable(): Promise<boolean> {
  return (await importLancedb()) !== null;
}

async function requireLancedb(): Promise<LancedbModule> {
  const mod = await importLancedb();
  if (mod === null) {
    throw new VectorStoreUnavailable(
      "@lancedb/lancedb is not installed — npm install @lancedb/lancedb to enable T2",
    );
  }
  return mod;
}

/** The spec/30 table layout: id/doc/ord/text + fixed-size float32 vector. */
async function chunkSchema(dim: number): Promise<Schema> {
  const arrow = await import("apache-arrow");
  return new arrow.Schema([
    new arrow.Field("id", new arrow.Utf8(), true),
    new arrow.Field("doc", new arrow.Utf8(), true),
    new arrow.Field("ord", new arrow.Int32(), true),
    new arrow.Field("text", new arrow.Utf8(), true),
    new arrow.Field(
      "vector",
      new arrow.FixedSizeList(dim, new arrow.Field("item", new arrow.Float32(), true)),
      true,
    ),
  ]);
}

function inPredicate(ids: string[]): string {
  const quoted = ids.map((chunkId) => "'" + chunkId.replaceAll("'", "''") + "'").join(", ");
  return `id IN (${quoted})`;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface ChunkRow {
  id: string;
  doc: string;
  ord: number;
  text: string;
  vector: number[];
}

/** Create/open the `chunks` table under <path> and keep it in sync. */
export class VectorStore {
  constructor(readonly path: string) {}

  private async connect(): Promise<Connection> {
    const lancedb = await requireLancedb();
    mkdirSync(this.path, { recursive: true });
    return lancedb.connect(this.path);
  }

  private async openTable(db: Connection): Promise<Table | null> {
    if (!(await db.tableNames()).includes(TABLE)) return null;
    return db.openTable(TABLE);
  }

  // -- writing -----------------------------------------------------------------

  /** Drop and rebuild — the fingerprint changed, every vector is invalid. */
  async replaceAll(rows: ChunkRow[], dim: number): Promise<void> {
    const db = await this.connect();
    if ((await db.tableNames()).includes(TABLE)) await db.dropTable(TABLE);
    const table = await db.createEmptyTable(TABLE, await chunkSchema(dim));
    if (rows.length > 0) await table.add(rows as unknown as Record<string, unknown>[]);
  }

  /** Incremental sync: delete vanished/changed ids, add the fresh rows. */
  async upsert(rows: ChunkRow[], deleteIds: Set<string>, dim: number): Promise<void> {
    const db = await this.connect();
    let table = await this.openTable(db);
    if (table === null) table = await db.createEmptyTable(TABLE, await chunkSchema(dim));
    const ordered = [...deleteIds].sort(cmpStr);
    for (let start = 0; start < ordered.length; start += DELETE_BATCH) {
      await table.delete(inPredicate(ordered.slice(start, start + DELETE_BATCH)));
    }
    if (rows.length > 0) await table.add(rows as unknown as Record<string, unknown>[]);
  }

  // -- reading -----------------------------------------------------------------

  async existingIds(): Promise<Set<string>> {
    return new Set((await this.existingShas()).keys());
  }

  /** {chunk id: sha256 of stored text} — what is ACTUALLY embedded.
   *
   * Incrementality diffs against the store, not against the previous
   * chunks.jsonl: after a failed embed pass the jsonl is current while the
   * vectors lag, and only the store knows which ones. */
  async existingShas(): Promise<Map<string, string>> {
    if (!isDir(this.path) || !(await lancedbAvailable())) return new Map();
    const table = await this.openTable(await this.connect());
    if (table === null) return new Map();
    const rows = await table.query().select(["id", "text"]).toArray();
    const out = new Map<string, string>();
    for (const row of rows as Array<Record<string, unknown>>) {
      out.set(String(row["id"]), sha256Hex(String(row["text"])));
    }
    return out;
  }

  /** Cosine top-k chunk rows (with `_distance`), nearest first. */
  async queryVectors(vector: number[], k: number): Promise<Array<Record<string, unknown>>> {
    if (!isDir(this.path)) return [];
    const table = await this.openTable(await this.connect());
    if (table === null) return [];
    return (await table
      .vectorSearch(vector)
      .distanceType("cosine")
      .limit(k)
      .toArray()) as Array<Record<string, unknown>>;
  }
}
