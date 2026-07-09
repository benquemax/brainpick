/** Config loading (spec/80): defaults, TOML values, env overrides, unknown-key
 * warnings (the twin of packages/python/tests/test_config.py). */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { generateBundleId, loadConfig } from "../src/config";
import { cleanup, tempDir } from "./helpers";

afterEach(cleanup);

function load(root: string, env: Record<string, string | undefined> = {}) {
  const warnings: string[] = [];
  const cfg = loadConfig(root, env, (m) => warnings.push(m));
  return { cfg, warnings };
}

function withToml(text: string): string {
  const root = tempDir();
  writeFileSync(join(root, "brainpick.toml"), text, "utf8");
  return root;
}

test("defaults when absent", () => {
  const { cfg } = load(tempDir());
  expect(cfg.spec).toBe("0.1");
  expect(cfg.bundle.root).toBe(".");
  expect(cfg.bundle.include).toEqual(["**/*.md"]);
  expect(cfg.bundle.exclude).toEqual([]);
  expect(cfg.bundle.id).toBe("");
  expect(cfg.index.mode).toBe("section");
  expect(cfg.index.file).toBe("index.md");
  expect(cfg.serve.host).toBe("127.0.0.1");
  expect(cfg.serve.port).toBe(4747);
  expect(cfg.serve.transports).toEqual(["streamable-http"]);
  expect(cfg.serve.watch).toBe(true);
  expect(cfg.serve.writes).toBe("guarded");
  expect(cfg.serve.token).toBe("");
  expect(cfg.validate.henxels).toBe("auto");
});

test("toml values override defaults", () => {
  const root = withToml(
    'spec = "0.1"\n' +
      "[serve]\n" +
      "port = 5757\n" +
      "watch = false\n" +
      'writes = "off"\n' +
      'transports = ["streamable-http", "sse"]\n' +
      "[validate]\n" +
      'henxels = "never"\n',
  );
  const { cfg, warnings } = load(root);
  expect(cfg.serve.port).toBe(5757);
  expect(cfg.serve.watch).toBe(false);
  expect(cfg.serve.writes).toBe("off");
  expect(cfg.serve.transports).toEqual(["streamable-http", "sse"]);
  expect(cfg.validate.henxels).toBe("never");
  expect(cfg.serve.host).toBe("127.0.0.1"); // untouched keys keep their defaults
  expect(warnings).toEqual([]);
});

test("env overrides beat toml", () => {
  const root = withToml("[serve]\nport = 5757\n");
  const { cfg } = load(root, {
    BRAINPICK_SERVE_PORT: "6868",
    BRAINPICK_SERVE_WATCH: "false",
    BRAINPICK_SERVE_TOKEN: "s3cret",
    BRAINPICK_SERVE_TRANSPORTS: "streamable-http,sse",
  });
  expect(cfg.serve.port).toBe(6868);
  expect(cfg.serve.watch).toBe(false);
  expect(cfg.serve.token).toBe("s3cret");
  expect(cfg.serve.transports).toEqual(["streamable-http", "sse"]);
});

test("unknown keys warn, not error", () => {
  const root = withToml("[serve]\nfancy = true\n[future]\nx = 1\n");
  const { cfg, warnings } = load(root);
  expect(warnings.length).toBeGreaterThan(0);
  expect(cfg.serve.port).toBe(4747); // the file still loads and serves defaults
});

test("invalid toml warns and uses defaults", () => {
  const root = withToml("this is not toml [ = ]");
  const { cfg, warnings } = load(root);
  expect(warnings.some((w) => w.includes("not valid TOML"))).toBe(true);
  expect(cfg.serve.port).toBe(4747);
});

test("bundle root indirection", () => {
  const { cfg } = load(withToml('[bundle]\nroot = "docs"\n'));
  expect(cfg.bundle.root).toBe("docs");
});

test("bundle id parses from toml", () => {
  const { cfg } = load(withToml('[bundle]\nid = "abc123xyz987def456ghi0a"\n'));
  expect(cfg.bundle.id).toBe("abc123xyz987def456ghi0a");
});

test("bundle id env override", () => {
  const { cfg } = load(tempDir(), { BRAINPICK_BUNDLE_ID: "envid00000000000000000" });
  expect(cfg.bundle.id).toBe("envid00000000000000000");
});

test("generateBundleId is 21-char lowercase alphanumeric", () => {
  const ids = new Set(Array.from({ length: 50 }, () => generateBundleId()));
  expect(ids.size).toBe(50); // no collisions in a small sample
  for (const id of ids) expect(id).toMatch(/^[a-z0-9]{21}$/);
});

test("modules and embedding defaults", () => {
  const { cfg } = load(tempDir());
  expect(cfg.modules.vectors).toBe("auto");
  expect(cfg.modules.graph).toBe("algorithmic");
  expect(cfg.modules.ui).toBe(true);
  expect(cfg.models.embedding.kind).toBe("");
  expect(cfg.models.embedding.endpoint).toBe("");
  expect(cfg.models.embedding.model).toBe("");
  expect(cfg.models.embedding.dim).toBe(0);
});

