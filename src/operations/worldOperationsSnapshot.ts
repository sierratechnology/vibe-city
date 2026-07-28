export type Freshness = "live" | "recent" | "historical" | "stale" | "degraded" | "unavailable";
export type CapabilityStatus = "working" | "degraded" | "blocked" | "not_configured" | "unavailable" | "private" | "retired";
export type PublicReason = "not_configured" | "not_public" | "not_checked" | "network" | "rate_limited" | "source_error" | "invalid_record" | "stale_source";

export type PublicIdentity = {
  identityId: "stg-spiders";
  kind: "static_identity";
  displayName: "Spiders";
  roleLabel: "Chief Agent";
  workplace: {
    id: "stg-chief-agent-office";
    label: "Chief Agent Office";
    relationship: "designated";
  };
  representation: "plaque_only";
  temporality: "static";
  availability: "not_claimed";
  currentWork: null;
  source: "checked_in_public_identity";
  authority: {
    scope: "coordination_and_synthesis_support";
    mayApproveConsequentialActions: false;
    humanApprovalRequired: true;
  };
};

export type ReceptionItem = {
  id: string;
  label: string;
  status: CapabilityStatus;
  summary: string;
  freshness: Freshness;
  asOf: string | null;
  reason: PublicReason | null;
};

export type ExecutiveAuthority = {
  personLabel: "Devon";
  roleLabel: "Human owner / executive authority";
  reservedActions: readonly ["spending", "external_communication", "irreversible_changes", "protected_releases"];
  delegationPolicy: "explicit_approved_policy_required";
  isApprovalControl: false;
};

export type ApprovedPublicRecord = {
  title: string;
  source: "GitHub public repository";
  sourceId: string;
  sourceUpdatedAt: string;
  observedAt: string;
  checkedAt: string;
  url: string;
  freshness: "fresh" | "stale";
  failureReason: RecordsObservation["failure"];
};

export type WorldOperationsSnapshot = {
  schemaVersion: "1.0";
  source: {
    id: "vibe-city-public-world-operations";
    label: "Vibe City public operations snapshot";
    visibility: "public";
  };
  generatedAt: string;
  freshness: Freshness;
  hostedAgents: {
    registryStatus: "not_configured";
    projectedCount: 0;
    reason: "not_configured";
  };
  approvedPublicRecords: readonly ApprovedPublicRecord[];
  publicIdentities: readonly PublicIdentity[];
  reception: readonly ReceptionItem[];
  executiveAuthority: ExecutiveAuthority;
};

export type RecordsObservation = {
  state: "fresh" | "stale" | "unavailable" | "not_checked";
  asOf: string | null;
  failure?: "network" | "rate_limited" | "source_error" | "invalid_record" | null;
  record?: {
    title: string;
    source: "GitHub public repository";
    sourceId: string;
    sourceUpdatedAt: string;
    observedAt: string;
    checkedAt: string;
    url: string;
  } | null;
};

type SnapshotOptions = {
  now?: () => number;
  services?: {
    coreWorld?: unknown;
    realtime?: unknown;
    records?: unknown;
  };
};

const SPIDERS_PUBLIC_IDENTITY: PublicIdentity = Object.freeze({
  identityId: "stg-spiders",
  kind: "static_identity",
  displayName: "Spiders",
  roleLabel: "Chief Agent",
  workplace: Object.freeze({
    id: "stg-chief-agent-office",
    label: "Chief Agent Office",
    relationship: "designated"
  }),
  representation: "plaque_only",
  temporality: "static",
  availability: "not_claimed",
  currentWork: null,
  source: "checked_in_public_identity",
  authority: Object.freeze({
    scope: "coordination_and_synthesis_support",
    mayApproveConsequentialActions: false,
    humanApprovalRequired: true
  })
});

const EXECUTIVE_AUTHORITY: ExecutiveAuthority = Object.freeze({
  personLabel: "Devon",
  roleLabel: "Human owner / executive authority",
  reservedActions: Object.freeze([
    "spending",
    "external_communication",
    "irreversible_changes",
    "protected_releases"
  ]) as ExecutiveAuthority["reservedActions"],
  delegationPolicy: "explicit_approved_policy_required",
  isApprovalControl: false
});

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

const COMMIT_URL_PREFIX = "https://github.com/sierratechnology/vibe-city/commit/";

