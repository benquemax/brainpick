/** brainpickd's own config/data dirs (_todo.md) — distinct from any
 * engine bundle's paths. XDG-style defaults so a Linux install feels native;
 * `BRAINPICK_DAEMON_CONFIG_DIR`/`BRAINPICK_DAEMON_DATA_DIR` override both for
 * tests and for callers that want an isolated daemon instance. */
import { join } from "node:path";

export type Env = Record<string, string | undefined>;

/** `brains.toml`, `users.toml`, the control-API token — small, hand-editable. */
export function configDir(env: Env = process.env): string {
  const override = env["BRAINPICK_DAEMON_CONFIG_DIR"];
  if (override) return override;
  const xdg = env["XDG_CONFIG_HOME"];
  const home = env["HOME"] ?? "";
  return join(xdg || join(home, ".config"), "brainpick");
}

/** Cloned brain repos, deploy keys — larger, disposable-if-lost-except-keys. */
export function dataDir(env: Env = process.env): string {
  const override = env["BRAINPICK_DAEMON_DATA_DIR"];
  if (override) return override;
  const xdg = env["XDG_DATA_HOME"];
  const home = env["HOME"] ?? "";
  return join(xdg || join(home, ".local", "share"), "brainpick");
}
