/** `brainpick migrate --to N` (spec/85 *Versioning and migration*): the one command
 * that rewrites committed bytes — deterministic, mechanical, writes by default,
 * --dry-run previews. The format-1 → 2 rewrite is pinned by the migrate
 * conformance case; these tests cover the edges the golden tree cannot.
 * The twin of packages/python/tests/test_migrate.py. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { MigrateError, migrate, runMigrate, splitMonth } from "../src/migrate";
import { cleanup, copyBundle, FIXTURE_BUNDLES, tempDir } from "./helpers";

afterEach(() => {
  delete process.env["BRAINPICK_TODAY"];
  vi.restoreAllMocks();
  cleanup();
});

const TODAY = "2026-07-02";

function v1(): string {
  const root = copyBundle("kotiaivot-v1");
  renameSync(join(root, "gitignore"), join(root, ".gitignore"));
  return root;
}

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    out[abs.slice(root.length + 1).split("\\").join("/")] = readFileSync(abs, "utf8");
  }
  return out;
}

// -- splitMonth: the pure function behind step 1 ------------------------------------

test("splitMonth by day headings promotes subheadings", () => {
  const text = "# 2026-07\n\n## 2026-07-02\n\nCoffee.\n\n### Evening\n\nTea.\n\n## 2026-07-01\n\nWater.\n";
  expect(splitMonth(text, "2026-07")).toEqual([
    ["2026-07-02", "# 2026-07-02\n\nCoffee.\n\n## Evening\n\nTea.\n"],
    ["2026-07-01", "# 2026-07-01\n\nWater.\n"],
  ]);
});

test("splitMonth keeps a non-title preamble and non-date h2", () => {
  const text = "Intro line.\n\n## 2026-07-01\n\nA.\n\n## Not a date\n\nB.\n";
  expect(splitMonth(text, "2026-07")).toEqual([["2026-07-01", "# 2026-07-01\n\nIntro line.\n\nA.\n\n## Not a date\n\nB.\n"]]);
});

test("splitMonth without day headings is the first day", () => {
  expect(splitMonth("# 2026-07\n\nJust notes.\n", "2026-07")).toEqual([["2026-07-01", "# 2026-07-01\n\nJust notes.\n"]]);
});

// -- migrate: the whole rewrite ---------------------------------------------------

test("migrate 1 → 2 moves days, todos and bumps the stamp", () => {
  const root = v1();
  const report = migrate(root, 2, { today: TODAY });
  const t = tree(root);
  expect(t["journals/2026-07.md"]).toBeUndefined();
  expect(t["journals/archive/2026-06.md"]).toBeUndefined();
  expect(t["journals/2026-07-02.md"]).toBeDefined(); // today stays at the top
  expect(t["journals/archive/2026/07/2026-07-01.md"]).toBeDefined();
  expect(t["journals/archive/2026/06/2026-06-30.md"]).toBeDefined();
  // links inside moved sections are re-rooted so they still land
  expect(t["journals/archive/2026/07/2026-07-01.md"]).toContain("(../../../../skills/veden-keitto.md)");
  expect(t["journals/2026-07-02.md"]).toContain("(../knowledge/vieraat.md)");
  expect(t["journals/archive/2026/06/2026-06-30.md"]).toContain("(../../../../knowledge/kahvi.md)");
  // links to day sections and to the month are rewritten, text untouched
  const kahvi = t["knowledge/kahvi.md"]!;
  expect(kahvi).toContain("[one evening](../journals/2026-07-02.md)");
  expect(kahvi).toContain("[June](../journals/archive/2026/06/2026-06-30.md)");
  expect(kahvi).toContain("[July journal](../journals/archive/2026/07/2026-07-01.md)");
  expect(kahvi).not.toContain("#2026");
  // _todo.md → todo/open.md
  expect(t["_todo.md"]).toBeUndefined();
  expect(t["todo/open.md"]!.startsWith("---\ntype: todo\ntitle: Open\n")).toBe(true);
  expect(t["todo/open.md"]).toContain(`timestamp: ${TODAY}T00:00:00Z`);
  expect(t["todo/open.md"]).not.toContain("# Parking lot");
  expect(t["todo/open.md"]).toContain("# Open\n");
  expect(t["todo/open.md"]).toContain("- [ ] Descale the kettle — see [Veden keitto](../skills/veden-keitto.md)");
  expect(t["todo/index.md"]).toContain("- [Open](open.md)");
  expect(t[".gitignore"]).not.toContain("_todo.md");
  expect(t[".gitignore"]).toContain("_temp/");
  expect(t["brainpick.toml"]).toContain("format = 2              # the brainpick brain format (spec/85)");
  expect(report.actions[0]!.startsWith("split journals/2026-07.md")).toBe(true);
  expect(report.actions[report.actions.length - 1]).toBe("stamp brainpick.toml: format 1 → 2");
  expect(report.dry_run).toBe(false);
});

test("migrate is idempotent and a no-op at target", () => {
  const root = v1();
  migrate(root, 2, { today: TODAY });
  const before = tree(root);
  const report = migrate(root, 2, { today: TODAY });
  expect(report.actions).toEqual([]);
  expect(tree(root)).toEqual(before);
});

test("dry run writes nothing but lists actions and a diff", () => {
  const root = v1();
  const before = tree(root);
  const report = migrate(root, 2, { today: TODAY, dryRun: true });
  expect(tree(root)).toEqual(before);
  expect(report.dry_run).toBe(true);
  expect(report.actions.length).toBeGreaterThan(0);
  expect(report.diff).toContain("--- knowledge/kahvi.md");
  expect(report.diff).toContain("+++ knowledge/kahvi.md");
  expect(report.diff).toContain("--- journals/2026-07.md"); // a deleted file diffs against nothing
});

test("refuses a downgrade, a non-brain and an unknown format", () => {
  const root = v1();
  migrate(root, 2, { today: TODAY });
  expect(() => migrate(root, 1, { today: TODAY })).toThrow(/below/);
  const wiki = copyBundle("kotiaurinko");
  expect(() => migrate(wiki, 2, { today: TODAY })).toThrow(/not a brain/);
  expect(() => migrate(root, 9, { today: TODAY })).toThrow(/unknown/);
  expect(() => migrate(root, 9, { today: TODAY })).toThrow(MigrateError);
});

test("migrate without a todo seeds an empty list", () => {
  const root = v1();
  unlinkSync(join(root, "_todo.md"));
  migrate(root, 2, { today: TODAY });
  const open = readFileSync(join(root, "todo", "open.md"), "utf8");
  expect(open.endsWith("# Open\n")).toBe(true);
  expect(open).toContain("type: todo");
});

test("migrate resolves the bundle below a repo root", () => {
  const repo = join(tempDir(), "repo");
  mkdirSync(repo);
  cpSync(join(FIXTURE_BUNDLES, "kotiaivot-v1"), join(repo, "_brain"), { recursive: true });
  renameSync(join(repo, "_brain", "gitignore"), join(repo, ".gitignore"));
  renameSync(join(repo, "_brain", "_todo.md"), join(repo, "_todo.md"));
  writeFileSync(join(repo, "brainpick.toml"), 'spec = "0.1"\n\n[bundle]\nroot = "_brain"\n\n[brain]\nformat = 1\n', "utf8");
  unlinkSync(join(repo, "_brain", "brainpick.toml"));
  migrate(repo, 2, { today: TODAY });
  expect(existsSync(join(repo, "_brain", "todo", "open.md"))).toBe(true);
  expect(existsSync(join(repo, "_todo.md"))).toBe(false);
  expect(readFileSync(join(repo, "brainpick.toml"), "utf8")).toContain("format = 2");
  expect(readFileSync(join(repo, ".gitignore"), "utf8")).not.toContain("_todo.md");
});

// -- the CLI verb ---------------------------------------------------------------------

test("runMigrate prints actions and honours BRAINPICK_TODAY", () => {
  const root = v1();
  process.env["BRAINPICK_TODAY"] = TODAY;
  const lines: string[] = [];
  expect(runMigrate(root, 2, false, (l) => lines.push(l))).toBe(0);
  const out = lines.join("\n");
  expect(out).toContain("split journals/2026-07.md");
  expect(out).toContain("stamp brainpick.toml: format 1 → 2");
  expect(out).toContain("migrated to format 2");
  expect(out).toContain("brainpick compile");
  expect(existsSync(join(root, "journals", "2026-07-02.md"))).toBe(true);
});

test("runMigrate dry-run, no-op and errors", () => {
  const root = v1();
  process.env["BRAINPICK_TODAY"] = TODAY;
  const before = tree(root);
  const lines: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(runMigrate(root, 2, true, (l) => lines.push(l))).toBe(0);
  expect(lines.join("\n")).toContain("dry run");
  expect(lines.join("\n")).toContain("+++ knowledge/kahvi.md");
  expect(tree(root)).toEqual(before);
  lines.length = 0;
  expect(runMigrate(root, 1, false, (l) => lines.push(l))).toBe(0); // already there: a no-op that says so
  expect(lines.join("\n")).toContain("already at format 1");
  runMigrate(root, 2, false, () => undefined);
  expect(runMigrate(root, 1, false, () => undefined)).toBe(1); // a downgrade is refused
  expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^error: .*below/));
  stdout.mockRestore();
});
