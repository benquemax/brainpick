"""Custom checks for the OKF wiki (scaffolded by `henxels init --template okf-llm-wiki`)."""

import datetime
import json
import re

from henxels import statement

_SECTION = re.compile(r"^##\s+(.+?)\s*$")


@statement("log_headings_are_dates", help="log.md sections are '## YYYY-MM-DD' headings, newest first")
def log_headings_are_dates(file, scope):
    dates, problems = [], []
    for line in (scope.read_text(file) or "").splitlines():
        m = _SECTION.match(line)
        if not m:
            continue
        try:
            dates.append(datetime.date.fromisoformat(m.group(1)))
        except ValueError:
            problems.append(f"section '{m.group(1)}' — head log sections with an ISO date: ## YYYY-MM-DD")
    if dates != sorted(dates, reverse=True):
        problems.append("order the date sections newest first")
    return problems


@statement(
    "similarity_gaps_no_unresolved",
    help="every open similarity-gap pair (spec/45) is linked or dismissed in the allowlist",
)
def similarity_gaps_no_unresolved(param, scope):
    """Whole-scope, unlike every other check here: this reads a COMPILE OUTPUT
    (`<bundle root>/.brainpick/t1/similarity-gaps.json`), not markdown directly
    — `param` names the bundle root (e.g. "docs"; "" or "." for the repo root).
    Absent or malformed artifact degrades silently (nothing to check yet), never
    an error — `brainpick compile` with T2 on is what keeps this accurate."""
    root = str(param or "").strip().strip("/")
    prefix = f"{root}/" if root and root != "." else ""
    text = scope.read_text(f"{prefix}.brainpick/t1/similarity-gaps.json")
    if text is None:
        return None
    try:
        gaps = json.loads(text)
    except ValueError:
        return None

    problems = []
    for pair in gaps.get("pairs", []):
        if pair.get("status") != "open":
            continue
        problems.append(
            f"similarity gap: {pair['a']} ↔ {pair['b']} (score {pair['score']}) — "
            f"link them, or dismiss in {prefix}similarity-gaps-allowlist.toml if reviewed and rejected"
        )
    return problems
