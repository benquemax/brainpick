/** T3 knowledge-graph query over the neutral export (spec/40).
 *
 * The CONSUMER side of T3: it never extracts. It reads the hand-authored
 * `t3/{entities.jsonl,relations.jsonl,kg-meta.json}` export into an in-memory
 * graph and answers the two normative retrievals — entity-layer neighbors and
 * `mode=graph` search — plus the entity graph the UI's entity layer consumes.
 *
 * Ports packages/python/src/brainpick/kg.py byte-for-byte: id normalization,
 * the export layout, and the retrieval semantics are normative (spec/40), so a
 * mistake in either engine fails the shared kg-query conformance class.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DocRecord, Graph } from "./compile/t1";
import { cmpStr } from "./core/canonical";
import { B, K1, search as keywordSearch, tokenize, type SearchHit } from "./query/keyword";

/** The alphanumeric run — the exact tokenizer keyword search uses (spec/50), so
 * "run of non-alphanumeric characters" is byte-identical to the Python engine. */
const ALNUM = /[\p{L}\p{N}]+/gu;

const GRAPH_HOP_DECAY = 1.0; // a one-hop neighbor contributes its relation weight, undecayed
const LINK_WALK_DECAY = 0.5; // a T1-link neighbor of a keyword hit ranks below it (graph degrade)

export interface Entity {
  id: string;
  name: string;
  description: string | null;
  source_docs: string[];
  type: string | null;
  [extra: string]: unknown;
}

export interface Relation {
  src: string;
  dst: string;
  weight: number;
  [extra: string]: unknown;
}

export interface EntityNode {
  id: string;
  name: string;
  description: string | null;
  distance: number;
  source_docs: string[];
  layer?: string;
}

export interface EntityEdge {
  src: string;
  dst: string;
  layer?: string;
}

/** Python round(x, 6) — see query/keyword.ts. */
function round6(x: number): number {
  return Number(x.toFixed(6));
}

/** spec/40 id: NFC, lowercased, every run of non-alphanumeric characters → "-",
 * trimmed of "-". Splitting on the alphanumeric tokenizer and re-joining with
 * "-" collapses runs and trims ends in one step — and reuses the
 * cross-engine-proven keyword tokenizer, so Python and JS agree by construction. */
export function normalizeEntityId(name: string): string {
  const folded = String(name).normalize("NFC").toLowerCase();
  return (folded.match(ALNUM) ?? []).join("-");
}

/** Distinct names that normalize to the same slug collide; the collision keeps
 * the base slug for the codepoint-first name and appends -2, -3… to the rest,
 * in `name` codepoint order (spec/40). */
export function disambiguateIds(names: string[]): Record<string, string> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const slug = normalizeEntityId(name);
    let group = groups.get(slug);
    if (!group) groups.set(slug, (group = []));
    group.push(name);
  }
  const assigned: Record<string, string> = {};
  for (const [slug, group] of groups) {
    const unique = [...new Set(group)].sort(cmpStr);
    unique.forEach((name, index) => {
      assigned[name] = index === 0 ? slug : `${slug}-${index + 1}`;
    });
  }
  return assigned;
}

/** The in-memory export: entities by id, undirected relation adjacency for
 * walks, a doc→entities reverse index, and a BM25 view of entity text. */
export class KnowledgeGraph {
  readonly entities: Map<string, Entity>;
  readonly relations: Relation[];
  readonly meta: Record<string, unknown>;
  readonly adjacency = new Map<string, Array<[string, number]>>();

  private readonly byDoc = new Map<string, string[]>();
  private readonly ids: string[];
  private readonly tokens: string[][];
  private readonly lengths: number[];
  private readonly avgLen: number;

  constructor(entities: Map<string, Entity>, relations: Relation[], meta: Record<string, unknown>) {
    this.entities = entities;
    this.relations = relations;
    this.meta = meta;

    for (const id of entities.keys()) this.adjacency.set(id, []);
    for (const rel of relations) {
      this.adjacency.get(rel.src)!.push([rel.dst, Number(rel.weight)]);
      this.adjacency.get(rel.dst)!.push([rel.src, Number(rel.weight)]);
    }
    for (const list of this.adjacency.values()) list.sort((a, b) => cmpStr(a[0], b[0]));

    for (const [id, entity] of entities) {
      for (const doc of entity.source_docs ?? []) {
        let list = this.byDoc.get(doc);
        if (!list) this.byDoc.set(doc, (list = []));
        list.push(id);
      }
    }
    for (const list of this.byDoc.values()) list.sort(cmpStr);

    // BM25 corpus over "name — description", one document per entity (spec/40).
    this.ids = [...entities.keys()].sort(cmpStr);
    this.tokens = this.ids.map((id) => tokenize(KnowledgeGraph.text(entities.get(id)!)));
    this.lengths = this.tokens.map((toks) => toks.length);
    this.avgLen = this.lengths.length > 0 ? this.lengths.reduce((a, b) => a + b, 0) / this.lengths.length : 0;
  }

