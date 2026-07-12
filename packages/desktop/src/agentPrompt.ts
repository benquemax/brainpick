/** Compose the paste-into-your-agent prompt for a bundle that isn't fully
 * Brainpick-ready (tester-zero, 2026-07-12). The daemon owns this text — the
 * app only copies it to the clipboard ("all magic in the brainpick service").
 *
 * Ready means: detected as an OKF bundle AND no henxels fix-list. Anything
 * less gets a prompt the user drops into their coding agent inside the repo;
 * "Onboarding is magic, not a manual" (principle 10) — the agent does the
 * migration, not the human. Written for a small local model: concrete target
 * state, one example, verbatim referee output, no lore. */

export interface AgentPromptInput {
  root: string; // the bundle root the agent will work in
  bundle: { kind: string; docs: number; typed: number };
  fixList: string | null;
}

const OKF_SHAPE = `Target shape (OKF — the Open Knowledge Format):
- One concept per file, kebab-case filename (e.g. \`release-checklist.md\`).
- Every concept file starts with YAML frontmatter carrying at least:
  \`type\` (the page's document form: article | decision | playbook |
  reference | log), \`title\`, \`description\` (one sentence), and
  \`timestamp\` (ISO 8601). Example:

  ---
  type: article
  title: Release checklist
  description: The steps every release walks through.
  timestamp: 2026-07-12T12:00:00+03:00
  ---

- The bundle root has an \`index.md\` whose frontmatter is exactly
  \`okf_version: "0.1"\` (this is what marks the folder as an OKF bundle)
  and whose body links every top-level concept.
- Pages link to each other with relative markdown links whose link text is
  the target page's title. Every page should be reachable from index.md;
  every link should land on a real file.`;

const VERIFY = `Verify your work:
- If the repo has a \`henxels.yaml\` contract and the \`henxels\` CLI is
  available, run \`henxels check --all\` until it is green.
- Re-add (or refresh) the brain in Brainpick — the bundle should be detected
  as \`okf\` with no fix-list.`;

export function composeAgentPrompt(input: AgentPromptInput): string | null {
  const { root, bundle, fixList } = input;
  const isOkf = bundle.kind === "okf";
  if (isOkf && fixList === null) return null;

  const parts: string[] = [];
  if (isOkf) {
    parts.push(
      `The OKF knowledge bundle at ${root} was added to Brainpick, but its own referee (henxels) reports contract violations. Fix every finding below — each line says what is wrong and where. Do not weaken the contract to make findings disappear; change the documents.`,
    );
  } else {
    parts.push(
      `The folder at ${root} is not yet an OKF bundle, so Brainpick can only serve it in degraded form (${bundle.docs} markdown docs found, ${bundle.typed} with \`type\` frontmatter). Convert it in place — keep all existing knowledge, change only structure and frontmatter.`,
      OKF_SHAPE,
    );
  }
  if (fixList !== null) {
    parts.push(`The referee's current findings, verbatim:\n\n${fixList}`);
  }
  parts.push(VERIFY);
  return parts.join("\n\n");
}
