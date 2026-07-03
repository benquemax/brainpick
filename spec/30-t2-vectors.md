# T2 — vectors

T2 adds semantic recall: documents are chunked deterministically, chunks are
embedded by a configured backend, vectors live in a LanceDB dataset both
runtimes read and write. Chunking is **normative** (byte-golden); vectors are
**advisory** in content (backends differ) but their storage layout is
normative; retrieval behavior is conformance-tested at query level using the
normative mock embedder.

## Chunker (normative — both engines byte-identical)

Input: a document's `text` (the body from `docs.jsonl`; reserved documents
are never chunked). Char-based — no tokenizer dependency.

1. Split the body into sections at ATX headings of level 1–3 (`^#{1,3} `,
   outside fenced code blocks). Text before the first heading is a section
   with an empty heading path. A section's `heading_path` is the list of
   heading titles from the nearest enclosing levels (e.g.
   `["Kuu", "Vuorovedet"]`).
2. Within a section, split into paragraphs on blank lines, then greedily
   pack consecutive paragraphs into chunks of at most **3200 chars**
   (joined with `\n\n`). A single paragraph longer than 3200 chars is hard-
   split at 3200-char boundaries.
3. Consecutive chunks within one section overlap: each chunk after the
   first is prefixed with the last **320 chars** of the previous chunk
   (overlap counts toward the 3200 budget).
4. Chunks whose text is empty or whitespace-only are dropped.

Chunk id: `{path}#{slug-path}~{n}` where `slug-path` joins slugged heading
titles with `/` (slug: lowercase, every run of non-alphanumeric characters →
`-`, trimmed of `-`; empty heading path → empty string) and `n` is the
0-based index within that section. Example: `kuu.md#kuu~0`.

## t2/chunks.jsonl (normative, golden-tested)

One canonical JSONL line per chunk, sorted by (`doc`, `ord`):

```json
{"doc":"kuu.md","heading_path":["Kuu"],"id":"kuu.md#kuu~0","ord":0,"sha256":"…","text":"…"}
```

`ord` is the chunk's 0-based index within its document; `sha256` is over the
chunk text (UTF-8). Incremental T2 re-embeds only chunks whose `sha256`
changed and deletes vectors whose ids disappeared.

## t2/embedding.json (normative)

```json
{"dim": 768, "endpoint": "http://127.0.0.1:11434", "fingerprint": "…",
 "kind": "ollama", "model": "nomic-embed-text"}
```

`kind ∈ ollama | openai-compatible | fastembed | mock`. `fingerprint` =
first 16 hex chars of sha256 over `kind|endpoint|model|dim`. A fingerprint
change invalidates every vector (full re-embed). Query-time embedding MUST
use this record.

## Vector store (layout normative)

`t2/lancedb/chunks.lance` — a LanceDB table with columns `id` (utf8, the
chunk id), `doc` (utf8), `ord` (int32), `text` (utf8), `vector`
(fixed-size list of float32, length = `dim`). Engines use the official
LanceDB SDK of their runtime; the on-disk Lance dataset is the
interoperability point — either engine may compile, either may query.
Embedding requests are batched (≤ 64 texts per call).

## Detection ladder (normative order)

1. Explicit `[models.embedding]` config — always wins, never re-probed.
2. Ollama (`http://127.0.0.1:11434`, then `OLLAMA_HOST`): prefer installed
   models in order `nomic-embed-text`, `mxbai-embed-large`,
   `snowflake-arctic-embed2`, `bge-m3`.
3. OpenAI-compatible local endpoints: `:1234/v1` (LM Studio), `:8080/v1`
   (llama.cpp).
4. `OPENAI_API_KEY` → `text-embedding-3-small` — recorded only with
   explicit consent (a paid API is opt-in).
5. Python engine only: `fastembed` ONNX (`[vectors-local]` extra) — the
   fully-offline floor. The Node engine steers to Ollama or the sibling.
6. Nothing → `[modules] vectors` stays off with the exact enabling command.

Probes: parallel, ≤ 300 ms, silent misses.

## Retrieval

- `mode=semantic`: cosine top-k over the chunk vectors of the embedded
  query; hits are deduplicated to documents (best chunk wins; its text is
  the snippet source). Reserved documents never surface.
- `mode=auto` with T2 fresh: **RRF fusion** (k=60) of the keyword ranking
  (spec/50) and the semantic ranking; dedupe by document; response
  `used_modes: ["keyword","semantic"]`.
- T2 stale or off: `semantic`/`auto` degrade to keyword with
  `degraded_from: "semantic"`.
- A hit's `source` is the retriever contributing its best rank.

## Mock embedder (normative, conformance only)

Deterministic, dependency-free, dim 16. For a text: lowercase, tokenize on
non-alphanumeric boundaries (`_` is a boundary); for each token compute
FNV-1a 32-bit over its UTF-8 bytes and add 1.0 to `vec[hash % 16]`;
L2-normalize (all-zero stays all-zero). Both engines implement it behind a
test hook (`kind: "mock"`); conformance `query` cases with
`mode: semantic|auto` use it and assert the top-k document SET.

## Tier status

`tiers.t2` in the manifest: `fresh` after a successful embed pass over the
current chunk set, `stale` when chunks changed but embedding hasn't run (or
the fingerprint changed), `off` when no backend is configured/available.
T2 failures never block T1 (spec/00 degradation ladder).
