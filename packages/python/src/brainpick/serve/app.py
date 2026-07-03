"""build_app: one Starlette process for /api, /api/live, /mcp, and the web UI."""
from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.routing import Route

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


class BearerGateMiddleware:
    """On non-localhost binds, MCP endpoints require the configured bearer token (spec/80)."""

    def __init__(self, app, token: str):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(("/mcp", "/sse", "/messages")):
            headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                       for k, v in scope.get("headers", [])}
            if headers.get("authorization") != f"Bearer {self.token}":
                response = JSONResponse(
                    {"error": "missing or wrong bearer token — send Authorization: Bearer <token>"},
                    status_code=401,
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def _http_write_refusal(config: Config) -> str | None:
    if config.serve.writes == "off":
        return WRITES_OFF_REFUSAL
    if not _is_local(config.serve.host) and not config.serve.token:
        return "brain_write over a non-localhost bind needs [serve] token set in brainpick.toml"
    return None


def build_app(root: str | Path, config: Config | None = None) -> Starlette:
    root = Path(root).resolve()
    if config is None:
        config = load_config(root)
    root = (root / config.bundle.root).resolve()

    state = ServeState(root, config)
    state.load()

    mcp_server = create_mcp_server(state, write_refusal=_http_write_refusal(config))
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

    middleware = []
    if not _is_local(config.serve.host) and config.serve.token:
        middleware.append(Middleware(BearerGateMiddleware, token=config.serve.token))

    app = Starlette(routes=routes, lifespan=lifespan, middleware=middleware)
    app.state.brainpick = state
    return app
