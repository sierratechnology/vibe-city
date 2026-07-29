import {
  PublicProjectRecordState,
  PublicProjectRecordUnavailable,
  loadLatestPublicProjectRecord
} from "./publicProjectRecord";

type RecordsTerminalElements = {
  dialog: HTMLDialogElement;
  close: HTMLButtonElement;
  refresh: HTMLButtonElement;
  state: HTMLElement;
  record: HTMLElement;
  status: HTMLElement;
  sourceId: HTMLElement;
  sourceUpdated: HTMLElement;
  observed: HTMLElement;
  freshness: HTMLElement;
  source: HTMLAnchorElement;
  onOpenChange?: () => void;
  onStateChange?: (state: PublicProjectRecordState) => void;
};

type LoadRecord = (options?: { force?: boolean }) => Promise<PublicProjectRecordState>;
type LoadWorkRecords = (options?: { force?: boolean }) => Promise<unknown>;

const REASON_LABELS: Record<PublicProjectRecordUnavailable["reason"], string> = {
  network: "Network unavailable",
  rate_limited: "Public source rate limited",
  source_error: "Public source unavailable",
  invalid_record: "Public source returned an invalid record"
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  });
}

export function createRecordsTerminalController(
  elements: RecordsTerminalElements,
  loadRecord: LoadRecord = loadLatestPublicProjectRecord,
  loadWorkRecords: LoadWorkRecords = async () => undefined
): { open: () => Promise<void>; refresh: () => Promise<void>; close: () => void } {
  let loading = false;

  function renderLoading(): void {
    elements.state.textContent = "Checking the public repository…";
    elements.status.textContent = "Checking";
    elements.refresh.disabled = true;
  }

  function render(state: PublicProjectRecordState): void {
    elements.onStateChange?.(state);
    elements.refresh.disabled = false;
    if (state.status === "unavailable") {
      elements.state.textContent = `${REASON_LABELS[state.reason]}. No record is being claimed.`;
      elements.record.textContent = "Unavailable";
      elements.status.textContent = "Unavailable";
      elements.sourceId.textContent = "Unavailable";
      elements.sourceUpdated.textContent = "Unavailable";
      elements.observed.textContent = formatTimestamp(state.checkedAt);
      elements.freshness.textContent = "Unavailable";
      elements.source.hidden = true;
      elements.source.removeAttribute("href");
      return;
    }

    elements.record.textContent = state.title;
    elements.status.textContent = "Recorded change";
    elements.sourceId.textContent = state.sourceId;
    elements.sourceUpdated.textContent = formatTimestamp(state.sourceUpdatedAt);
    elements.observed.textContent = formatTimestamp(state.observedAt);
    elements.freshness.textContent = state.freshness === "fresh" ? "Fresh" : "Stale / last known";
    elements.source.href = state.url;
    elements.source.textContent = `Open durable source (${state.source})`;
    elements.source.hidden = false;
    elements.state.textContent = state.freshness === "fresh"
      ? "Fresh public repository record."
      : `${REASON_LABELS[state.staleReason ?? "source_error"]}. Showing the last known public record.`;
  }

  async function load(force: boolean): Promise<void> {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      const [record] = await Promise.all([
        loadRecord({ force }),
        loadWorkRecords({ force })
      ]);
      render(record);
    } finally {
      loading = false;
      elements.refresh.disabled = false;
    }
  }

  async function open(): Promise<void> {
    if (!elements.dialog.open) {
      elements.dialog.showModal();
      elements.onOpenChange?.();
    }
    await load(false);
  }

  async function refresh(): Promise<void> {
    await load(true);
  }

  function close(): void {
    if (elements.dialog.open) elements.dialog.close();
  }

  elements.refresh.addEventListener("click", () => void refresh());
  elements.close.addEventListener("click", close);
  elements.dialog.addEventListener("close", () => elements.onOpenChange?.());

  return { open, refresh, close };
}
