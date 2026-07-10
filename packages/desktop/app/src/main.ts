/** brainpick desktop — a thin client of brainpickd. Renders the brain list
 * (MCP URL/snippet copy buttons) and hosts the add-brain wizard; every
 * action is a call into ./api, never a decision made here. */
import { brainStatus, daemonInfo, listBrains, removeBrain, type BrainRecord } from "./api";
import { openWizard } from "./wizard";

const statusBanner = document.querySelector<HTMLElement>("#status-banner")!;
const brainListEl = document.querySelector<HTMLElement>("#brain-list")!;
const addBrainButton = document.querySelector<HTMLButtonElement>("#add-brain-button")!;
const wizardDialog = document.querySelector<HTMLDialogElement>("#wizard-dialog")!;
const wizardBody = document.querySelector<HTMLElement>("#wizard-body")!;

function showBanner(message: string, kind: "info" | "error" = "info"): void {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner status-banner--${kind}`;
  statusBanner.hidden = false;
}

function hideBanner(): void {
  statusBanner.hidden = true;
}

function brainCard(brain: BrainRecord): HTMLElement {
  const card = document.createElement("article");
  card.className = "brain-card";
  card.dataset["brainId"] = brain.id;
  card.innerHTML = `
    <header>
      <h2>${brain.id}</h2>
      <span class="status-pill status-pill--${brain.process_status}">${brain.process_status}</span>
    </header>
    <p class="brain-repo">${brain.repo}${brain.bundle_path ? `/${brain.bundle_path}` : ""}</p>
    <div class="brain-details" hidden>
      <p class="mcp-url"></p>
      <div class="snippet-row">
        <code class="mcp-snippet"></code>
        <button type="button" class="copy-snippet">Copy</button>
      </div>
    </div>
    <div class="brain-actions">
      <button type="button" class="reveal-details">MCP snippet</button>
      <button type="button" class="remove-brain">Remove</button>
    </div>
  `;

  const details = card.querySelector<HTMLElement>(".brain-details")!;
  const mcpUrlEl = card.querySelector<HTMLElement>(".mcp-url")!;
  const snippetEl = card.querySelector<HTMLElement>(".mcp-snippet")!;

  card.querySelector(".reveal-details")!.addEventListener("click", () => {
    void (async () => {
      if (details.hidden) {
        const status = await brainStatus(brain.id);
        mcpUrlEl.textContent =
          status.mcp_url !== status.mcp_url_local
            ? `${status.mcp_url} (local: ${status.mcp_url_local})`
            : status.mcp_url;
        snippetEl.textContent = status.claude_mcp_add;
      }
      details.hidden = !details.hidden;
    })();
  });

  card.querySelector(".copy-snippet")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(snippetEl.textContent ?? "");
  });

  card.querySelector(".remove-brain")!.addEventListener("click", () => {
    void (async () => {
      if (!confirm(`Remove ${brain.id}? Its clone is left on disk.`)) return;
      await removeBrain(brain.id);
      await refresh();
    })();
  });

  return card;
}

async function refresh(): Promise<void> {
  try {
    const { brains } = await listBrains();
    hideBanner();
    brainListEl.replaceChildren();
    if (brains.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No brains yet — add one to get started.";
      brainListEl.append(empty);
      return;
    }
    for (const brain of brains) brainListEl.append(brainCard(brain));
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error), "error");
  }
}

addBrainButton.addEventListener("click", () => {
  openWizard(wizardDialog, wizardBody, { onDone: () => void refresh() });
});

async function boot(): Promise<void> {
  showBanner("Starting brainpickd…");
  try {
    await daemonInfo();
    await refresh();
  } catch (error) {
    showBanner(error instanceof Error ? error.message : String(error), "error");
  }
}

void boot();

// Cheap liveness — the tray already polls independently; this just keeps
// the visible list honest without the user reopening the window.
setInterval(() => void refresh(), 15_000);
