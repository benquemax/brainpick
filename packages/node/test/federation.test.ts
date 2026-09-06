/** Federation (spec/75): many brains behind one MCP server — the registry, the
 * brain set, aliases, qualified paths, scope, merged search, routed reads.
 * The twin of packages/python/tests/test_federation.py. */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  Brain,
  BrainSet,
  aliasFor,
  discoverHere,
  loadRegistry,
  parseScope,
  qualify,
  registerBrain,
  resolveBrainSet,
  splitQualified,
  unregisterBrain,
  runRegister,
  scanHosts,
} from "../src/federation";
import {
  createMcpServer,
  neighborsPayload,
  overviewPayload,
  readPayload,
  searchPayload,
  showPayload,
  writePayload,
} from "../src/mcp";
import { cleanup, copyBundle, tempDir } from "./helpers";

/** The pre-federation shape in every known host: one `mcp --root DIR` per project. */
function writeHosts(home: string, [a, b, gone]: [string, string, string]): void {
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        brainpick: { command: "uvx", args: ["brainpick", "mcp", "--root", a] },
        other: { command: "npx", args: ["some-server"] },
      },
      projects: { [b]: { mcpServers: { brainpick: { command: "brainpick", args: ["mcp", `--root=${b}`] } } } },
    }),
  );
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  writeFileSync(
    join(home, ".config", "opencode", "opencode.json"),
    JSON.stringify({
      mcp: {
        brainpick: { type: "local", command: ["uv", "run", "brainpick", "mcp", "--root", a] },
        remote: { type: "remote", url: "http://x/sse" },
      },
    }),
  );
  mkdirSync(join(home, ".codex"));
  writeFileSync(join(home, ".codex", "config.toml"), `[mcp_servers.brainpick]\ncommand = "brainpick"\nargs = ["mcp", "--root", "${gone}"]\n`);
  mkdirSync(join(home, ".cursor"));
  writeFileSync(
    join(home, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { bp: { command: "brainpick", args: ["serve", "--root", a] } } }),
  );
}

afterEach(cleanup);

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n# Uusi kivi\n\nNear [Kuu](kuu.md).\n";

function makeSet(here: "aurinko" | "kirja" | null = null): BrainSet {
  const a = copyBundle("kotiaurinko");
  const k = copyBundle("kotikirja");
  return new BrainSet([
    new Brain({ alias: "aurinko", root: a, here: here === "aurinko" }),
    new Brain({ alias: "kirja", root: k, role: "user", here: here === "kirja" }),
  ]);
}

describe("qualified paths", () => {
  test("split and qualify", () => {
    expect(splitQualified("acme:docs/a.md")).toEqual(["acme", "docs/a.md"]);
    expect(splitQualified("docs/a.md")).toEqual([null, "docs/a.md"]);
    expect(splitQualified("c:\\weird")).toEqual([null, "c:\\weird"]);
    expect(qualify("acme", "a.md")).toBe("acme:a.md");
  });
});

describe("aliases", () => {
  test("repo name inside a git repo, directory name outside", () => {
    const dir = tempDir();
    const repo = join(dir, "acme");
    mkdirSync(join(repo, "docs"), { recursive: true });
    spawnSync("git", ["init", "-q", repo]);
    expect(aliasFor(join(repo, "docs"))).toBe("acme");
    const plain = join(dir, "My Brain!");
    mkdirSync(plain);
    expect(aliasFor(plain)).toBe("my-brain");
  });

  test("dedupes collisions and reserved words in set order", () => {
    const dir = tempDir();
    const roots = ["all", "x", "x"].map((name) => {
      const root = join(dir, name);
      mkdirSync(root, { recursive: true });
      return root;
    });
    const set = new BrainSet(roots.map((root) => new Brain({ alias: null, root })));
    expect(set.brains.map((b) => b.alias)).toEqual(["all-2", "x", "x-2"]);
  });
});

