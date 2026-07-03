"""build_app: one Starlette process for /api, /api/live, /mcp, and the web UI."""
from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

from urllib.parse import parse_qs

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from brainpick.auth import (
    AUTH_REQUIRED_ERROR,
    LOGIN_HTML,
    SESSION_COOKIE,
    AuthProvider,
    AuthStore,
    auth_active,
    verify_session,
    verify_token,
)
from brainpick.config import Config, load_config
from brainpick.mcp_server import WRITES_OFF_REFUSAL, create_mcp_server
from brainpick.serve.live import live_endpoint
from brainpick.serve.rest import api_not_found, api_routes
from brainpick.serve.state import ServeState
from brainpick.serve.watcher import watch_bundle

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", ""}

FALLBACK_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>brainpick</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto;">
<h1>brainpick is serving</h1>
<p>The web UI is not built yet. Build it once:</p>
<pre>cd packages/webui &amp;&amp; npm install &amp;&amp; npm run build</pre>
<p>Meanwhile the API is live: <a href="/api/status">/api/status</a>,
<a href="/api/graph">/api/graph</a>, <a href="/api/live">/api/live</a> — and MCP at /mcp.</p>
</body></html>
"""


def _is_local(host: str) -> bool:
    return host in LOCAL_HOSTS


def _resolve_ui_dir() -> Path | None:
    """Package data first (shipped wheels), then the dev checkout's webui build."""
    package_static = Path(__file__).resolve().parent.parent / "_static"
    if (package_static / "index.html").is_file():
        return package_static
    dev_dist = Path(__file__).resolve().parents[4] / "webui" / "dist"
    if (dev_dist / "index.html").is_file():
        return dev_dist
    return None


def _make_spa_endpoint(ui_dir: Path | None):
    async def spa(request: Request) -> Response:
        if ui_dir is None:
            return HTMLResponse(FALLBACK_HTML)
        path = request.path_params.get("path", "")
        if path:
            candidate = (ui_dir / path).resolve()
            if candidate.is_file() and candidate.is_relative_to(ui_dir):
                return FileResponse(candidate)
        return FileResponse(ui_dir / "index.html")  # SPA fallback for client routes

    return spa


def _is_mcp_path(path: str) -> bool:
    return (path in ("/mcp", "/sse", "/messages")
            or path.startswith(("/mcp/", "/sse/", "/messages/")))


def _scope_headers(scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}


def _session_cookie(scope) -> str:
    parts = [v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"cookie"]
    for chunk in "; ".join(parts).split(";"):
        name, _, value = chunk.strip().partition("=")
        if name == SESSION_COOKIE:
            return value
    return ""


class AuthGateMiddleware:
    """spec/80 enforcement: once tokens or a password exist, /api/* and /mcp demand a
    Bearer token or a session cookie (/api/live also takes ?token=); the static UI asks
    for a login only when a password is set. Without an auth file the legacy
    non-localhost [serve] token rule still guards MCP — superseded by real tokens.
    stdio MCP never passes through here: it is local by construction, never gated."""

    def __init__(self, app, provider: AuthProvider, legacy_token: str = ""):
        self.app = app
        self.provider = provider
        self.legacy_token = legacy_token

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            response = self._gate(scope)
            if response is not None:
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _gate(self, scope) -> Response | None:
        path = scope["path"]
        auth = self.provider.current()
        if not auth_active(auth):
            if self.legacy_token and _is_mcp_path(path) \
                    and _scope_headers(scope).get("authorization") != f"Bearer {self.legacy_token}":
                return JSONResponse(
                    {"error": "missing or wrong bearer token — send Authorization: Bearer <token>"},
                    status_code=401,
                )
            return None
        if path in ("/api/login", "/api/logout"):
            return None  # the way in (and out) stays reachable
        if path == "/api" or path.startswith("/api/") or _is_mcp_path(path):
            if self._authorized(auth, path, scope):
                return None
            return JSONResponse({"error": AUTH_REQUIRED_ERROR}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        if auth.password is not None and scope.get("method", "GET") in ("GET", "HEAD") \
                and not verify_session(auth, _session_cookie(scope)):
            return HTMLResponse(LOGIN_HTML)  # spec/50: / serves the login page, no session yet
        return None

    def _authorized(self, auth: AuthStore, path: str, scope) -> bool:
        bearer = _scope_headers(scope).get("authorization", "")
        if bearer.startswith("Bearer ") and verify_token(auth, bearer[len("Bearer "):]):
            return True
        if verify_session(auth, _session_cookie(scope)):
            return True
        if path == "/api/live":  # EventSource cannot set headers (spec/80)
            query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
            token = (query.get("token") or [""])[0]
            if verify_token(auth, token):
                return True
        return False


def _http_write_refusal(config: Config, auth_configured: bool) -> str | None:
    if config.serve.writes == "off":
        return WRITES_OFF_REFUSAL
    if not _is_local(config.serve.host) and not config.serve.token and not auth_configured:
        return "brain_write over a non-localhost bind needs [serve] token set in brainpick.toml"
    return None


def build_app(root: str | Path, config: Config | None = None) -> Starlette:
    root = Path(root).resolve()
    if config is None:
        config = load_config(root)
    root = (root / config.bundle.root).resolve()

    state = ServeState(root, config)
    state.load()

    auth_provider = AuthProvider(root)
    mcp_server = create_mcp_server(
        state, write_refusal=_http_write_refusal(config, auth_active(auth_provider.current())),
    )
    transports = config.serve.transports or ["streamable-http"]
    streamable = "streamable-http" in transports
    mcp_route_list: list = []
    if streamable:
        # the SDK's app is a plain Route("/mcp", ...) — lift it instead of nesting Mounts
        mcp_route_list.extend(mcp_server.streamable_http_app().routes)
    if "sse" in transports:
        mcp_route_list.extend(mcp_server.sse_app().routes)

    routes = [
        *api_routes(),
        Route("/api/live", live_endpoint),
        Route("/api/{rest:path}", api_not_found),
        *mcp_route_list,
        Route("/{path:path}", _make_spa_endpoint(_resolve_ui_dir())),
    ]

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        state.loop = asyncio.get_running_loop()
        async with contextlib.AsyncExitStack() as stack:
            if streamable:  # the streamable-http transport needs its session manager running
                await stack.enter_async_context(mcp_server.session_manager.run())
            watcher = asyncio.create_task(watch_bundle(state)) if config.serve.watch else None
            try:
                yield
            finally:
                if watcher is not None:
                    watcher.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await watcher

    legacy_token = config.serve.token if not _is_local(config.serve.host) else ""
    middleware = [Middleware(AuthGateMiddleware, provider=auth_provider, legacy_token=legacy_token)]

    app = Starlette(routes=routes, lifespan=lifespan, middleware=middleware)
    app.state.brainpick = state
    app.state.auth = auth_provider
    return app
