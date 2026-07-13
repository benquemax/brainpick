/** Timeline (spec/90): git history distilled, oldest-first, advisory content.
 *
 * Every test builds its own throwaway git repo with FIXED author/committer dates,
 * so results are deterministic and wholly independent of the outer repo's history
 * (hermetic: no network, no reliance on brainpick's own git log). Twin of
 * test_timeline.py.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { buildTimeline, docAtCommit } from "../src/timeline";
import { cleanup, tempDir } from "./helpers";

afterEach(cleanup);

const C1 = "2026-07-02T20:41:00+00:00";
const C2 = "2026-07-03T09:12:00+00:00";
const C3 = "2026-07-04T10:00:00+00:00";
const Z1 = "2026-07-02T20:41:00Z";
const Z2 = "2026-07-03T09:12:00Z";
const Z3 = "2026-07-04T10:00:00Z";

function git(repo: string, args: string[], date?: string): void {
  const env = { ...process.env };
  if (date !== undefined) {
    env["GIT_AUTHOR_DATE"] = date;
    env["GIT_COMMITTER_DATE"] = date;
    env["GIT_AUTHOR_NAME"] = "Tester";
    env["GIT_AUTHOR_EMAIL"] = "t@e.st";
    env["GIT_COMMITTER_NAME"] = "Tester";
    env["GIT_COMMITTER_EMAIL"] = "t@e.st";
  }
  execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
}

function initRepo(): string {
  const repo = join(tempDir(), "brain");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Tester"]);
  git(repo, ["config", "user.email", "t@e.st"]);
  return repo;
}

function write(repo: string, rel: string, content: string): void {
  const abs = join(repo, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function commit(repo: string, message: string, date: string): void {
  git(repo, ["add", "-A"], date);
  git(repo, ["commit", "-m", message], date);
}

function threeCommitBrain(): string {
  const repo = initRepo();
  write(repo, "a.md", "# A\n\nLinks to [B](b.md).\n");
  write(repo, "b.md", "# B\n\nThe bee document about buzzing.\n");
  commit(repo, "Founding commit", C1);
  write(repo, "a.md", "# A\n\nLinks to [B](b.md), now with more text.\n");
  commit(repo, "Modify a", C2);
  rmSync(join(repo, "b.md"));
  write(repo, "c.md", "# C\n\nCompletely different comet content here.\n");
  commit(repo, "Delete b add c", C3);
  return repo;
}

test("commits chronological, oldest-first, with per-commit status", () => {
  const repo = threeCommitBrain();
  const tl = buildTimeline(repo, repo);
  if (tl === null) {
    // Flaps rarely, ONLY on CI runners; buildTimeline swallows git errors by
    // design, so on failure re-run the underlying git and FAIL WITH ITS
    // OUTPUT — the next flap self-diagnoses (instrument, don't guess).
    let evidence: string;
    try {
      const out = execFileSync(
        "git",
        ["-c", "core.quotePath=false", "log", "--diff-filter=AMDR", "--name-status", "-M",
         "--format=%H%x1f%aI%x1f%an%x1f%s", "--", "."],
        { cwd: repo, encoding: "utf8", stdio: "pipe" },
      );
      evidence = `git log SUCCEEDED on re-run (transient?): ${out.slice(0, 400)}`;
    } catch (error) {
      const err = error as { stderr?: string; message: string };
      evidence = `git log failed: ${(err.stderr ?? err.message).slice(0, 400)}`;
    }
    expect.fail(`buildTimeline returned null — ${evidence}`);
  }
  expect(tl).not.toBeNull();
  const commits = tl!.commits;
  expect(commits.length).toBe(3);
  expect(commits.map((c) => c.message)).toEqual(["Founding commit", "Modify a", "Delete b add c"]);
  expect(commits.every((c) => c.sha.length === 7)).toBe(true);
  expect(commits.every((c) => c.author === "Tester")).toBe(true);

  expect(commits[0]!.added).toEqual(["a.md", "b.md"]);
  expect(commits[0]!.modified).toEqual([]);
  expect(commits[0]!.deleted).toEqual([]);
  expect(commits[0]!.date).toBe(Z1);

  expect(commits[1]!.modified).toEqual(["a.md"]);
  expect(commits[1]!.added).toEqual([]);
  expect(commits[1]!.deleted).toEqual([]);
  expect(commits[1]!.date).toBe(Z2);

  expect(commits[2]!.added).toEqual(["c.md"]);
  expect(commits[2]!.deleted).toEqual(["b.md"]);
  expect(commits[2]!.modified).toEqual([]);
  expect(commits[2]!.date).toBe(Z3);
});

test("docs lifecycle and span", () => {
  const repo = threeCommitBrain();
  const tl = buildTimeline(repo, repo)!;
  expect(tl.docs["a.md"]).toEqual({ created: Z1, deleted: null, modified: [Z2] });
  expect(tl.docs["b.md"]).toEqual({ created: Z1, deleted: Z3, modified: [] });
  expect(tl.docs["c.md"]).toEqual({ created: Z3, deleted: null, modified: [] });
  expect(tl.span).toEqual({ commits: 3, first: Z1, last: Z3 });
});

test("reserved index.md/log.md and non-md files are excluded", () => {
  const repo = initRepo();
  write(repo, "a.md", "# A\n");
  write(repo, "index.md", "# Index\n"); // reserved
  write(repo, "log.md", "# Log\n"); // reserved
  write(repo, "notes.txt", "plain text, not a doc\n");
  commit(repo, "Founding commit", C1);

  const tl = buildTimeline(repo, repo)!;
  expect(tl.commits[0]!.added).toEqual(["a.md"]); // index.md / log.md / notes.txt dropped
  expect(Object.keys(tl.docs)).toEqual(["a.md"]);
});

test("a bundle in a subdir maps to bundle-relative paths", () => {
  const repo = initRepo();
  write(repo, "docs/x.md", "# X\n");
  write(repo, "outside.md", "# Outside the bundle\n");
  commit(repo, "Founding commit", C1);

  const tl = buildTimeline(join(repo, "docs"), repo)!; // bundle = repo/docs, repo = repo
  expect(tl.commits[0]!.added).toEqual(["x.md"]); // docs/x.md -> x.md, outside.md scoped out
  expect(Object.keys(tl.docs)).toEqual(["x.md"]);
});

test("a rename splits into delete(old) + add(new)", () => {
  const repo = initRepo();
  write(repo, "a.md", "# A\n\nEnough shared content that git detects the rename as a rename.\n");
  commit(repo, "Add a", C1);
  git(repo, ["mv", "a.md", "renamed.md"]);
  commit(repo, "Rename a to renamed", C2);

  const tl = buildTimeline(repo, repo)!;
  const rename = tl.commits[1]!;
  expect(rename.deleted).toEqual(["a.md"]);
  expect(rename.added).toEqual(["renamed.md"]);
  expect(tl.docs["a.md"]!.deleted).toBe(Z2);
  expect(tl.docs["renamed.md"]!.created).toBe(Z2);
});

test("a non-git bundle returns null", () => {
  const plain = join(tempDir(), "plain");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, "a.md"), "# A\n", "utf8");
  expect(buildTimeline(plain, null)).toBeNull(); // no repo root at all
  expect(buildTimeline(plain, plain)).toBeNull(); // a dir that is not a git work tree
});

test("a repo with no bundle history returns null", () => {
  const repo = initRepo();
  write(repo, "elsewhere.txt", "not markdown\n");
  commit(repo, "Unrelated", C1);
  mkdirSync(join(repo, "docs"), { recursive: true });
  expect(buildTimeline(join(repo, "docs"), repo)).toBeNull();
});

// --- docAtCommit (spec/50 "Doc versions" — the file-level Time Machine) ---

function head(repo: string): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

test("docAtCommit serves each version of a doc", () => {
  const repo = initRepo();
  write(repo, "a.md", "---\ntitle: A\n---\n\nversion one\n");
  commit(repo, "Add a", C1);
  const sha1 = head(repo);
  write(repo, "a.md", "---\ntitle: A\n---\n\nversion two\n");
  commit(repo, "Modify a", C2);
  const sha2 = head(repo);

  expect(docAtCommit(repo, repo, "a.md", sha1)).toContain("version one");
  expect(docAtCommit(repo, repo, "a.md", sha2)).toContain("version two");
});

test("docAtCommit is null when the file did not exist at that commit", () => {
  const repo = initRepo();
  write(repo, "a.md", "# A\n");
  commit(repo, "Add a", C1);
  const sha1 = head(repo);
  write(repo, "b.md", "# B\n");
  commit(repo, "Add b", C2);

  expect(docAtCommit(repo, repo, "b.md", sha1)).toBeNull();
});

test("docAtCommit is null for an unknown commit or without a repo", () => {
  const repo = initRepo();
  write(repo, "a.md", "# A\n");
  commit(repo, "Add a", C1);
  expect(docAtCommit(repo, repo, "a.md", "deadbee")).toBeNull();

  const plain = join(tempDir(), "plain2");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, "a.md"), "# A\n", "utf8");
  expect(docAtCommit(plain, null, "a.md", "deadbee")).toBeNull();
});

test("docAtCommit resolves a nested bundle prefix", () => {
  const repo = initRepo();
  write(repo, "docs/a.md", "nested v1\n");
  commit(repo, "Add docs/a", C1);
  const sha1 = head(repo);
  write(repo, "docs/a.md", "nested v2\n");
  commit(repo, "Modify docs/a", C2);

  expect(docAtCommit(join(repo, "docs"), repo, "a.md", sha1)).toBe("nested v1\n");
});
