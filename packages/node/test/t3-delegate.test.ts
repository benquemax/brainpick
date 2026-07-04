/** T3 extraction is Python-only (spec/40); the Node engine delegates the
 * `compile --only t3` step to an installed Python sibling via uvx, or skips with
 * the exact enabling command. This pins that plan without spawning anything. */
import { describe, expect, test } from "vitest";

import { commandExists, planT3Delegate } from "../src/cli";

describe("planT3Delegate", () => {
  test("delegates via uvx when uv + python are present", () => {
    const plan = planT3Delegate("/bundle", true, true);
    expect(plan.argv).toEqual([
      "uvx",
      "--from",
      "brainpick[graph]",
      "brainpick",
      "compile",
      "--only",
      "t3",
      "--root",
      "/bundle",
    ]);
    expect(plan.message).toContain("delegating T3 extraction");
  });

  test("skips with an instruction when uv is missing", () => {
    const plan = planT3Delegate("/bundle", false, true);
    expect(plan.argv).toBeNull();
    expect(plan.message).toContain("uvx --from 'brainpick[graph]' brainpick compile --only t3 --root /bundle");
    expect(plan.message).toContain("Python-only");
  });

  test("skips with an instruction when python is missing", () => {
    const plan = planT3Delegate("/bundle", true, false);
    expect(plan.argv).toBeNull();
    expect(plan.message).toContain("Install uv + Python");
  });
});

describe("commandExists", () => {
  test("a nonexistent command resolves to false", () => {
    expect(commandExists("definitely-not-a-real-binary-xyz")).toBe(false);
  });
});
