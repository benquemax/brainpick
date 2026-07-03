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
export {
  checkFresh,
  INDEX_FILE,
  runCompile,
  type CompileResult,
  type Freshness,
  type Tier,
} from "./compile/pipeline";
export {
  buildChunks,
  chunkDocument,
  fingerprint,
  MAX_CHUNK,
  OVERLAP,
  runT2Stage,
  slugify,
  t2Gate,
  type Chunk,
  type ChunkSource,
  type T2Result,
} from "./compile/t2";
export {
  defaultConfig,
  loadConfig,
  type Config,
  type EmbeddingConfig,
  type ModelsConfig,
  type ModulesConfig,
} from "./config";
export { diffGraphs, type GraphDelta, type RemovedEdge } from "./deltas";
export {
  BATCH_SIZE,
  EmbeddingUnavailable,
  makeEmbedder,
  MOCK_DIM,
  MockEmbedder,
  OllamaEmbedder,
  OpenAICompatEmbedder,
  type Embedder,
} from "./embed";
export { search, type HitSource, type SearchHit } from "./query/keyword";
export {
  KNOWN_MODES,
  resolveMode,
  RRF_K,
  rrfFuse,
  runSearch,
  type SearchBody,
  type SemanticFn,
} from "./query/router";
export { loadEmbeddingRecord, semanticSearch, SemanticUnavailable } from "./query/vectors";
export {
  lancedbAvailable,
  TABLE,
  VectorStore,
  VectorStoreUnavailable,
  type ChunkRow,
} from "./vectorstore";
