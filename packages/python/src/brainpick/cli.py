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


def _print_t3_summary(result: CompileResult) -> None:
    s = result.t3_summary
    if s is not None:
        print(f"t3 sample: {s['entities']} entities · {s['relations']} relations"
              f" from {s['docs']} docs", flush=True)


def _cmd_compile(args: argparse.Namespace) -> int:
    from brainpick.config import resolve_bundle

    root, config = resolve_bundle(args.root)  # --root may be a repo root above the bundle (spec/80)
    if args.check_fresh:
        verdict = check_fresh(root, config)
        print("fresh" if verdict.fresh else verdict.reason)
        return 0 if verdict.fresh else 1

    only = (args.only,) if args.only else None
    result = run_compile(root, full=args.full, only=only, config=config, sample=args.sample)
    if result.changed:
        _print_compiled(result)
    else:
        print(f"fresh — nothing to do (seq {result.seq})")
    _print_t3_summary(result)
    _print_warnings(result)

    if args.watch:
        from watchfiles import watch as watch_sync

        from brainpick.serve.watcher import DEBOUNCE_MS, source_filter

        print(f"watching {root} — Ctrl-C stops", flush=True)
        for _changes in watch_sync(root, watch_filter=source_filter(root), step=DEBOUNCE_MS,
                                   raise_interrupt=False):
            result = run_compile(root, only=only, config=config)
            if result.changed:
                _print_compiled(result)
            _print_warnings(result)
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import threading
    import webbrowser

    import uvicorn

    from brainpick.config import resolve_bundle
    from brainpick.serve.app import build_app

    root, config = resolve_bundle(args.root)  # --root may be a repo root above the bundle (spec/80)
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


def _note_if_stale(root: Path, config) -> None:
    if not check_fresh(root, config).fresh:
        print(f"note: the brain is stale — run: brainpick compile --root {root}", file=sys.stderr)


def _query_setup(args: argparse.Namespace):
    """Shared prelude for the four query mirrors: resolve, load, warn if stale."""
    from brainpick.config import resolve_bundle

    root, config = resolve_bundle(args.root)
    state, instruction = _held_state(root, config)
    if state is None:
        return None, _emit_uncompiled(instruction, args.json)
    _note_if_stale(root, config)
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


def connectable_host(host: str) -> str:
    """A server may bind 0.0.0.0/:: (everywhere); a client must connect via a
    real address — shared by the CLI's `show` and brain_show's server-proxy
    attempt (mcp_server.py) so both resolve a running `brainpick serve` the
    same way."""
    return "127.0.0.1" if host in ("0.0.0.0", "::") else host


def post_show(base_url: str, body: dict,
              token: str | None = None) -> tuple[dict | None, str | None, bool]:
    """POST a presentation body to a running server's /api/show (spec/95). Returns
    (response, None, False) on success, or (None, instruction, unreachable) — the
    caller is a client here, never resolving locally: the live server resolves and
    broadcasts to open UIs. `unreachable` is True only when nothing answered at all
    (connection refused/DNS/timeout) — a caller that wants to fall back to a local,
    UI-less presentation must check it, so a server that's up but REJECTS the
    request (bad auth, bad body) is never mistaken for "no server running" and
    silently papered over."""
    import json
    import urllib.error
    import urllib.request

    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{base_url}/api/show", data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 (localhost control-plane)
            return json.loads(response.read().decode("utf-8")), None, False
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(detail).get("error", detail)
        except (ValueError, AttributeError):
            message = detail
        return None, f"the server rejected the presentation ({error.code}): {message}", False
    except urllib.error.URLError as error:
        return None, (f"no brainpick server at {base_url} — start one with 'brainpick serve' "
                      f"({error.reason})"), True


