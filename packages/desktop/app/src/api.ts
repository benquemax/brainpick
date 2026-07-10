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
}

let cachedInfo: DaemonInfo | null = null;

/** Ensures a daemon is running (spawning one on first run) and returns its
 * address + control token. Cached after the first successful call in a
 * session — call {@link forgetDaemon} to force a re-check (e.g. after an
 * API call fails, in case the daemon was restarted with a new token). */
export async function daemonInfo(): Promise<DaemonInfo> {
  if (cachedInfo !== null) return cachedInfo;
  cachedInfo = await invoke<DaemonInfo>("daemon_info");
  return cachedInfo;
}

export function forgetDaemon(): void {
  cachedInfo = null;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const info = await daemonInfo();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${info.token}`);
  let response: Response;
  try {
    response = await fetch(`${info.base_url}${path}`, { ...init, headers });
  } catch (error) {
    if (retry) {
      forgetDaemon();
      return call<T>(path, init, false);
    }
    throw error;
  }
  const text = await response.text();
  const body: unknown = text === "" ? null : JSON.parse(text);
  if (!response.ok) {
    const message =
      body !== null && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function listBrains(): Promise<{ brains: BrainRecord[] }> {
  return call("/daemon/brains");
}

export function brainStatus(id: string): Promise<BrainStatus> {
  return call(`/daemon/brains/${encodeURIComponent(id)}/status`);
}

export function removeBrain(id: string): Promise<void> {
  return call(`/daemon/brains/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function mintKey(id?: string): Promise<MintedKey> {
  return call("/daemon/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? { id } : {}),
  });
}

export function addBrain(input: AddBrainInput): Promise<AddBrainResult> {
  return call("/daemon/brains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** A local filesystem path, as opposed to a git remote — mirrors
 * registry.ts's isLocalRepo exactly, but this copy is presentation-only
 * (which wizard step to show next); the daemon is the actual authority. */
export function isLocalRepo(repo: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo)) return false;
  if (/^[^/\s]+@[^/\s]+:/.test(repo)) return false;
  return true;
}