function normalizePublicRecord(value: unknown, generatedAt: string): NonNullable<RecordsObservation["record"]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.title !== "string" ||
    !record.title.trim() ||
    record.title.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(record.title) ||
    record.source !== "GitHub public repository" ||
    typeof record.sourceId !== "string" ||
    !/^[a-f0-9]{40}$/i.test(record.sourceId) ||
    record.url !== `${COMMIT_URL_PREFIX}${record.sourceId}` ||
    !isIsoTimestamp(record.sourceUpdatedAt) ||
    !isIsoTimestamp(record.observedAt) ||
    !isIsoTimestamp(record.checkedAt)
  ) return null;
  const sourceUpdatedTime = Date.parse(record.sourceUpdatedAt);
  const observedTime = Date.parse(record.observedAt);
  const checkedTime = Date.parse(record.checkedAt);
  const generatedTime = Date.parse(generatedAt);
  if (sourceUpdatedTime > observedTime || observedTime > checkedTime || checkedTime > generatedTime) return null;
  return {
    title: record.title,
    source: "GitHub public repository",
    sourceId: record.sourceId,
    sourceUpdatedAt: record.sourceUpdatedAt,
    observedAt: record.observedAt,
    checkedAt: record.checkedAt,
    url: record.url
  };
}

function normalizeRecordsObservation(value: unknown, generatedAt: string): RecordsObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "unavailable", asOf: null, failure: "source_error", record: null };
  const input = value as { state?: unknown; asOf?: unknown; failure?: unknown; record?: unknown };
  const state = input.state;
  if (state === "not_checked" && input.asOf === null) return { state, asOf: null, record: null };
  if (state !== "fresh" && state !== "stale" && state !== "unavailable") {
    return { state: "unavailable", asOf: null, failure: "source_error", record: null };
  }
  if (!isIsoTimestamp(input.asOf)) return { state: "unavailable", asOf: null, failure: "source_error", record: null };
  const failure = input.failure === null || input.failure === undefined
    ? null
    : input.failure === "network" || input.failure === "rate_limited" || input.failure === "source_error" || input.failure === "invalid_record"
      ? input.failure
      : "invalid_failure";
  if (failure === "invalid_failure") {
    return { state: "unavailable", asOf: input.asOf, failure: "invalid_record", record: null };
  }
  if (state === "unavailable") return { state, asOf: input.asOf, failure: failure ?? "source_error", record: null };
  if ((state === "fresh" && failure !== null) || (state === "stale" && failure === null)) {
    return { state: "unavailable", asOf: input.asOf, failure: "invalid_record", record: null };
  }
  const record = normalizePublicRecord(input.record, generatedAt);
  if (!record || record.observedAt !== input.asOf || (state === "fresh" && record.checkedAt !== record.observedAt)) {
    return { state: "unavailable", asOf: input.asOf, failure: "invalid_record", record: null };
  }
  return { state, asOf: input.asOf, failure, record };
}

function projectApprovedPublicRecords(observation: RecordsObservation): ApprovedPublicRecord[] {
  if ((observation.state !== "fresh" && observation.state !== "stale") || !observation.record) return [];
  return [{
    ...observation.record,
    freshness: observation.state,
    failureReason: observation.failure ?? null
  }];
}

function recordsReceptionItem(observation: RecordsObservation): ReceptionItem {
  if (observation.state === "fresh") {
    return {
      id: "public-record-source",
      label: "Public GitHub record source",
      status: "working",
      summary: "A validated public repository record was successfully observed.",
      freshness: "recent",
      asOf: observation.asOf,
      reason: null
    };
  }
  if (observation.state === "stale") {
    return {
      id: "public-record-source",
      label: "Public GitHub record source",
      status: "degraded",
      summary: "Last-known validated public repository data is stale.",
      freshness: "stale",
      asOf: observation.asOf,
      reason: "stale_source"
    };
  }
  if (observation.state === "not_checked") {
    return {
      id: "public-record-source",
      label: "Public GitHub record source",
      status: "unavailable",
      summary: "No public repository record has been checked in this browser session.",
      freshness: "unavailable",
      asOf: null,
      reason: "not_checked"
    };
  }
  return {
    id: "public-record-source",
    label: "Public GitHub record source",
    status: "unavailable",
    summary: "The public repository record source is unavailable.",
    freshness: "unavailable",
    asOf: observation.asOf,
    reason: observation.failure ?? "source_error"
  };
}

function realtimeReceptionItem(observation: unknown, generatedAt: string): ReceptionItem {
  if (observation === "working") {
    return {
      id: "multiplayer-realtime",
      label: "Multiplayer Realtime",
      status: "working",
      summary: "Realtime presence is connected in this browser session.",
      freshness: "live",
      asOf: generatedAt,
      reason: null
    };
  }
  if (observation === "missing_configuration") {
    return {
      id: "multiplayer-realtime",
      label: "Multiplayer Realtime",
      status: "not_configured",
      summary: "Realtime configuration is not available to this browser runtime.",
      freshness: "unavailable",
      asOf: null,
      reason: "not_configured"
    };
  }
  if (observation === "realtime_unavailable") {
    return {
      id: "multiplayer-realtime",
      label: "Multiplayer Realtime",
      status: "degraded",
      summary: "Realtime is configured but currently unavailable.",
      freshness: "degraded",
      asOf: generatedAt,
      reason: "source_error"
    };
  }
  return {
    id: "multiplayer-realtime",
    label: "Multiplayer Realtime",
    status: "unavailable",
    summary: "No recognized public Realtime observation is available.",
    freshness: "unavailable",
    asOf: null,
    reason: "source_error"
  };
}