def _cmd_show(args: argparse.Namespace) -> int:
    from brainpick.config import load_config
    from brainpick.query.present import present_show, to_json

    root = Path(args.root).resolve()
    config = load_config(root)
    host = args.host or config.serve.host
    port = args.port or config.serve.port
    display_host = connectable_host(host)
    base_url = f"http://{display_host}:{port}"
    token = args.token or (config.serve.token or None)

    body: dict = {"nodes": args.nodes}
    if args.focus:
        body["focus"] = args.focus
    if args.mode:
        body["mode"] = args.mode
    if args.annotate is not None:
        body["annotation"] = args.annotate
    if args.clear:
        body["clear"] = True

    result, error, _unreachable = post_show(base_url, body, token)
    if error is not None:
        if args.json:
            print(to_json({"error": error, "hint": "start the server with: brainpick serve"}))
        else:
            print(error, file=sys.stderr)
        return 1
    print(to_json(result) if args.json else present_show(result))
    return 0


def _cmd_mcp(args: argparse.Namespace) -> int:
    # stdio is the protocol channel: nothing may print to stdout here
    from brainpick.config import load_config
    from brainpick.federation import resolve_brain_set
    from brainpick.mcp_server import WRITES_OFF_REFUSAL, create_mcp_server

    # spec/75: explicit --root(s) win; else the registry ∪ the cwd's own bundle; a
    # lone brain serves exactly as before (the plain single-brain payloads). Each
    # --root may be a repo root above its bundle ([bundle] root, spec/80).
    brain_set = resolve_brain_set(list(args.root))
    if brain_set.federated:
        target = brain_set
        refusal = WRITES_OFF_REFUSAL if all(
            load_config(b.root).serve.writes == "off" for b in brain_set.brains) else None
    else:
        target = brain_set.state_for(brain_set.brains[0])
        refusal = WRITES_OFF_REFUSAL if target.config.serve.writes == "off" else None
    create_mcp_server(target, write_refusal=refusal).run(transport="stdio")
    return 0


def _cmd_register(args: argparse.Namespace) -> int:
    """spec/75: add, remove, or list the brains one `brainpick mcp` fronts."""
    from brainpick.federation import (
        alias_for_repo,
        entry_root,
        load_registry,
        register_brain,
        registry_path,
        unregister_brain,
    )

    def shown_alias(entry: dict) -> str:  # the address the tools use — never the opaque id
        return entry.get("alias") or alias_for_repo(entry["repo"])

    env = getattr(args, "_env", None)
    registry = registry_path(env)
    if args.from_hosts:
        return _register_from_hosts(args, registry, env, shown_alias)
    if args.path is None:
        entries = load_registry(registry)
        if not entries:
            print(f"no brains registered ({registry}) — brainpick register <bundle> adds one")
            return 0
        for entry in entries:
            root = entry_root(entry)
            marks = "".join([" (me)" if entry.get("role") == "user" else "",
                             "" if entry.get("enabled", True) else " (disabled)",
                             "" if root else " (missing)"])
            shown = str(root) if root else f"{entry['repo']}/{entry['bundle_path']}".rstrip("/")
            print(f"  {shown_alias(entry):<20} {shown}{marks}")
        print(f"registry: {registry}")
        return 0

    root = Path(args.path).resolve()
    if args.remove:
        if unregister_brain(root, registry):
            print(f"removed {root} from {registry}")
            return 0
        print(f"{root} is not registered ({registry})", file=sys.stderr)
        return 1
    if not root.is_dir() or not any(root.rglob("*.md")):
        print(f"{root} holds no markdown — a brain is an OKF bundle of .md files", file=sys.stderr)
        return 1
    entry = register_brain(root, registry, alias=args.alias, user=args.user)
    label = shown_alias(entry)
    print(f"registered {label}{' (me)' if entry.get('role') == 'user' else ''} → {root}")
    print(f"registry: {registry}")
    print("brainpick mcp (no --root) now fronts every registered brain plus the one you're in.")
    return 0


