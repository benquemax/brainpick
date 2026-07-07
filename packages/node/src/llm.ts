/** Chat-completion clients for [models.extraction] (spec/80). Port of llm.py.
 *
 * A sibling of embed.ts, kept separate on purpose: chat is a different protocol
 * surface (messages in, one string out — no batching, no dimensions) with its
 * own failure type. One `complete(system, user) -> string` surface, no
 * streaming, short timeouts. The extraction model powers T3 and doubles as the
 * merge resolver for stale brain_writes (spec/70).
 */
import type { ExtractionConfig } from "./config";

const HTTP_TIMEOUT_MS = 60_000; // single-shot merges — never streams

/** The chat backend cannot answer right now — the message is a one-line instruction. */
export class ChatUnavailable extends Error {}

export interface ChatClient {
  complete(system: string, user: string): string | Promise<string>;
}

function chatMessages(system: string, user: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Walk a nested JSON value by keys/indices; undefined the moment a step misses
 * — the guard behind Python's `data["choices"][0]["message"]["content"]` try. */
function dig(value: unknown, ...path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (typeof current !== "object" || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

abstract class HttpChat implements ChatClient {
  protected readonly endpoint: string;

  constructor(
    endpoint: string,
    protected readonly model: string,
    protected readonly apiKey = "",
  ) {
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  protected async post(url: string, payload: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ChatUnavailable(
        `chat backend at ${this.endpoint} did not answer (${msg}) — ` +
          `check the [models.extraction] endpoint and that '${this.model}' is available`,
      );
    }
  }

  abstract complete(system: string, user: string): Promise<string>;
}

/** POST {endpoint}/api/chat {"model", "messages", "stream": false} → message.content. */
export class OllamaChat extends HttpChat {
  async complete(system: string, user: string): Promise<string> {
    const data = await this.post(`${this.endpoint}/api/chat`, {
      model: this.model,
      messages: chatMessages(system, user),
      stream: false,
    });
    const content = dig(data, "message", "content");
    if (typeof content !== "string") {
      throw new ChatUnavailable(
        `ollama at ${this.endpoint} returned no message for '${this.model}' — ` +
          `pull it first: ollama pull ${this.model}`,
      );
    }
    return content;
  }
}

/** POST {endpoint}/chat/completions (endpoint already ends in /v1) — OpenAI shape. */
export class OpenAICompatChat extends HttpChat {
  async complete(system: string, user: string): Promise<string> {
    const data = await this.post(`${this.endpoint}/chat/completions`, {
      model: this.model,
      messages: chatMessages(system, user),
      stream: false,
    });
    const content = dig(data, "choices", 0, "message", "content");
    if (typeof content !== "string") {
      throw new ChatUnavailable(
        `${this.endpoint} returned no completion for '${this.model}' — ` +
          "check the model name in [models.extraction]",
      );
    }
    return content;
  }
}

/** The test hook behind `[models.extraction] kind = "mock"` — never something
 * init records. Replies with `reply` (string or callable); by default it echoes
 * the text after the last `--- YOURS` section header of the merge prompts
 * (brainpick.merge), which is exactly enough to prove the plumbing. */
export class MockChat implements ChatClient {
  readonly calls: Array<[string, string]> = [];

  constructor(private readonly reply?: string | ((system: string, user: string) => string)) {}

  complete(system: string, user: string): string {
    this.calls.push([system, user]);
    if (typeof this.reply === "function") return this.reply(system, user);
    if (this.reply !== undefined) return this.reply;
    const marker = user.lastIndexOf("--- YOURS");
    if (marker === -1) return user;
    const newline = user.indexOf("\n", marker);
    return newline !== -1 ? user.slice(newline + 1) : user;
  }
}

/** The [models.extraction] record → a client, or null when nothing is configured.
 *
 * `api_key_env` names an env var to read the key from (spec/80: tokens by
 * reference, never a key in config). Unknown kinds warn and yield null — a
 * missing merge resolver degrades the ladder, never the write path. */
export function makeChat(
  extraction: ExtractionConfig,
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = (message) => console.warn(message),
): ChatClient | null {
  const kind = extraction.kind;
  if (!kind) return null;
  if (kind === "mock") return new MockChat();
  if (kind === "ollama") return new OllamaChat(extraction.endpoint, extraction.model);
  if (kind === "openai-compatible" || kind === "openai") {
    const apiKey = extraction.api_key_env ? (env[extraction.api_key_env] ?? "") : "";
    return new OpenAICompatChat(extraction.endpoint, extraction.model, apiKey);
  }
  warn(`unknown extraction kind '${kind}' — use ollama, openai-compatible, or mock`);
  return null;
}
