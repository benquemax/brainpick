/** The AGENTS.md brain report (spec/20): deterministic render, sane hub ordering,
 * <=5 truncation, and marker apply/refresh with a stable hash stamp. Twin of
 * packages/python/tests/test_report.py. */
import { describe, expect, test } from "vitest";

import {
  applyReportSection,
  REPORT_BEGIN_PREFIX,
  REPORT_END_MARKER,
  renderReportBlock,
  type Graph,
  type GhostEdge,
  type GraphNode,
} from "../src/compile/t1";
import { sha256Hex } from "../src/core/canonical";

const TIERS = { t1: "fresh", t2: "off", t3: "off" };

function node(id: string, title: string, inbound: number, outbound: number, reserved = false, orphan = false): GraphNode {
  return {
    id,
    title,
    in: inbound,
    out: outbound,
    reserved,
    orphan,
    about: null,
    description: null,
    tags: [],
    timestamp: null,
    type: null,
  };
}

function graph(nodes: GraphNode[], stats: Partial<Graph["stats"]> = {}, ghostPairs: GhostEdge[] = []): Graph {
  return {
    edges: [],
    ghosts: ghostPairs,
    islands: [],
    nodes,
    tags: {},
    stats: { docs: nodes.length, edges: 0, tags: 0, orphans: 0, ghosts: ghostPairs.length, islands: 0, ...stats },
  };
}

function body(block: string): string {
  const start = block.indexOf(" -->\n") + " -->\n".length;
  return block.slice(start, block.lastIndexOf(REPORT_END_MARKER));
}

