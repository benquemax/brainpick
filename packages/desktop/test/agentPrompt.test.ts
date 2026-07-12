/** The agent prompt is the onboarding hand-off (tester-zero, 2026-07-12):
 * when an added folder isn't a governed OKF bundle yet, the daemon composes
 * a paste-into-your-agent prompt that steers the user's coding agent to make
 * it one — "Onboarding is magic, not a manual" (principle 10), and the magic
 * must live in the service, not the app. */
import { describe, expect, it } from "vitest";

import { composeAgentPrompt } from "../src/agentPrompt";

const ROOT = "/home/someone/wiki";

describe("composeAgentPrompt", () => {
  it("returns null for a clean OKF bundle — nothing to teach", () => {
    expect(
      composeAgentPrompt({ root: ROOT, bundle: { kind: "okf", docs: 12, typed: 12 }, fixList: null }),
    ).toBeNull();
  });

  it("teaches the full OKF shape when the folder is not an OKF bundle", () => {
    const prompt = composeAgentPrompt({
      root: ROOT,
      bundle: { kind: "none", docs: 7, typed: 0 },
      fixList: null,
    });
    expect(prompt).not.toBeNull();
    // The agent must know WHERE to work and WHAT the target state is.
    expect(prompt).toContain(ROOT);
    expect(prompt).toContain("okf_version");
    expect(prompt).toContain("index.md");
    expect(prompt).toMatch(/kebab-case/i);
    expect(prompt).toMatch(/type.*title.*description.*timestamp/is);
    // ...and how to see the current scale of the job.
    expect(prompt).toContain("7 markdown docs");
  });

  it("treats a density bundle like a not-yet-OKF one (full guidance)", () => {
    const prompt = composeAgentPrompt({
      root: ROOT,
      bundle: { kind: "density", docs: 20, typed: 5 },
      fixList: null,
    });
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("okf_version");
  });

  it("embeds the henxels fix-list verbatim when there is one", () => {
    const fixList = "✗ docs/foo.md: link lands nowhere: bar.md\n✗ docs/baz.md: missing frontmatter: type";
    const prompt = composeAgentPrompt({
      root: ROOT,
      bundle: { kind: "okf", docs: 12, typed: 12 },
      fixList,
    });
    expect(prompt).not.toBeNull();
    expect(prompt).toContain(fixList);
    // An OKF bundle with contract findings gets the fix-list, not the 101.
    expect(prompt).not.toMatch(/not .*an OKF bundle/i);
  });

  it("gives both the OKF shape and the fix-list when both are missing/failing", () => {
    const fixList = "✗ index.md: the bundle root has no index";
    const prompt = composeAgentPrompt({
      root: ROOT,
      bundle: { kind: "none", docs: 3, typed: 0 },
      fixList,
    });
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("okf_version");
    expect(prompt).toContain(fixList);
  });
});
