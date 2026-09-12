"""The release ledger and the what's-new notice (spec/80 *The release ledger*).

The update notice says a newer engine exists; this one says what changed and
what to do about it. `spec/releases.yaml` is the canonical ledger, shipped
byte-identical inside each package (scripts/sync-releases.mjs). The notice is
a pure function of the ledger, the running version, the version that last
compiled the brain (the manifest's `generator.version`) and the brain's
stamped `[brain] format` — deterministic, offline, conformance-tested.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from brainpick.update import is_newer

Ledger = list[dict]


def ledger_path() -> Path:
    """The shipped ledger: the package copy first (installed wheels), then the
    repo-root canonical (dev checkout) — the Agent Skill's resolution."""
    packaged = Path(__file__).resolve().parent / "_releases" / "releases.yaml"
    if packaged.is_file():
        return packaged
    return Path(__file__).resolve().parents[4] / "spec" / "releases.yaml"


def load_ledger(path: Path | None = None) -> Ledger:
    """The ledger, newest first, with `version` and `date` as strings (YAML
    would read `2026-09-11` as a date; the Node engine keeps it a string)."""
    data = yaml.safe_load((path or ledger_path()).read_text(encoding="utf-8")) or {}
    releases = data.get("releases") or []
    out = []
    for r in releases:
        if not isinstance(r, dict):
            continue
        r = dict(r)
        r["version"] = str(r.get("version", ""))
        r["date"] = str(r.get("date", ""))
        out.append(r)
    return out


def _core(version: str | None) -> tuple[int, ...] | None:
    if not version:
        return None
    parts = version.strip().split(".")
    try:
        return tuple(int(p) for p in parts[:3])
    except ValueError:
        return None


def is_unreleased(release: dict) -> bool:
    return str(release.get("date", "")).strip().lower() == "unreleased"


def _at_most(ledger: Ledger, current: str) -> Ledger:
    """Ledger entries ≤ current, newest first."""
    return [r for r in ledger if not is_newer(current, str(r["version"]))]


def releases_between(ledger: Ledger, since: str | None, current: str) -> Ledger:
    """Entries with since < version ≤ current, newest first; [] without a since.
    An `unreleased` head is never one you could have missed."""
    if since is None:
        return []
    return [r for r in _at_most(ledger, current)
            if is_newer(since, str(r["version"])) and not is_unreleased(r)]


def latest_brain_format(ledger: Ledger, current: str) -> int | None:
    """The newest brain format among ledger entries ≤ current or marked
    unreleased — the format a dev checkout's head declares is what it writes."""
    formats = [int(r["brain_format"]) for r in ledger
               if "brain_format" in r and (is_unreleased(r) or not is_newer(current, str(r["version"])))]
    return max(formats) if formats else None


def whats_new(ledger: Ledger, current: str, since: str | None, brain_format: int | None) -> dict | None:
    """The notice (spec/80): releases since the brain was last compiled and/or a
    brain format newer than its stamp; None when there is nothing to say."""
    notice: dict = {}
    parts: list[str] = []
    if since is not None:
        notice["since"] = since
    notice["current"] = current
    between = releases_between(ledger, since, current)
    if between:
        notice["releases"] = [str(r["version"]) for r in between]
        n = len(between)
        parts.append(f"brainpick {since} → {current}: {n} release{'s' if n != 1 else ''} since this brain "
                     f"was last compiled — run `brainpick whats-new --since {since}`")
    if brain_format is not None and brain_format > 0:
        latest = latest_brain_format(ledger, current)
        if latest is not None and latest > brain_format:
            notice["format"] = {"current": brain_format, "latest": latest}
            parts.append(f"brain format {brain_format} → {latest}: run `brainpick migrate --to {latest}`")
    if not parts:
        return None
    notice["hint"] = "; ".join(parts)
    return notice


def _one_line(text: str) -> str:
    return " ".join(str(text).split())


def render_release(release: dict) -> str:
    lines = [f"## {release['version']} ({release.get('date', '?')})", "",
             _one_line(release.get("summary", "")), ""]
    for change in release.get("changes", []):
        lines.append(f"- {change.get('kind', '?')} ({change.get('area', '?')}): {_one_line(change.get('text', ''))}")
    return "\n".join(lines) + "\n"


def render_whats_new(ledger: Ledger, current: str, since: str | None, brain_format: int | None,
                     everything: bool = False) -> str:
    """What `brainpick whats-new` prints: the releases the notice points at (or the
    current release alone when nothing lies between) newest first, then *Do next*
    — a numbered checklist in the order the actions should be done: the oldest
    shown release's actions first, each in ledger order, the format part last."""
    if everything:
        shown = list(ledger)
    else:
        shown = releases_between(ledger, since, current)
        if not shown:
            shown = [r for r in ledger if str(r["version"]) == current] or _at_most(ledger, current)[:1]
    out = [render_release(r) for r in shown]
    actions = [_one_line(c["agent_action"]) for r in reversed(shown) for c in r.get("changes", [])
               if c.get("agent_action")]
    notice = whats_new(ledger, current, since, brain_format)
    fmt = notice.get("format") if notice else None
    if fmt:
        actions.append(f"brain format {fmt['current']} → {fmt['latest']}: run `brainpick migrate --to {fmt['latest']}`")
    if actions:
        out.append("Do next:\n")
        out.append("".join(f"{i}. {action}\n" for i, action in enumerate(actions, 1)))
    return "\n".join(out)