def _register_from_hosts(args: argparse.Namespace, registry, env, shown_alias) -> int:
    """spec/75: the one-command migration — every `mcp --root DIR` in the agent
    host configs becomes a registry entry; then ONE replacement entry is shown.
    Never edits a host config."""
    from brainpick.federation import entry_root, load_registry, register_brain, scan_hosts
    from brainpick.scaffold import brainpick_command

    found = scan_hosts(env)
    if not found:
        print("no per-project `brainpick mcp --root` entries found in ~/.claude.json, "
              "opencode.json, ~/.codex/config.toml or ~/.cursor/mcp.json — nothing to migrate")
        return 0
    existing = {entry_root(e, env) for e in load_registry(registry)}
    label = "dry run — would register" if args.dry_run else "registered"
    registered = 0
    for item in found:
        via = ", ".join(item.hosts)
        root = item.root.resolve()
        if root in existing:
            print(f"  already registered {root} ({via})")
            continue
        if not root.is_dir() or not any(root.rglob("*.md")):
            print(f"  skipped {root} ({via}) — not a bundle on this machine")
            continue
        if args.dry_run:
            print(f"  {label} {root} ({via})")
            continue
        entry = register_brain(root, registry, alias=None, user=False)
        print(f"  {label} {shown_alias(entry)} → {root} ({via})")
        registered += 1
    print(f"registry: {registry}")
    if args.dry_run:
        print("re-run without --dry-run to write the registry.")
        return 0
    if registered:
        cmd = " ".join(brainpick_command())
        print(f"\nreplace the per-project entries with ONE user-scope entry:\n"
              f"  claude mcp add brainpick --scope user -- {cmd} mcp\n"
              "(the old --root entries keep working until you remove them; "
              "brainpick register ~/brain --user marks your personal brain.)")
    return 0


def build_parser() -> argparse.ArgumentParser:
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
    p_compile.add_argument("--only", choices=("t1", "t2", "t3"), default=None,
                           help="compile a single tier (t2/t3 reuse the compiled docs substrate)")
    p_compile.add_argument("--sample", type=int, default=None, metavar="N",
                           help="T3 preview: extract only the first N docs' chunks and summarize")
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
    p_mcp.add_argument("--root", action="append", default=[], metavar="[ALIAS=]DIR",
                       help="bundle root — repeat to front several brains; default: every "
                            "registered brain plus the current directory's (spec/75)")
    p_mcp.set_defaults(func=_cmd_mcp)

    p_register = sub.add_parser("register", help="add a brain to the federation registry (or list/remove)")
    p_register.add_argument("path", nargs="?", default=None, metavar="PATH",
                            help="bundle root to register (omit to list the registry)")
    p_register.add_argument("--alias", default=None, help="the brain's address in tool payloads")
    p_register.add_argument("--user", action="store_true", help="mark it as your personal brain (scope 'me')")
    p_register.add_argument("--remove", action="store_true", help="drop PATH from the registry")
    p_register.add_argument("--from-hosts", action="store_true",
                            help="register every `mcp --root DIR` found in agent host configs (spec/75 migration)")
    p_register.add_argument("--dry-run", action="store_true", help="with --from-hosts: report, don't write")
    p_register.set_defaults(func=_cmd_register)

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

    p_show = sub.add_parser("show",
                            help="present a subgraph live in every open UI (posts to a running server)")
    p_show.add_argument("nodes", nargs="*", help="doc paths or entity names to spotlight")
    p_show.add_argument("--focus", default=None,
                        help="a single id to fly the camera to (defaults to the first node)")
    p_show.add_argument("--mode", default=None, help="cosmos | brain — switch the UI view")
    p_show.add_argument("--annotate", default=None, metavar="TEXT",
                        help="a short caption shown over the presentation")
    p_show.add_argument("--clear", action="store_true", help="dismiss the current presentation")
    p_show.add_argument("--host", default=None, help="server host (default: config or 127.0.0.1)")
    p_show.add_argument("--port", type=int, default=None, help="server port (default: config or 4747)")
    p_show.add_argument("--token", default=None, help="bearer token for a guarded server")
    p_show.add_argument("--root", default=".", help="bundle root (default: current directory)")
    p_show.add_argument("--json", action="store_true", help="print the raw server response as JSON")
    p_show.set_defaults(func=_cmd_show)

    p_integrate = sub.add_parser("integrate", help="install brainpick into an agent harness (skill, MCP, report)")
    p_integrate.add_argument("target", metavar="<target>",
                             help="the harness to wire up: claude-code | opencode | agents-md | dsh")
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
    return parser


def main(argv: list[str] | None = None, env: dict | None = None) -> int:
    args = build_parser().parse_args(argv)
    args._env = env  # tests pass an isolated HOME/registry; None means the process env
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
