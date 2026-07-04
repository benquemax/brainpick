/** The four CLI query mirrors (search/read/neighbors/overview) as testable units.
 *
 * Each is thin glue over the very same payload builders the MCP tools and REST
 * use; cli.ts wires commander to these and prints `out`/`err`. Self-healing: an
 * uncompiled brain yields an instruction, never a crash. Mirrors query/present.py's
 * side of the Python cli.py functions.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { checkFresh } from "../compile/pipeline";
import { loadConfig } from "../config";
import { neighborsPayload, overviewPayload, readPayload, searchPayload } from "../mcp";
import { ServeState } from "../serve/state";
import { presentNeighbors, presentOverview, presentRead, presentSearch, toJson } from "./present";

/** What a mirror prints: `out` to stdout (results / JSON), `err` to stderr (notes). */
export interface MirrorOutput {
  out?: string;
  err?: string;
}

/** Load the compiled brain read-only (never compiles); null → not compiled yet. */
export async function heldState(root: string): Promise<ServeState | null> {
  const bp = join(root, ".brainpick");
  const needed = [join(bp, "manifest.json"), join(bp, "t1", "graph.json"), join(bp, "t1", "docs.jsonl")];
  if (!needed.every((path) => existsSync(path))) return null;
  const state = new ServeState(root, loadConfig(root));
  state.reloadArtifacts();
  return state;
}

function uncompiled(root: string, jsonMode: boolean): MirrorOutput {
  const instruction = `no compiled brain at ${root} — run: brainpick compile --root ${root}`;
  return jsonMode
    ? { out: toJson({ error: instruction, hint: "compile the brain, then retry" }) }
    : { err: instruction };
}

function staleNote(root: string): string | undefined {
  return checkFresh(root).fresh ? undefined : `note: the brain is stale — run: brainpick compile --root ${root}`;
}

export async function searchMirror(
  root: string,
  query: string,
  mode: string,
  limit: number,
  jsonMode: boolean,
): Promise<MirrorOutput> {
  const state = await heldState(root);
  if (state === null) return uncompiled(root, jsonMode);
  const payload = await searchPayload(state, query, mode, limit);
  return { out: jsonMode ? toJson(payload) : presentSearch(payload, query), err: staleNote(root) };
}

export async function readMirror(root: string, doc: string, jsonMode: boolean): Promise<MirrorOutput> {
  const state = await heldState(root);
  if (state === null) return uncompiled(root, jsonMode);
  const payload = readPayload(state, doc);
  return { out: jsonMode ? toJson(payload) : presentRead(payload), err: staleNote(root) };
}

export async function neighborsMirror(
  root: string,
  doc: string,
  depth: number,
  layer: string,
  jsonMode: boolean,
): Promise<MirrorOutput> {
  const state = await heldState(root);
  if (state === null) return uncompiled(root, jsonMode);
  const payload = neighborsPayload(state, doc, depth, layer);
  return { out: jsonMode ? toJson(payload) : presentNeighbors(payload), err: staleNote(root) };
}

export async function overviewMirror(root: string, jsonMode: boolean): Promise<MirrorOutput> {
  const state = await heldState(root);
  if (state === null) return uncompiled(root, jsonMode);
  const payload = overviewPayload(state);
  return { out: jsonMode ? toJson(payload) : presentOverview(payload), err: staleNote(root) };
}