test("modules and embedding from toml", () => {
  const root = withToml(
    "[modules]\n" +
      'vectors = "on"\n' +
      "[models.embedding]\n" +
      'kind = "ollama"\n' +
      'endpoint = "http://127.0.0.1:11434"\n' +
      'model = "nomic-embed-text"\n' +
      "dim = 768\n",
  );
  const { cfg, warnings } = load(root);
  expect(cfg.modules.vectors).toBe("on");
  expect(cfg.models.embedding.kind).toBe("ollama");
  expect(cfg.models.embedding.endpoint).toBe("http://127.0.0.1:11434");
  expect(cfg.models.embedding.model).toBe("nomic-embed-text");
  expect(cfg.models.embedding.dim).toBe(768);
  expect(warnings).toEqual([]);
});

test("ui defaults, toml, and env overrides", () => {
  // [ui] policy the engine ships to the client via /api/status (spec/80)
  const base = load(tempDir()).cfg;
  expect(base.ui.max_nodes_mobile).toBe(8000);
  expect(base.ui.default_mode).toBe("cosmos");

  const { cfg, warnings } = load(withToml('[ui]\nmax_nodes_mobile = 1200\ndefault_mode = "brain"\n'));
  expect(cfg.ui.max_nodes_mobile).toBe(1200);
  expect(cfg.ui.default_mode).toBe("brain");
  expect(warnings).toEqual([]);

  const env = load(tempDir(), { BRAINPICK_UI_MAX_NODES_MOBILE: "500" }).cfg;
  expect(env.ui.max_nodes_mobile).toBe(500);
});

test("embedding env overrides", () => {
  const root = withToml('[models.embedding]\nkind = "ollama"\nmodel = "nomic-embed-text"\n');
  const { cfg } = load(root, {
    BRAINPICK_MODULES_VECTORS: "off",
    BRAINPICK_MODELS_EMBEDDING_KIND: "mock",
  });
  expect(cfg.modules.vectors).toBe("off");
  expect(cfg.models.embedding.kind).toBe("mock");
});

test("unknown embedding keys warn, not error", () => {
  const root = withToml("[models.embedding]\nturbo = true\n[models.future]\nx = 1\n");
  const { cfg, warnings } = load(root);
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings.some((w) => w.includes("[models.embedding] turbo"))).toBe(true);
  expect(warnings.some((w) => w.includes("[models.future]"))).toBe(true);
  expect(cfg.models.embedding.kind).toBe("");
});

// -- layering: brainpick.local.toml deep-merges over the shared file (spec/80) ------

function withLocal(root: string, text: string): string {
  writeFileSync(join(root, "brainpick.local.toml"), text, "utf8");
  return root;
}

test("local toml overrides shared toml", () => {
  const root = withToml("[serve]\nport = 5757\nhost = \"127.0.0.1\"\n");
  withLocal(root, "[serve]\nport = 6868\n");
  const { cfg, warnings } = load(root);
  expect(cfg.serve.port).toBe(6868); // local wins the contested key
  expect(cfg.serve.host).toBe("127.0.0.1"); // untouched shared keys survive the merge
  expect(warnings).toEqual([]);
});

test("local toml deep-merges models over shared policy", () => {
  const root = withToml("[modules]\nvectors = \"on\"\n[index]\nmode = \"manage\"\n");
  withLocal(root, '[models.embedding]\nkind = "ollama"\nendpoint = "http://127.0.0.1:11434"\nmodel = "nomic-embed-text"\n');
  const { cfg } = load(root);
  expect(cfg.modules.vectors).toBe("on"); // shared policy intact
  expect(cfg.index.mode).toBe("manage");
  expect(cfg.models.embedding.kind).toBe("ollama"); // machine-local endpoint layered in
  expect(cfg.models.embedding.model).toBe("nomic-embed-text");
});

test("env still beats local toml", () => {
  const root = withToml("[serve]\nport = 5757\n");
  withLocal(root, "[serve]\nport = 6868\n");
  const { cfg } = load(root, { BRAINPICK_SERVE_PORT: "7979" });
  expect(cfg.serve.port).toBe(7979); // CLI > env > local > toml > defaults
});

test("local toml alone works without a shared file", () => {
  const root = tempDir();
  withLocal(root, '[models.embedding]\nkind = "mock"\n');
  const { cfg, warnings } = load(root);
  expect(cfg.models.embedding.kind).toBe("mock");
  expect(cfg.serve.port).toBe(4747);
  expect(warnings).toEqual([]);
});

test("broken local toml warns and keeps the shared layer", () => {
  const root = withToml("[serve]\nport = 5757\n");
  withLocal(root, "this is not toml [ = ]");
  const { cfg, warnings } = load(root);
  expect(warnings.some((w) => w.includes("brainpick.local.toml is not valid TOML"))).toBe(true);
  expect(cfg.serve.port).toBe(5757); // the shared file still applied
});

test("unknown keys in local toml warn with the local filename", () => {
  const root = withToml("");
  withLocal(root, "[serve]\nfancy = true\n");
  const { warnings } = load(root);
  expect(warnings.some((w) => w.includes("brainpick.local.toml"))).toBe(true);
});

test("extraction model section parses without warnings", () => {
  const root = withToml(
    '[models.extraction]\nkind = "ollama"\nendpoint = "http://127.0.0.1:11434"\nmodel = "qwen3.5:4b"\napi_key_env = "MY_KEY"\n',
  );
  const { cfg, warnings } = load(root);
  expect(warnings).toEqual([]);
  expect(cfg.models.extraction.kind).toBe("ollama");
  expect(cfg.models.extraction.model).toBe("qwen3.5:4b");
  expect(cfg.models.extraction.api_key_env).toBe("MY_KEY");
});
