export type HostedPresenceValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_hosted_agent_presence" };

export interface ReviewedHostedIdentityMapping {
  schemaVersion: "1.0";
  tenantId: string;
  subjectId: string;
  identityId: "stg-spiders";
  profileName: string;
  registryRevision: number;
  synchronizedAt: string;
  status: "active" | "revoked" | "retired";
}

export interface HermesPresenceReadRequest {
  schemaVersion: "1.0";
  boardScope: string;
  profileName: string;
  evaluatedAt: string;
  mappingRevision: number;
}

export interface HermesCurrentRun {
  taskId: string;
  runId: number;
  runStatus: "running" | "blocked" | "done" | "failed" | "stale" | "timed_out" | "crashed";
  outcome: null | "completed" | "blocked" | "failed" | "stale" | "timed_out" | "crashed";
  claimCurrent: boolean;
  spawnedEventPresent: boolean;
  pidLiveness: "alive" | "dead" | "unknown" | "not_applicable";
  heartbeatAt: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface HermesDecisiveEvent {
  eventId: number;
  kind: "spawned" | "heartbeat" | "blocked" | "completed" | "failed" | "stale" | "timed_out" | "crashed";
  occurredAt: string;
}

export interface HermesPresenceObservation {
  schemaVersion: "1.0";
  profileName: string;
  observedAt: string;
  sourceStatus: "available" | "degraded" | "unavailable";
  reason: null | "profile_missing" | "board_unavailable" | "ambiguous_run" | "clock_invalid" |
    "invalid_source" | "pid_heartbeat_disagreement";
  currentRun: HermesCurrentRun | null;
  decisiveEvent: HermesDecisiveEvent | null;
}

export interface PrivateHostedAgentPresence {
  identityId: "stg-spiders";
  displayName: "Spiders";
  roleLabel: "Chief Agent";
  workplace: {
    id: "stg-chief-agent-office";
    label: "Chief Agent Office";
    relationship: "designated";
  };
  state: "working" | "blocked" | "completed" | "unavailable";
  freshness: "live" | "recent" | "stale" | "degraded" | "unavailable";
  reason: null | "no_current_work" | "source_unavailable" | "source_stale" | "clock_invalid" |
    "mapping_invalid" | "membership_revoked" | "record_unavailable" | "run_disagreement" |
    "completion_unaccepted";
  stateChangedAt: string | null;
  observedAt: string | null;
  checkedAt: string;
  recordRef: { recordId: string; href: string } | null;
}

export interface PrivateHostedAgentPresenceResponse {
  schemaVersion: "1.0";
  tenantId: string;
  generatedAt: string;
  presence: PrivateHostedAgentPresence | null;
}

type SnapshotObject = Record<string, unknown>;

const INVALID = Object.freeze({ ok: false, code: "invalid_hosted_agent_presence" } as const);
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const CONFIG_SCOPE = /^[a-z][a-z0-9_-]{0,63}$/;
const TASK_ID = /^t_[a-f0-9]{8}$/;
const SNAPSHOT_MAX_KEYS = 64;
const SNAPSHOT_MAX_NODES = 64;
const SNAPSHOT_MAX_DEPTH = 16;

const MAPPING_KEYS = [
  "identityId", "profileName", "registryRevision", "schemaVersion", "status", "subjectId", "synchronizedAt",
  "tenantId"
];
const REQUEST_KEYS = ["boardScope", "evaluatedAt", "mappingRevision", "profileName", "schemaVersion"];
const OBSERVATION_KEYS = [
  "currentRun", "decisiveEvent", "observedAt", "profileName", "reason", "schemaVersion", "sourceStatus"
];
const RUN_KEYS = [
  "claimCurrent", "endedAt", "heartbeatAt", "outcome", "pidLiveness", "runId", "runStatus",
  "spawnedEventPresent", "startedAt", "taskId"
];
const EVENT_KEYS = ["eventId", "kind", "occurredAt"];
const RESPONSE_KEYS = ["generatedAt", "presence", "schemaVersion", "tenantId"];
const PRESENCE_KEYS = [
  "checkedAt", "displayName", "freshness", "identityId", "observedAt", "reason", "recordRef", "roleLabel",
  "state", "stateChangedAt", "workplace"
];
const WORKPLACE_KEYS = ["id", "label", "relationship"];
const RECORD_REF_KEYS = ["href", "recordId"];

function reject<T>(): HostedPresenceValidationResult<T> {
  return INVALID;
}

function accept<T>(value: T): HostedPresenceValidationResult<T> {
  return { ok: true, value };
}

function sameKeys(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const sorted = [...actual].sort();
  return sorted.every((key, index) => key === expected[index]);
}

function snapshotObject(value: unknown, budget = { nodes: 0 }, depth = 0): SnapshotObject | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    if (depth > SNAPSHOT_MAX_DEPTH) return null;
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    budget.nodes += 1;
    if (budget.nodes > SNAPSHOT_MAX_NODES) return null;

