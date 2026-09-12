/** To-do lists (spec/85 *To-do lists*, spec/20 *t1/todos.json*): a `type: todo`
 * doc's checklist lines are items the engine indexes, counts in the overview and
 * marks on search hits. Twin of packages/python/tests/test_todos.py. */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { checkFresh, runCompile } from "../src/compile/pipeline";
import { buildTodos, isTodo, parseTodoItems } from "../src/compile/todos";
import { loadConfig } from "../src/config";
import { scan } from "../src/core/bundle";
import { overviewPayload, searchPayload } from "../src/mcp";
import { overviewMirror } from "../src/query/mirrors";
import { ServeState } from "../src/serve/state";
import { cleanup, copyBundle, makeBundle } from "./helpers";

afterEach(cleanup);

async function stateOf(root: string): Promise<ServeState> {
  await runCompile(root);
  const state = new ServeState(root, loadConfig(root));
  state.reloadArtifacts();
  return state;
}

describe("recognition", () => {
  test.each([
    ["todo", true],
    ["Todo", true],
    ["TODO ", true],
    ["skill", false],
    ["log", false],
    [null, false],
    ["", false],
  ])("isTodo(%j) is %s", (value, expected) => {
    expect(isTodo(value)).toBe(expected);
  });

  test("scan flags todo docs and never reserved files", () => {
    const root = makeBundle({
      "a.md": "---\ntype: todo\ntitle: A\n---\n# A\n\n- [ ] x\n",
      "index.md": "---\nokf_version: '0.1'\n---\n# I\n\n- [ ] not an item\n",
    });
    const docs = new Map(scan(root).map((d) => [d.path, d]));
    expect(docs.get("a.md")!.todo).toBe(true);
    expect(docs.get("index.md")!.todo).toBe(false);
  });
});

describe("items", () => {
  test("parseTodoItems reads checklist lines only", () => {
    const text =
      "---\ntype: todo\ntimestamp: 2026-07-02T08:00:00Z\n---\n" +
      "# Open\n\n" +
      "- [ ] Descale the kettle\n" +
      "* [x] Buy filters (done: 2026-07-01)\n" +
      "  + [X] Nested and upper-case\n" +
      "- plain bullet, not an item\n" +
      "- [] malformed, not an item\n" +
      "```\n- [ ] inside a fence, skipped\n```\n" +
      "- [x] Dated by the doc\n";
    expect(parseTodoItems(text, "2026-07-02T08:00:00Z")).toEqual([
      { done: null, line: 7, status: "open", text: "Descale the kettle" },
      { done: "2026-07-01", line: 8, status: "done", text: "Buy filters" },
      { done: "2026-07-02", line: 9, status: "done", text: "Nested and upper-case" },
      { done: "2026-07-02", line: 15, status: "done", text: "Dated by the doc" },
    ]);
  });

  test("without a timestamp a done item's date stays null", () => {
    expect(parseTodoItems("- [x] a\n", null)).toEqual([{ done: null, line: 1, status: "done", text: "a" }]);
  });

  test("buildTodos is sorted by path then line", () => {
    const root = copyBundle("kotiaivot");
    expect(buildTodos(scan(root, undefined, ["raw/*"]), root)).toEqual({
      todos: [
        {
          done: "2026-07-01",
          line: 10,
          path: "todo/archive/2026-07-01.md",
          status: "done",
          text: "Write down the [Kahvin keitto](../../skills/kahvin-keitto.md) procedure",
        },
        {
          done: null,
          line: 10,
          path: "todo/open.md",
          status: "open",
          text: "Descale the kettle — see [Veden keitto](../skills/veden-keitto.md)",
        },
        { done: null, line: 11, path: "todo/open.md", status: "open", text: "Try the oily beans again once `keita` retries twice" },
        { done: "2026-07-02", line: 12, path: "todo/open.md", status: "done", text: "Buy filters" },
      ],
    });
  });

  test("compile writes todos.json and it gates freshness", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    const artifact = join(root, ".brainpick", "t1", "todos.json");
    expect(JSON.parse(readFileSync(artifact, "utf8")).todos[1].text.startsWith("Descale")).toBe(true);
    expect((await checkFresh(root)).fresh).toBe(true);
    writeFileSync(artifact, '{"todos": []}');
    expect((await checkFresh(root)).fresh).toBe(false);
  });

  test("a wiki without lists writes an empty artifact", async () => {
    const root = copyBundle("kotiaurinko");
    await runCompile(root);
    const artifact = join(root, ".brainpick", "t1", "todos.json");
    expect(existsSync(artifact)).toBe(true);
    expect(JSON.parse(readFileSync(artifact, "utf8"))).toEqual({ todos: [] });
  });
});

describe("surfaces", () => {
  test("overview counts todos and points at the open list", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaivot")));
    expect(result["todos"]).toEqual({ open: 2, done: 2 });
    expect(String(result["hint"])).toContain("2 open todos");
    expect(String(result["hint"])).toContain("todo/open.md");
  });

  test("overview without lists reports zero and says nothing", async () => {
    const result = overviewPayload(await stateOf(copyBundle("kotiaurinko")));
    expect(result["todos"]).toEqual({ open: 0, done: 0 });
    expect(String(result["hint"])).not.toContain("todo");
  });

  test("overview reads a missing artifact as no todos", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    unlinkSync(join(root, ".brainpick", "t1", "todos.json"));
    const state = new ServeState(root, loadConfig(root));
    state.reloadArtifacts();
    expect(overviewPayload(state)["todos"]).toEqual({ open: 0, done: 0 });
  });

  test("a search hit on a todo list carries its counts", async () => {
    const state = await stateOf(copyBundle("kotiaivot"));
    const hits = (await searchPayload(state, "descale", "keyword"))["hits"] as Array<Record<string, unknown>>;
    expect(hits[0]!["path"]).toBe("todo/open.md");
    expect(hits[0]!["todo"]).toEqual({ open: 2, done: 1 });
    const other = (await searchPayload(state, "vesi", "keyword"))["hits"] as Array<Record<string, unknown>>;
    expect("todo" in other[0]!).toBe(false);
  });

  test("the CLI overview prints the todo line", async () => {
    const root = copyBundle("kotiaivot");
    await runCompile(root);
    expect((await overviewMirror(root, false)).out).toContain("todos: 2 open · 2 done");
  });
});
