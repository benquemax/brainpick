/** Embedding clients (spec/30): one tiny interface, four backends, ≤64 batching.
 *
 * The compile stage and query-time embedding share these; whichever backend the
 * t2/embedding.json record names is the one that must answer at query time.
 * `local` (transformers.js on onnxruntime-node) is this engine's peer to the
 * Python engine's `fastembed` — the in-process, fully-offline floor (rung 5 of
 * the detection ladder), import-guarded exactly like @lancedb/lancedb: absence
 * degrades with an instruction, never a module-not-found crash.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const BATCH_SIZE = 64; // spec/30: embedding requests are batched (≤ 64 texts per call)
export const MOCK_DIM = 16;
/** nomic-ai/nomic-embed-text-v1.5 (Apache-2.0): ships ONNX exports directly, a
 * natively supported architecture (nomic_bert) in transformers.js — the
 * `local` kind's default model when `[models.embedding] model` is unset. */
export const DEFAULT_LOCAL_MODEL = "nomic-ai/nomic-embed-text-v1.5";

/** Where downloaded ONNX weights + tokenizers live — outside node_modules (a
 * global/npx install wipes that on every reinstall), one documented path for
 * every platform (docs/embedding-detection.md). */
export function localModelCacheDir(): string {
  return join(homedir(), ".cache", "brainpick", "transformers");
}
// Same boundaries as keyword search (spec/50): Python [^\W_]+ with re.UNICODE.
const TOKEN = /[\p{L}\p{N}]+/gu;
const HTTP_TIMEOUT_MS = 120_000; // the first call may load a model

/** The backend cannot embed right now — the message is a one-line instruction. */
export class EmbeddingUnavailable extends Error {}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

function* batches(texts: string[]): Generator<string[]> {
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    yield texts.slice(start, start + BATCH_SIZE);
  }
}

/** FNV-1a 32-bit over bytes (spec/30 mock embedder). Math.imul keeps the
 * multiply in 32-bit integer semantics — a plain `*` would lose low bits
 * past 2^53. */
export function fnv1a(data: Uint8Array): number {
  let value = 2166136261;
  for (const byte of data) {
    value = (value ^ byte) >>> 0;
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

const utf8 = new TextEncoder();

/** The normative conformance embedder (spec/30): FNV-1a token buckets, dim 16.
 *
 * Deterministic and dependency-free; reachable via `[models.embedding]
 * kind = "mock"` — a test hook, never something init records. */
export class MockEmbedder implements Embedder {
  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.one(text)));
  }

  private one(text: string): number[] {
    const vec = new Array<number>(MOCK_DIM).fill(0.0);
    for (const token of text.toLowerCase().match(TOKEN) ?? []) {
      vec[fnv1a(utf8.encode(token)) % MOCK_DIM] += 1.0;
    }
    let sum = 0;
    for (const x of vec) sum += x * x;
    const norm = Math.sqrt(sum);
    return norm ? vec.map((x) => x / norm) : vec; // all-zero stays all-zero
  }
}

abstract class HttpEmbedder implements Embedder {
  protected readonly endpoint: string;

  constructor(
    endpoint: string,
    protected readonly model: string,
    protected readonly apiKey = "",
  ) {
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const batch of batches(texts)) {
      vectors.push(...(await this.embedBatch(batch)));
    }
    return vectors;
  }

  protected async post(url: string, payload: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new EmbeddingUnavailable(
        `embedding backend at ${this.endpoint} did not answer (${msg}) — ` +
          `check the [models.embedding] endpoint and that '${this.model}' is available`,
      );
    }
  }

  protected abstract embedBatch(batch: string[]): Promise<number[][]>;
}

/** POST {endpoint}/api/embed {"model", "input": [...]} → {"embeddings": [...]}. */
export class OllamaEmbedder extends HttpEmbedder {
  protected async embedBatch(batch: string[]): Promise<number[][]> {
    const data = await this.post(`${this.endpoint}/api/embed`, { model: this.model, input: batch });
    const embeddings = data["embeddings"];
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
      throw new EmbeddingUnavailable(
        `ollama at ${this.endpoint} returned no embeddings for '${this.model}' — ` +
          `pull it first: ollama pull ${this.model}`,
      );
    }
    return embeddings.map((vec: unknown) => (vec as unknown[]).map(Number));
  }
}

