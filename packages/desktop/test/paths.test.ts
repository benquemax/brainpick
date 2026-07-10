/** brainpickd's own config/data dirs — never the engine's per-bundle paths.
 * XDG-style defaults (~/.config, ~/.local/share), env overrides for tests. */
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { configDir, dataDir } from "../src/paths";

const SAVED = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  Object.assign(process.env, SAVED);
});

test("configDir defaults to ~/.config/brainpick", () => {
  delete process.env["BRAINPICK_DAEMON_CONFIG_DIR"];
  delete process.env["XDG_CONFIG_HOME"];
  const home = process.env["HOME"] ?? "/home/nobody";
  expect(configDir({ HOME: home })).toBe(join(home, ".config", "brainpick"));
});

test("configDir honors XDG_CONFIG_HOME", () => {
  expect(configDir({ HOME: "/home/x", XDG_CONFIG_HOME: "/custom/config" })).toBe(
    join("/custom/config", "brainpick"),
  );
});

test("configDir honors the explicit override", () => {
  expect(configDir({ HOME: "/home/x", BRAINPICK_DAEMON_CONFIG_DIR: "/tmp/cfg" })).toBe("/tmp/cfg");
});

test("dataDir defaults to ~/.local/share/brainpick", () => {
  const home = process.env["HOME"] ?? "/home/nobody";
  expect(dataDir({ HOME: home })).toBe(join(home, ".local", "share", "brainpick"));
});

test("dataDir honors XDG_DATA_HOME", () => {
  expect(dataDir({ HOME: "/home/x", XDG_DATA_HOME: "/custom/data" })).toBe(join("/custom/data", "brainpick"));
});

test("dataDir honors the explicit override", () => {
  expect(dataDir({ HOME: "/home/x", BRAINPICK_DAEMON_DATA_DIR: "/tmp/data" })).toBe("/tmp/data");
});

test("explicit override beats XDG", () => {
  expect(
    configDir({ HOME: "/home/x", XDG_CONFIG_HOME: "/custom", BRAINPICK_DAEMON_CONFIG_DIR: "/wins" }),
  ).toBe("/wins");
});
