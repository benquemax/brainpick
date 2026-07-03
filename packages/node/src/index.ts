/** brainpick — pick your agent's brain. The native Node engine's library surface. */
export { SPEC_VERSION, VERSION } from "./version";
export { canonicalJson, canonicalJsonl, cmpStr, sha256Hex, type JsonValue } from "./core/canonical";
export { splitFrontmatter } from "./core/frontmatter";
export { extractLinks, type RawLink } from "./core/links";
export {
  ALWAYS_EXCLUDED_DIRS,
  DEFAULT_INCLUDE,
  RESERVED_NAMES,
  normalizeTags,
  normalizeTimestamp,
  posixBasename,
  posixDirname,
  posixJoin,
  posixNormpath,
  scan,
  type Document,
  type Ghost,
  type ResolvedLink,
} from "./core/bundle";
export { pyStr, YamlFloat, YamlTimestamp } from "./core/yaml11";
export {
  applyIndexSection,
  BEGIN_PREFIX,
  buildDocsRecords,
  buildGraph,
  END_MARKER,
  renderIndexBlock,
  type DocRecord,
  type GhostEdge,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphStats,
} from "./compile/t1";
export { checkFresh, INDEX_FILE, runCompile, type CompileResult, type Freshness } from "./compile/pipeline";
export { diffGraphs, type GraphDelta, type RemovedEdge } from "./deltas";
export { search, type SearchHit } from "./query/keyword";
