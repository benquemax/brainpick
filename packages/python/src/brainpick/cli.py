"""brainpick CLI — argparse, stdlib-first, plain in pipes (henxels family voice)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from brainpick import __version__
from brainpick.compile.pipeline import CompileResult, check_fresh, run_compile


def _print_compiled(result: CompileResult) -> None:
    s = result.stats
    print(
        f"compiled: {s['docs']} docs · {s['edges']} links · {s['ghosts']} ghosts"
        f" · {s['orphans']} orphans · seq {result.seq}",
        flush=True,  # watch mode lives in pipes; every line lands when it happens
    )


def _cmd_compile(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    if args.check_fresh:
        verdict = check_fresh(root)
        print("fresh" if verdict.fresh else verdict.reason)
        return 0 if verdict.fresh else 1

    result = run_compile(root, full=args.full)
    if result.changed:
        _print_compiled(result)
    else:
        print(f"fresh — nothing to do (seq {result.seq})")

    if args.watch:
        from watchfiles import watch as watch_sync

        from brainpick.serve.watcher import DEBOUNCE_MS, source_filter

        print(f"watching {root} — Ctrl-C stops", flush=True)
        for _changes in watch_sync(root, watch_filter=source_filter(root), step=DEBOUNCE_MS,
                                   raise_interrupt=False):
            result = run_compile(root)
            if result.changed:
                _print_compiled(result)
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import threading
    import webbrowser

    import uvicorn

    from brainpick.config import load_config
    from brainpick.serve.app import build_app

    root = Path(args.root).resolve()
    config = load_config(root)
    if args.host is not None:
        config.serve.host = args.host
    if args.port is not None:
        config.serve.port = args.port
    if args.no_watch:
        config.serve.watch = False

    app = build_app(root, config)
    display_host = "127.0.0.1" if config.serve.host in ("0.0.0.0", "::") else config.serve.host
    url = f"http://{display_host}:{config.serve.port}/"
    print(f"serving {root} at {url} — UI /, REST /api, live /api/live, MCP /mcp (Ctrl-C stops)",
          flush=True)
    if args.open:
        threading.Timer(0.8, webbrowser.open, [url]).start()
    uvicorn.run(app, host=config.serve.host, port=config.serve.port, log_level="warning")
    return 0


def _cmd_mcp(args: argparse.Namespace) -> int:
    # stdio is the protocol channel: nothing may print to stdout here
    from brainpick.config import load_config
    from brainpick.mcp_server import WRITES_OFF_REFUSAL, create_mcp_server
    from brainpick.serve.state import ServeState

    root = Path(args.root).resolve()
    config = load_config(root)
    state = ServeState(root, config)
    state.load()
    refusal = WRITES_OFF_REFUSAL if config.serve.writes == "off" else None
    create_mcp_server(state, write_refusal=refusal).run(transport="stdio")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="brainpick",
        description="pick your agent's brain — compile and serve OKF knowledge bundles",
    )
    parser.add_argument("--version", action="version", version=f"brainpick {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_compile = sub.add_parser("compile", help="compile the bundle into .brainpick/ artifacts")
    p_compile.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_compile.add_argument("--full", action="store_true", help="ignore the manifest, rebuild all")
    p_compile.add_argument("--check-fresh", action="store_true",
                           help="verify freshness without writing (exit 1 when stale)")
    p_compile.add_argument("--watch", action="store_true",
                           help="stay running and recompile on changes")
    p_compile.set_defaults(func=_cmd_compile)

    p_serve = sub.add_parser("serve", help="serve REST + live deltas + web UI + MCP in one process")
    p_serve.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_serve.add_argument("--host", default=None, help="bind host (default: config or 127.0.0.1)")
    p_serve.add_argument("--port", type=int, default=None, help="bind port (default: config or 4747)")
    p_serve.add_argument("--no-watch", action="store_true", help="serve without the file watcher")
    p_serve.add_argument("--open", action="store_true", help="open the UI in a browser")
    p_serve.set_defaults(func=_cmd_serve)

    p_mcp = sub.add_parser("mcp", help="speak MCP over stdio (for agent hosts)")
    p_mcp.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_mcp.set_defaults(func=_cmd_mcp)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
