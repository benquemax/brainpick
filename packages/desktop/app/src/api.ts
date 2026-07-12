/** A thin client of brainpickd's control API — every call here is a plain
 * fetch to the daemon (_todo.md: "NO logic in the app that isn't
 * an API call"). `daemonInfo()` is the one Tauri command this app has:
 * bootstrap the daemon (spawn it if needed) and hand back where it lives. */
import { invoke } from "@tauri-apps/api/core";

export interface DaemonInfo {
  base_url: string;
  token: string;
}

export interface BrainRecord {
  id: string;
  repo: string;
  bundle_path: string;
  port: number;
  enabled: boolean;
  host: string;
  process_status: string;
}

export interface BrainStatus {
  id: string;
  process_status: string;
  port: number;
  mcp_url: string;
  mcp_url_local: string;
  claude_mcp_add: string;
  engine_status: Record<string, unknown> | null;
}

export interface MintedKey {
  id: string;
  public_key: string;
}

export interface AddBrainInput {
  id?: string;
  repo: string;
  bundle_path?: string;
  host?: string;
  port?: number;
  enabled?: boolean;
}

export interface AddBrainResult {
  brain: BrainRecord;
  bundle: { kind: string; docs: number; typed: number };
  compiled: Record<string, unknown>;
  fix_list: string | null;
  /** Paste-into-your-coding-agent hand-off, non-null whenever the bundle
   * isn't Brainpick-ready (not OKF, or henxels has findings). Composed by
   * the daemon — the app only copies it. */
  agent_prompt: string | null;
}

/** Ensures a daemon is running (spawning one on first run) and returns its
 * address + control token — used by the UI for display (the web URL), never
 * for fetching. */
export function daemonInfo(): Promise<DaemonInfo> {
  return invoke<DaemonInfo>("daemon_info");
}

/** ALL control-API traffic rides the Rust `api_call` command (tester-zero,
 * 2026-07-12): the packaged webview's cross-origin fetch SENDS requests but
 * WebKit never hands the response back to JS — the wizard's adds landed
 * (seven times, thanks to a blind retry that is also gone now) while the UI
 * saw nothing. Rust/reqwest has no scheme/CORS politics. NEVER add a
 * webview fetch back here. */
async function call<T>(method: string, path: string, payload?: unknown): Promise<T> {
  const raw = await invoke<{ status: number; body: string }>("api_call", {
    method,
    path,
    body: payload === undefined ? null : JSON.stringify(payload),
  });
  const body: unknown = raw.body === "" ? null : JSON.parse(raw.body);
  if (raw.status >= 400) {
    const message =
      body !== null && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${raw.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function listBrains(): Promise<{ brains: BrainRecord[] }> {
  return call("GET", "/daemon/brains");
}

export function brainStatus(id: string): Promise<BrainStatus> {
  return call("GET", `/daemon/brains/${encodeURIComponent(id)}/status`);
}

export function removeBrain(id: string): Promise<void> {
  return call("DELETE", `/daemon/brains/${encodeURIComponent(id)}`);
}

export function mintKey(id?: string): Promise<MintedKey> {
  return call("POST", "/daemon/keys", id ? { id } : {});
}

export function addBrain(input: AddBrainInput): Promise<AddBrainResult> {
  return call("POST", "/daemon/brains", input);
}

/** A local filesystem path, as opposed to a git remote — mirrors
 * registry.ts's isLocalRepo exactly, but this copy is presentation-only
 * (which wizard step to show next); the daemon is the actual authority. */
export function isLocalRepo(repo: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo)) return false;
  if (/^[^/\s]+@[^/\s]+:/.test(repo)) return false;
  return true;
}

/** The human (browser) URL for a brain is the same address as its MCP
 * endpoint, minus `/mcp` — a presentation-only transform of a value the
 * daemon already computed (mcp_url / mcp_url_local), not a new decision. */
export function webUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp$/, "");
}
