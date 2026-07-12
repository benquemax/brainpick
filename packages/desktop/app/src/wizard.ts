/** The add-brain wizard (Chunk E MVP scope): repo URL -> key generation (for
 * a remote repo) -> "paste this into your forge" -> validate -> fix-list.
 * Every step-to-step decision here is presentation flow; every actual
 * action is a call into ./api — "NO logic in the app that isn't an API
 * call" (_todo.md). */
import { addBrain, isLocalRepo, mintKey, type AddBrainResult, type MintedKey } from "./api";
import { forgeDeepLink } from "./forges";

export interface WizardCallbacks {
  onDone: () => void;
}

function closeDialog(body: HTMLElement): void {
  body.closest("dialog")?.close();
}

function showError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.hidden = false;
}

/** Busy-state guard (tester-zero, 2026-07-12): an add can clone + compile for
 * whole seconds — a still-clickable Next with no feedback is what turned one
 * add into seven. While the promise is in flight the button is disabled and
 * says so; it re-arms only on failure (success re-renders the step anyway). */
async function withBusy(button: HTMLButtonElement, busyLabel: string, work: () => Promise<void>): Promise<void> {
  const idleLabel = button.textContent ?? "";
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await work();
  } finally {
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function openWizard(dialog: HTMLDialogElement, body: HTMLElement, callbacks: WizardCallbacks): void {
  renderRepoStep(body, callbacks);
  dialog.showModal();
}

function renderRepoStep(body: HTMLElement, callbacks: WizardCallbacks): void {
  body.innerHTML = `
    <h2>Add a brain</h2>
    <label>Repo URL or local path
      <input id="w-repo" placeholder="git@github.com:you/wiki.git or /path/to/wiki" />
    </label>
    <label>Bundle subdirectory (optional)
      <input id="w-bundle-path" placeholder="docs" />
    </label>
    <label><input id="w-lan" type="checkbox" /> Allow LAN access (agents on other machines)</label>
    <p id="w-error" class="wizard-error" hidden></p>
    <div class="wizard-actions">
      <button id="w-cancel" type="button">Cancel</button>
      <button id="w-next" type="button">Next</button>
    </div>
  `;
  const repoInput = body.querySelector<HTMLInputElement>("#w-repo")!;
  const bundlePathInput = body.querySelector<HTMLInputElement>("#w-bundle-path")!;
  const lanCheckbox = body.querySelector<HTMLInputElement>("#w-lan")!;
  const errorEl = body.querySelector<HTMLElement>("#w-error")!;

  body.querySelector("#w-cancel")!.addEventListener("click", () => closeDialog(body));
  const nextButton = body.querySelector<HTMLButtonElement>("#w-next")!;
  nextButton.addEventListener("click", () => {
    const repo = repoInput.value.trim();
    if (repo === "") {
      showError(errorEl, "a repo URL or local path is required");
      return;
    }
    errorEl.hidden = true;
    const host = lanCheckbox.checked ? "0.0.0.0" : undefined;
    const bundlePath = bundlePathInput.value.trim() || undefined;
    void withBusy(nextButton, isLocalRepo(repo) ? "Adding…" : "Minting key…", async () => {
      try {
        if (isLocalRepo(repo)) {
          const result = await addBrain({ repo, bundle_path: bundlePath, host });
          renderResultStep(body, result, callbacks);
        } else {
          const key = await mintKey();
          renderKeyStep(body, key, repo, bundlePath, host, callbacks);
        }
      } catch (error) {
        showError(errorEl, error instanceof Error ? error.message : String(error));
      }
    });
  });
}

function renderKeyStep(
  body: HTMLElement,
  key: MintedKey,
  repo: string,
  bundlePath: string | undefined,
  host: string | undefined,
  callbacks: WizardCallbacks,
): void {
  const link = forgeDeepLink(repo);
  body.innerHTML = `
    <h2>Paste this deploy key</h2>
    <p>Add this as a READ-ONLY deploy key on the repo, then continue.</p>
    <textarea id="w-key" readonly rows="3">${escapeHtml(key.public_key)}</textarea>
    <div class="wizard-actions">
      <button id="w-copy" type="button">Copy key</button>
      ${link !== null ? `<a id="w-forge-link" href="${link.url}" target="_blank" rel="noopener">Open ${link.label} settings</a>` : ""}
    </div>
    <p id="w-error" class="wizard-error" hidden></p>
    <div class="wizard-actions">
      <button id="w-cancel" type="button">Cancel</button>
      <button id="w-next" type="button">I've added the key</button>
    </div>
  `;
  const errorEl = body.querySelector<HTMLElement>("#w-error")!;

  body.querySelector("#w-copy")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(key.public_key);
  });
  body.querySelector("#w-cancel")!.addEventListener("click", () => closeDialog(body));
  const nextButton = body.querySelector<HTMLButtonElement>("#w-next")!;
  nextButton.addEventListener("click", () => {
    errorEl.hidden = true;
    void withBusy(nextButton, "Cloning + compiling…", async () => {
      try {
        const result = await addBrain({ id: key.id, repo, bundle_path: bundlePath, host });
        renderResultStep(body, result, callbacks);
      } catch (error) {
        showError(errorEl, error instanceof Error ? error.message : String(error));
      }
    });
  });
}

function renderResultStep(body: HTMLElement, result: AddBrainResult, callbacks: WizardCallbacks): void {
  const docs = "docs" in result.compiled ? String(result.compiled["docs"]) : "?";
  const ready = result.agent_prompt === null;
  // Three honest states (tester-zero: "No henxels contract issues." on a
  // plain folder read as a clean bill of health it never earned):
  const verdict = ready
    ? `<p>OKF bundle — ${docs} docs compiled. Ready to serve.</p>`
    : result.bundle.kind === "okf"
      ? `<p>OKF bundle — ${docs} docs compiled, but its henxels contract has findings:</p>`
      : `<p>Not an OKF bundle yet (${docs} docs found) — added, but served in degraded form.</p>`;
  const fixList = result.fix_list !== null ? `<pre class="fix-list">${escapeHtml(result.fix_list)}</pre>` : "";
  const handoff = ready
    ? ""
    : `
    <p>Have your coding agent make it Brainpick-ready — copy this prompt
    into Claude Code (or any agent) running in that repo:</p>
    <div class="wizard-actions">
      <button id="w-copy-prompt" type="button">Copy agent prompt</button>
    </div>`;
  body.innerHTML = `
    <h2>Brain added</h2>
    ${verdict}
    ${fixList}
    ${handoff}
    <div class="wizard-actions">
      <button id="w-done" type="button">Done</button>
    </div>
  `;
  const copyPrompt = body.querySelector<HTMLButtonElement>("#w-copy-prompt");
  if (copyPrompt !== null) {
    copyPrompt.addEventListener("click", () => {
      void navigator.clipboard.writeText(result.agent_prompt ?? "");
      copyPrompt.textContent = "Copied ✓";
    });
  }
  body.querySelector("#w-done")!.addEventListener("click", () => {
    closeDialog(body);
    callbacks.onDone();
  });
}