  private static text(entity: Entity): string {
    return `${entity.name} ${entity.description ?? ""}`;
  }

  /** The entity ids grounded in `path` (its `source_docs` include it), sorted. */
  entitiesForDoc(path: string): string[] {
    return [...(this.byDoc.get(path) ?? [])];
  }

  /** {entity id: BM25 score} for the entities the query touches (score > 0).
   * Rare terms dominate, so common words ("the") barely move an entity. */
  entityBm25(query: string): Map<string, number> {
    const terms = tokenize(query);
    if (terms.length === 0 || this.avgLen === 0) return new Map();
    const termFreqs = this.tokens.map((toks) => {
      const tf = new Map<string, number>();
      for (const token of toks) tf.set(token, (tf.get(token) ?? 0) + 1);
      return tf;
    });
    const docCount = this.ids.length;
    const docFreq = new Map<string, number>();
    for (const term of new Set(terms)) {
      docFreq.set(term, termFreqs.filter((tf) => (tf.get(term) ?? 0) > 0).length);
    }
    const scores = new Map<string, number>();
    for (let i = 0; i < this.ids.length; i++) {
      const tf = termFreqs[i]!;
      const length = this.lengths[i]!;
      let score = 0;
      for (const term of terms) {
        const freq = tf.get(term) ?? 0;
        if (freq === 0) continue;
        const df = docFreq.get(term)!;
        const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
        score += (idf * (freq * (K1 + 1))) / (freq + K1 * (1 - B + (B * length) / this.avgLen));
      }
      if (score > 0) scores.set(this.ids[i]!, round6(score));
    }
    return scores;
  }

  /** spec/40 brain_neighbors layer=entities: seed with the doc's entities
   * (distance 0), walk relations undirected to `depth`, return entity nodes
   * {id,name,description,distance,source_docs} and the induced edges {src,dst}. */
  neighborEntities(centerDoc: string, depth: number): [EntityNode[], EntityEdge[]] {
    const distance = new Map<string, number>();
    for (const id of this.entitiesForDoc(centerDoc)) distance.set(id, 0);
    let frontier = [...distance.keys()];
    for (let hop = 1; hop <= depth; hop++) {
      const reached: string[] = [];
      for (const id of frontier) {
        for (const [neighbor] of this.adjacency.get(id) ?? []) {
          if (!distance.has(neighbor)) {
            distance.set(neighbor, hop);
            reached.push(neighbor);
          }
        }
      }
      frontier = reached;
    }
    const nodes: EntityNode[] = [...distance.entries()]
      .sort((a, b) => a[1] - b[1] || cmpStr(a[0], b[0]))
      .map(([id, hops]) => {
        const entity = this.entities.get(id)!;
        return {
          id,
          name: entity.name,
          description: entity.description ?? null,
          distance: hops,
          source_docs: [...(entity.source_docs ?? [])],
        };
      });
    const edges: EntityEdge[] = this.relations
      .filter((rel) => distance.has(rel.src) && distance.has(rel.dst))
      .map((rel) => ({ src: rel.src, dst: rel.dst }));
    return [nodes, edges];
  }

  /** The whole entity layer for /api/graph?layer=entities: nodes
   * {id,name,type,description,degree}, edges {src,dst,weight} (spec/40). */
  entityGraph(): {
    nodes: Array<{ id: string; name: string; type: string | null; description: string | null; degree: number }>;
    edges: Array<{ src: string; dst: string; weight: number }>;
  } {
    const nodes = this.ids.map((id) => {
      const entity = this.entities.get(id)!;
      const degree = new Set((this.adjacency.get(id) ?? []).map(([n]) => n)).size;
      return { id, name: entity.name, type: entity.type ?? null, description: entity.description ?? null, degree };
    });
    const edges = [...this.relations]
      .sort((a, b) => cmpStr(a.src, b.src) || cmpStr(a.dst, b.dst))
      .map((rel) => ({ src: rel.src, dst: rel.dst, weight: rel.weight }));
    return { nodes, edges };
  }
}

/** Read `.brainpick/t3/` into a graph, or null when the export is absent — T3
 * unavailable is a degradation, never an error (spec/40). Dangling relations
 * (an endpoint missing from entities.jsonl) are skipped, not fatal. */
