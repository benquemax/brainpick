/** The normative T2 chunker (spec/30): heading sections, packing, overlap, ids.
 *
 * Byte-golden across engines — these tests pin the exact boundaries, not just
 * shapes (the twin of packages/python/tests/test_t2_chunker.py).
 */
import { expect, test } from "vitest";

import { buildChunks, chunkDocument, MAX_CHUNK, OVERLAP, type Chunk } from "../src/compile/t2";
import { sha256Hex } from "../src/core/canonical";

const MAX_CONTENT = MAX_CHUNK - OVERLAP; // what fits into a chunk that carries an overlap prefix

function rec(path: string, text: string, reserved = false): { path: string; text: string; reserved: boolean } {
  return { path, text, reserved };
}

function texts(chunks: Chunk[]): string[] {
  return chunks.map((c) => c.text);
}

// -- sections and heading paths ------------------------------------------------------

test("single heading section excludes the heading line", () => {
  const chunks = chunkDocument(rec("kuu.md", "# Kuu\n\nThe moon pulls the tides.\n"));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.id).toBe("kuu.md#kuu~0");
  expect(chunks[0]!.heading_path).toEqual(["Kuu"]);
  expect(chunks[0]!.text).toBe("The moon pulls the tides.");
  expect(chunks[0]!.ord).toBe(0);
});

test("preamble before first heading has empty heading path", () => {
  const chunks = chunkDocument(rec("a.md", "intro line\n\n# One\n\nbody\n"));
  expect(chunks.map((c) => c.id)).toEqual(["a.md#~0", "a.md#one~0"]);
  expect(chunks[0]!.heading_path).toEqual([]);
  expect(chunks[0]!.text).toBe("intro line");
  expect(chunks.map((c) => c.ord)).toEqual([0, 1]);
});

test("heading path nests and resets by level", () => {
  const text =
    "# A\n\na text\n\n## B\n\nb text\n\n### C\n\nc text\n\n" + "## B2\n\nb2 text\n\n# Z\n\nz text\n";
  const chunks = chunkDocument(rec("d.md", text));
  expect(chunks.map((c) => c.heading_path)).toEqual([
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B2"],
    ["Z"],
  ]);
  expect(chunks.map((c) => c.id)).toEqual([
    "d.md#a~0",
    "d.md#a/b~0",
    "d.md#a/b/c~0",
    "d.md#a/b2~0",
    "d.md#z~0",
  ]);
  expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2, 3, 4]);
});

test("heading level jump keeps nearest enclosing titles", () => {
  const chunks = chunkDocument(rec("j.md", "# A\n\na\n\n### C\n\nc\n\n## B\n\nb\n"));
  expect(chunks.map((c) => c.heading_path)).toEqual([["A"], ["A", "C"], ["A", "B"]]);
});

test("level four headings are not split points", () => {
  const chunks = chunkDocument(rec("h4.md", "# A\n\n#### deep\n\nstill in A\n"));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.heading_path).toEqual(["A"]);
  expect(chunks[0]!.text).toBe("#### deep\n\nstill in A");
});

test("hash without space is not a heading", () => {
  const chunks = chunkDocument(rec("n.md", "#Kuu\n\ntext\n"));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.heading_path).toEqual([]);
  expect(chunks[0]!.text).toBe("#Kuu\n\ntext");
});

test("headings inside fences do not split", () => {
  const text = "# A\n\nbefore\n\n```markdown\n# not a heading\n```\n\nafter\n";
  const chunks = chunkDocument(rec("f.md", text));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.heading_path).toEqual(["A"]);
  expect(chunks[0]!.text).toContain("# not a heading");
});

test("tilde fences guard headings too", () => {
  const text = "# A\n\n~~~\n## fenced\n~~~\n\ntail\n";
  const chunks = chunkDocument(rec("t.md", text));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.text).toContain("## fenced");
});

test("blank lines inside fences do not split paragraphs", () => {
  const text = "# A\n\n```\nline one\n\nline two\n```\n";
  const chunks = chunkDocument(rec("g.md", text));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.text).toBe("```\nline one\n\nline two\n```");
});

test("empty sections produce no chunks", () => {
  const chunks = chunkDocument(rec("e.md", "# Empty\n\n# Full\n\ncontent\n"));
  expect(chunks.map((c) => c.id)).toEqual(["e.md#full~0"]);
  expect(chunks[0]!.ord).toBe(0); // ord numbers surviving chunks
  expect(chunkDocument(rec("blank.md", ""))).toEqual([]);
  expect(chunkDocument(rec("ws.md", "   \n\n  \n"))).toEqual([]);
});

// -- slugs ---------------------------------------------------------------------------

test("unicode slugs keep letters and collapse symbol runs", () => {
  let chunks = chunkDocument(rec("y.md", "# Yksinäinen tähti!!\n\nbody\n"));
  expect(chunks[0]!.id).toBe("y.md#yksinäinen-tähti~0");
  chunks = chunkDocument(rec("s.md", "## C++ / Rust_FFI --- notes\n\nbody\n"));
  expect(chunks[0]!.id).toBe("s.md#c-rust-ffi-notes~0");
});

