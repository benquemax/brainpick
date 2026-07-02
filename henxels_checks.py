"""Custom checks for the OKF wiki (scaffolded by `henxels init --template okf-llm-wiki`)."""

import datetime
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
