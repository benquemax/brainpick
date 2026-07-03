"""Embedding clients (spec/30): one tiny protocol, four backends, ≤64 batching.

The compile stage and query-time embedding share these; whichever backend the
t2/embedding.json record names is the one that must answer at query time.
"""
from __future__ import annotations

import re
from typing import Iterable, Protocol

import httpx

BATCH_SIZE = 64  # spec/30: embedding requests are batched (≤ 64 texts per call)
MOCK_DIM = 16
_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)  # same boundaries as keyword search (spec/50)
_HTTP_TIMEOUT = httpx.Timeout(120.0, connect=5.0)  # first call may load a model


class EmbeddingUnavailable(Exception):
    """The backend cannot embed right now — the message is a one-line instruction."""


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


def _batches(texts: list[str]) -> Iterable[list[str]]:
    for start in range(0, len(texts), BATCH_SIZE):
        yield texts[start:start + BATCH_SIZE]


def _fnv1a(data: bytes) -> int:
    value = 2166136261
    for byte in data:
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


class MockEmbedder:
    """The normative conformance embedder (spec/30): FNV-1a token buckets, dim 16.

    Deterministic and dependency-free; reachable via `[models.embedding]
    kind = "mock"` — a test hook, never something init records.
    """

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(text) for text in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * MOCK_DIM
        for token in _TOKEN.findall(text.lower()):
            vec[_fnv1a(token.encode("utf-8")) % MOCK_DIM] += 1.0
        norm = sum(x * x for x in vec) ** 0.5
        return [x / norm for x in vec] if norm else vec  # all-zero stays all-zero


class _HttpEmbedder:
    def __init__(self, endpoint: str, model: str, api_key: str = ""):
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.api_key = api_key

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for batch in _batches(texts):
            vectors.extend(self._embed_batch(batch))
        return vectors

    def _post(self, url: str, payload: dict) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=_HTTP_TIMEOUT)
            response.raise_for_status()
            return response.json()
        except Exception as error:
            raise EmbeddingUnavailable(
                f"embedding backend at {self.endpoint} did not answer ({error}) — "
                f"check the [models.embedding] endpoint and that '{self.model}' is available"
            ) from error

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:  # pragma: no cover
        raise NotImplementedError


class OllamaEmbedder(_HttpEmbedder):
    """POST {endpoint}/api/embed {"model", "input": [...]} → {"embeddings": [...]}."""

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        data = self._post(f"{self.endpoint}/api/embed", {"model": self.model, "input": batch})
        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(batch):
            raise EmbeddingUnavailable(
                f"ollama at {self.endpoint} returned no embeddings for '{self.model}' — "
                f"pull it first: ollama pull {self.model}"
            )
        return [[float(x) for x in vec] for vec in embeddings]


class OpenAICompatEmbedder(_HttpEmbedder):
    """POST {endpoint}/embeddings (endpoint already ends in /v1) — OpenAI shape."""

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        data = self._post(f"{self.endpoint}/embeddings", {"model": self.model, "input": batch})
        items = data.get("data")
        if not isinstance(items, list) or len(items) != len(batch):
            raise EmbeddingUnavailable(
                f"{self.endpoint} returned no embeddings for '{self.model}' — "
                "check the model name in [models.embedding]"
            )
        ordered = sorted(items, key=lambda item: item.get("index", 0))
        return [[float(x) for x in item["embedding"]] for item in ordered]


class FastembedEmbedder:
    """Local ONNX embeddings via the [vectors-local] extra — the offline floor."""

    def __init__(self, model: str):
        try:
            from fastembed import TextEmbedding
        except ImportError as error:
            raise EmbeddingUnavailable(
                "fastembed is not installed — pip install 'brainpick[vectors-local]'"
            ) from error
        self.model = model
        self._engine = TextEmbedding(model_name=model)

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for batch in _batches(texts):
            vectors.extend([float(x) for x in vec] for vec in self._engine.embed(batch))
        return vectors


def make_embedder(kind: str, endpoint: str = "", model: str = "", api_key: str = "") -> Embedder:
    """The [models.embedding] record → a client. Unknown kinds are instructions."""
    if kind == "mock":
        return MockEmbedder()
    if kind == "ollama":
        return OllamaEmbedder(endpoint, model)
    if kind in ("openai-compatible", "openai"):
        return OpenAICompatEmbedder(endpoint, model, api_key=api_key)
    if kind == "fastembed":
        return FastembedEmbedder(model)
    raise EmbeddingUnavailable(
        f"unknown embedding kind '{kind}' — use ollama, openai-compatible, fastembed, or mock"
    )