describe("the registry", () => {
  test("register writes canonical toml, round-trips, updates in place", () => {
    const dir = tempDir();
    const registry = join(dir, "brains.toml");
    const root = copyBundle("kotiaurinko");
    const entry = registerBrain(root, registry, { alias: "aurinko" });
    const text = readFileSync(registry, "utf8");
    expect(text.startsWith("[[brain]]\n")).toBe(true);
    expect(text.indexOf("id = ")).toBeLessThan(text.indexOf("repo = "));
    expect(text.indexOf("repo = ")).toBeLessThan(text.indexOf("bundle_path = "));
    expect(text.indexOf("bundle_path = ")).toBeLessThan(text.indexOf("alias = "));
    expect(text).not.toContain('role = "user"');
    expect(entry["repo"]).toBe(root);

    expect(loadRegistry(registry).map((b) => b["alias"])).toEqual(["aurinko"]);
    registerBrain(root, registry, { alias: "sun", user: true });
    const loaded = loadRegistry(registry);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!["alias"]).toBe("sun");
    expect(loaded[0]!["role"]).toBe("user");
  });

  test("uses the bundle id when it has one", () => {
    const dir = tempDir();
    const root = copyBundle("kotiaurinko");
    writeFileSync(join(root, "brainpick.toml"), '[bundle]\nid = "abc123"\n');
    expect(registerBrain(root, join(dir, "brains.toml"))["id"]).toBe("abc123");
  });

  test("drops malformed entries, keeps unknown keys, tolerates absence", () => {
    const dir = tempDir();
    const registry = join(dir, "brains.toml");
    writeFileSync(
      registry,
      '[[brain]]\nid = "a"\nrepo = "/nope"\nbundle_path = ""\nport = 4750\nenabled = true\n' +
        'host = "127.0.0.1"\nextra = "kept"\n\n[[brain]]\nrepo = 5\n',
    );
    const loaded = loadRegistry(registry);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!["extra"]).toBe("kept");
    expect(loadRegistry(join(dir, "missing.toml"))).toEqual([]);
  });

  test("unregister removes by root", () => {
    const dir = tempDir();
    const registry = join(dir, "brains.toml");
    const root = copyBundle("kotiaurinko");
    registerBrain(root, registry);
    expect(unregisterBrain(root, registry)).toBe(true);
    expect(loadRegistry(registry)).toEqual([]);
    expect(unregisterBrain(root, registry)).toBe(false);
  });
});

describe("the brain set", () => {
  test("discoverHere walks up to a bundle root", () => {
    const root = copyBundle("kotiaurinko");
    writeFileSync(join(root, "brainpick.toml"), "");
    expect(discoverHere(join(root, "saaret"))).toBe(root);
    expect(discoverHere(join(root, ".."))).toBeNull();
  });

  test("explicit roots win and take alias prefixes", () => {
    const a = copyBundle("kotiaurinko");
    const k = copyBundle("kotikirja");
    const dir = tempDir();
    const set = resolveBrainSet([`sun=${a}`, k], { cwd: dir, registryPath: join(dir, "none.toml") });
    expect(set.brains.map((b) => [b.alias, b.root])).toEqual([
      ["sun", a],
      ["kotikirja", k],
    ]);
  });

  test("registry ∪ here orders here → user → rest and skips missing roots", () => {
    const dir = tempDir();
    const registry = join(dir, "brains.toml");
    const here = join(dir, "here"); // a reserved word as the directory name → suffixed alias
    cpSync(copyBundle("kotiaurinko"), here, { recursive: true });
    writeFileSync(join(here, "brainpick.toml"), "");
    const me = copyBundle("kotikirja");
    const other = copyBundle("kotikirja");
    registerBrain(other, registry, { alias: "other" });
    registerBrain(me, registry, { alias: "mine", user: true });
    const gone = join(dir, "gone");
    mkdirSync(gone);
    registerBrain(gone, registry, { alias: "gone" });
    rmSync(gone, { recursive: true });

    const set = resolveBrainSet([], { cwd: join(here, "saaret"), registryPath: registry });
    expect(set.brains.map((b) => b.alias)).toEqual(["here-2", "mine", "other"]);
    expect(set.brains[0]!.here).toBe(true);
    expect(set.brains[1]!.role).toBe("user");
  });

  test("here matching a registered brain is not duplicated", () => {
    const dir = tempDir();
    const registry = join(dir, "brains.toml");
    const here = copyBundle("kotiaurinko");
    registerBrain(here, registry, { alias: "sun" });
    const set = resolveBrainSet([], { cwd: join(here, "saaret"), registryPath: registry });
    expect(set.brains.map((b) => [b.alias, b.here])).toEqual([["sun", true]]);
  });

  test("an empty set falls back to cwd; disabled entries are skipped", () => {
    const dir = tempDir();
    const root = copyBundle("kotiaurinko");
    const set = resolveBrainSet([], { cwd: root, registryPath: join(dir, "none.toml") });
    expect(set.brains.map((b) => b.root)).toEqual([root]);
    expect(set.federated).toBe(false);

    const registry = join(dir, "brains.toml");
    registerBrain(root, registry, { alias: "a" });
    writeFileSync(registry, readFileSync(registry, "utf8").replace("enabled = true", "enabled = false"));
    expect(resolveBrainSet([], { cwd: dir, registryPath: registry }).brains[0]!.root).toBe(dir);
  });
});