function projectReception(services: SnapshotOptions["services"], generatedAt: string, recordsObservation: RecordsObservation): ReceptionItem[] {
  const input = services && typeof services === "object" ? services : {};
  const coreWorking = input.coreWorld === "working";
  return [
    {
      id: "world-zero",
      label: "World Zero entry and movement",
      status: coreWorking ? "working" : "unavailable",
      summary: coreWorking
        ? "Public World Zero entry and movement are available."
        : "No recognized public World Zero runtime observation is available.",
      freshness: coreWorking ? "live" : "unavailable",
      asOf: coreWorking ? generatedAt : null,
      reason: coreWorking ? null : "source_error"
    },
    {
      id: "public-records-terminal",
      label: "Public Records terminal",
      status: "working",
      summary: "The contextual public Records terminal is available in Headquarters.",
      freshness: "live",
      asOf: generatedAt,
      reason: null
    },
    recordsReceptionItem(recordsObservation),
    {
      id: "spiders-identity",
      label: "Spiders identity publication",
      status: "working",
      summary: "Static role identity published; live availability is not claimed.",
      freshness: "historical",
      asOf: null,
      reason: null
    },
    {
      id: "hosted-agent-registry",
      label: "Hosted-agent registry",
      status: "not_configured",
      summary: "No authorized hosted-agent registry is configured. Projected hosted agents: 0.",
      freshness: "unavailable",
      asOf: null,
      reason: "not_configured"
    },
    realtimeReceptionItem(input.realtime, generatedAt),
    {
      id: "private-work-state",
      label: "Private Hermes and Kanban work state",
      status: "private",
      summary: "Private Hermes and Kanban work state is not published on the public site.",
      freshness: "unavailable",
      asOf: null,
      reason: "not_public"
    },
    {
      id: "executive-authority",
      label: "Executive authority plaque",
      status: "working",
      summary: "Static human-authority policy is published; this is not an approval control.",
      freshness: "historical",
      asOf: null,
      reason: null
    }
  ];
}

function buildSnapshot(services: SnapshotOptions["services"], generatedAt: string): WorldOperationsSnapshot {
  const recordsObservation = normalizeRecordsObservation(services?.records, generatedAt);
  const reception = projectReception(services, generatedAt, recordsObservation);
  const freshness: Freshness = reception.some((item) => item.status === "unavailable")
    ? "degraded"
    : reception.some((item) => item.status === "degraded" || item.status === "not_configured")
      ? "degraded"
      : "recent";
  return {
    schemaVersion: "1.0",
    source: {
      id: "vibe-city-public-world-operations",
      label: "Vibe City public operations snapshot",
      visibility: "public"
    },
    generatedAt,
    freshness,
    hostedAgents: {
      registryStatus: "not_configured",
      projectedCount: 0,
      reason: "not_configured"
    },
    approvedPublicRecords: projectApprovedPublicRecords(recordsObservation),
    publicIdentities: [SPIDERS_PUBLIC_IDENTITY],
    reception,
    executiveAuthority: EXECUTIVE_AUTHORITY
  };
}

export function createWorldOperationsSnapshot(options: unknown = {}): WorldOperationsSnapshot {
  const fallbackTime = "1970-01-01T00:00:00.000Z";
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) return buildSnapshot(undefined, fallbackTime);
    const candidate = options as SnapshotOptions;
    const suppliedNow = candidate.now;
    const now = suppliedNow === undefined ? Date.now : typeof suppliedNow === "function" ? suppliedNow : null;
    if (!now) return buildSnapshot(undefined, fallbackTime);
    const observedNow = now();
    const observedDate = new Date(observedNow);
    if (!Number.isFinite(observedNow) || !Number.isFinite(observedDate.getTime())) return buildSnapshot(undefined, fallbackTime);
    const services = candidate.services;
    return buildSnapshot(services, observedDate.toISOString());
  } catch {
    return buildSnapshot(undefined, fallbackTime);
  }
}

export function deriveRealtimeObservation(value: unknown): NonNullable<SnapshotOptions["services"]>["realtime"] {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "realtime_unavailable";
    const debug = value as { envConfigured?: unknown; channelStatus?: unknown };
    if (debug.envConfigured === false) return "missing_configuration";
    if (debug.envConfigured === true && debug.channelStatus === "subscribed") return "working";
    return "realtime_unavailable";
  } catch {
    return "realtime_unavailable";
  }
}
