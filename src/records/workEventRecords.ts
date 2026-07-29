export type WorkEvent = {
  version: "1.0";
  eventId: string;
  sourceType: "hermes_kanban";
  workRef: string;
  profileId: string;
  eventKind: "task_assigned" | "task_started" | "status_changed" | "blocked" | "completed" | "review_requested";
  status: "ready" | "running" | "blocked" | "done";
  occurredAt: string;
  observedAt: string;
  summary: string;
};

export type WorkEventsAvailable = {
  status: "available" | "empty";
  checkedAt: string;
  schemaVersion: "1.0";
  generatedAt: string;
  freshness: "recent" | "stale" | "empty";
  source: {
    type: "authenticated_local_work_events";
    eventCount: number;
    newestOccurredAt: string | null;
    newestObservedAt: string | null;
  };
  events: WorkEvent[];
};

export type WorkEventsUnavailable = {
  status: "unavailable";
  reason: "network" | "source_error" | "invalid_record";
  checkedAt: string;
};

export type WorkEventRecordsState = WorkEventsAvailable | WorkEventsUnavailable;

type LoadOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  force?: boolean;
};

const TOP_LEVEL_KEYS = ["events", "freshness", "generatedAt", "schemaVersion", "source"];
const SOURCE_KEYS = ["eventCount", "newestObservedAt", "newestOccurredAt", "type"];
const EVENT_KEYS = ["eventId", "eventKind", "observedAt", "occurredAt", "profileId", "sourceType", "status", "summary", "version", "workRef"];
const EVENT_KINDS = new Set(["task_assigned", "task_started", "status_changed", "blocked", "completed", "review_requested"]);
const STATUSES = new Set(["ready", "running", "blocked", "done"]);
const PUBLIC_PROFILES = new Set(["ariadne", "spiders"]);
const PUBLIC_SUMMARIES = new Set([
  "Assigned work is ready.",
  "Work is in progress.",
  "Work is blocked pending input.",
  "Work is complete.",
  "Work is ready for review."
]);
const EXPECTED_SUMMARIES = new Map([
  ["task_assigned:ready", "Assigned work is ready."],
  ["task_started:running", "Work is in progress."],
  ["status_changed:ready", "Assigned work is ready."],
  ["status_changed:running", "Work is in progress."],
  ["status_changed:blocked", "Work is blocked pending input."],
  ["status_changed:done", "Work is complete."],
  ["blocked:blocked", "Work is blocked pending input."],
  ["completed:done", "Work is complete."],
  ["review_requested:running", "Work is ready for review."]
]);
const STALE_AFTER_MS = 15 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isSafeSummary(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= 1 && value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/(?:https?:\/\/|www\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\/(?:Users|home|var|private|tmp)\/|[A-Z]:\\)/i.test(value);
}

function normalizeEvent(value: unknown, generatedAt: string): WorkEvent | null {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_KEYS)) return null;
  if (
    value.version !== "1.0" ||
    value.sourceType !== "hermes_kanban" ||
    typeof value.eventId !== "string" || !/^evt_[a-f0-9]{32,64}$/.test(value.eventId) ||
    typeof value.workRef !== "string" || !/^public-[a-f0-9]{16,64}$/.test(value.workRef) ||
    typeof value.profileId !== "string" || !PUBLIC_PROFILES.has(value.profileId) ||
    typeof value.eventKind !== "string" ||
    !EVENT_KINDS.has(value.eventKind) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status) ||
    !isIso(value.occurredAt) ||
    !isIso(value.observedAt) ||
    !isSafeSummary(value.summary) || !PUBLIC_SUMMARIES.has(value.summary) ||
    value.summary !== EXPECTED_SUMMARIES.get(`${value.eventKind}:${value.status}`)
  ) return null;
  if (Date.parse(value.occurredAt) > Date.parse(value.observedAt) || Date.parse(value.observedAt) > Date.parse(generatedAt)) return null;
  return {
    version: "1.0",
    eventId: value.eventId,
    sourceType: "hermes_kanban",
    workRef: value.workRef,
    profileId: value.profileId,
    eventKind: value.eventKind as WorkEvent["eventKind"],
    status: value.status as WorkEvent["status"],
    occurredAt: value.occurredAt,
    observedAt: value.observedAt,
    summary: value.summary
  };
}

