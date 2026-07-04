"""The LightRAG extractor behind the KGBackend seam (spec/40).

Import-guarded: LightRAG ships in ``brainpick[graph]`` and every entry point
degrades with an instruction rather than an ImportError. LightRAG's working
directory (``.brainpick/t3/lightrag/``) is an opaque, private store outside this
spec — the exporter reads only its entity/relation graph and translates that
into the neutral shape.

We drive LightRAG with the OpenAI-compatible (or Ollama) chat model from
``[models.extraction]`` and, when T2 has recorded an embedding backend, the same
embedder T2 uses; otherwise a cheap deterministic embedder just satisfies
LightRAG's plumbing (extraction quality is the LLM's job, not the embedder's).
Markup is NOT stripped by us — LightRAG strips its own and never follows links.
"""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from typing import Mapping

# LightRAG sums per-mention relation weights (a pair seen twice → 2.0), so the
# exporter clamps; here we only carry the raw value through.
_SEP = "<SEP>"
_LLM_TIMEOUT = 300.0  # a small local model chewing a whole chunk with a big extraction prompt
_FALLBACK_DIM = 16    # the cheap deterministic embedder when T2 recorded none


def lightrag_available() -> bool:
    """True when the ``[graph]`` extra is importable."""
    try:
        import lightrag  # noqa: F401
    except Exception:
        return False
    return True


def _distill_header(chunk: dict) -> str:
    """One-line frontmatter header (Title/Type/Tags) prepended to the body, so a
    chunk carries its doc's identity into extraction. Empty parts are omitted;
    an all-empty header collapses to nothing."""
    parts: list[str] = []
    title = (chunk.get("title") or "").strip()
    dtype = (chunk.get("type") or "").strip()
    tags = [t for t in (chunk.get("tags") or []) if t]
    if title:
        parts.append(f"Title: {title}")
    if dtype:
        parts.append(f"Type: {dtype}")
    if tags:
        parts.append("Tags: " + ", ".join(tags))
    header = " | ".join(parts)
    body = chunk.get("text", "")
    return f"{header}\n\n{body}" if header else body


