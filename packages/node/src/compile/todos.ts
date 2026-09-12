/**
 * To-do lists (spec/85 *To-do lists*, spec/20 *t1/todos.json*): a `type: todo`
 * doc's checklist lines, compiled into an artifact so the overview can count
 * them and a search hit can say "2 open" — the engine indexes and never edits.
 * Twin of packages/python/src/brainpick/compile/todos.py.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isTodo, type Document } from "../core/bundle";
import { cmpStr } from "../core/canonical";

export { isTodo };

export interface TodoItem {
  done: string | null;
  line: number;
  status: "open" | "done";
  text: string;
}

export interface TodoRecord extends TodoItem {
  path: string;
}

export interface TodosArtifact {
  todos: TodoRecord[];
}

export interface TodoCounts {
  open: number;
  done: number;
}

const ITEM = /^\s*[-*+] \[([ xX])\] (.*)$/;
const DONE_SUFFIX = /\s*\(done:\s*(\d{4}-\d{2}-\d{2})\)\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** The checklist items of a document's full text, in order, with 1-based file
 * lines. `timestamp` (the doc's) dates a done item that carries no
 * `(done: YYYY-MM-DD)` suffix of its own; an open item is never dated. */
export function parseTodoItems(text: string, timestamp: string | null): TodoItem[] {
  const docDate = timestamp ? timestamp.slice(0, 10) : null;
  const items: TodoItem[] = [];
  let inFence = false;
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = ITEM.exec(line);
    if (!match) return;
    const status: "open" | "done" = match[1] === " " ? "open" : "done";
    let body = match[2]!.trim();
    let done: string | null = null;
    const suffix = DONE_SUFFIX.exec(body);
    if (suffix) {
      body = body.slice(0, suffix.index).trimEnd();
      done = suffix[1]!;
    }
    if (status === "done" && done === null) done = docDate;
    items.push({ done: status === "done" ? done : null, line: i + 1, status, text: body });
  });
  return items;
}

/** The t1/todos.json payload: every item of every to-do list, sorted by (path, line). */
export function buildTodos(docs: readonly Document[], root: string): TodosArtifact {
  const todos: TodoRecord[] = [];
  for (const doc of [...docs].sort((a, b) => cmpStr(a.path, b.path))) {
    if (!doc.todo) continue;
    const text = readFileSync(join(root, doc.path), "utf8");
    for (const item of parseTodoItems(text, doc.timestamp)) {
      todos.push({ done: item.done, line: item.line, path: doc.path, status: item.status, text: item.text });
    }
  }
  return { todos };
}

/** `{open, done}` over the items — of one list when `path` is given. */
export function todoCounts(todos: readonly TodoRecord[], path?: string): TodoCounts {
  const scoped = path === undefined ? todos : todos.filter((t) => t.path === path);
  return {
    open: scoped.filter((t) => t.status === "open").length,
    done: scoped.filter((t) => t.status === "done").length,
  };
}
