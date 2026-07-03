"""Embedder clients (spec/30): the normative mock, HTTP backends, ≤64 batching."""
import http.server
import json
import math
import threading
from contextlib import contextmanager

import pytest

from brainpick.embed import (
    BATCH_SIZE,
    EmbeddingUnavailable,
    MockEmbedder,
    OllamaEmbedder,
    OpenAICompatEmbedder,
    make_embedder,
)

# fnv1a("kuu") = 1815928360 -> bucket 8; fnv1a("maa") = 4003661646 -> bucket 14
KUU_BUCKET, MAA_BUCKET = 8, 14


@contextmanager
def embed_server(reply):
    """An http.server thread answering POST with canned JSON, capturing request bodies."""
    calls = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            calls.append({"path": self.path, "body": body})
            data = json.dumps(reply(body)).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", calls
    finally:
        server.shutdown()
        server.server_close()


# -- the normative mock (spec/30) ----------------------------------------------------


def test_mock_embedder_pins_the_spec_vector():
    [vec] = MockEmbedder().embed(["Kuu kuu maa"])
    assert len(vec) == 16
    expected = [0.0] * 16
    expected[KUU_BUCKET] = 2.0 / math.sqrt(5.0)
    expected[MAA_BUCKET] = 1.0 / math.sqrt(5.0)
    assert vec == pytest.approx(expected, abs=1e-12)
    assert math.isclose(sum(x * x for x in vec), 1.0, abs_tol=1e-12)


def test_mock_embedder_tokenizes_on_non_alnum_and_underscore():
    [with_underscore] = MockEmbedder().embed(["kuu_maa"])
    [with_space] = MockEmbedder().embed(["kuu maa"])
    assert with_underscore == with_space  # `_` is a boundary (spec/30)


def test_mock_embedder_all_zero_stays_all_zero():
    [vec] = MockEmbedder().embed(["!!! --- ..."])
    assert vec == [0.0] * 16
    assert MockEmbedder().embed([""]) == [[0.0] * 16]


def test_mock_embedder_is_case_insensitive_and_deterministic():
    a = MockEmbedder().embed(["Aurinko PAISTAA"])
    b = MockEmbedder().embed(["aurinko paistaa"])
    assert a == b


# -- HTTP backends -------------------------------------------------------------------


def test_ollama_embedder_posts_api_embed_and_batches():
    def reply(body):
        return {"embeddings": [[float(len(t)), 0.0] for t in body["input"]]}

    with embed_server(reply) as (base, calls):
        embedder = OllamaEmbedder(base, "nomic-embed-text")
        texts = [f"t{i}" * (i + 1) for i in range(70)]
        vectors = embedder.embed(texts)
    assert len(vectors) == 70
    assert vectors[0] == [2.0, 0.0]  # order preserved across batches
    assert vectors[69] == [float(len(texts[69])), 0.0]
    assert [c["path"] for c in calls] == ["/api/embed", "/api/embed"]
    assert [len(c["body"]["input"]) for c in calls] == [BATCH_SIZE, 70 - BATCH_SIZE]
    assert all(c["body"]["model"] == "nomic-embed-text" for c in calls)


def test_openai_compat_embedder_posts_v1_embeddings_and_sorts_by_index():
    def reply(body):
        data = [{"embedding": [float(i)], "index": i} for i in range(len(body["input"]))]
        return {"data": list(reversed(data))}  # servers may reorder; index is the truth

    with embed_server(reply) as (base, calls):
        embedder = OpenAICompatEmbedder(f"{base}/v1", "text-embedding-nomic")
        vectors = embedder.embed(["a", "b", "c"])
    assert vectors == [[0.0], [1.0], [2.0]]
    assert calls[0]["path"] == "/v1/embeddings"
    assert calls[0]["body"] == {"model": "text-embedding-nomic", "input": ["a", "b", "c"]}


def test_http_embedder_failure_raises_embedding_unavailable():
    embedder = OllamaEmbedder("http://127.0.0.1:9", "nomic-embed-text")  # port 9: discard
    with pytest.raises(EmbeddingUnavailable):
        embedder.embed(["kuu"])


def test_empty_input_never_calls_the_backend():
    embedder = OllamaEmbedder("http://127.0.0.1:9", "nomic-embed-text")
    assert embedder.embed([]) == []


# -- the factory ---------------------------------------------------------------------


def test_make_embedder_maps_kinds():
    assert isinstance(make_embedder("mock"), MockEmbedder)
    assert isinstance(make_embedder("ollama", "http://x", "m"), OllamaEmbedder)
    assert isinstance(make_embedder("openai-compatible", "http://x/v1", "m"), OpenAICompatEmbedder)
    # "openai" (init's paid-API record) is an openai-compatible endpoint with a bearer key
    assert isinstance(make_embedder("openai", "https://api.openai.com/v1", "m"), OpenAICompatEmbedder)
    with pytest.raises(EmbeddingUnavailable):
        make_embedder("teleport", "http://x", "m")


def test_make_embedder_fastembed_is_import_guarded():
    fastembed = pytest.importorskip("fastembed", reason="[vectors-local] extra not installed")
    assert fastembed is not None
    embedder = make_embedder("fastembed", "", "BAAI/bge-small-en-v1.5")
    [vec] = embedder.embed(["kuu"])
    assert len(vec) > 0
