/** The HTTP client for POST /api/show (spec/95): a leaf module with no local
 * imports on purpose — both `cli.ts` (the `show` command) and `mcp.ts`
 * (`brain_show`'s server-proxy attempt) need it, and `cli.ts` has a top-level
 * await gating its entry point, so a module that imports it back would create
 * a real circular reference at bundle time (esbuild then emits invalid
 * "await" outside an async wrapper — this file exists to avoid that, not as
 * a style preference). */

export interface ShowResult {
  result?: Record<string, unknown>;
  error?: string;
  /** True only when nothing answered at all (connection refused/DNS/timeout) —
   * a caller that wants to fall back to a local, UI-less presentation must
   * check this, so a server that's up but REJECTS the request (bad auth, bad
   * body) is never mistaken for "no server running" and silently papered over. */
  unreachable?: boolean;
}

/** A server may bind 0.0.0.0/:: (everywhere); a client must connect via a real
 * address — shared by `brainpick show` and brain_show's server-proxy attempt
 * so both resolve a running `brainpick serve` the same way. */
export function connectableHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

/** POST a presentation body to a running server's /api/show (spec/95). The
 * caller is a client here, never resolving locally: the live server resolves
 * and broadcasts to open UIs. Returns the parsed response or a clear
 * instruction (never throws). */
export async function postShow(
  baseUrl: string,
  body: Record<string, unknown>,
  token?: string | null,
): Promise<ShowResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/show`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      error: `no brainpick server at ${baseUrl} — start one with 'brainpick serve' (${reason})`,
      unreachable: true,
    };
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* non-JSON error body — keep the raw text */
    }
    return { error: `the server rejected the presentation (${res.status}): ${message}` };
  }
  return { result: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}
