"""Chat-completion clients for [models.extraction] (spec/80).

A sibling of embed.py, kept separate on purpose: chat is a different protocol
surface (messages in, one string out — no batching, no dimensions) with its own
failure type. One `complete(system, user) -> str` surface, no streaming, short
timeouts. The extraction model powers T3 and doubles as the merge resolver for
stale brain_writes (spec/70).
"""
from __future__ import annotations

import os
import warnings
from typing import Callable, Mapping, Protocol

import httpx

_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=5.0)  # single-shot merges — never streams


class ChatUnavailable(Exception):
    """The chat backend cannot answer right now — the message is a one-line instruction."""


class ChatClient(Protocol):
    def complete(self, system: str, user: str) -> str: ...


class _HttpChat:
    def __init__(self, endpoint: str, model: str, api_key: str = ""):
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.api_key = api_key

    def _post(self, url: str, payload: dict) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=_HTTP_TIMEOUT)
            response.raise_for_status()
            return response.json()
        except Exception as error:
            raise ChatUnavailable(
                f"chat backend at {self.endpoint} did not answer ({error}) — "
                f"check the [models.extraction] endpoint and that '{self.model}' is available"
            ) from error

    def _messages(self, system: str, user: str) -> list[dict]:
        return [{"role": "system", "content": system}, {"role": "user", "content": user}]


class OllamaChat(_HttpChat):
    """POST {endpoint}/api/chat {"model", "messages", "stream": false} → message.content."""

    def complete(self, system: str, user: str) -> str:
        data = self._post(f"{self.endpoint}/api/chat", {
            "model": self.model,
            "messages": self._messages(system, user),
            "stream": False,
        })
        message = data.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            raise ChatUnavailable(
                f"ollama at {self.endpoint} returned no message for '{self.model}' — "
                f"pull it first: ollama pull {self.model}"
            )
        return content


class OpenAICompatChat(_HttpChat):
    """POST {endpoint}/chat/completions (endpoint already ends in /v1) — OpenAI shape."""

    def complete(self, system: str, user: str) -> str:
        data = self._post(f"{self.endpoint}/chat/completions", {
            "model": self.model,
            "messages": self._messages(system, user),
            "stream": False,
        })
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = None
        if not isinstance(content, str):
            raise ChatUnavailable(
                f"{self.endpoint} returned no completion for '{self.model}' — "
                "check the model name in [models.extraction]"
            )
        return content


class MockChat:
    """The test hook behind `[models.extraction] kind = "mock"` — never something
    init records. Replies with `reply` (string or callable); by default it echoes
    the text after the last `--- YOURS` section header of the merge prompts
    (brainpick.merge), which is exactly enough to prove the plumbing."""

    def __init__(self, reply: str | Callable[[str, str], str] | None = None):
        self.reply = reply
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str) -> str:
        self.calls.append((system, user))
        if callable(self.reply):
            return self.reply(system, user)
        if self.reply is not None:
            return self.reply
        marker = user.rfind("--- YOURS")
        if marker == -1:
            return user
        newline = user.find("\n", marker)
        return user[newline + 1:] if newline != -1 else user


def make_chat(extraction, env: Mapping[str, str] | None = None) -> ChatClient | None:
    """The [models.extraction] record → a client, or None when nothing is configured.

    `api_key_env` names an env var to read the key from (spec/80: tokens by
    reference, never a key in config). Unknown kinds warn and yield None — a
    missing merge resolver degrades the ladder, never the write path."""
    env = os.environ if env is None else env
    kind = extraction.kind
    if not kind:
        return None
    if kind == "mock":
        return MockChat()
    if kind == "ollama":
        return OllamaChat(extraction.endpoint, extraction.model)
    if kind in ("openai-compatible", "openai"):
        api_key = env.get(extraction.api_key_env, "") if extraction.api_key_env else ""
        return OpenAICompatChat(extraction.endpoint, extraction.model, api_key=api_key)
    warnings.warn(
        f"unknown extraction kind '{kind}' — use ollama, openai-compatible, or mock", stacklevel=2,
    )
    return None