function normalizePayload(value: unknown, checkedAt: string): Omit<WorkEventsAvailable, "status" | "checkedAt"> | null {
  if (!isRecord(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) return null;
  if (value.schemaVersion !== "1.0" || !isIso(value.generatedAt) || Date.parse(value.generatedAt) > Date.parse(checkedAt)) return null;
  if (value.freshness !== "recent" && value.freshness !== "stale" && value.freshness !== "empty") return null;
  if (!isRecord(value.source) || !hasExactKeys(value.source, SOURCE_KEYS)) return null;
  if (
    value.source.type !== "authenticated_local_work_events" ||
    !Number.isSafeInteger(value.source.eventCount) ||
    Number(value.source.eventCount) < 0 ||
    !Array.isArray(value.events) ||
    value.events.length > 50 ||
    Number(value.source.eventCount) < value.events.length
  ) return null;
  const eventCount = Number(value.source.eventCount);
  const events = value.events.map((event) => normalizeEvent(event, value.generatedAt as string));
  if (events.some((event) => event === null)) return null;
  const normalizedEvents = events as WorkEvent[];
  for (let index = 1; index < normalizedEvents.length; index += 1) {
    if (Date.parse(normalizedEvents[index - 1].observedAt) < Date.parse(normalizedEvents[index].observedAt)) return null;
  }
  const newest = normalizedEvents[0] ?? null;
  const sourceNewestOccurredAt = value.source.newestOccurredAt;
  const sourceNewestObservedAt = value.source.newestObservedAt;
  const emptyValid = value.freshness === "empty" && eventCount === 0 && normalizedEvents.length === 0 &&
    sourceNewestOccurredAt === null && sourceNewestObservedAt === null;
  const populatedValid = value.freshness !== "empty" && eventCount > 0 && newest !== null &&
    isIso(sourceNewestOccurredAt) && isIso(sourceNewestObservedAt) &&
    sourceNewestObservedAt === newest.observedAt &&
    Date.parse(sourceNewestOccurredAt) <= Date.parse(sourceNewestObservedAt) &&
    Date.parse(sourceNewestObservedAt) <= Date.parse(value.generatedAt) &&
    normalizedEvents.every((event) => Date.parse(event.occurredAt) <= Date.parse(sourceNewestOccurredAt));
  if (!emptyValid && !populatedValid) return null;
  if (populatedValid) {
    const age = Date.parse(value.generatedAt) - Date.parse(sourceNewestObservedAt as string);
    const expectedFreshness = age <= STALE_AFTER_MS ? "recent" : "stale";
    if (value.freshness !== expectedFreshness) return null;
  }
  return {
    schemaVersion: "1.0",
    generatedAt: value.generatedAt,
    freshness: value.freshness,
    source: {
      type: "authenticated_local_work_events",
      eventCount,
      newestOccurredAt: sourceNewestOccurredAt as string | null,
      newestObservedAt: sourceNewestObservedAt as string | null
    },
    events: normalizedEvents
  };
}

function observeNow(now: () => number): string {
  try {
    return new Date(now()).toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

export async function loadWorkEventRecords(options: LoadOptions = {}): Promise<WorkEventRecordsState> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let response: Response;
  try {
    response = await fetcher("/api/work-events?limit=20", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    return { status: "unavailable", reason: "network", checkedAt: observeNow(now) };
  }
  const checkedAt = observeNow(now);
  if (!response.ok) return { status: "unavailable", reason: "source_error", checkedAt };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "unavailable", reason: "invalid_record", checkedAt };
  }
  const normalized = normalizePayload(payload, checkedAt);
  if (!normalized) return { status: "unavailable", reason: "invalid_record", checkedAt };
  return {
    status: normalized.freshness === "empty" ? "empty" : "available",
    checkedAt,
    ...normalized
  };
}