    const firstKeys = Reflect.ownKeys(value);
    if (firstKeys.length > SNAPSHOT_MAX_KEYS || firstKeys.some((key) => typeof key !== "string")) return null;
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of firstKeys as string[]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
          descriptor.get !== undefined || descriptor.set !== undefined) return null;
      descriptors.set(key, descriptor);
    }

    const snapshot: SnapshotObject = {};
    for (const key of firstKeys as string[]) {
      const field = descriptors.get(key)?.value;
      if (field !== null && typeof field === "object") {
        const nested = snapshotObject(field, budget, depth + 1);
        if (nested === null) return null;
        snapshot[key] = nested;
      } else {
        snapshot[key] = field;
      }
    }

    const secondKeys = Reflect.ownKeys(value);
    if (secondKeys.length !== firstKeys.length ||
        secondKeys.some((key, index) => key !== firstKeys[index])) return null;
    for (const key of firstKeys as string[]) {
      const before = descriptors.get(key);
      const after = Reflect.getOwnPropertyDescriptor(value, key);
      if (!before || !after || before.enumerable !== after.enumerable ||
          before.configurable !== after.configurable || before.writable !== after.writable ||
          !("value" in after) || !Object.is(before.value, after.value)) return null;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function isClosedString(value: unknown): value is string {
  return typeof value === "string" && value === value.normalize("NFC") &&
    !/[\u0000-\u001f\u007f]/.test(value) && value.trim().length > 0;
}

function isOpaqueId(value: unknown): value is string {
  return isClosedString(value) && OPAQUE_ID.test(value);
}

function isConfigScope(value: unknown): value is string {
  return isClosedString(value) && CONFIG_SCOPE.test(value) && value !== "." && value !== "..";
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
}

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isCanonicalUtc(value: unknown): value is string {
  if (!isClosedString(value) || !UTC_INSTANT.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function time(value: string): number {
  return Date.parse(value);
}

function oneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === "string" && values.includes(value);
}

export function validateReviewedHostedIdentityMapping(
  value: unknown,
  evaluatedAt: string
): HostedPresenceValidationResult<ReviewedHostedIdentityMapping> {
  const candidate = snapshotObject(value);
  if (!candidate || !sameKeys(Object.keys(candidate), MAPPING_KEYS) || !isCanonicalUtc(evaluatedAt) ||
      candidate.schemaVersion !== "1.0" || !isOpaqueId(candidate.tenantId) || !isOpaqueId(candidate.subjectId) ||
      candidate.identityId !== "stg-spiders" || !isConfigScope(candidate.profileName) ||
      !isRevision(candidate.registryRevision) || !isCanonicalUtc(candidate.synchronizedAt) ||
      time(candidate.synchronizedAt) > time(evaluatedAt) ||
      !oneOf(candidate.status, ["active", "revoked", "retired"])) return reject();
  return accept(candidate as unknown as ReviewedHostedIdentityMapping);
}

export function validateHermesPresenceReadRequest(
  value: unknown,
  mapping: unknown,
  evaluatedAt: string
): HostedPresenceValidationResult<HermesPresenceReadRequest> {
  const trustedMapping = validateReviewedHostedIdentityMapping(mapping, evaluatedAt);
  const candidate = snapshotObject(value);
  if (!trustedMapping.ok || trustedMapping.value.status !== "active" || !candidate ||
      !sameKeys(Object.keys(candidate), REQUEST_KEYS) || candidate.schemaVersion !== "1.0" ||
      !isConfigScope(candidate.boardScope) || !isConfigScope(candidate.profileName) ||
      candidate.profileName !== trustedMapping.value.profileName || !isRevision(candidate.mappingRevision) ||
      candidate.mappingRevision !== trustedMapping.value.registryRevision || !isCanonicalUtc(candidate.evaluatedAt) ||
      time(candidate.evaluatedAt) < time(trustedMapping.value.synchronizedAt) ||
      time(candidate.evaluatedAt) > time(evaluatedAt)) return reject();
  return accept(candidate as unknown as HermesPresenceReadRequest);
}

const TERMINAL_RUNS = {
  blocked: { outcome: "blocked", event: "blocked" },
  done: { outcome: "completed", event: "completed" },
  failed: { outcome: "failed", event: "failed" },
  stale: { outcome: "stale", event: "stale" },
  timed_out: { outcome: "timed_out", event: "timed_out" },
  crashed: { outcome: "crashed", event: "crashed" }
} as const;

function validRunAndEvent(
  run: SnapshotObject,
  event: SnapshotObject,
  observedAt: string
): boolean {
  if (!sameKeys(Object.keys(run), RUN_KEYS) || !sameKeys(Object.keys(event), EVENT_KEYS) ||
      !isClosedString(run.taskId) || !TASK_ID.test(run.taskId) || !isPositiveId(run.runId) ||
      typeof run.claimCurrent !== "boolean" || typeof run.spawnedEventPresent !== "boolean" ||
      !oneOf(run.pidLiveness, ["alive", "dead", "unknown", "not_applicable"]) ||
      !isCanonicalUtc(run.startedAt) || time(run.startedAt) > time(observedAt) ||
      (run.heartbeatAt !== null && (!isCanonicalUtc(run.heartbeatAt) ||
        time(run.heartbeatAt) < time(run.startedAt) || time(run.heartbeatAt) > time(observedAt))) ||
      !isPositiveId(event.eventId) || !isCanonicalUtc(event.occurredAt) ||
      time(event.occurredAt) < time(run.startedAt) || time(event.occurredAt) > time(observedAt)) return false;

  if (run.runStatus === "running") {
    return run.outcome === null && run.endedAt === null && run.claimCurrent === true &&
      oneOf(event.kind, ["spawned", "heartbeat"]) && run.pidLiveness !== "not_applicable" &&
      (run.spawnedEventPresent !== false || run.pidLiveness !== "alive");
  }

  if (!oneOf(run.runStatus, Object.keys(TERMINAL_RUNS))) return false;
  const terminal = TERMINAL_RUNS[run.runStatus as keyof typeof TERMINAL_RUNS];
  return run.outcome === terminal.outcome && run.claimCurrent === false && run.pidLiveness === "not_applicable" &&
    isCanonicalUtc(run.endedAt) && time(run.endedAt) >= time(run.startedAt) &&
    time(run.endedAt) <= time(observedAt) &&
    (run.heartbeatAt === null || time(run.heartbeatAt) <= time(run.endedAt)) &&
    event.kind === terminal.event && time(event.occurredAt) <= time(run.endedAt);
}

export function validateHermesPresenceObservation(
  value: unknown,
  request: unknown
): HostedPresenceValidationResult<HermesPresenceObservation> {
  const candidate = snapshotObject(value);
  const trustedRequest = snapshotObject(request);
  if (!candidate || !trustedRequest || !sameKeys(Object.keys(candidate), OBSERVATION_KEYS) ||
      !sameKeys(Object.keys(trustedRequest), REQUEST_KEYS) || candidate.schemaVersion !== "1.0" ||
      trustedRequest.schemaVersion !== "1.0" || !isConfigScope(trustedRequest.boardScope) ||
      !isConfigScope(trustedRequest.profileName) || !isRevision(trustedRequest.mappingRevision) ||
      !isCanonicalUtc(trustedRequest.evaluatedAt) || candidate.profileName !== trustedRequest.profileName ||
      !isCanonicalUtc(candidate.observedAt) || time(candidate.observedAt) > time(trustedRequest.evaluatedAt)) return reject();

  const reasonPairs: Record<string, readonly unknown[]> = {
    available: [null],
    degraded: ["ambiguous_run", "pid_heartbeat_disagreement"],
    unavailable: ["profile_missing", "board_unavailable", "clock_invalid", "invalid_source"]
  };
  if (!oneOf(candidate.sourceStatus, Object.keys(reasonPairs)) ||
      !reasonPairs[candidate.sourceStatus].includes(candidate.reason)) return reject();

  if (candidate.currentRun === null || candidate.decisiveEvent === null) {
    if (candidate.currentRun !== null || candidate.decisiveEvent !== null) return reject();
  } else if (!validRunAndEvent(candidate.currentRun as SnapshotObject,
    candidate.decisiveEvent as SnapshotObject, candidate.observedAt)) return reject();

  return accept(candidate as unknown as HermesPresenceObservation);
}

function validRecordRef(value: SnapshotObject, tenantId: string): boolean {
  if (!sameKeys(Object.keys(value), RECORD_REF_KEYS) || !isOpaqueId(value.recordId) ||
      typeof value.href !== "string") return false;
  return value.href === `/api/private/tenants/${tenantId}/records/${value.recordId}`;
}

function validPresence(value: SnapshotObject, tenantId: string, generatedAt: string): boolean {
  if (!sameKeys(Object.keys(value), PRESENCE_KEYS) || value.identityId !== "stg-spiders" ||
      value.displayName !== "Spiders" || value.roleLabel !== "Chief Agent" ||
      !value.workplace || typeof value.workplace !== "object" ||
      !sameKeys(Object.keys(value.workplace), WORKPLACE_KEYS)) return false;
  const workplace = value.workplace as SnapshotObject;
  if (workplace.id !== "stg-chief-agent-office" || workplace.label !== "Chief Agent Office" ||
      workplace.relationship !== "designated" ||
      !oneOf(value.state, ["working", "blocked", "completed", "unavailable"]) ||
      !oneOf(value.freshness, ["live", "recent", "stale", "degraded", "unavailable"]) ||
      !isCanonicalUtc(value.checkedAt) || time(value.checkedAt) > time(generatedAt)) return false;

  const responseReasons = [
    "no_current_work", "source_unavailable", "source_stale", "clock_invalid", "mapping_invalid",
    "membership_revoked", "record_unavailable", "run_disagreement", "completion_unaccepted"
  ];
  if (value.state === "unavailable") {
    if (!oneOf(value.freshness, ["degraded", "unavailable"]) ||
        !oneOf(value.reason, responseReasons) || value.recordRef !== null) return false;
  } else {
    const current = oneOf(value.freshness, ["live", "recent"]) && value.reason === null;
    const retained = value.freshness === "stale" && value.reason === "source_stale";
    if ((!current && !retained) || value.stateChangedAt === null || value.observedAt === null ||
        !value.recordRef || typeof value.recordRef !== "object" ||
        !validRecordRef(value.recordRef as SnapshotObject, tenantId)) return false;
  }

  if (value.stateChangedAt !== null && !isCanonicalUtc(value.stateChangedAt)) return false;
  if (value.observedAt !== null && !isCanonicalUtc(value.observedAt)) return false;
  if (value.stateChangedAt !== null && (value.observedAt === null ||
      time(value.stateChangedAt) > time(value.observedAt))) return false;
  if (value.observedAt !== null && time(value.observedAt) > time(value.checkedAt)) return false;
  return true;
}

export function validatePrivateHostedAgentPresenceResponse(
  value: unknown,
  evaluatedAt: string
): HostedPresenceValidationResult<PrivateHostedAgentPresenceResponse> {
  const candidate = snapshotObject(value);
  if (!candidate || !sameKeys(Object.keys(candidate), RESPONSE_KEYS) || !isCanonicalUtc(evaluatedAt) ||
      candidate.schemaVersion !== "1.0" || !isOpaqueId(candidate.tenantId) ||
      !isCanonicalUtc(candidate.generatedAt) || time(candidate.generatedAt) > time(evaluatedAt) ||
      (candidate.presence !== null && (!candidate.presence || typeof candidate.presence !== "object" ||
        !validPresence(candidate.presence as SnapshotObject, candidate.tenantId, candidate.generatedAt)))) return reject();
  return accept(candidate as unknown as PrivateHostedAgentPresenceResponse);
}

function hasDuplicateJsonObjectKey(source: string): boolean {
  let position = 0;
  const skipWhitespace = () => {
    while (/\s/.test(source[position] ?? "")) position += 1;
  };
  const readString = (): string => {
    const start = position;
    position += 1;
    while (position < source.length) {
      if (source[position] === "\\") {
        position += 2;
      } else if (source[position] === '"') {
        position += 1;
        return JSON.parse(source.slice(start, position)) as string;
      } else {
        position += 1;
      }
    }
    throw new Error("invalid_json");
  };
  const readValue = (depth: number): boolean => {
    if (depth > 16) throw new Error("invalid_json");
    skipWhitespace();
    if (source[position] === '"') {
      readString();
      return false;
    }
    if (source[position] === "{") {
      position += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (source[position] === "}") {
        position += 1;
        return false;
      }
      while (position < source.length) {
        skipWhitespace();
        if (source[position] !== '"') throw new Error("invalid_json");
        const key = readString();
        if (keys.has(key)) return true;
        keys.add(key);
        skipWhitespace();
        if (source[position] !== ":") throw new Error("invalid_json");
        position += 1;
        if (readValue(depth + 1)) return true;
        skipWhitespace();
        if (source[position] === "}") {
          position += 1;
          return false;
        }
        if (source[position] !== ",") throw new Error("invalid_json");
        position += 1;
      }
      throw new Error("invalid_json");
    }
    if (source[position] === "[") {
      position += 1;
      skipWhitespace();
      if (source[position] === "]") {
        position += 1;
        return false;
      }
      while (position < source.length) {
        if (readValue(depth + 1)) return true;
        skipWhitespace();
        if (source[position] === "]") {
          position += 1;
          return false;
        }
        if (source[position] !== ",") throw new Error("invalid_json");
        position += 1;
      }
      throw new Error("invalid_json");
    }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/
      .exec(source.slice(position));
    if (!primitive) throw new Error("invalid_json");
    position += primitive[0].length;
    return false;
  };

  const duplicate = readValue(0);
  skipWhitespace();
  if (position !== source.length) throw new Error("invalid_json");
  return duplicate;
}

export function parsePrivateHostedAgentPresenceResponseJson(
  source: unknown,
  evaluatedAt: string
): HostedPresenceValidationResult<PrivateHostedAgentPresenceResponse> {
  try {
    if (typeof source !== "string" || source.length === 0 || source.length > 65_536 ||
        hasDuplicateJsonObjectKey(source)) return reject();
    return validatePrivateHostedAgentPresenceResponse(JSON.parse(source) as unknown, evaluatedAt);
  } catch {
    return reject();
  }
}
