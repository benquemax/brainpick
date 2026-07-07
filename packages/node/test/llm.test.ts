/** Chat clients for [models.extraction] (spec/80): one complete() surface, two
 * HTTP backends, a mock for tests — misses raise instructions, never hang.
 * Twin of packages/python/tests/test_llm.py. */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, expect, test } from "vitest";

import { defaultConfig, type ExtractionConfig } from "../src/config";
import { ChatUnavailable, makeChat, MockChat, OllamaChat, OpenAICompatChat } from "../src/llm";

interface SeenRequest {
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

interface RunningChat {
  url: string;
  seen: SeenRequest[];
  close: () => Promise<void>;
}

const servers: RunningChat[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

/** A local http server answering every POST with canned JSON, recording requests. */
async function chatServer(payload: unknown): Promise<RunningChat> {
  const seen: SeenRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      seen.push({
        path: req.url ?? "",
        body: raw === "" ? null : (JSON.parse(raw) as Record<string, unknown>),
        authorization: req.headers["authorization"] ?? null,
      });
      const data = JSON.stringify(payload);
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
      res.end(data);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const running: RunningChat = {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  servers.push(running);
  return running;
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function extraction(overrides: Partial<ExtractionConfig> = {}): ExtractionConfig {
  return { ...defaultConfig().models.extraction, ...overrides };
}

test("ollama chat speaks api/chat without streaming", async () => {
  const server = await chatServer({ message: { role: "assistant", content: "merged text" } });
  const answer = await new OllamaChat(server.url, "qwen3.5:4b").complete("be terse", "merge these");
  expect(answer).toBe("merged text");
  expect(server.seen.length).toBe(1);
  const request = server.seen[0]!;
  expect(request.path).toBe("/api/chat");
  expect(request.body!["model"]).toBe("qwen3.5:4b");
  expect(request.body!["stream"]).toBe(false);
  expect(request.body!["messages"]).toEqual([
    { role: "system", content: "be terse" },
    { role: "user", content: "merge these" },
  ]);
});

test("openai-compat chat hits v1/chat/completions with bearer", async () => {
  const server = await chatServer({ choices: [{ message: { role: "assistant", content: "ok" } }] });
  const client = new OpenAICompatChat(`${server.url}/v1`, "qwen3.5-4b", "sk-local");
  const answer = await client.complete("sys", "usr");
  expect(answer).toBe("ok");
  const request = server.seen[0]!;
  expect(request.path).toBe("/v1/chat/completions");
  expect(request.authorization).toBe("Bearer sk-local");
  expect(request.body!["model"]).toBe("qwen3.5-4b");
});

test("chat backend down raises an instruction", async () => {
  const client = new OllamaChat(`http://127.0.0.1:${await closedPort()}`, "qwen3.5:4b");
  await expect(client.complete("sys", "usr")).rejects.toThrow(/models\.extraction/);
});

test("chat gibberish payload raises not crashes", async () => {
  const server = await chatServer({ unexpected: true });
  await expect(new OllamaChat(server.url, "m").complete("s", "u")).rejects.toBeInstanceOf(ChatUnavailable);
  await expect(new OpenAICompatChat(`${server.url}/v1`, "m").complete("s", "u")).rejects.toBeInstanceOf(
    ChatUnavailable,
  );
});

test("makeChat resolves kinds", () => {
  expect(makeChat(extraction())).toBeNull(); // nothing configured
  expect(makeChat(extraction({ kind: "mock" }))).toBeInstanceOf(MockChat);
  expect(makeChat(extraction({ kind: "ollama", endpoint: "http://x:11434", model: "m" }))).toBeInstanceOf(
    OllamaChat,
  );
  expect(
    makeChat(extraction({ kind: "openai-compatible", endpoint: "http://x:1234/v1", model: "m" })),
  ).toBeInstanceOf(OpenAICompatChat);
});

test("makeChat reads the api key from api_key_env, never config", async () => {
  const server = await chatServer({ choices: [{ message: { content: "ok" } }] });
  const client = makeChat(
    extraction({ kind: "openai-compatible", endpoint: `${server.url}/v1`, model: "m", api_key_env: "MY_KEY" }),
    { MY_KEY: "sk-from-env" },
  )!;
  await client.complete("s", "u");
  expect(server.seen[0]!.authorization).toBe("Bearer sk-from-env"); // resolved by reference, never stored
});

test("makeChat unknown kind warns and returns null", () => {
  const warnings: string[] = [];
  const result = makeChat(extraction({ kind: "banana" }), {}, (message) => warnings.push(message));
  expect(result).toBeNull();
  expect(warnings.some((warning) => warning.includes("banana"))).toBe(true);
});

test("mock chat canned, callable, and derived replies", () => {
  const canned = new MockChat("fixed");
  expect(canned.complete("s", "u")).toBe("fixed");
  expect(canned.calls).toEqual([["s", "u"]]);

  const derived = new MockChat((_system, user) => user.toUpperCase());
  expect(derived.complete("s", "abc")).toBe("ABC");

  const echoing = new MockChat(); // default: echo the text after the last --- YOURS header
  const prompt = "--- THEIRS (saved) ---\nold\n--- YOURS (incoming) ---\nnew doc\nline two\n";
  expect(echoing.complete("s", prompt)).toBe("new doc\nline two\n");
  expect(echoing.complete("s", "no marker")).toBe("no marker");
});
