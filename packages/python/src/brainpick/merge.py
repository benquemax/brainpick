"""Merge resolution for stale writes (spec/70 brain_write `base_sha`).

The proposal ladder: a mechanical three-way merge when the base is known and
the edits do not overlap; a single-shot merge through the configured
[models.extraction] chat model when they do (prose merges badly mechanically —
the model the brain already has doubles as the merge tool); neither → None,
the manual path. Every product here is a PROPOSAL — callers never auto-apply.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from difflib import SequenceMatcher
from pathlib import Path

from brainpick.core.canonical import sha256_hex
from brainpick.core.frontmatter import split_frontmatter
from brainpick.llm import ChatClient, ChatUnavailable

_CONFLICT_MARKER = re.compile(r"^(<{7}|>{7}|={7})", re.MULTILINE)
_FENCE_WRAP = re.compile(r"\A```[a-zA-Z]*\n(.*)\n```\s*\Z", re.DOTALL)

MERGE_SYSTEM = (
    "You are merging two edits of the same markdown knowledge page. "
    "Preserve BOTH parties' new information; where both rewrote the same passage, combine them. "
    "Keep the YAML frontmatter intact and valid. "
    "Output ONLY the merged markdown document — no commentary, no code fences, no conflict markers."
)

MERGE_USER = (
    "--- BASE (the version both edits started from) ---\n{base}\n"
    "--- THEIRS (the currently saved version) ---\n{theirs}\n"
    "--- YOURS (the incoming edit) ---\n{yours}"
)

MERGE_SYSTEM_TWO = (
    "You are merging two divergent versions of the same markdown knowledge page; "
    "no common ancestor is available. "
    "Preserve BOTH versions' information, deduplicating what they share. "
    "Keep the YAML frontmatter intact and valid. "
    "Output ONLY the merged markdown document — no commentary, no code fences, no conflict markers."
)

MERGE_USER_TWO = (
    "--- THEIRS (the currently saved version) ---\n{theirs}\n"
    "--- YOURS (the incoming edit) ---\n{yours}"
)


# -- three-way (mechanical) ------------------------------------------------------------


def _sync_regions(base: list[str], a: list[str], b: list[str]) -> list[tuple[int, ...]]:
    """Base intervals matched by BOTH sides, with their positions in each side:
    (base_lo, base_hi, a_lo, a_hi, b_lo, b_hi), ascending and non-overlapping."""
    am = SequenceMatcher(None, base, a, autojunk=False).get_matching_blocks()
    bm = SequenceMatcher(None, base, b, autojunk=False).get_matching_blocks()
    regions: list[tuple[int, ...]] = []
    ai = bi = 0
    while ai < len(am) and bi < len(bm):
        blk_a, blk_b = am[ai], bm[bi]
        lo = max(blk_a.a, blk_b.a)
        hi = min(blk_a.a + blk_a.size, blk_b.a + blk_b.size)
        if lo < hi:
            regions.append((
                lo, hi,
                blk_a.b + lo - blk_a.a, blk_a.b + hi - blk_a.a,
                blk_b.b + lo - blk_b.a, blk_b.b + hi - blk_b.a,
            ))
        if blk_a.a + blk_a.size <= blk_b.a + blk_b.size:
            ai += 1
        else:
            bi += 1
    return regions


def three_way(base: str, theirs: str, yours: str) -> str | None:
    """Mechanical line merge; None when the edits overlap.

    Conservative on purpose: a stable region of blank lines does not separate
    two edits — a heading rename and an edit to the paragraph under it are the
    same neighborhood, and in doubt the answer is None (the ladder's next rung).
    """
    if theirs == yours:
        return theirs
    base_l = base.splitlines(keepends=True)
    theirs_l = theirs.splitlines(keepends=True)
    yours_l = yours.splitlines(keepends=True)

    out: list[str] = []
    bpos = tpos = ypos = 0

    def flush(blo: int, tlo: int, ylo: int) -> bool:
        """Resolve one gap between sync regions; False when both sides edited it."""
        base_gap = base_l[bpos:blo]
        theirs_gap = theirs_l[tpos:tlo]
        yours_gap = yours_l[ypos:ylo]
        if theirs_gap == base_gap:
            out.extend(yours_gap)  # only yours (or nobody) touched it
        elif yours_gap == base_gap or yours_gap == theirs_gap:
            out.extend(theirs_gap)  # only theirs touched it, or both agree
        else:
            return False
        return True

    for blo, bhi, tlo, thi, ylo, yhi in _sync_regions(base_l, theirs_l, yours_l):
        if not any(line.strip() for line in base_l[blo:bhi]):
            continue  # blank-only stability — fold into the surrounding gap
        if not flush(blo, tlo, ylo):
            return None
        out.extend(base_l[blo:bhi])
        bpos, tpos, ypos = bhi, thi, yhi
    if not flush(len(base_l), len(theirs_l), len(yours_l)):
        return None
    return "".join(out)


# -- llm (single-shot) -------------------------------------------------------------------


def _sanitize(answer: str, theirs: str, yours: str) -> str | None:
    """The sanity gate on model output: non-empty, unfenced, no conflict markers,
    frontmatter still parses (split_frontmatter) when the inputs carried one."""
    text = answer.strip()
    fenced = _FENCE_WRAP.match(text)
    if fenced:
        text = fenced.group(1).strip()
    if not text:
        return None
    if _CONFLICT_MARKER.search(text):
        return None
    if not text.endswith("\n"):
        text += "\n"
    if theirs.startswith("---\n") or yours.startswith("---\n"):
        meta, _body = split_frontmatter(text)
        if not meta:
            return None  # the inputs had frontmatter; the merge lost or broke it
    return text


def _ask(chat: ChatClient, system: str, user: str, theirs: str, yours: str) -> str | None:
    try:
        answer = chat.complete(system, user)
    except ChatUnavailable:
        return None
    return _sanitize(answer, theirs, yours)


def llm_merge(base: str, theirs: str, yours: str, chat: ChatClient) -> str | None:
    """One shot through the extraction model with the full triple; None unless sane."""
    user = MERGE_USER.format(base=base, theirs=theirs, yours=yours)
    return _ask(chat, MERGE_SYSTEM, user, theirs, yours)


def llm_merge_two(theirs: str, yours: str, chat: ChatClient) -> str | None:
    """The degraded, honest variant when no base exists: the prompt says so."""
    user = MERGE_USER_TWO.format(theirs=theirs, yours=yours)
    return _ask(chat, MERGE_SYSTEM_TWO, user, theirs, yours)


# -- the ladder ---------------------------------------------------------------------------


def resolve(base: str | None, theirs: str, yours: str, chat: ChatClient | None) -> dict | None:
    """spec/70's proposal ladder → {"content", "strategy"} or None (manual path)."""
    if base is not None:
        merged = three_way(base, theirs, yours)
        if merged is not None:
            return {"content": merged, "strategy": "three-way"}
        if chat is not None:
            merged = llm_merge(base, theirs, yours, chat)
            if merged is not None:
                return {"content": merged, "strategy": "llm"}
        return None
    if chat is None:
        return None
    merged = llm_merge_two(theirs, yours, chat)
    if merged is not None:
        return {"content": merged, "strategy": "llm"}
    return None


# -- where the base comes from -------------------------------------------------------------


def git_base(root: str | Path, rel: str) -> bytes | None:
    """`git show HEAD:./<rel>` — the committed bytes, or None (no git, not a
    repo, never committed). The `./` scopes the path to the bundle root even
    when the bundle is a subdirectory of the repository.

    A backslash is not a directory separator to git's pathspec parser on ANY
    platform — it can only ever arrive here on win32 if a caller built `rel`
    with `os.sep`; normalized defensively so this stays correct regardless
    of caller discipline (CI-2, _plans/2026-07-10-phase1.5-release.md)."""
    git = shutil.which("git")
    if git is None:
        return None
    pathspec_rel = rel.replace("\\", "/")
    try:
        proc = subprocess.run(
            [git, "-C", str(root), "show", f"HEAD:./{pathspec_rel}"],
            capture_output=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired, subprocess.SubprocessError):
        return None
    return proc.stdout if proc.returncode == 0 else None


def find_base(root: str | Path, rel: str, base_sha: str) -> str | None:
    """The content the writer read — git HEAD, but only when its bytes hash to
    `base_sha`. A guessed base would let the mechanical merge silently drop
    edits; unverified means unknown, and the ladder degrades to the two-input
    model merge instead."""
    committed = git_base(root, rel)
    if committed is None or sha256_hex(committed) != base_sha:
        return None
    return committed.decode("utf-8", errors="replace")
