/** advertise_host resolution (D.1, checkpoint log): the address a LAN-bound
 * brain's MCP URL is built from — "never advertise an address the brain
 * isn't actually bound to" governs the CALLER (api.ts), this module just
 * answers "what's this machine's best-effort LAN address". */
import { expect, test } from "vitest";

import { primaryNonLoopbackIPv4, resolveAdvertiseHost } from "../src/network";

test("resolveAdvertiseHost honors the explicit override", () => {
  expect(resolveAdvertiseHost({ BRAINPICK_DAEMON_ADVERTISE_HOST: "203.0.113.5" })).toBe("203.0.113.5");
});

test("resolveAdvertiseHost falls back to 127.0.0.1 when nothing else is found", () => {
  // a stub with no non-loopback IPv4 interface at all
  const host = resolveAdvertiseHost({}, () => ({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] }));
  expect(host).toBe("127.0.0.1");
});

test("resolveAdvertiseHost prefers a real non-loopback IPv4 interface when present", () => {
  const host = resolveAdvertiseHost({}, () => ({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
  }));
  expect(host).toBe("192.168.1.42");
});

test("primaryNonLoopbackIPv4 reflects the machine's real interfaces (sanity, not a specific value)", () => {
  // just proves it runs against the real os.networkInterfaces() without throwing
  const result = primaryNonLoopbackIPv4();
  expect(result === null || typeof result === "string").toBe(true);
});

test("primaryNonLoopbackIPv4 ignores internal/IPv6 entries", () => {
  const result = primaryNonLoopbackIPv4(() => ({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    docker0: [{ address: "::1", family: "IPv6", internal: false }],
    eth0: [{ address: "10.0.0.9", family: "IPv4", internal: false }],
  }));
  expect(result).toBe("10.0.0.9");
});