export function loadKg(bpDir: string): KnowledgeGraph | null {
  const t3 = join(bpDir, "t3");
  let entitiesText: string;
  try {
    entitiesText = readFileSync(join(t3, "entities.jsonl"), "utf8");
  } catch {
    return null;
  }
  const entities = new Map<string, Entity>();
  for (const line of entitiesText.split("\n")) {
    if (line === "") continue;
    const entity = JSON.parse(line) as Entity;
    entities.set(entity.id, entity);
  }
  if (entities.size === 0) return null; // an empty export is nothing to query

  const relations: Relation[] = [];
  try {
    const relationsText = readFileSync(join(t3, "relations.jsonl"), "utf8");
    for (const line of relationsText.split("\n")) {
      if (line === "") continue;
      const rel = JSON.parse(line) as Relation;
      if (entities.has(rel.src) && entities.has(rel.dst)) relations.push(rel);
    }
  } catch {
    /* relations.jsonl is optional (spec/40) */
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(readFileSync(join(t3, "kg-meta.json"), "utf8")) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return new KnowledgeGraph(entities, relations, meta);
}

/** spec/40 mode=graph: match the query against entity name+description, expand
 * one relation hop, and rank the source_docs of the matched-and-adjacent
 * entities — "what connects to X" rather than "what says X". Returns spec/50
 * hits with source "graph". */
export function graphSearch(
  kg: KnowledgeGraph,
  records: readonly DocRecord[],
  query: string,
  limit = 8,
): SearchHit[] {
  const entityScores = kg.entityBm25(query);
  if (entityScores.size === 0) return [];
  const byPath = new Map(records.filter((r) => !r.reserved).map((r) => [r.path, r]));
  const docScores = new Map<string, number>();
  const orderedIds = [...entityScores.keys()].sort(cmpStr); // deterministic summation order
  for (const id of orderedIds) {
    const score = entityScores.get(id)!;
    for (const doc of kg.entities.get(id)!.source_docs ?? []) {
      docScores.set(doc, (docScores.get(doc) ?? 0) + score);
    }
  }
  for (const id of orderedIds) {
    const score = entityScores.get(id)!;
    for (const [neighbor, weight] of kg.adjacency.get(id) ?? []) {
      for (const doc of kg.entities.get(neighbor)!.source_docs ?? []) {
        docScores.set(doc, (docScores.get(doc) ?? 0) + score * weight * GRAPH_HOP_DECAY);
      }
    }
  }

  const ranked = [...docScores.keys()].sort((a, b) => docScores.get(b)! - docScores.get(a)! || cmpStr(a, b));
  const hits: SearchHit[] = [];
  for (const path of ranked) {
    const meta = byPath.get(path);
    if (meta === undefined) continue; // an entity grounds a reserved/deleted doc — not a hit
    hits.push({
      description: meta.description,
      path,
      score: round6(docScores.get(path)!),
      snippet: null,
      source: "graph",
      title: meta.title,
    });
    if (hits.length === limit) break;
  }
  return hits;
}

/** The mode=graph degrade when T3 is absent (spec/40): keyword hits, then one
 * hop over the T1 link graph, so the answer still walks *some* graph. Keyword
 * hits keep their source; docs reached only by a link are tagged "graph". */
export function linkWalkSearch(
  linkGraph: Graph,
  records: readonly DocRecord[],
  query: string,
  limit = 8,
): SearchHit[] {
  const seeds = keywordSearch([...records], query, limit);
  const byPath = new Map(records.filter((r) => !r.reserved).map((r) => [r.path, r]));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of linkGraph.edges ?? []) {
    let out = adjacency.get(edge.source);
    if (!out) adjacency.set(edge.source, (out = new Set()));
    out.add(edge.target);
    let incoming = adjacency.get(edge.target);
    if (!incoming) adjacency.set(edge.target, (incoming = new Set()));
    incoming.add(edge.source);
  }

  const seen = new Set(seeds.map((hit) => hit.path));
  const extra: SearchHit[] = [];
  for (const hit of seeds) {
    for (const neighbor of [...(adjacency.get(hit.path) ?? [])].sort(cmpStr)) {
      if (seen.has(neighbor)) continue;
      const meta = byPath.get(neighbor);
      if (meta === undefined) continue;
      seen.add(neighbor);
      extra.push({
        description: meta.description,
        path: neighbor,
        score: round6(hit.score * LINK_WALK_DECAY),
        snippet: null,
        source: "graph",
        title: meta.title,
      });
    }
  }
  return [...seeds, ...extra].slice(0, limit);
}