class LightRAGBackend:
    """Drive LightRAG over one bundle's chunks, then surface its graph neutrally."""

    def __init__(
        self,
        working_dir: str | Path,
        extraction,
        embedding_record: dict | None = None,
        fresh: bool = False,
        env: Mapping[str, str] | None = None,
    ):
        self.working_dir = Path(working_dir)
        self.extraction = extraction
        self.embedding_record = embedding_record
        self.env = os.environ if env is None else env
        if fresh and self.working_dir.exists():
            shutil.rmtree(self.working_dir, ignore_errors=True)

    # -- the seam ----------------------------------------------------------------

    def available(self) -> bool | str:
        if not lightrag_available():
            return "LightRAG missing — pip install 'brainpick[graph]'"
        if not self.extraction.kind or not self.extraction.endpoint:
            return "no [models.extraction] endpoint configured"
        return True

    def insert(self, chunks: list[dict]) -> None:
        if not chunks:
            return
        inputs = [_distill_header(chunk) for chunk in chunks]
        ids = [chunk["id"] for chunk in chunks]
        file_paths = [chunk["doc"] for chunk in chunks]
        asyncio.run(self._ainsert(inputs, ids, file_paths))

    def export(self) -> dict:
        return asyncio.run(self._aexport())

    # -- LightRAG lifecycle ------------------------------------------------------

    async def _build_rag(self):
        from lightrag import LightRAG
        from lightrag.kg.shared_storage import initialize_pipeline_status

        self.working_dir.mkdir(parents=True, exist_ok=True)
        rag = LightRAG(
            working_dir=str(self.working_dir),
            llm_model_func=self._llm_func,
            llm_model_name=self.extraction.model or "extraction-model",
            embedding_func=self._embedding_func(),
            # One extraction pass, no gleaning: a small model's second pass mostly adds
            # noise, and halving the calls keeps a full brain's extraction tractable.
            entity_extract_max_gleaning=0,
            # Modest parallelism: a served endpoint pipelines requests, but too many
            # concurrent whole-chunk generations on one small model queue and stall the
            # slowest past its timeout. Tune up via env when the endpoint is beefy.
            llm_model_max_async=int(self.env.get("BRAINPICK_T3_CONCURRENCY", "2") or "2"),
        )
        await rag.initialize_storages()
        await initialize_pipeline_status()
        return rag

    async def _ainsert(self, inputs: list[str], ids: list[str], file_paths: list[str]) -> None:
        rag = await self._build_rag()
        try:
            await rag.ainsert(input=inputs, ids=ids, file_paths=file_paths)
        finally:
            await rag.finalize_storages()

    async def _aexport(self) -> dict:
        rag = await self._build_rag()
        try:
            nodes = await rag.chunk_entity_relation_graph.get_all_nodes()
            edges = await rag.chunk_entity_relation_graph.get_all_edges()
        finally:
            await rag.finalize_storages()
        return {
            "entities": [self._node_to_entity(node) for node in nodes],
            "relations": [self._edge_to_relation(edge) for edge in edges],
        }

    @staticmethod
    def _source_docs(field: str | None) -> list[str]:
        """LightRAG joins the file_paths we fed with ``<SEP>``; split back to the
        bundle paths, dropping its 'unknown_source' sentinel and blanks."""
        if not field:
            return []
        return [p for p in field.split(_SEP) if p and p != "unknown_source"]

    def _node_to_entity(self, node: dict) -> dict:
        return {
            "name": node.get("entity_id") or node.get("id") or "",
            "type": node.get("entity_type") or "",
            "description": (node.get("description") or "").replace(_SEP, "; "),
            "source_docs": self._source_docs(node.get("file_path")),
        }

    def _edge_to_relation(self, edge: dict) -> dict:
        return {
            "src_name": edge.get("source") or "",
            "dst_name": edge.get("target") or "",
            "description": (edge.get("description") or "").replace(_SEP, "; "),
            "keywords": edge.get("keywords") or "",
            "weight": edge.get("weight"),
            "source_docs": self._source_docs(edge.get("file_path")),
        }

    # -- model plumbing ----------------------------------------------------------

    async def _llm_func(self, prompt, system_prompt=None, history_messages=None, **_kwargs) -> str:
        """LightRAG's async chat surface → the [models.extraction] endpoint.

        Handles gleaning's multi-turn history and both the OpenAI-compatible and
        Ollama shapes; keeps its own httpx client so llm.py's sync clients stay
        untouched."""
        import httpx

        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.extend(history_messages or [])
        messages.append({"role": "user", "content": prompt})

        endpoint = self.extraction.endpoint.rstrip("/")
        timeout = httpx.Timeout(_LLM_TIMEOUT, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            if self.extraction.kind == "ollama":
                resp = await client.post(
                    f"{endpoint}/api/chat",
                    json={"model": self.extraction.model, "messages": messages, "stream": False},
                )
                resp.raise_for_status()
                return resp.json()["message"]["content"]
            headers = {}
            if self.extraction.api_key_env:
                key = self.env.get(self.extraction.api_key_env, "")
                if key:
                    headers["Authorization"] = f"Bearer {key}"
            resp = await client.post(
                f"{endpoint}/chat/completions",
                json={"model": self.extraction.model, "messages": messages,
                      "stream": False, "temperature": 0.0},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    def _embedding_func(self):
        """An EmbeddingFunc for LightRAG. Reuses T2's recorded backend when present
        (its vectors are unused by our export but keep LightRAG whole); otherwise a
        cheap deterministic hash embedder — extraction never depends on it."""
        import numpy as np
        from lightrag.utils import EmbeddingFunc

        record = self.embedding_record
        if record and record.get("kind") and record.get("kind") != "mock":
            from brainpick.embed import make_embedder

            kind = record["kind"]
            embedder = make_embedder(
                kind, record.get("endpoint", ""), record.get("model", ""),
                api_key=self.env.get("OPENAI_API_KEY", ""),
            )
            dim = int(record.get("dim") or 0) or len(embedder.embed(["brainpick"])[0])

            async def real_embed(texts):
                vectors = await asyncio.to_thread(embedder.embed, list(texts))
                return np.array(vectors, dtype=np.float32)

            return EmbeddingFunc(embedding_dim=dim, max_token_size=8192, func=real_embed)

        async def cheap_embed(texts):
            out = np.zeros((len(texts), _FALLBACK_DIM), dtype=np.float32)
            for row, text in enumerate(texts):
                for i, byte in enumerate(text.encode("utf-8")):
                    out[row][i % _FALLBACK_DIM] += byte
                norm = float(np.linalg.norm(out[row]))
                if norm:
                    out[row] /= norm
            return out

        return EmbeddingFunc(embedding_dim=_FALLBACK_DIM, max_token_size=8192, func=cheap_embed)