describe("renderReportBlock", () => {
  test("hubs rank by total degree then path", () => {
    const block = renderReportBlock(
      graph([node("a.md", "A", 1, 1), node("b.md", "B", 4, 3), node("m.md", "M", 3, 2), node("n.md", "N", 2, 3)]),
      TIERS,
    );
    const hubs = block.split("\n").filter((l) => l.startsWith("  - ") && l.includes(" — "));
    expect(hubs).toEqual([
      "  - B (b.md) — 4/3",
      "  - M (m.md) — 3/2",
      "  - N (n.md) — 2/3",
      "  - A (a.md) — 1/1",
    ]);
  });

  test("hubs exclude reserved and truncate to five", () => {
    const nodes = Array.from({ length: 7 }, (_, i) => node(`${i}.md`, `D${i}`, 10 - i, 0));
    nodes.push(node("index.md", "Index", 99, 99, true));
    const block = renderReportBlock(graph(nodes), TIERS);
    const hubLines = block.split("\n").filter((l) => l.startsWith("  - ") && l.includes("/"));
    expect(hubLines).toHaveLength(5);
    expect(block).not.toContain("index.md");
  });

  test("orphans truncate with a more note", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`o${i}.md`, `O${i}`, 0, 0, false, true));
    const block = renderReportBlock(graph(nodes, { orphans: 6 }), TIERS);
    const lines = block.split("\n");
    const start = lines.indexOf("- Orphans:");
    const end = lines.findIndex((l, i) => i > start && l.startsWith("- Top ghosts:"));
    const orphanLines = lines.slice(start + 1, end).filter((l) => l.startsWith("  - "));
    expect(orphanLines).toHaveLength(6); // 5 shown + the truncation note
    expect(orphanLines[orphanLines.length - 1]).toBe("  - …and 1 more");
  });

  test("empty hubs, orphans and ghosts say (none)", () => {
    const block = renderReportBlock(graph([]), TIERS);
    expect(block).toContain("- Top hubs (in/out):\n  - (none)");
    expect(block).toContain("- Orphans:\n  - (none)");
    expect(block).toContain("- Top ghosts:\n  - (none)");
  });

  test("top ghosts rank by reference count then target", () => {
    // b is referenced by 3 distinct docs, a by 2, c by 1 — count is DISTINCT
    // sources, so a duplicate (source, target) pair must not double-count.
    const ghostPairs: GhostEdge[] = [
      { source: "x.md", target: "b.md" },
      { source: "y.md", target: "b.md" },
      { source: "z.md", target: "b.md" },
      { source: "x.md", target: "a.md" },
      { source: "y.md", target: "a.md" },
      { source: "x.md", target: "c.md" },
    ];
    const block = renderReportBlock(graph([], {}, ghostPairs), TIERS);
    const lines = block.split("\n");
    const start = lines.indexOf("- Top ghosts:");
    const end = lines.findIndex((l, i) => i > start && l.startsWith("- Bundle root:"));
    expect(lines.slice(start + 1, end)).toEqual(["  - b.md — 3 refs", "  - a.md — 2 refs", "  - c.md — 1 refs"]);
  });

  test("top ghosts truncate to five", () => {
    const ghostPairs: GhostEdge[] = Array.from({ length: 7 }, (_, i) => ({ source: `s${i}.md`, target: `g${i}.md` }));
    const block = renderReportBlock(graph([], {}, ghostPairs), TIERS);
    const lines = block.split("\n");
    const start = lines.indexOf("- Top ghosts:");
    const end = lines.findIndex((l, i) => i > start && l.startsWith("- Bundle root:"));
    const ghostLines = lines.slice(start + 1, end).filter((l) => l.startsWith("  - "));
    expect(ghostLines).toHaveLength(5);
  });

  test("counts, tiers and bundle root render", () => {
    const block = renderReportBlock(
      graph([node("a.md", "A", 0, 1)], { docs: 3, edges: 5, tags: 2, orphans: 1, ghosts: 1 }),
      { t1: "fresh", t2: "fresh", t3: "off" },
      "docs",
    );
    expect(block).toContain("- Counts: 3 docs · 5 links · 2 tags · 1 orphans · 1 ghosts");
    expect(block).toContain("- Tiers: t1 fresh · t2 fresh · t3 off");
    expect(block).toContain("- Bundle root: docs");
  });

  test("render is deterministic and hash stamped", () => {
    const g = graph([node("b.md", "B", 2, 1), node("a.md", "A", 1, 1)]);
    const first = renderReportBlock(g, TIERS);
    expect(renderReportBlock(g, TIERS)).toBe(first);
    const stamp = first.slice(REPORT_BEGIN_PREFIX.length, first.indexOf(") -->"));
    expect(stamp).toBe(sha256Hex(body(first)).slice(0, 8));
  });
});

describe("applyReportSection", () => {
  test("only touches content between the markers", () => {
    const block = renderReportBlock(graph([node("a.md", "A", 1, 1)]), TIERS);
    const before =
      "# AGENTS.md\n\nHand-written intro.\n\n" +
      `${REPORT_BEGIN_PREFIX}old00000) -->\nstale body\n${REPORT_END_MARKER}\n\n` +
      "<!-- henxels:begin -->\ncontract\n<!-- henxels:end -->\n";
    const after = applyReportSection(before, block);
    expect(after).not.toBeNull();
    expect(after!).toContain("Hand-written intro.");
    expect(after!).toContain("<!-- henxels:begin -->\ncontract\n<!-- henxels:end -->");
    expect(after!).not.toContain("stale body");
    expect(after!).toContain(block);
  });

  test("refuses to create or touch unmarked files", () => {
    const block = renderReportBlock(graph([node("a.md", "A", 1, 1)]), TIERS);
    expect(applyReportSection(null, block)).toBeNull();
    expect(applyReportSection("plain AGENTS.md\n", block)).toBeNull();
  });

  test("is idempotent", () => {
    const block = renderReportBlock(graph([node("a.md", "A", 1, 1)]), TIERS);
    const text = `intro\n\n${REPORT_BEGIN_PREFIX}zzz) -->\nx\n${REPORT_END_MARKER}\nfooter\n`;
    const once = applyReportSection(text, block);
    expect(applyReportSection(once, block)).toBe(once);
  });
});
