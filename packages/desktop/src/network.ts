/** advertise_host (D.1, checkpoint log): the address a LAN-bound brain's MCP
 * URL is built from — a status response never advertises an address the
 * brain isn't actually bound to (that check lives with the caller, api.ts,
 * which knows each brain's own bind host); this module only answers "what's
 * this machine's best-effort LAN address". */
import { networkInterfaces } from "node:os";

import type { Env } from "./paths";

// The slice of node:os's NetworkInterfaceInfo this module actually reads —
// narrower than the real type so tests can stub interfaces() without also
// fabricating netmask/mac/cidr they never look at.
interface InterfaceAddress {
  address: string;
  family: string;
  internal: boolean;
}
type Interfaces = Record<string, InterfaceAddress[] | undefined>;
type InterfacesFn = () => Interfaces;

/** The first non-internal IPv4 address, interface names in sorted order for
 * determinism — best-effort, not a guess at "the right" interface on a
 * multi-homed machine. */
export function primaryNonLoopbackIPv4(interfaces: InterfacesFn = networkInterfaces): string | null {
  const all = interfaces();
  for (const name of Object.keys(all).sort()) {
    for (const iface of all[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

export function resolveAdvertiseHost(env: Env = process.env, interfaces: InterfacesFn = networkInterfaces): string {
  return env["BRAINPICK_DAEMON_ADVERTISE_HOST"] || primaryNonLoopbackIPv4(interfaces) || "127.0.0.1";
}
