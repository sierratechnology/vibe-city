import type { WorkEventRecordsState } from "./workEventRecords";

type WorkRecordsPanelElements = {
  state: HTMLElement;
  freshness: HTMLElement;
  source: HTMLElement;
  list: HTMLElement;
};

type LoadWorkRecords = (options?: { force?: boolean }) => Promise<WorkEventRecordsState>;

const UNAVAILABLE_LABELS = {
  network: "Local work-record service is offline.",
  source_error: "Local work-record service returned an error.",
  invalid_record: "Local work-record service returned an invalid privacy-safe projection."
} as const;

function displayToken(value: string): string {
  return value.split(/[_-]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function eventItem(event: Extract<WorkEventRecordsState, { status: "available" | "empty" }>["events"][number]): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "work-record-event";
  item.textContent = `${displayToken(event.profileId)} · ${displayToken(event.status)} · ${event.summary} · ${new Date(event.occurredAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  return item;
}

export function createWorkRecordsPanelController(
  elements: WorkRecordsPanelElements,
  loadRecords: LoadWorkRecords
): { load: (options?: { force?: boolean }) => Promise<WorkEventRecordsState>; render: (state: WorkEventRecordsState) => void } {
  function render(state: WorkEventRecordsState): void {
    elements.list.replaceChildren();
    elements.source.textContent = "Authenticated local Hermes/Kanban ingestion";
    if (state.status === "unavailable") {
      elements.state.textContent = UNAVAILABLE_LABELS[state.reason];
      elements.freshness.textContent = "Unavailable";
      return;
    }
    if (state.status === "empty") {
      elements.state.textContent = "No authenticated work events have been accepted.";
      elements.freshness.textContent = "Empty";
      return;
    }
    elements.state.textContent = state.freshness === "stale"
      ? `${state.source.eventCount} authenticated local work event${state.source.eventCount === 1 ? "" : "s"}; source is stale.`
      : `${state.source.eventCount} authenticated local work event${state.source.eventCount === 1 ? "" : "s"}.`;
    elements.freshness.textContent = state.freshness === "recent" ? "Recent" : "Stale";
    elements.list.replaceChildren(...state.events.map(eventItem));
  }

  async function load(options: { force?: boolean } = {}): Promise<WorkEventRecordsState> {
    elements.state.textContent = "Checking authenticated local work records…";
    let state: WorkEventRecordsState;
    try {
      state = await loadRecords(options);
    } catch {
      state = { status: "unavailable", reason: "network", checkedAt: new Date().toISOString() };
    }
    render(state);
    return state;
  }

  return { load, render };
}
