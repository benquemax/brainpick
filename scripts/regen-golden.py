#!/usr/bin/env python3
"""Regenerate the conformance goldens from the Python reference implementation.

This is the ONLY sanctioned way to touch spec/fixtures/expected/ and the
scenario expected-deltas files (AGENTS.md: goldens are regenerated via script
and the diffs reviewed like code).
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "packages" / "python" / "src"))

import yaml  # noqa: E402

from brainpick.compile.pipeline import run_compile  # noqa: E402
from brainpick.compile.t1 import build_docs_records, render_report_block  # noqa: E402
from brainpick.compile.t2 import build_chunks  # noqa: E402
from brainpick.core.bundle import scan  # noqa: E402
from brainpick.core.canonical import canonical_jsonl  # noqa: E402

SPEC = REPO / "spec"
BUNDLES = SPEC / "fixtures" / "bundles"
EXPECTED = SPEC / "fixtures" / "expected"
SCENARIOS = SPEC / "fixtures" / "scenarios"
SENTINEL_TIME = "1970-01-01T00:00:00Z"

CASES = yaml.safe_load((SPEC / "conformance" / "cases.yaml").read_text(encoding="utf-8"))["cases"]


def normalize_manifest(text: str) -> str:
    manifest = json.loads(text)
    manifest["compiled_at"] = SENTINEL_TIME
    manifest.pop("generator", None)
    return json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def regen_compile(case: dict) -> None:
    bundle = case["bundle"]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / bundle
        shutil.copytree(BUNDLES / bundle, root)
        run_compile(root)
        for artifact in case["artifacts"]:
            src = root / artifact
            dst = EXPECTED / bundle / artifact
            dst.parent.mkdir(parents=True, exist_ok=True)
            text = src.read_text(encoding="utf-8")
            if artifact.endswith("manifest.json"):
                text = normalize_manifest(text)
            dst.write_text(text, encoding="utf-8")
            print(f"golden: {dst.relative_to(REPO)}")


def regen_chunks(case: dict) -> None:
    """t2/chunks.jsonl is a pure function of the bundle (spec/30 chunker) —
    no embedding backend involved, so the golden regenerates offline."""
    bundle = case["bundle"]
    records = build_docs_records(scan(BUNDLES / bundle))
    dst = EXPECTED / bundle / case["artifact"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(canonical_jsonl(build_chunks(records)), encoding="utf-8")
    print(f"golden: {dst.relative_to(REPO)}")


def regen_report(case: dict) -> None:
    """The AGENTS.md brain report block (spec/20) rendered from the compiled
    fixture with bundle_root "." — the golden holds exactly the block plus a
    trailing newline (a well-formed text file)."""
    bundle = case["bundle"]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / bundle
        shutil.copytree(BUNDLES / bundle, root)
        run_compile(root)
        bp = root / ".brainpick"
        graph = json.loads((bp / "t1" / "graph.json").read_text(encoding="utf-8"))
        tiers = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))["tiers"]
        dst = EXPECTED / bundle / case["artifact"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(render_report_block(graph, tiers) + "\n", encoding="utf-8")
        print(f"golden: {dst.relative_to(REPO)}")


def regen_delta(case: dict) -> None:
    bundle, scenario = case["bundle"], case["scenario"]
    steps = yaml.safe_load((SCENARIOS / scenario / "steps.yaml").read_text(encoding="utf-8"))["steps"]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / bundle
        shutil.copytree(BUNDLES / bundle, root)
        run_compile(root)
        lines = []
        for step in steps:
            if step["action"] == "write":
                (root / step["path"]).write_text(step["content"], encoding="utf-8")
            elif step["action"] == "delete":
                (root / step["path"]).unlink()
            else:
                raise SystemExit(f"unknown action {step['action']} in {scenario}")
            result = run_compile(root)
            if result.delta is None:
                raise SystemExit(f"step {step['id']} produced no delta — scenario is broken")
            lines.append(json.dumps(result.delta, ensure_ascii=False,
                                    separators=(",", ":"), sort_keys=True))
        out = SCENARIOS / scenario / "expected-deltas.jsonl"
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"golden: {out.relative_to(REPO)}")


def main() -> None:
    for case in CASES:
        if case["class"] == "compile":
            regen_compile(case)
        elif case["class"] == "chunks":
            regen_chunks(case)
        elif case["class"] == "report":
            regen_report(case)
        elif case["class"] == "delta":
            regen_delta(case)
    print("done — review the diffs like code before committing.")


if __name__ == "__main__":
    main()