/** POST {endpoint}/embeddings (endpoint already ends in /v1) — OpenAI shape. */
export class OpenAICompatEmbedder extends HttpEmbedder {
  protected async embedBatch(batch: string[]): Promise<number[][]> {
    const data = await this.post(`${this.endpoint}/embeddings`, { model: this.model, input: batch });
    const items = data["data"];
    if (!Array.isArray(items) || items.length !== batch.length) {
      throw new EmbeddingUnavailable(
        `${this.endpoint} returned no embeddings for '${this.model}' — ` +
          "check the model name in [models.embedding]",
      );
    }
    const ordered = [...(items as Array<Record<string, unknown>>)].sort(
      (a, b) => Number(a["index"] ?? 0) - Number(b["index"] ?? 0),
    );
    return ordered.map((item) => (item["embedding"] as unknown[]).map(Number));
  }
}

type TransformersModule = typeof import("@huggingface/transformers");

let transformersModule: TransformersModule | null | undefined;

async function importTransformers(): Promise<TransformersModule | null> {
  if (transformersModule === undefined) {
    try {
      transformersModule = await import("@huggingface/transformers");
    } catch {
      transformersModule = null; // absent or its native onnxruntime-node binding failed to load
    }
  }
  return transformersModule;
}

/** Whether @huggingface/transformers resolves — the `local` kind's import guard. */
export async function transformersAvailable(): Promise<boolean> {
  return (await importTransformers()) !== null;
}

interface FeatureExtractor {
  (texts: string[], options: { pooling: "mean"; normalize: boolean }): Promise<{ tolist(): number[][] }>;
}

/** In-process local embeddings via transformers.js on onnxruntime-node (spec/30
 * rung 5) — the fully-offline floor, this engine's peer to Python's fastembed.
 * The pipeline (tokenizer + ONNX session) loads lazily on first `embed()` and
 * is cached for the life of this instance; a missing package or a load
 * failure surfaces as an instructive `EmbeddingUnavailable`, never a crash. */
export class LocalEmbedder implements Embedder {
  private pipelinePromise: Promise<FeatureExtractor> | null = null;

  constructor(private readonly model: string) {}

  private async getPipeline(): Promise<FeatureExtractor> {
    if (this.pipelinePromise === null) {
      this.pipelinePromise = this.loadPipeline();
    }
    try {
      return await this.pipelinePromise;
    } catch (error) {
      this.pipelinePromise = null; // a failed load never wedges retries
      throw error;
    }
  }

  private async loadPipeline(): Promise<FeatureExtractor> {
    const mod = await importTransformers();
    if (mod === null) {
      throw new EmbeddingUnavailable(
        "@huggingface/transformers is not installed — npm install @huggingface/transformers " +
          "to enable the in-process local embedding backend (kind = \"local\")",
      );
    }
    try {
      return (await mod.pipeline("feature-extraction", this.model, {
        dtype: "q8", // quantized — a fraction of the fp32 download for near-identical recall
        cache_dir: localModelCacheDir(),
      })) as unknown as FeatureExtractor;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new EmbeddingUnavailable(
        `local model '${this.model}' failed to load (${msg}) — check the model name in ` +
          "[models.embedding] and that it has been downloaded (first use fetches it)",
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await this.getPipeline();
    const vectors: number[][] = [];
    for (const batch of batches(texts)) {
      const output = await pipe(batch, { pooling: "mean", normalize: true });
      vectors.push(...output.tolist());
    }
    return vectors;
  }
}

/** The [models.embedding] record → a client. Unknown kinds are instructions. */
export function makeEmbedder(kind: string, endpoint = "", model = "", apiKey = ""): Embedder {
  if (kind === "mock") return new MockEmbedder();
  if (kind === "ollama") return new OllamaEmbedder(endpoint, model);
  if (kind === "openai-compatible" || kind === "openai") {
    return new OpenAICompatEmbedder(endpoint, model, apiKey);
  }
  if (kind === "local") return new LocalEmbedder(model || DEFAULT_LOCAL_MODEL);
  if (kind === "fastembed") {
    throw new EmbeddingUnavailable(
      "fastembed is Python-only — use kind = \"local\" (npm install @huggingface/transformers), " +
        "ollama (ollama pull nomic-embed-text), or compile with the Python engine's [vectors-local] extra",
    );
  }
  throw new EmbeddingUnavailable(
    `unknown embedding kind '${kind}' — use ollama, openai-compatible, local, or mock`,
  );
}