describe("scope", () => {
  test("parseScope", () => {
    const set = makeSet("aurinko");
    expect(parseScope(set, "all")[0].map((b) => b.alias)).toEqual(["aurinko", "kirja"]);
    expect(parseScope(set, "here")[0].map((b) => b.alias)).toEqual(["aurinko"]);
    expect(parseScope(set, "me")[0].map((b) => b.alias)).toEqual(["kirja"]);
    const [chosen, dropped] = parseScope(set, "kirja, nope");
    expect(chosen.map((b) => b.alias)).toEqual(["kirja"]);
    expect(dropped).toEqual(["nope"]);
    const [fallback, dropped2] = parseScope(set, "nope");
    expect(fallback.map((b) => b.alias)).toEqual(["aurinko", "kirja"]);
    expect(dropped2).toEqual(["nope"]);
  });
});

describe("federated search", () => {
  test("qualifies and merges", async () => {
    const set = makeSet();
    const result = await searchPayload(set, "kuu", "keyword");
    const hits = result["hits"] as Array<Record<string, unknown>>;
    expect(new Set(hits.map((h) => h["path"]))).toEqual(
      new Set(["aurinko:kuu.md", "aurinko:maa.md", "aurinko:aurinko.md", "kirja:kuu-muistio.md", "kirja:kahvi.md"]),
    );
    expect(hits[0]!["brain"]).toBe("aurinko");
    expect(result["searched"]).toEqual(["aurinko", "kirja"]);
    expect(result["contributing"]).toEqual(["aurinko", "kirja"]);
    expect(result["used_modes"]).toEqual(["keyword"]);
    expect(result["hint"]).toContain("brain_read 'aurinko:kuu.md'");
  });

  test("merges by rank, not score (T2-fresh RRF vs T1-only BM25)", async () => {
    // spec/75: scores are not commensurable across brains — a score merge would
    // bury the RRF-scaled brain under the BM25 one; ranks interleave instead.
    const set = makeSet();
    writeFileSync(join(set.brains[0]!.root, "brainpick.local.toml"), '[models.embedding]\nkind = "mock"\n');
    const result = await searchPayload(set, "kuu", "auto");
    expect(result["used_modes"]).toEqual(["keyword", "semantic"]);
    const hits = result["hits"] as Array<Record<string, unknown>>;
    expect(hits.slice(0, 4).map((h) => h["brain"])).toEqual(["aurinko", "kirja", "aurinko", "kirja"]);
    expect(Number(hits[0]!["score"])).toBeLessThan(Number(hits[1]!["score"]));
    expect(hits[1]!["path"]).toBe("kirja:kuu-muistio.md");
  });

  test("scope narrows and unknown aliases are noted", async () => {
    const set = makeSet();
    const result = await searchPayload(set, "kuu", "keyword", 8, null, "kirja,nope");
    const hits = result["hits"] as Array<Record<string, unknown>>;
    expect(new Set(hits.map((h) => h["brain"]))).toEqual(new Set(["kirja"]));
    expect(result["searched"]).toEqual(["kirja"]);
    expect(result["hint"]).toContain("nope");
  });

  test("limit and budget apply after the merge", async () => {
    const set = makeSet();
    expect((await searchPayload(set, "kuu", "keyword", 2))["hits"]).toHaveLength(2);
    const tight = await searchPayload(set, "kuu", "keyword", 8, 60);
    expect(tight["truncated"]).toBe(true);
    expect((tight["hits"] as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  test("a single-brain set emits the plain payload but accepts a qualified doc", async () => {
    const set = new BrainSet([new Brain({ alias: "sun", root: copyBundle("kotiaurinko") })]);
    const result = await searchPayload(set, "kuu", "keyword");
    const hits = result["hits"] as Array<Record<string, unknown>>;
    expect(hits[0]!["path"]).toBe("kuu.md");
    expect(hits[0]).not.toHaveProperty("brain");
    expect(result).not.toHaveProperty("searched");
    expect((await readPayload(set, "sun:kuu.md"))["path"]).toBe("kuu.md");
  });
});

describe("federated overview", () => {
  test("lists brains and focuses here", async () => {
    const set = makeSet("kirja");
    const result = await overviewPayload(set);
    const brains = result["brains"] as Array<Record<string, unknown>>;
    expect(brains.map((b) => b["alias"])).toEqual(["aurinko", "kirja"]);
    expect(brains[1]!["here"]).toBe(true);
    expect(brains[1]!["role"]).toBe("user");
    expect(brains[1]!["docs"]).toBe(3);
    expect((brains[1]!["tiers"] as Record<string, string>)["t1"]).toBe("fresh");
    expect(result["bundle"]).toBe("kirja");
    expect((result["counts"] as Record<string, number>)["docs"]).toBe(3);
    const tree = result["tree"] as Array<{ docs: Array<{ path: string }> }>;
    expect(tree[0]!.docs[0]!.path.startsWith("kirja:")).toBe(true);
    expect(result["hint"]).toContain("scope");
  });

  test("scope picks the focus; brains survive the budget", async () => {
    const set = makeSet();
    const result = await overviewPayload(set, 80, "aurinko");
    expect(result["bundle"]).toBe("aurinko");
    expect(result["brains"]).toHaveLength(2);
    expect(result["truncated"]).toBe(true);
  });
});

describe("routed read / neighbors / write / show", () => {
  test("read routes qualified and unqualified docs", async () => {
    const set = makeSet();
    const result = await readPayload(set, "kirja:kahvi.md");
    expect(result["path"]).toBe("kirja:kahvi.md");
    expect(result["brain"]).toBe("kirja");
    const neighbors = result["neighbors"] as { out: Array<{ path: string }> };
    expect(neighbors.out[0]!.path).toBe("kirja:kuu-muistio.md");
    expect(result["hint"]).toContain("brain_neighbors 'kirja:kahvi.md'");
    expect((await readPayload(set, "kahvi"))["path"]).toBe("kirja:kahvi.md");
    expect((await readPayload(set, "kuu"))["path"]).toBe("aurinko:kuu.md");
  });

  test("disambiguates across brains, suggests qualified, names unknown brains", async () => {
    const twin = new BrainSet([
      new Brain({ alias: "a", root: copyBundle("kotiaurinko") }),
      new Brain({ alias: "b", root: copyBundle("kotiaurinko") }),
    ]);
    const result = await readPayload(twin, "kuu");
    const listed = result["disambiguation"] as Array<{ path: string }>;
    expect(new Set(listed.map((d) => d.path))).toEqual(new Set(["a:kuu.md", "b:kuu.md"]));
    const miss = await readPayload(makeSet(), "zzzz-nothing");
    expect(miss).toHaveProperty("error");
    expect((miss["suggestions"] as string[]).every((s) => s.includes(":"))).toBe(true);
    const unknown = await readPayload(makeSet(), "nope:kuu.md");
    expect(String(unknown["error"])).toContain("nope");
  });

  test("an exact hit in one brain beats a fuzzy title in another", async () => {
    // spec/75: the ladder runs tier by tier ACROSS the set — "kuu-muistio" is a
    // stem in kirja, so aurinko's fuzzy titles never enter the race.
    const set = makeSet();
    writeFileSync(
      join(set.brains[0]!.root, "kuu-muistio-notes.md"),
      "---\ntype: Concept\ntitle: Kuu-muistio notes\ndescription: Fuzzy twin.\n---\n" +
        "# Kuu-muistio notes\nSee [Kuu](kuu.md).\n",
    );
    writeFileSync(
      join(set.brains[0]!.root, "porch-moon-diary.md"),
      "---\ntype: Concept\ntitle: Porch moon diary\ndescription: Only fuzzily reachable.\n---\n" +
        "# Porch moon diary\nSee [Kuu](kuu.md).\n",
    );
    expect((await readPayload(set, "kuu-muistio"))["path"]).toBe("kirja:kuu-muistio.md");
    // the fuzzy tier still runs when no brain has an exact match
    expect((await readPayload(set, "porch moon diaries"))["path"]).toBe("aurinko:porch-moon-diary.md");
  });

  test("neighbors are qualified", async () => {
    const set = makeSet();
    const result = await neighborsPayload(set, "aurinko:kuu.md");
    expect(result["center"]).toBe("aurinko:kuu.md");
    expect(result["brain"]).toBe("aurinko");
    const nodes = result["nodes"] as Array<{ path: string }>;
    expect(nodes.every((n) => n.path.startsWith("aurinko:"))).toBe(true);
    const edges = result["edges"] as Array<{ source: string; target: string }>;
    expect(edges.every((e) => e.source.startsWith("aurinko:") && e.target.startsWith("aurinko:"))).toBe(true);
  });

  test("write targets here or declines", async () => {
    const set = makeSet();
    const declined = await writePayload(set, "uusi-kivi", NEW_DOC);
    expect(declined["ok"]).toBe(false);
    expect(String(declined["instruction"])).toContain("aurinko");
    const written = await writePayload(set, "kirja:uusi-kivi", NEW_DOC);
    expect(written["ok"]).toBe(true);
    expect(written["path"]).toBe("kirja:uusi-kivi.md");
    expect(existsSync(join(set.byAlias("kirja")!.root, "uusi-kivi.md"))).toBe(true);

    const withHere = makeSet("aurinko");
    const result = await writePayload(withHere, "uusi-kivi", NEW_DOC);
    expect(result["ok"]).toBe(true);
    expect(result["path"]).toBe("aurinko:uusi-kivi.md");
  });

  test("show targets one brain and drops the rest", async () => {
    const set = makeSet();
    const result = await showPayload(set, ["kirja:kahvi.md", "aurinko:kuu.md"]);
    expect(result["shown"]).toBe(1);
    expect(result["dropped"]).toEqual(["aurinko:kuu.md"]);
    expect(result["brain"]).toBe("kirja");
  });
});

describe("the MCP server", () => {
  test("exposes scope and names the brains in its instructions", async () => {
    const set = makeSet();
    await set.stateFor(set.brains[0]!);
    const server = createMcpServer(set);
    const instructions = (server.server as unknown as { _instructions?: string })._instructions ?? "";
    expect(instructions).toContain("aurinko");
    expect(instructions).toContain("kirja");
    // the registered tool schemas carry scope
    const tools = (server as unknown as { _registeredTools: Record<string, { inputSchema?: { shape?: Record<string, unknown> } }> })
      ._registeredTools;
    expect(Object.keys(tools["brain_search"]!.inputSchema!.shape!)).toContain("scope");
    expect(Object.keys(tools["brain_overview"]!.inputSchema!.shape!)).toContain("scope");
  });

  test("brains load lazily", async () => {
    const set = makeSet();
    const brain = set.byAlias("kirja")!;
    expect(brain.loaded).toBe(false);
    const state = await set.stateFor(brain);
    expect(brain.loaded).toBe(true);
    const manifest = JSON.parse(readFileSync(join(brain.root, ".brainpick", "manifest.json"), "utf8"));
    expect(manifest.seq).toBe(state.seq);
  });
});

describe("the register runner", () => {
  test("add, list, remove", () => {
    const dir = tempDir();
    const registry = join(dir, "brains.toml");
    const root = copyBundle("kotiaurinko");
    const lines: string[] = [];
    const print = (line: string) => lines.push(line);

    expect(runRegister(root, { alias: "sun", user: true, registryPath: registry, print })).toBe(0);
    expect(lines.join("\n")).toContain("registered sun (me)");
    expect(readFileSync(registry, "utf8")).toContain('role = "user"');

    lines.length = 0;
    expect(runRegister(null, { registryPath: registry, print })).toBe(0);
    expect(lines.join("\n")).toContain("sun");
    expect(lines.join("\n")).toContain("(me)");

    lines.length = 0;
    expect(runRegister(root, { remove: true, registryPath: registry, print })).toBe(0);
    expect(lines[0]).toContain("removed");
    lines.length = 0;
    expect(runRegister(null, { registryPath: registry, print })).toBe(0);
    expect(lines[0]).toContain("no brains registered");

    // no alias: the EFFECTIVE alias (the directory name) is shown, never the opaque id
    lines.length = 0;
    expect(runRegister(root, { registryPath: registry, print })).toBe(0);
    expect(lines[0]).toContain("registered kotiaurinko ");
    lines.length = 0;
    expect(runRegister(null, { registryPath: registry, print })).toBe(0);
    expect(lines[0]!.trim().startsWith("kotiaurinko")).toBe(true);

    const errors: string[] = [];
    const empty = join(dir, "empty");
    mkdirSync(empty);
    expect(runRegister(empty, { registryPath: registry, print, printErr: (l) => errors.push(l) })).toBe(1);
    expect(errors[0]).toContain("no markdown");
  });
});

describe("migrating per-project host entries (spec/75 --from-hosts)", () => {
  test("scanHosts finds every per-project root", () => {
    const dir = tempDir();
    const home = join(dir, "home");
    mkdirSync(home);
    const a = copyBundle("kotiaurinko");
    const b = copyBundle("kotikirja");
    const gone = join(dir, "gone");
    writeHosts(home, [a, b, gone]);
    const found = scanHosts({ HOME: home });
    // distinct roots, in discovery order; `serve --root` is not an mcp entry
    expect(found.map((f) => f.root)).toEqual([a, b, gone]);
    expect(found[0]!.hosts).toEqual(["claude-code", "opencode"]);
    expect(found[1]!.hosts).toEqual(["claude-code"]);
    expect(found[2]!.hosts).toEqual(["codex"]);
    expect(scanHosts({ HOME: join(dir, "nohome") })).toEqual([]);
  });

  test("register --from-hosts registers bundles and reports the rest", () => {
    const dir = tempDir();
    const home = join(dir, "home");
    mkdirSync(home);
    const a = copyBundle("kotiaurinko");
    const b = copyBundle("kotikirja");
    const gone = join(dir, "gone");
    writeHosts(home, [a, b, gone]);
    const registry = join(dir, "brains.toml");
    const lines: string[] = [];
    const print = (line: string) => lines.push(line);
    const env = { HOME: home };

    expect(runRegister(null, { fromHosts: true, dryRun: true, registryPath: registry, print, env })).toBe(0);
    let text = lines.join("\n");
    expect(text).toContain("kotiaurinko");
    expect(text).toContain("kotikirja");
    expect(text).toContain("gone");
    expect(text).toContain("dry run");
    expect(existsSync(registry)).toBe(false);

    lines.length = 0;
    expect(runRegister(null, { fromHosts: true, registryPath: registry, print, env })).toBe(0);
    text = lines.join("\n");
    expect(text).toContain("registered kotiaurinko");
    expect(text).toContain("registered kotikirja");
    expect(text).toContain("skipped");
    expect(text).toContain(gone);
    expect(text).toContain("claude mcp add brainpick --scope user");
    const toml = readFileSync(registry, "utf8");
    expect(toml).toContain(a);
    expect(toml).toContain(b);
    expect(toml).not.toContain(gone);

    // idempotent: a second run leaves the registry alone
    lines.length = 0;
    expect(runRegister(null, { fromHosts: true, registryPath: registry, print, env })).toBe(0);
    expect(readFileSync(registry, "utf8")).toBe(toml);
    expect(lines.join("\n")).toContain("already registered");

    // nothing to find is a report, not a failure
    lines.length = 0;
    expect(runRegister(null, { fromHosts: true, registryPath: registry, print, env: { HOME: join(dir, "empty") } })).toBe(0);
    expect(lines.join("\n")).toContain("no per-project");
  });
});
