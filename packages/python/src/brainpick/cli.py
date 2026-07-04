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
        f"compiled: {s.get('docs', 0)} docs · {s.get('edges', 0)} links"
        f" · {s.get('ghosts', 0)} ghosts · {s.get('orphans', 0)} orphans · seq {result.seq}",
        flush=True,  # watch mode lives in pipes; every line lands when it happens
    )


def _print_warnings(result: CompileResult) -> None:
    for warning in result.warnings:
        print(warning, flush=True)


def _cmd_compile(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    if args.check_fresh:
        verdict = check_fresh(root)
        print("fresh" if verdict.fresh else verdict.reason)
        return 0 if verdict.fresh else 1

    only = (args.only,) if args.only else None
    result = run_compile(root, full=args.full, only=only)
    if result.changed:
        _print_compiled(result)
    else:
        print(f"fresh — nothing to do (seq {result.seq})")
    _print_warnings(result)

    if args.watch:
        from watchfiles import watch as watch_sync

        from brainpick.serve.watcher import DEBOUNCE_MS, source_filter

        print(f"watching {root} — Ctrl-C stops", flush=True)
        for _changes in watch_sync(root, watch_filter=source_filter(root), step=DEBOUNCE_MS,
                                   raise_interrupt=False):
            result = run_compile(root, only=only)
            if result.changed:
                _print_compiled(result)
            _print_warnings(result)
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


def _cmd_init(args: argparse.Namespace) -> int:
    from brainpick.scaffold import run_init

    return run_init(Path(args.root), yes=args.yes, dry_run=args.dry_run)


def _cmd_doctor(args: argparse.Namespace) -> int:
    from brainpick.scaffold import run_doctor

    return run_doctor(Path(args.root))


def _cmd_token_create(args: argparse.Namespace) -> int:
    from brainpick.auth import run_token_create

    return run_token_create(Path(args.root), name=args.name)


def _cmd_token_list(args: argparse.Namespace) -> int:
    from brainpick.auth import run_token_list

    return run_token_list(Path(args.root))


def _cmd_token_revoke(args: argparse.Namespace) -> int:
    from brainpick.auth import run_token_revoke

    return run_token_revoke(Path(args.root), args.token_id)


def _cmd_password_set(args: argparse.Namespace) -> int:
    from brainpick.auth import run_password_set

    return run_password_set(Path(args.root), use_stdin=args.stdin)


def _cmd_password_clear(args: argparse.Namespace) -> int:
    from brainpick.auth import run_password_clear

    return run_password_clear(Path(args.root))


def _held_state(root: Path, config):
    """Load the compiled brain read-only (never compiles). Returns (state, None)
    or (None, instruction) so the query mirrors self-heal instead of crashing."""
    from brainpick.serve.state import ServeState

    bp = root / ".brainpick"
    needed = (bp / "manifest.json", bp / "t1" / "graph.json", bp / "t1" / "docs.jsonl")
    if not all(path.is_file() for path in needed):
        return None, f"no compiled brain at {root} — run: brainpick compile --root {root}"
    state = ServeState(root, config)
    state.reload_artifacts()
    return state, None


def _emit_uncompiled(instruction: str, as_json: bool) -> int:
    from brainpick.query.present import to_json

    if as_json:
        print(to_json({"error": instruction, "hint": "compile the brain, then retry"}))
    else:
        print(instruction, file=sys.stderr)
    return 0


def _note_if_stale(root: Path) -> None:
    if not check_fresh(root).fresh:
        print(f"note: the brain is stale — run: brainpick compile --root {root}", file=sys.stderr)


def _query_setup(args: argparse.Namespace):
    """Shared prelude for the four query mirrors: resolve, load, warn if stale."""
    from brainpick.config import load_config

    root = Path(args.root).resolve()
    state, instruction = _held_state(root, load_config(root))
    if state is None:
        return None, _emit_uncompiled(instruction, args.json)
    _note_if_stale(root)
    return state, 0


def _cmd_search(args: argparse.Namespace) -> int:
    state, code = _query_setup(args)
    if state is None:
        return code
    from brainpick.mcp_server import search_payload
    from brainpick.query.present import present_search, to_json

    payload = search_payload(state, args.query, mode=args.mode, limit=args.limit)
    print(to_json(payload) if args.json else present_search(payload, args.query))
    return 0


def _cmd_read(args: argparse.Namespace) -> int:
    state, code = _query_setup(args)
    if state is None:
        return code
    from brainpick.mcp_server import read_payload
    from brainpick.query.present import present_read, to_json

    payload = read_payload(state, args.doc)
    print(to_json(payload) if args.json else present_read(payload))
    return 0


def _cmd_neighbors(args: argparse.Namespace) -> int:
    state, code = _query_setup(args)
    if state is None:
        return code
    from brainpick.mcp_server import neighbors_payload
    from brainpick.query.present import present_neighbors, to_json

    payload = neighbors_payload(state, args.doc, depth=args.depth, layer=args.layer)
    print(to_json(payload) if args.json else present_neighbors(payload))
    return 0


def _cmd_overview(args: argparse.Namespace) -> int:
    state, code = _query_setup(args)
    if state is None:
        return code
    from brainpick.mcp_server import overview_payload
    from brainpick.query.present import present_overview, to_json

    payload = overview_payload(state)
    print(to_json(payload) if args.json else present_overview(payload))
    return 0


def _cmd_integrate(args: argparse.Namespace) -> int:
    from brainpick.integrate import run_integrate

    return run_integrate(args.target, Path(args.root), dry_run=args.dry_run)


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
    p_compile.add_argument("--only", choices=("t1", "t2"), default=None,
                           help="compile a single tier (t2 reuses the compiled docs substrate)")
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

    # The four query mirrors — the same router/state the MCP tools and REST use,
    # in plain terminal form (add --json for the raw MCP payload).
    p_search = sub.add_parser("search", help="search the compiled brain (the brain_search tool, in the terminal)")
    p_search.add_argument("query", help="the search query")
    p_search.add_argument("--mode", default="auto",
                          help="auto | keyword | semantic | graph (unknown falls back to auto)")
    p_search.add_argument("--limit", type=int, default=8, help="max hits (default: 8)")
    p_search.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_search.add_argument("--json", action="store_true", help="print the raw MCP payload as JSON")
    p_search.set_defaults(func=_cmd_search)

    p_read = sub.add_parser("read", help="read one doc from the brain (path, stem, or approximate title)")
    p_read.add_argument("doc", help="a path (kuu.md), a stem (kuu), or an approximate title")
    p_read.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_read.add_argument("--json", action="store_true", help="print the raw MCP payload as JSON")
    p_read.set_defaults(func=_cmd_read)

    p_neighbors = sub.add_parser("neighbors", help="walk the link graph around a doc")
    p_neighbors.add_argument("doc", help="the doc to center on (path, stem, or title)")
    p_neighbors.add_argument("--depth", type=int, default=1, help="hops to walk, 1–3 (default: 1)")
    p_neighbors.add_argument("--layer", default="links",
                             help="links | entities | both (entities degrades to links until T3)")
    p_neighbors.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_neighbors.add_argument("--json", action="store_true", help="print the raw MCP payload as JSON")
    p_neighbors.set_defaults(func=_cmd_neighbors)

    p_overview = sub.add_parser("overview", help="one screen of the whole brain: counts, tiers, every doc")
    p_overview.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_overview.add_argument("--json", action="store_true", help="print the raw MCP payload as JSON")
    p_overview.set_defaults(func=_cmd_overview)

    p_integrate = sub.add_parser("integrate", help="install brainpick into an agent harness (skill, MCP, report)")
    p_integrate.add_argument("target", metavar="<target>",
                             help="the harness to wire up: claude-code | opencode | agents-md")
    p_integrate.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_integrate.add_argument("--dry-run", action="store_true",
                             help="print what integrate would do without writing anything")
    p_integrate.set_defaults(func=_cmd_integrate)

    p_init = sub.add_parser("init", help="detect the bundle and backends, write config, compile T1")
    p_init.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_init.add_argument("--yes", action="store_true",
                        help="accept the opt-in choices (e.g. record OPENAI_API_KEY for T2)")
    p_init.add_argument("--dry-run", action="store_true",
                        help="print what init would do without writing anything")
    p_init.set_defaults(func=_cmd_init)

    p_doctor = sub.add_parser("doctor", help="diagnose config, bundle, artifacts, backends, and UI")
    p_doctor.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_doctor.set_defaults(func=_cmd_doctor)

    p_token = sub.add_parser("token", help="manage bearer tokens for agents (spec/80 auth)")
    token_sub = p_token.add_subparsers(dest="token_command", required=True)
    t_create = token_sub.add_parser("create", help="mint a token — the secret prints exactly once")
    t_create.add_argument("--name", default=None, help="a label for the token (e.g. the agent's name)")
    t_create.add_argument("--root", default=".", help="bundle root (default: current directory)")
    t_create.set_defaults(func=_cmd_token_create)
    t_list = token_sub.add_parser("list", help="list tokens (ids and names — never secrets)")
    t_list.add_argument("--root", default=".", help="bundle root (default: current directory)")
    t_list.set_defaults(func=_cmd_token_list)
    t_revoke = token_sub.add_parser("revoke", help="revoke a token by id — it stops working immediately")
    t_revoke.add_argument("token_id", metavar="<id>", help="the token id (brainpick token list)")
    t_revoke.add_argument("--root", default=".", help="bundle root (default: current directory)")
    t_revoke.set_defaults(func=_cmd_token_revoke)

    p_password = sub.add_parser("password", help="manage the web UI password (spec/80 auth)")
    password_sub = p_password.add_subparsers(dest="password_command", required=True)
    pw_set = password_sub.add_parser("set", help="set the password (TTY prompt, or --stdin for pipes)")
    pw_set.add_argument("--stdin", action="store_true", help="read the password from stdin")
    pw_set.add_argument("--root", default=".", help="bundle root (default: current directory)")
    pw_set.set_defaults(func=_cmd_password_set)
    pw_clear = password_sub.add_parser("clear", help="remove the password — the UI opens without a login")
    pw_clear.add_argument("--root", default=".", help="bundle root (default: current directory)")
    pw_clear.set_defaults(func=_cmd_password_clear)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
