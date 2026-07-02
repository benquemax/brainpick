"""brainpick CLI — argparse, stdlib-first, plain in pipes (henxels family voice)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from brainpick import __version__
from brainpick.compile.pipeline import check_fresh, run_compile


def _cmd_compile(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    if args.check_fresh:
        verdict = check_fresh(root)
        print("fresh" if verdict.fresh else verdict.reason)
        return 0 if verdict.fresh else 1

    result = run_compile(root, full=args.full)
    s = result.stats
    if result.changed:
        print(
            f"compiled: {s['docs']} docs · {s['edges']} links · {s['ghosts']} ghosts"
            f" · {s['orphans']} orphans · seq {result.seq}"
        )
    else:
        print(f"fresh — nothing to do (seq {result.seq})")
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
    p_compile.set_defaults(func=_cmd_compile)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
