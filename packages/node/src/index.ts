/** brainpick — pick your agent's brain. The native Node engine's library surface. */
export { SPEC_VERSION, VERSION } from "./version";
export {
  AUTH_FILE,
  AUTH_REQUIRED_ERROR,
  AuthProvider,
  authActive,
  authPath,
  clearPassword,
  clearSessionCookieHeader,
  createToken,
  ensureGitignored,
  listTokens,
  loadAuth,
  LOGIN_HTML,
  makeSessionCookie,
  revokeToken,
  runPasswordClear,
  runPasswordSetValue,
  runTokenCreate,
  runTokenList,
  runTokenRevoke,
  saveAuth,
  scryptHash,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieHeader,
  setPassword,
  verifyPassword,
  verifySession,
  verifyToken,
  type AuthStore,
  type HashRecord,
  type TokenRecord,
} from "./auth";
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
  deriveAlgorithmicExport,
  runT3AlgorithmicStage,
  type AlgorithmicEntity,
  type AlgorithmicRelation,
  type T3Outcome,
} from "./compile/t3";
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
  CONFIG_FILE,
  defaultConfig,
  loadConfig,
  LOCAL_CONFIG_FILE,
  type Config,
  type EmbeddingConfig,
  type ExtractionConfig,
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
export { search, tokenize, type HitSource, type SearchHit } from "./query/keyword";
export {
  disambiguateIds,
  graphSearch,
  KnowledgeGraph,
  linkWalkSearch,
  loadKg,
  normalizeEntityId,
  type Entity,
  type EntityEdge,
  type EntityNode,
  type Relation,
} from "./kg";
export {
  isRelational,
  KNOWN_MODES,
  RELATIONAL_HINTS,
  resolveMode,
  RRF_K,
  rrfFuse,
  runSearch,
  type GraphFn,
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
export {
  bfsNeighborhood,
  dumps,
  EventQueue,
  jsonable,
  resolveDoc,
  RING_SIZE,
  ServeState,
  suggestPaths,
  type Resolution,
  type ServeEvent,
} from "./serve/state";
export { apiRouter, intParam } from "./serve/rest";
export { liveHandler, PING_INTERVAL_MS, sseFrame } from "./serve/live";
export {
  bundleFilter,
  DEBOUNCE_MS,
  recompileAndBroadcast,
  sourceFilter,
  watchBundle,
  watchIgnored,
  type BundleWatcher,
} from "./serve/watcher";
export {
  buildApp,
  FALLBACK_HTML,
  isLocalHost,
  resolveUiDir,
  type BuildAppOptions,
  type ServeHandles,
} from "./serve/app";
export {
  bumpTimestamp,
  createMcpServer,
  neighborsPayload,
  overviewPayload,
  readPayload,
  resolveWritePath,
  searchPayload,
  slugifyDocPath,
  tokensOf,
  writePayload,
  WRITES_OFF_REFUSAL,
  type WritePayloadOptions,
} from "./mcp";
export {
  detectBundle,
  detectHenxels,
  detectLinkStyle,
  findRepoRoot,
  henxelsOnPath,
  openaiKeyPresent,
  pickBackend,
  probeBackends,
  probeOllama,
  probeOpenaiCompatible,
  which,
  type Backend,
  type BundleInfo,
  type LinkStyle,
  type ProbeResult,
} from "./detect";
export {
  brainpickCommand,
  gitignoreSuggestion,
  henxelsFragment,
  isFancy,
  mcpSnippets,
  renderConfig,
  renderLocalConfig,
  runDoctor,
  runInit,
  type DoctorOptions,
  type InitOptions,
} from "./scaffold";
export { getCloseMatches, SequenceMatcher } from "./core/difflib";
