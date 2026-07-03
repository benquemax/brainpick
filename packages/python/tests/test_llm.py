"""Chat clients for [models.extraction] (spec/80): one complete() surface, two
HTTP backends, a mock for tests — misses raise instructions, never hang."""
import http.server
import json
import socket
import threading
from contextlib import contextmanager

import pytest

from brainpick.config import ExtractionConfig
from brainpick.llm import ChatUnavailable, MockChat, OllamaChat, OpenAICompatChat, make_chat


@contextmanager
def chat_server(payload: dict):
    """A local http.server answering every POST with canned JSON, recording requests."""
    seen: list[dict] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            seen.append({
                "path": self.path,
                "body": json.loads(self.rfile.read(length).decode("utf-8")),
                "authorization": self.headers.get("Authorization"),
            })
            data = json.dumps(payload).encode("utf-8")
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
        yield f"http://127.0.0.1:{server.server_address[1]}", seen
    finally:
        server.shutdown()
        server.server_close()


def closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_ollama_chat_speaks_api_chat_without_streaming():
    payload = {"message": {"role": "assistant", "content": "merged text"}}
    with chat_server(payload) as (base, seen):
        answer = OllamaChat(base, "qwen3.5:4b").complete("be terse", "merge these")
    assert answer == "merged text"
    (request,) = seen
    assert request["path"] == "/api/chat"
    assert request["body"]["model"] == "qwen3.5:4b"
    assert request["body"]["stream"] is False
    assert request["body"]["messages"] == [
        {"role": "system", "content": "be terse"},
        {"role": "user", "content": "merge these"},
    ]


def test_openai_compat_chat_hits_v1_chat_completions_with_bearer():
    payload = {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}
    with chat_server(payload) as (base, seen):
        client = OpenAICompatChat(f"{base}/v1", "qwen3.5-4b", api_key="sk-local")
        answer = client.complete("sys", "usr")
    assert answer == "ok"
    (request,) = seen
    assert request["path"] == "/v1/chat/completions"
    assert request["authorization"] == "Bearer sk-local"
    assert request["body"]["model"] == "qwen3.5-4b"


def test_chat_backend_down_raises_an_instruction():
    client = OllamaChat(f"http://127.0.0.1:{closed_port()}", "qwen3.5:4b")
    with pytest.raises(ChatUnavailable, match="models.extraction"):
        client.complete("sys", "usr")


def test_chat_gibberish_payload_raises_not_crashes():
    with chat_server({"unexpected": True}) as (base, _seen):
        with pytest.raises(ChatUnavailable):
            OllamaChat(base, "m").complete("s", "u")
        with pytest.raises(ChatUnavailable):
            OpenAICompatChat(f"{base}/v1", "m").complete("s", "u")


def test_make_chat_resolves_kinds_and_api_key_env():
    assert make_chat(ExtractionConfig()) is None  # nothing configured
    mock = make_chat(ExtractionConfig(kind="mock"))
    assert isinstance(mock, MockChat)
    ollama = make_chat(ExtractionConfig(kind="ollama", endpoint="http://x:11434", model="m"))
    assert isinstance(ollama, OllamaChat)
    assert (ollama.endpoint, ollama.model) == ("http://x:11434", "m")
    compat = make_chat(
        ExtractionConfig(kind="openai-compatible", endpoint="http://x:1234/v1",
                         model="m", api_key_env="MY_KEY"),
        env={"MY_KEY": "sk-from-env"},
    )
    assert isinstance(compat, OpenAICompatChat)
    assert compat.api_key == "sk-from-env"  # resolved by reference, never stored in config


def test_make_chat_unknown_kind_warns_and_returns_none():
    with pytest.warns(UserWarning, match="banana"):
        assert make_chat(ExtractionConfig(kind="banana")) is None


def test_mock_chat_canned_callable_and_derived_replies():
    canned = MockChat(reply="fixed")
    assert canned.complete("s", "u") == "fixed"
    assert canned.calls == [("s", "u")]

    derived = MockChat(reply=lambda system, user: user.upper())
    assert derived.complete("s", "abc") == "ABC"

    echoing = MockChat()  # default: echo the text after the last --- YOURS header
    prompt = "--- THEIRS (saved) ---\nold\n--- YOURS (incoming) ---\nnew doc\nline two\n"
    assert echoing.complete("s", prompt) == "new doc\nline two\n"
    assert echoing.complete("s", "no marker") == "no marker"
