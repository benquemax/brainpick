/** Plain-text presenters for the CLI query mirrors (search/read/neighbors/overview).
 *
 * The mirrors are thin: they call the very same payload builders the MCP tools and
 * REST use, then render for a human here. `--json` skips these entirely and prints
 * the raw payload — the same shape a machine gets over MCP. Ports query/present.py.
 */

export function toJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

interface Counts {
  docs?: number;
  edges?: number;
  tags?: number;
  orphans?: number;
  ghosts?: number;
}

function countsLine(counts: Counts): string {
  return (
    `${counts.docs ?? 0} docs · ${counts.edges ?? 0} links · ` +
    `${counts.tags ?? 0} tags · ${counts.orphans ?? 0} orphans · ${counts.ghosts ?? 0} ghosts`
  );
}

interface OverviewDoc {
  path: string;
  title: string;
  description: string | null;
}

export function presentOverview(p: Record<string, unknown>): string {
  const counts = (p["counts"] ?? {}) as Counts;
  const tiers = (p["tiers"] ?? {}) as Record<string, unknown>;
  const lines = [
    `brain: ${String(p["bundle"] ?? "")}`,
    `counts: ${countsLine(counts)}`,
    "tiers: " +
      Object.entries(tiers)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(" · "),
  ];
  for (const group of (p["tree"] ?? []) as Array<{ group: string; docs: OverviewDoc[] }>) {
    lines.push("");
    lines.push(`${group.group}/`);
    for (const doc of group.docs) {
      const desc = doc.description ? ` — ${doc.description}` : "";
      lines.push(`  ${doc.path}  ${doc.title}${desc}`);
    }
  }
  if (p["truncated"]) {
    lines.push("");
    lines.push("(listing trimmed — pass --json or a bigger brain for the full tree)");
  }
  return lines.join("\n");
}

interface Hit {
  path: string;
  title: string;
  description: string | null;
  why?: string;
}

export function presentSearch(p: Record<string, unknown>, query: string): string {
  const hits = (p["hits"] ?? []) as Hit[];
  let header = `${hits.length} hits for '${query}'`;
  const used = ((p["used_modes"] ?? []) as string[]).join(", ");
  if (used) header += ` (mode: ${used})`;
  if (p["degraded_from"]) header += ` [degraded from ${String(p["degraded_from"])}]`;
  const lines = [header];
  for (const hit of hits) {
    const desc = hit.description ? ` — ${hit.description}` : "";
    const why = hit.why ? `  (${hit.why})` : "";
    lines.push(`  ${hit.path}  ${hit.title}${desc}${why}`);
  }
  if (hits.length === 0) lines.push("  (no hits — try `overview` for the whole brain)");
  return lines.join("\n");
}

function presentResolutionMiss(p: Record<string, unknown>): string | null {
  if ("disambiguation" in p) {
    const lines = ["several docs match — name one exactly:"];
    for (const d of p["disambiguation"] as Array<{ path: string; title: string }>) {
      lines.push(`  ${d.path}  ${d.title}`);
    }
    return lines.join("\n");
  }
  if ("error" in p) {
    const lines = [String(p["error"])];
    const suggestions = (p["suggestions"] ?? []) as string[];
    if (suggestions.length > 0) {
      lines.push("did you mean:");
      for (const s of suggestions) lines.push(`  ${s}`);
    }
    return lines.join("\n");
  }
  return null;
}

export function presentRead(p: Record<string, unknown>): string {
  const miss = presentResolutionMiss(p);
  if (miss !== null) return miss;
  const frontmatter = (p["frontmatter"] ?? {}) as Record<string, unknown>;
  const title = frontmatter["title"];
  const heading = title ? `${String(p["path"])} — ${String(title)}` : String(p["path"]);
  const lines = [heading, "", String(p["content"] ?? "").replace(/\n+$/, "")];
  const neighbors = (p["neighbors"] ?? {}) as { in?: Array<{ path: string }>; out?: Array<{ path: string }> };
  const incoming = (neighbors.in ?? []).map((n) => n.path).join(", ");
  const outgoing = (neighbors.out ?? []).map((n) => n.path).join(", ");
  if (incoming || outgoing) {
    lines.push("");
    lines.push(`neighbors: in [${incoming}] out [${outgoing}]`);
  }
  if (p["truncated"]) {
    lines.push("");
    lines.push("(content trimmed — pass --json or read specific sections for the rest)");
  }
  return lines.join("\n");
}

/** The brainpick show result (spec/95): what the live server broadcast. */
export function presentShow(p: Record<string, unknown>): string {
  if ("error" in p) return String(p["error"]);
  const shown = (p["shown"] ?? 0) as number;
  const lines = [`presented (seq ${String(p["seq"])}): ${shown} node(s) spotlighted in every open UI`];
  const dropped = (p["dropped"] ?? []) as string[];
  if (dropped.length > 0) lines.push(`dropped (unresolved): ${dropped.join(", ")}`);
  return lines.join("\n");
}

interface NeighborNode {
  path: string;
  title: string;
  description: string | null;
  distance: number;
}

export function presentNeighbors(p: Record<string, unknown>): string {
  const miss = presentResolutionMiss(p);
  if (miss !== null) return miss;
  const center = String(p["center"]);
  let header = `neighbors of ${center}`;
  if (p["degraded_from"]) header += ` [degraded from ${String(p["degraded_from"])}]`;
  const lines = [header];
  const others = ((p["nodes"] ?? []) as NeighborNode[]).filter((n) => n.path !== center);
  for (const node of others) {
    const desc = node.description ? ` — ${node.description}` : "";
    lines.push(`  d${node.distance}  ${node.path}  ${node.title}${desc}`);
  }
  if (others.length === 0) lines.push("  (no neighbors — an orphan, or nothing links here yet)");
  const edges = (p["edges"] ?? []) as Array<{ source: string; target: string; kind: string }>;
  if (edges.length > 0) {
    lines.push("edges:");
    for (const e of edges) lines.push(`  ${e.source} → ${e.target} (${e.kind})`);
  }
  return lines.join("\n");
}
