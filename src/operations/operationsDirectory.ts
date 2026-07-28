import type { WorldOperationsSnapshot } from "./worldOperationsSnapshot";

type OperationsDirectoryElements = {
  access: HTMLButtonElement;
  dialog: HTMLDialogElement;
  close: HTMLButtonElement;
  state: HTMLElement;
  services: HTMLElement;
  records: HTMLElement;
  identity: HTMLElement;
  authority: HTMLElement;
  onOpenChange?: () => void;
};

type GetSnapshot = () => WorldOperationsSnapshot;

const RESERVED_ACTION_LABELS: Record<WorldOperationsSnapshot["executiveAuthority"]["reservedActions"][number], string> = {
  spending: "spending",
  external_communication: "external communication",
  irreversible_changes: "irreversible changes",
  protected_releases: "protected releases"
};

export function createOperationsDirectoryController(
  elements: OperationsDirectoryElements,
  getSnapshot: GetSnapshot
): { open: (opener?: HTMLElement) => void; close: () => void } {
  let restoreFocusTo: HTMLElement | null = null;

  function render(snapshot: WorldOperationsSnapshot): void {
    elements.state.textContent = `Public snapshot generated ${new Date(snapshot.generatedAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    })} UTC. Overall freshness: ${snapshot.freshness}.`;

    const receptionItems = snapshot.reception.map((entry) => {
      const item = document.createElement("li");
      const capability = entry.status.replaceAll("_", " ");
      const freshness = entry.freshness.replaceAll("_", " ");
      const reason = entry.reason?.replaceAll("_", " ") ?? "none";
      item.textContent = `${entry.label}. Capability: ${capability}. Freshness: ${freshness}. As of: ${entry.asOf ?? "not available"}. Reason: ${reason}. ${entry.summary}`;
      item.dataset.status = entry.status;
      item.dataset.freshness = entry.freshness;
      return item;
    });
    elements.services.replaceChildren(...receptionItems);

    const record = snapshot.approvedPublicRecords[0];
    if (!record) {
      const unavailable = document.createElement("p");
      unavailable.textContent = "No validated public record has been observed in this browser session. No record is being claimed.";
      elements.records.replaceChildren(unavailable);
    } else {
      const article = document.createElement("article");
      const title = document.createElement("p");
      const sourceId = document.createElement("p");
      const sourceUpdated = document.createElement("p");
      const observed = document.createElement("p");
      const checked = document.createElement("p");
      const freshness = document.createElement("p");
      const source = document.createElement("a");
      title.textContent = `Record: ${record.title}`;
      sourceId.textContent = `Source ID: ${record.sourceId}`;
      sourceUpdated.textContent = `Source updated: ${record.sourceUpdatedAt}`;
      observed.textContent = `Observed: ${record.observedAt}`;
      checked.textContent = `Last checked: ${record.checkedAt}`;
      freshness.textContent = `Freshness: ${record.freshness}${record.failureReason ? ` / ${record.failureReason.replace("_", " ")}` : ""}`;
      source.href = record.url;
      source.target = "_blank";
      source.rel = "noreferrer";
      source.textContent = `Open durable source (${record.source})`;
      article.replaceChildren(title, sourceId, sourceUpdated, observed, checked, freshness, source);
      elements.records.replaceChildren(article);
    }

    const identity = snapshot.publicIdentities[0];
    elements.identity.textContent = identity
      ? `${identity.displayName} — ${identity.roleLabel} identity. Designated workplace: ${identity.workplace.label}. This ${identity.temporality} identity uses ${identity.representation.replace("_", " ")} representation for coordination and synthesis support. It does not claim a live hosted agent, current availability, presence, or current work.`
      : "No public identity metadata is available.";

    const authority = snapshot.executiveAuthority;
    const reservedActions = authority.reservedActions.map((action) => RESERVED_ACTION_LABELS[action]).join(", ");
    elements.authority.textContent = `${authority.personLabel} — ${authority.roleLabel}. ${reservedActions} remain reserved for human authority unless an explicitly approved policy delegates them. This plaque describes an authority boundary; it is not an approval control and does not claim a live agent.`;
  }

  function open(opener: HTMLElement = elements.access): void {
    restoreFocusTo = opener;
    render(getSnapshot());
    if (!elements.dialog.open) {
      elements.dialog.showModal();
      elements.close.focus();
      elements.onOpenChange?.();
    }
  }

  function close(): void {
    if (elements.dialog.open) elements.dialog.close();
  }

  elements.access.addEventListener("click", (event) => open(event.currentTarget as HTMLElement));
  elements.close.addEventListener("click", close);
  elements.dialog.addEventListener("close", () => {
    elements.onOpenChange?.();
    const target = restoreFocusTo;
    restoreFocusTo = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  });

  return { open, close };
}