test("symbol-only heading slugs to empty string", () => {
  const chunks = chunkDocument(rec("p.md", "# ---\n\nbody\n"));
  expect(chunks[0]!.id).toBe("p.md#~0");
  expect(chunks[0]!.heading_path).toEqual(["---"]);
});

// -- packing, overlap, hard splits ---------------------------------------------------

test("paragraphs pack greedily and join with blank line", () => {
  const text = "# A\n\npara one\n\npara two\n\npara three\n";
  const chunks = chunkDocument(rec("p.md", text));
  expect(texts(chunks)).toEqual(["para one\n\npara two\n\npara three"]);
});

test("overlap is exactly the last 320 chars of the previous chunk", () => {
  const p1 = "a".repeat(3000);
  const p2 = "b".repeat(2000);
  const chunks = chunkDocument(rec("o.md", `# X\n\n${p1}\n\n${p2}\n`));
  expect(texts(chunks)).toEqual(["a".repeat(3000), "a".repeat(OVERLAP) + "b".repeat(2000)]);
  expect(chunks[1]!.text.slice(0, OVERLAP)).toBe(chunks[0]!.text.slice(-OVERLAP));
  expect(chunks.every((c) => c.text.length <= MAX_CHUNK)).toBe(true);
  expect(chunks.map((c) => c.id)).toEqual(["o.md#x~0", "o.md#x~1"]);
});

test("hard split boundaries respect the overlap budget", () => {
  const p1 = "a".repeat(3000);
  const p2 = "b".repeat(3000);
  const p3 = "c".repeat(500);
  const chunks = chunkDocument(rec("h.md", `# X\n\n${p1}\n\n${p2}\n\n${p3}\n`));
  expect(texts(chunks)).toEqual([
    "a".repeat(3000),
    "a".repeat(OVERLAP) + "b".repeat(MAX_CONTENT),
    "b".repeat(OVERLAP) + "b".repeat(3000 - MAX_CONTENT) + "\n\n" + "c".repeat(500),
  ]);
  expect(chunks.every((c) => c.text.length <= MAX_CHUNK)).toBe(true);
});

test("lone giant paragraph first slice is 3200", () => {
  const chunks = chunkDocument(rec("g.md", "# X\n\n" + "q".repeat(7000) + "\n"));
  expect(chunks[0]!.text.length).toBe(MAX_CHUNK);
  expect(chunks[0]!.text).toBe("q".repeat(MAX_CHUNK));
  // second chunk: 320-char prefix + a full 2880 content slice
  expect(chunks[1]!.text).toBe("q".repeat(MAX_CHUNK));
  const remainder = 7000 - MAX_CHUNK - MAX_CONTENT;
  expect(chunks[2]!.text).toBe("q".repeat(OVERLAP + remainder));
  expect(chunks.map((c) => c.id)).toEqual(["g.md#x~0", "g.md#x~1", "g.md#x~2"]);
});

test("chunk index n restarts per section, ord runs per doc", () => {
  const text = `# A\n\n${"a".repeat(3000)}\n\n${"b".repeat(2000)}\n\n# B\n\nshort\n`;
  const chunks = chunkDocument(rec("n.md", text));
  expect(chunks.map((c) => c.id)).toEqual(["n.md#a~0", "n.md#a~1", "n.md#b~0"]);
  expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2]);
});

test("budgets count code points, not UTF-16 units", () => {
  // 3300 astral chars = 6600 UTF-16 units; Python's len() sees 3300, so the
  // hard split cuts at 3200 code points and never tears a surrogate pair.
  const emoji = "\u{1F600}";
  const chunks = chunkDocument(rec("cp.md", "# X\n\n" + emoji.repeat(3300) + "\n"));
  expect(texts(chunks)).toEqual([emoji.repeat(MAX_CHUNK), emoji.repeat(OVERLAP + 100)]);
  expect([...chunks[0]!.text].length).toBe(MAX_CHUNK);
});

// -- buildChunks over records ----------------------------------------------------------

test("buildChunks skips reserved and sorts by doc then ord", () => {
  const records = [
    rec("z.md", "# Z\n\nzzz\n"),
    rec("index.md", "# Index\n\nnever chunked\n", true),
    rec("a.md", "# A\n\naaa\n\n# B\n\nbbb\n"),
  ];
  const chunks = buildChunks(records);
  expect(chunks.map((c) => [c.doc, c.ord])).toEqual([
    ["a.md", 0],
    ["a.md", 1],
    ["z.md", 0],
  ]);
  expect(chunks.every((c) => c.doc !== "index.md")).toBe(true);
});

test("chunk sha256 is over the chunk text", () => {
  const chunks = buildChunks([rec("s.md", "# S\n\nsisältö\n")]);
  expect(chunks[0]!.sha256).toBe(sha256Hex("sisältö"));
});

test("chunk record shape matches spec", () => {
  const chunks = buildChunks([rec("k.md", "# K\n\nbody\n")]);
  expect(Object.keys(chunks[0]!).sort()).toEqual(["doc", "heading_path", "id", "ord", "sha256", "text"]);
});
