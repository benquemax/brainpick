"""Half-life (spec/50 *Half-life*): memories fade, and that is a feature. A
document's retrieval score is multiplied by max(2^(-age/half_life), 1/16) —
never deleted, never filtered, only harder to recall — where the effective
half-life resolves bundle default → longest matching folder → the doc's own
frontmatter `half_life`. Twin of packages/node/src/query/half-life.ts."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from brainpick.config import HalfLifeConfig

FLOOR = 1 / 16  # four half-lives: a faded page stays recallable, old pages stay ordered

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DATETIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$")


def effective_half_life(path: str, frontmatter: float | None, config: HalfLifeConfig) -> float:
    """Days; most specific wins. `0` means the document never fades."""
    if frontmatter is not None:
        return max(0.0, float(frontmatter))
    best: tuple[int, float] | None = None
    for folder, days in config.folders.items():
        if not folder:
            continue
        if path == folder or path.startswith(folder + "/"):
            if best is None or len(folder) > best[0]:
                best = (len(folder), float(days))
    if best is not None:
        return max(0.0, best[1])
    return max(0.0, float(config.default))


def parse_timestamp(value: str | None) -> datetime | None:
    """An OKF timestamp as an aware UTC datetime — `YYYY-MM-DD` (midnight UTC) or
    `YYYY-MM-DDTHH:MM[:SS]` with `Z`, an offset, or nothing (naive = UTC); anything
    else is None (the doc never fades)."""
    if value is None:
        return None
    text = str(value).strip()
    match = _DATE.match(text)
    if match:
        y, m, d = (int(g) for g in match.groups())
        try:
            return datetime(y, m, d, tzinfo=timezone.utc)
        except ValueError:
            return None
    match = _DATETIME.match(text)
    if not match:
        return None
    y, m, d, hh, mm, ss, tz = match.groups()
    try:
        moment = datetime(int(y), int(m), int(d), int(hh), int(mm), int(ss or 0), tzinfo=timezone.utc)
    except ValueError:
        return None
    if tz and tz != "Z":
        sign = 1 if tz[0] == "+" else -1
        offset_minutes = sign * (int(tz[1:3]) * 60 + int(tz[4:6]))
        moment = moment - _minutes(offset_minutes)
    return moment


def _minutes(count: int):
    from datetime import timedelta

    return timedelta(minutes=count)


def age_days(timestamp: str | None, now: datetime) -> float | None:
    """Days from the document's timestamp to `now`; the future counts as 0."""
    moment = parse_timestamp(timestamp)
    if moment is None:
        return None
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0.0, (now - moment).total_seconds() / 86400.0)


def fade_factor(age: float | None, half_life: float) -> float:
    if age is None or half_life <= 0:
        return 1.0
    return max(2.0 ** (-age / half_life), FLOOR)


def fade(hits: list[dict], records: list[dict], config: HalfLifeConfig | None,
         now: datetime | None) -> list[dict]:
    """The retriever's hits with faded scores, re-ranked by (score desc, path).
    With no config, or a config where nothing fades, the hits come back as they
    were — byte-identical to an engine without the factor."""
    if config is None or (config.default <= 0 and not any(d > 0 for d in config.folders.values())
                          and not any(r.get("half_life") for r in records)):
        return hits
    moment = now or datetime.now(timezone.utc)
    by_path = {r["path"]: r for r in records}
    faded = []
    for hit in hits:
        record = by_path.get(hit["path"])
        if record is None:
            faded.append(hit)
            continue
        half_life = effective_half_life(record["path"], record.get("half_life"), config)
        age = age_days(record.get("timestamp"), moment)
        factor = fade_factor(age, half_life)
        if factor >= 1.0:
            faded.append(hit)
            continue
        out = dict(hit)
        out["score"] = round(hit["score"] * factor, 6)
        out["faded"] = {"age_days": round(age or 0.0, 2), "half_life": half_life}
        faded.append(out)
    faded.sort(key=lambda h: (-h["score"], h["path"]))
    return faded
