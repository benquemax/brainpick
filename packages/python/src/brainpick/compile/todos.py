"""To-do lists (spec/85 *To-do lists*, spec/20 *t1/todos.json*): a `type: todo`
doc's checklist lines, compiled into an artifact so the overview can count
them and a search hit can say "2 open" — the engine indexes and never edits."""
from __future__ import annotations

import re
from pathlib import Path

from brainpick.core.bundle import Document, is_todo

__all__ = ["build_todos", "is_todo", "parse_todo_items", "todo_counts"]

_ITEM = re.compile(r"^\s*[-*+] \[([ xX])\] (.*)$")
_DONE_SUFFIX = re.compile(r"\s*\(done:\s*(\d{4}-\d{2}-\d{2})\)\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


def parse_todo_items(text: str, timestamp: str | None) -> list[dict]:
    """The checklist items of a document's full text, in order, with 1-based
    file lines. `timestamp` (the doc's) dates a done item that carries no
    `(done: YYYY-MM-DD)` suffix of its own; an open item is never dated."""
    doc_date = timestamp[:10] if timestamp else None
    items: list[dict] = []
    in_fence = False
    for number, line in enumerate(text.splitlines(), start=1):
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = _ITEM.match(line)
        if not match:
            continue
        status = "open" if match.group(1) == " " else "done"
        body = match.group(2).strip()
        done: str | None = None
        suffix = _DONE_SUFFIX.search(body)
        if suffix:
            body = body[: suffix.start()].rstrip()
            done = suffix.group(1)
        if status == "done" and done is None:
            done = doc_date
        items.append({"done": done if status == "done" else None, "line": number,
                      "status": status, "text": body})
    return items


def build_todos(docs: list[Document], root: str | Path) -> dict:
    """The t1/todos.json payload: every item of every to-do list, sorted by
    (path, line)."""
    root = Path(root)
    todos: list[dict] = []
    for doc in sorted(docs, key=lambda d: d.path):
        if not doc.todo:
            continue
        text = (root / doc.path).read_text(encoding="utf-8", errors="replace")
        for item in parse_todo_items(text, doc.timestamp):
            todos.append({"done": item["done"], "line": item["line"], "path": doc.path,
                          "status": item["status"], "text": item["text"]})
    return {"todos": todos}


def todo_counts(todos: list[dict], path: str | None = None) -> dict:
    """`{"open", "done"}` over the items — of one list when `path` is given."""
    scoped = [t for t in todos if path is None or t.get("path") == path]
    return {"open": sum(1 for t in scoped if t.get("status") == "open"),
            "done": sum(1 for t in scoped if t.get("status") == "done")}
