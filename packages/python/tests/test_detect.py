"""Detection ladder (docs/embedding-detection.md + onboarding): bundle shape,
link style, and backend probes that are parallel, short-fused, and never raise."""
import http.server
import json
import socket
import threading
import time
from contextlib import contextmanager

import pytest

from brainpick.detect import (
    Backend,
    detect_bundle,
    detect_henxels,
    detect_link_style,
    pick_backend,
    probe_backends,
    probe_ollama,
    probe_openai_compatible,
)

OLLAMA_TAGS = {
    "models": [
        {"name": "qwen3.5:4b"},
        {"name": "mxbai-embed-large:latest"},
        {"name": "nomic-embed-text:latest"},
    ],
}


@contextmanager
def json_server(payloads: dict):
    """A local http.server thread answering GET with canned JSON — the fake backend."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = payloads.get(self.path)
            if body is None:
                self.send_error(404)
                return
            data = json.dumps(body).encode("utf-8")
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
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def fake_ollama():
    """One fake Ollama serving /api/tags with embedding and chat models mixed."""
    with json_server({"/api/tags": OLLAMA_TAGS}) as base:
        yield base


def closed_port() -> int:
    """A port that was just free — connecting to it must refuse, not hang."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


# -- backend probes ----------------------------------------------------------------


def test_probe_ollama_prefers_nomic_embed_text(fake_ollama):
    backend = probe_ollama(env={"OLLAMA_HOST": fake_ollama})
    assert backend == Backend("ollama", fake_ollama, "nomic-embed-text:latest")


def test_probe_ollama_reports_endpoint_with_no_embedding_model():
    with json_server({"/api/tags": {"models": [{"name": "qwen3.5:4b"}]}}) as base:
        backend = probe_ollama(env={"OLLAMA_HOST": base})
    assert backend is not None
    assert backend.model is None  # up, but nothing to embed with


def test_probe_ollama_normalizes_schemeless_host():
    with json_server({"/api/tags": OLLAMA_TAGS}) as base:
        backend = probe_ollama(env={"OLLAMA_HOST": base.removeprefix("http://")})
    assert backend is not None
    assert backend.endpoint == base


def test_probe_ollama_closed_port_is_a_silent_fast_miss():
    started = time.monotonic()
    backend = probe_ollama(env={"OLLAMA_HOST": f"http://127.0.0.1:{closed_port()}"})
    assert backend is None
    assert time.monotonic() - started < 2.0  # 300 ms budget, generous margin


def test_probe_openai_compatible_finds_embedding_model():
    models = {"data": [{"id": "qwen/qwen3-8b"}, {"id": "text-embedding-nomic-embed-text-v1.5"}]}
    with json_server({"/v1/models": models}) as base:
        backend = probe_openai_compatible(base)
    assert backend is not None
    assert backend.kind == "openai-compatible"
    assert backend.endpoint == f"{base}/v1"
    assert backend.model == "text-embedding-nomic-embed-text-v1.5"


def test_probe_backends_reports_every_target_and_pick_takes_the_first_model(fake_ollama):
    dead = f"127.0.0.1:{closed_port()}"
    results = probe_backends(
        env={"OLLAMA_HOST": fake_ollama},
        openai_compatible=(("lm studio", dead), ("llama.cpp", dead)),
    )
    assert [label for label, _ in results] == ["ollama", "lm studio", "llama.cpp"]
    assert results[1][1] is None and results[2][1] is None
    picked = pick_backend(results)
    assert picked is not None and picked.kind == "ollama"
    assert pick_backend([("ollama", Backend("ollama", "x", None))]) is None  # modelless ≠ found


# -- bundle detection --------------------------------------------------------------


def test_detect_bundle_okf_via_index_okf_version(kotiaurinko):
    info = detect_bundle(kotiaurinko)
    assert info.kind == "okf"
    assert info.docs == 10


def test_detect_bundle_density_scan(tmp_path):
    for name in ("yksi", "kaksi", "kolme"):
        (tmp_path / f"{name}.md").write_text(
            f"---\ntype: Concept\ntitle: {name}\n---\n\n# {name}\n", encoding="utf-8",
        )
    info = detect_bundle(tmp_path)
    assert info.kind == "density"
    assert info.typed == 3


def test_detect_bundle_none_when_empty_or_sparse(tmp_path):
    assert detect_bundle(tmp_path).kind == "none"
    (tmp_path / "a.md").write_text("---\ntype: Note\n---\n# a\n", encoding="utf-8")
    (tmp_path / "b.md").write_text("# b — no frontmatter\n", encoding="utf-8")
    info = detect_bundle(tmp_path)
    assert info.kind == "none"
    assert info.docs == 2
    assert info.typed == 1


def test_detect_bundle_ignores_always_excluded_dirs(tmp_path):
    (tmp_path / ".brainpick").mkdir()
    (tmp_path / ".brainpick" / "x.md").write_text("---\ntype: T\n---\n", encoding="utf-8")
    assert detect_bundle(tmp_path).docs == 0


# -- link style --------------------------------------------------------------------


def test_link_style_kotiaurinko_is_mixed_mostly_markdown(kotiaurinko):
    style = detect_link_style(kotiaurinko)
    assert style.style == "mixed"
    assert style.wikilinks == 2
    assert style.markdown > style.wikilinks


def test_link_style_pure_cases(tmp_path):
    wiki = tmp_path / "wiki"
    wiki.mkdir()
    (wiki / "a.md").write_text("# a\n\nSee [[b]] and [[c|the c page]].\n", encoding="utf-8")
    assert detect_link_style(wiki).style == "wikilinks"
    md = tmp_path / "md"
    md.mkdir()
    (md / "a.md").write_text("# a\n\nSee [b](b.md).\n", encoding="utf-8")
    assert detect_link_style(md).style == "markdown"
    assert detect_link_style(tmp_path / "md").markdown == 1
    empty = tmp_path / "empty"
    empty.mkdir()
    assert detect_link_style(empty).style == "none"


# -- henxels -----------------------------------------------------------------------


def test_detect_henxels_bundle_root_beats_repo_root(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    bundle = repo / "wiki"
    bundle.mkdir()
    assert detect_henxels(bundle) == repo / "henxels.yaml"
    (bundle / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    assert detect_henxels(bundle) == bundle / "henxels.yaml"


def test_detect_henxels_none_outside_any_contract(tmp_path):
    lone = tmp_path / "lone"
    lone.mkdir()
    assert detect_henxels(lone) is None
