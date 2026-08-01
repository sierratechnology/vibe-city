import { authorizeAction, type TrustedAuthorizationInput, type WorkRecord } from "./workRecords";

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

export interface BlockTransitionAuthorizationFacts {
  auditEventId: string;
  authentication: { authenticated: boolean; subjectId: string | null };
  membership: { active: boolean; tenantId: string | null };
  permissions: string[];
  decisionAuthorities: string[];
  onBehalfOf: { tenantId: string; subjectId: string } | null;
  action: "transition";
  scope: string;
  authorizationRef: string;
  policyRevision: number;
}

export interface TrustedBlockTransitionAuthorizationContext extends BlockTransitionAuthorizationFacts {
  provenance: "backend_trusted";
}

export interface CompletionAcceptanceAuthorityFacts {
  acceptanceAuthorizationId: string;
  auditEventId: string;
  authentication: { authenticated: boolean; subjectId: string | null };
  membership: { active: boolean; tenantId: string | null };
  permissions: string[];
  decisionAuthorities: string[];
  onBehalfOf: { tenantId: string; subjectId: string } | null;
  action: "accept_outcome";
  scope: string;
  authorizationRef: string;
  policyRevision: number;
  mappingRevision: number;
  recordRevision: number;
  assignmentAuthorizationId: string;
  outcomeId: string;
  evidenceIds: string[];
  evidenceIntegrityDigests: string[];
  sourceId: string;
  sourceRecordId: string;
  sourceEventId: string;
  acceptedAt: string;
  auditRecordedAt: string;
}

export interface TrustedCompletionAcceptanceAuthorityContext extends CompletionAcceptanceAuthorityFacts {
  provenance: "backend_trusted";
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
const WORKING_INPUT_KEYS = [
  "activity", "assignment", "audit", "authorization", "checkedAt", "generatedAt", "mapping", "observation",
  "record", "schemaVersion", "trace"
];
const WORKING_RECORD_KEYS = [
  "assignees", "freshness", "recordId", "recordedAt", "revision", "schemaVersion", "state", "stateChangedAt",
  "tenantId"
];
const WORKING_ASSIGNMENT_KEYS = [
  "acceptedRevision", "assignees", "authorizationId", "recordId", "source", "tenantId"
];
const WORKING_ACTIVITY_KEYS = [
  "activityId", "actor", "eventKind", "observedAt", "occurredAt", "recordId", "recordedAt", "source",
  "tenantId"
];
const WORKING_TRACE_KEYS = [
  "activityId", "assignmentAuthorizationId", "hermesEventId", "hermesRunId", "hermesTaskId", "mappingRevision",
  "policyRevision", "recordId", "recordRevision", "tenantId"
];
const WORKING_AUDIT_KEYS = [
  "authorizationRef", "eventKind", "newRevision", "occurredAt", "policyRevision", "recordId", "recordedAt",
  "source", "tenantId"
];
const WORKING_AUTHORIZATION_KEYS = [
  "action", "allowed", "authorizationId", "authorizationRef", "beneficiary", "policyRevision", "scope", "tenantId"
];
const BLOCKED_INPUT_KEYS = [
  "assignment", "audit", "authorization", "blockAuthorization", "checkedAt", "generatedAt", "mapping",
  "profileName", "record", "schemaVersion", "trace"
];
const BLOCKED_RECORD_KEYS = [
  "assignees", "blockReason", "freshness", "recordId", "recordedAt", "revision", "schemaVersion", "source",
  "state", "stateChangedAt", "tenantId"
];
const BLOCK_REASON_KEYS = ["blockedAt", "category", "resolutionAuthority", "summary"];
const BLOCK_AUDIT_KEYS = [
  "actor", "auditEventId", "authorizationRef", "changedFields", "eventKind", "newRevision", "occurredAt",
  "onBehalfOf", "policyRevision", "priorRevision", "reasonRef", "recordId", "recordedAt", "source", "tenantId"
];
const FIELD_CHANGE_KEYS = ["after", "before", "field"];
const BLOCK_AUTHORIZATION_KEYS = [
  "action", "auditEventId", "authentication", "authorizationRef", "decisionAuthorities", "membership",
  "onBehalfOf", "permissions", "policyRevision", "provenance", "scope"
];
const BLOCK_AUTHORIZATION_FACT_KEYS = BLOCK_AUTHORIZATION_KEYS.filter((key) => key !== "provenance");
const AUTHENTICATION_KEYS = ["authenticated", "subjectId"];
const MEMBERSHIP_KEYS = ["active", "tenantId"];
const SUBJECT_KEYS = ["subjectId", "tenantId"];
const SOURCE_KEYS = [
  "contractVersion", "observedAt", "occurredAt", "sourceEventId", "sourceId", "sourceRecordId", "tenantId"
];
const COMPLETED_INPUT_KEYS = [
  "acceptanceAuthority", "assignment", "audit", "authorization", "checkedAt", "evidence", "generatedAt",
  "mapping", "outcome", "profileName", "record", "schemaVersion", "trace"
];
const COMPLETED_RECORD_KEYS = [
  "assignees", "completedAt", "freshness", "recordId", "recordedAt", "revision", "schemaVersion", "source",
  "state", "stateChangedAt", "tenantId"
];
const COMPLETED_TRACE_KEYS = [
  "assignmentAuthorizationId", "mappingRevision", "policyRevision", "recordId", "recordRevision", "source",
  "tenantId"
];
const COMPLETION_EVIDENCE_KEYS = [
  "availability", "evidenceId", "integrity", "label", "locator", "observedAt", "recordedAt", "relation",
  "sensitivity", "source", "sourceOccurredAt", "tenantId"
];
const INTEGRITY_KEYS = ["algorithm", "digest"];
const OUTCOME_KEYS = [
  "acceptanceActor", "acceptanceAuthorizationId", "acceptedAt", "outcomeId", "recordId", "requiredEvidenceIds",
  "tenantId"
];
const COMPLETION_AUDIT_KEYS = [
  "actor", "auditEventId", "authorizationRef", "changedFields", "eventKind", "evidenceIds", "newRevision",
  "occurredAt", "onBehalfOf", "outcomeId", "policyRevision", "priorRevision", "recordId", "recordedAt",
  "source", "tenantId"
];
const COMPLETION_AUTHORITY_KEYS = [
  "acceptanceAuthorizationId", "acceptedAt", "action", "assignmentAuthorizationId", "auditEventId", "auditRecordedAt",
  "authentication",
  "authorizationRef", "decisionAuthorities", "evidenceIds", "evidenceIntegrityDigests", "mappingRevision",
  "membership", "onBehalfOf", "outcomeId", "permissions", "policyRevision", "provenance", "recordRevision",
  "scope", "sourceEventId", "sourceId", "sourceRecordId"
];
const COMPLETION_AUTHORITY_FACT_KEYS = COMPLETION_AUTHORITY_KEYS.filter((key) => key !== "provenance");
const COMPLETION_CAPABILITY_KEYS = [
  "authentication", "authorizationRef", "decisionAuthorities", "membership", "permissions", "policyRevision",
  "provenance"
];
const trustedBlockTransitionAuthorizationContexts = new WeakSet<object>();
const trustedCompletionAcceptanceAuthorityContexts = new WeakSet<object>();

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

function snapshotWorkingValue(value: unknown, budget = { nodes: 0 }, depth = 0): unknown | null {
  try {
    if (value === null || typeof value !== "object") return value;
    if (depth > SNAPSHOT_MAX_DEPTH) return null;
    budget.nodes += 1;
    if (budget.nodes > SNAPSHOT_MAX_NODES * 2) return null;

    if (Array.isArray(value)) {
      if (value.length > 8) return null;
      const firstKeys = Reflect.ownKeys(value);
      const expectedKeys = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"];
      if (firstKeys.length !== expectedKeys.length ||
          firstKeys.some((key, index) => key !== expectedKeys[index])) return null;
      const descriptors = firstKeys.map((key) => Reflect.getOwnPropertyDescriptor(value, key));
      if (descriptors.some((descriptor, index) => !descriptor || !("value" in descriptor) ||
          descriptor.get !== undefined || descriptor.set !== undefined ||
          (index < value.length ? !descriptor.enumerable : descriptor.enumerable))) return null;
      const snapshot = [];
      for (let index = 0; index < value.length; index += 1) {
        const field = (descriptors[index] as PropertyDescriptor).value;
        const nested = snapshotWorkingValue(field, budget, depth + 1);
        if (nested === null && field !== null) return null;
        snapshot.push(nested);
      }
      const secondKeys = Reflect.ownKeys(value);
      if (secondKeys.length !== firstKeys.length || secondKeys.some((key, index) => key !== firstKeys[index])) {
        return null;
      }
      for (let index = 0; index < firstKeys.length; index += 1) {
        const before = descriptors[index];
        const after = Reflect.getOwnPropertyDescriptor(value, firstKeys[index]);
        if (!before || !after || !("value" in before) || !("value" in after) ||
            before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
            before.writable !== after.writable || !Object.is(before.value, after.value)) return null;
      }
      return Object.freeze(snapshot);
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
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
      const nested = snapshotWorkingValue(field, budget, depth + 1);
      if (nested === null && field !== null) return null;
      snapshot[key] = nested;
    }
    const secondKeys = Reflect.ownKeys(value);
    if (secondKeys.length !== firstKeys.length || secondKeys.some((key, index) => key !== firstKeys[index])) return null;
    for (const key of firstKeys as string[]) {
      const before = descriptors.get(key);
      const after = Reflect.getOwnPropertyDescriptor(value, key);
      if (!before || !after || !("value" in before) || !("value" in after) ||
          before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
          before.writable !== after.writable || !Object.is(before.value, after.value)) return null;
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

function isPositivePolicyRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
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

function validWorkingSubject(value: unknown, tenantId: string): value is SnapshotObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    sameKeys(Object.keys(value), SUBJECT_KEYS) &&
    (value as SnapshotObject).tenantId === tenantId && isOpaqueId((value as SnapshotObject).subjectId);
}

function validWorkingSource(value: unknown, tenantId: string): value is SnapshotObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(Object.keys(value), SOURCE_KEYS)) return false;
  const source = value as SnapshotObject;
  return source.tenantId === tenantId && isOpaqueId(source.sourceId) &&
    isClosedString(source.sourceRecordId) && source.sourceRecordId.length <= 200 &&
    isClosedString(source.sourceEventId) && source.sourceEventId.length <= 200 &&
    isClosedString(source.contractVersion) && source.contractVersion.length <= 32 &&
    isCanonicalUtc(source.occurredAt) && isCanonicalUtc(source.observedAt) &&
    time(source.occurredAt as string) <= time(source.observedAt as string);
}

function sameWorkingSource(left: SnapshotObject, right: SnapshotObject): boolean {
  return SOURCE_KEYS.every((key) => Object.is(left[key], right[key]));
}

function hasWorkingAssignee(value: unknown, tenantId: string, subjectId: string): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((candidate, index) =>
    validWorkingSubject(candidate, tenantId) &&
    value.findIndex((other) => validWorkingSubject(other, tenantId) &&
      other.subjectId === candidate.subjectId) === index) &&
    value.some((candidate) => validWorkingSubject(candidate, tenantId) && candidate.subjectId === subjectId);
}

function workingUnavailable(
  tenantId: string,
  checkedAt: string,
  generatedAt: string,
  reason: PrivateHostedAgentPresence["reason"]
): PrivateHostedAgentPresenceResponse {
  const response: PrivateHostedAgentPresenceResponse = {
    schemaVersion: "1.0",
    tenantId,
    generatedAt,
    presence: {
      identityId: "stg-spiders",
      displayName: "Spiders",
      roleLabel: "Chief Agent",
      workplace: {
        id: "stg-chief-agent-office",
        label: "Chief Agent Office",
        relationship: "designated"
      },
      state: "unavailable",
      freshness: "unavailable",
      reason,
      stateChangedAt: null,
      observedAt: null,
      checkedAt,
      recordRef: null
    }
  };
  return snapshotObject(response) as unknown as PrivateHostedAgentPresenceResponse;
}

export function derivePrivateHostedAgentWorkingPresence(
  value: unknown
): HostedPresenceValidationResult<PrivateHostedAgentPresenceResponse> {
  const candidate = snapshotWorkingValue(value);
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
      !sameKeys(Object.keys(candidate), WORKING_INPUT_KEYS)) return reject();
  const input = candidate as SnapshotObject;
  if (input.schemaVersion !== "1.0" || !isCanonicalUtc(input.checkedAt) ||
      !isCanonicalUtc(input.generatedAt) || time(input.checkedAt as string) > time(input.generatedAt as string)) {
    return reject();
  }

  const mappingResult = validateReviewedHostedIdentityMapping(input.mapping, input.checkedAt as string);
  if (!mappingResult.ok) return reject();
  const mapping = mappingResult.value;
  if (mapping.status !== "active") {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "membership_revoked"));
  }

  if (input.record === null || typeof input.record !== "object" || Array.isArray(input.record) ||
      input.assignment === null || typeof input.assignment !== "object" || Array.isArray(input.assignment) ||
      input.activity === null || typeof input.activity !== "object" || Array.isArray(input.activity) ||
      input.trace === null || typeof input.trace !== "object" || Array.isArray(input.trace) ||
      input.audit === null || typeof input.audit !== "object" || Array.isArray(input.audit) ||
      input.authorization === null || typeof input.authorization !== "object" || Array.isArray(input.authorization)) {
    return reject();
  }
  const record = input.record as SnapshotObject;
  const assignment = input.assignment as SnapshotObject;
  const activity = input.activity as SnapshotObject;
  const trace = input.trace as SnapshotObject;
  const audit = input.audit as SnapshotObject;
  const authorization = input.authorization as SnapshotObject;
  if (!sameKeys(Object.keys(record), WORKING_RECORD_KEYS) ||
      !sameKeys(Object.keys(assignment), WORKING_ASSIGNMENT_KEYS) ||
      !sameKeys(Object.keys(activity), WORKING_ACTIVITY_KEYS) ||
      !sameKeys(Object.keys(trace), WORKING_TRACE_KEYS) ||
      !sameKeys(Object.keys(audit), WORKING_AUDIT_KEYS) ||
      !sameKeys(Object.keys(authorization), WORKING_AUTHORIZATION_KEYS)) return reject();

  if (!isOpaqueId(record.tenantId) || !isOpaqueId(record.recordId) || record.schemaVersion !== "1.0" ||
      !isRevision(record.revision) || !isCanonicalUtc(record.stateChangedAt) ||
      !isCanonicalUtc(record.recordedAt) || !hasWorkingAssignee(record.assignees, record.tenantId, mapping.subjectId) ||
      !isOpaqueId(assignment.tenantId) || !isOpaqueId(assignment.recordId) ||
      !isOpaqueId(assignment.authorizationId) || !isRevision(assignment.acceptedRevision) ||
      !hasWorkingAssignee(assignment.assignees, assignment.tenantId, mapping.subjectId) ||
      !validWorkingSource(assignment.source, assignment.tenantId) ||
      !isOpaqueId(activity.activityId) || !isOpaqueId(activity.tenantId) || !isOpaqueId(activity.recordId) ||
      !validWorkingSubject(activity.actor, activity.tenantId as string) ||
      !oneOf(activity.eventKind, ["work_started", "work_performed"]) ||
      !validWorkingSource(activity.source, activity.tenantId as string) ||
      !isCanonicalUtc(activity.occurredAt) || !isCanonicalUtc(activity.observedAt) ||
      !isCanonicalUtc(activity.recordedAt) ||
      !isOpaqueId(trace.tenantId) || !isOpaqueId(trace.recordId) || !isRevision(trace.recordRevision) ||
      !isOpaqueId(trace.assignmentAuthorizationId) || !isOpaqueId(trace.activityId) ||
      !isClosedString(trace.hermesTaskId) || !TASK_ID.test(trace.hermesTaskId) ||
      !isPositiveId(trace.hermesRunId) || !isPositiveId(trace.hermesEventId) ||
      !isRevision(trace.mappingRevision) || !isRevision(trace.policyRevision) ||
      !isOpaqueId(audit.tenantId) || !isOpaqueId(audit.recordId) || audit.eventKind !== "assignment" ||
      !isOpaqueId(audit.authorizationRef) || !isRevision(audit.policyRevision) || !isRevision(audit.newRevision) ||
      !isCanonicalUtc(audit.occurredAt) || !isCanonicalUtc(audit.recordedAt) ||
      !validWorkingSource(audit.source, audit.tenantId as string) ||
      !isOpaqueId(authorization.tenantId) || authorization.action !== "assign" ||
      !isOpaqueId(authorization.authorizationId) || !isOpaqueId(authorization.authorizationRef) ||
      !isOpaqueId(authorization.scope) ||
      !validWorkingSubject(authorization.beneficiary, authorization.tenantId as string) ||
      !isRevision(authorization.policyRevision) ||
      typeof authorization.allowed !== "boolean") return reject();

  const observationRequest = {
    schemaVersion: "1.0",
    boardScope: "working_derivation",
    profileName: mapping.profileName,
    evaluatedAt: input.checkedAt,
    mappingRevision: mapping.registryRevision
  };
  const observationResult = validateHermesPresenceObservation(input.observation, observationRequest);
  if (!observationResult.ok) return reject();
  const observationValue = observationResult.value;
  const run = observationValue.currentRun;
  const event = observationValue.decisiveEvent;

  const tenantMatches = [record, assignment, activity, trace, audit, authorization]
    .every((item) => item.tenantId === mapping.tenantId);
  const recordMatches = [assignment, activity, trace, audit].every((item) => item.recordId === record.recordId);
  const sourceMatches = sameWorkingSource(assignment.source as SnapshotObject, activity.source as SnapshotObject) &&
    sameWorkingSource(assignment.source as SnapshotObject, audit.source as SnapshotObject);
  const chronologyValid = time(record.stateChangedAt as string) <= time(record.recordedAt as string) &&
    time(record.stateChangedAt as string) <= time(observationValue.observedAt) &&
    time(activity.occurredAt as string) <= time(activity.observedAt as string) &&
    time(activity.observedAt as string) <= time(activity.recordedAt as string) &&
    time(activity.recordedAt as string) <= time(input.generatedAt as string) &&
    time(audit.occurredAt as string) <= time(audit.recordedAt as string) &&
    time(audit.recordedAt as string) <= time(input.generatedAt as string) &&
    time(record.recordedAt as string) <= time(input.generatedAt as string) &&
    time(observationValue.observedAt) <= time(input.checkedAt as string);
  const currentRunMatches = observationValue.sourceStatus === "available" && observationValue.reason === null &&
    run !== null && event !== null && run.runStatus === "running" && run.outcome === null &&
    run.claimCurrent === true && run.spawnedEventPresent === true && run.pidLiveness !== "dead" &&
    trace.hermesTaskId === run.taskId && trace.hermesRunId === run.runId && trace.hermesEventId === event.eventId &&
    (assignment.source as SnapshotObject).sourceRecordId === run.taskId &&
    (assignment.source as SnapshotObject).sourceEventId === String(run.runId);
  const acceptedM3 = record.state === "active" && oneOf(record.freshness, ["live", "recent"]) &&
    record.tenantId === mapping.tenantId &&
    assignment.acceptedRevision === record.revision && trace.recordRevision === record.revision &&
    audit.newRevision === record.revision &&
    authorization.authorizationId === assignment.authorizationId &&
    assignment.authorizationId === trace.assignmentAuthorizationId &&
    activity.activityId === trace.activityId && (activity.actor as SnapshotObject).subjectId === mapping.subjectId &&
    (activity.source as SnapshotObject).occurredAt === activity.occurredAt &&
    (activity.source as SnapshotObject).observedAt === activity.observedAt &&
    trace.mappingRevision === mapping.registryRevision &&
    authorization.scope === record.recordId &&
    (authorization.beneficiary as SnapshotObject).subjectId === mapping.subjectId && authorization.allowed === true &&
    authorization.authorizationRef === audit.authorizationRef && authorization.policyRevision === audit.policyRevision &&
    audit.policyRevision === trace.policyRevision;

  if (!tenantMatches || !recordMatches || !sourceMatches || !chronologyValid || !currentRunMatches || !acceptedM3) {
    const reason = !currentRunMatches ? "run_disagreement" : "record_unavailable";
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, reason));
  }

  const response: PrivateHostedAgentPresenceResponse = {
    schemaVersion: "1.0",
    tenantId: mapping.tenantId,
    generatedAt: input.generatedAt as string,
    presence: {
      identityId: "stg-spiders",
      displayName: "Spiders",
      roleLabel: "Chief Agent",
      workplace: {
        id: "stg-chief-agent-office",
        label: "Chief Agent Office",
        relationship: "designated"
      },
      state: "working",
      freshness: record.freshness as "live" | "recent",
      reason: null,
      stateChangedAt: record.stateChangedAt as string,
      observedAt: observationValue.observedAt,
      checkedAt: input.checkedAt as string,
      recordRef: {
        recordId: record.recordId as string,
        href: `/api/private/tenants/${mapping.tenantId}/records/${record.recordId as string}`
      }
    }
  };
  const detached = snapshotObject(response);
  if (!detached) return reject();
  return validatePrivateHostedAgentPresenceResponse(detached, input.generatedAt as string);
}

function validBlockReason(value: unknown, tenantId: string): value is SnapshotObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(Object.keys(value), BLOCK_REASON_KEYS)) return false;
  const reason = value as SnapshotObject;
  return isClosedString(reason.category) && (reason.category as string).length <= 64 &&
    isClosedString(reason.summary) && (reason.summary as string).length <= 500 &&
    isCanonicalUtc(reason.blockedAt) && (reason.resolutionAuthority === null ||
      validWorkingSubject(reason.resolutionAuthority, tenantId));
}

function blockReasonAuditValue(reason: SnapshotObject): string {
  return JSON.stringify({
    category: reason.category,
    summary: reason.summary,
    resolutionAuthority: reason.resolutionAuthority,
    blockedAt: reason.blockedAt
  });
}

function hasExactBlockDelta(value: unknown, reason: SnapshotObject): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const changes = value as unknown[];
  if (!changes.every((change) => change !== null && typeof change === "object" && !Array.isArray(change) &&
      sameKeys(Object.keys(change), FIELD_CHANGE_KEYS))) return false;
  const fields = changes.map((change) => (change as SnapshotObject).field);
  if (new Set(fields).size !== fields.length) return false;
  const state = changes.find((change) => (change as SnapshotObject).field === "state") as SnapshotObject | undefined;
  const blockReason = changes.find((change) =>
    (change as SnapshotObject).field === "blockReason") as SnapshotObject | undefined;
  return state?.before === "active" && state.after === "blocked" &&
    blockReason?.before === null && blockReason.after === blockReasonAuditValue(reason);
}

function validBlockTransitionAuthorizationFacts(value: unknown): value is SnapshotObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(Object.keys(value), BLOCK_AUTHORIZATION_FACT_KEYS)) return false;
  const authorization = value as SnapshotObject;
  return authorization.action === "transition" && isOpaqueId(authorization.auditEventId) &&
    isOpaqueId(authorization.scope) && isOpaqueId(authorization.authorizationRef) &&
    isPositivePolicyRevision(authorization.policyRevision) &&
    Array.isArray(authorization.permissions) && authorization.permissions.length === 1 &&
    authorization.permissions[0] === "transition" &&
    Array.isArray(authorization.decisionAuthorities) && authorization.decisionAuthorities.length === 0 &&
    (authorization.onBehalfOf === null ||
      (authorization.onBehalfOf !== null && typeof authorization.onBehalfOf === "object" &&
        !Array.isArray(authorization.onBehalfOf) &&
        sameKeys(Object.keys(authorization.onBehalfOf), SUBJECT_KEYS) &&
        isOpaqueId((authorization.onBehalfOf as SnapshotObject).tenantId) &&
        isOpaqueId((authorization.onBehalfOf as SnapshotObject).subjectId))) &&
    authorization.authentication !== null && typeof authorization.authentication === "object" &&
    !Array.isArray(authorization.authentication) &&
    sameKeys(Object.keys(authorization.authentication), AUTHENTICATION_KEYS) &&
    (authorization.authentication as SnapshotObject).authenticated === true &&
    isOpaqueId((authorization.authentication as SnapshotObject).subjectId) &&
    authorization.membership !== null && typeof authorization.membership === "object" &&
    !Array.isArray(authorization.membership) &&
    sameKeys(Object.keys(authorization.membership), MEMBERSHIP_KEYS) &&
    (authorization.membership as SnapshotObject).active === true &&
    isOpaqueId((authorization.membership as SnapshotObject).tenantId);
}

export function createTrustedBlockTransitionAuthorizationContext(
  value: unknown
): HostedPresenceValidationResult<TrustedBlockTransitionAuthorizationContext> {
  const facts = snapshotWorkingValue(value);
  if (!validBlockTransitionAuthorizationFacts(facts)) return reject();
  const context = Object.freeze({
    ...(facts as SnapshotObject),
    provenance: "backend_trusted" as const
  }) as unknown as TrustedBlockTransitionAuthorizationContext;
  trustedBlockTransitionAuthorizationContexts.add(context);
  return accept(context);
}

function isTrustedBlockTransitionAuthorizationContext(
  value: unknown
): value is TrustedBlockTransitionAuthorizationContext {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    trustedBlockTransitionAuthorizationContexts.has(value) &&
    sameKeys(Object.keys(value), BLOCK_AUTHORIZATION_KEYS) &&
    (value as SnapshotObject).provenance === "backend_trusted" &&
    validBlockTransitionAuthorizationFacts(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "provenance")
    ));
}

function trustedBlockAuthorizationFromInput(value: unknown): TrustedBlockTransitionAuthorizationContext | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptor = Reflect.getOwnPropertyDescriptor(value, "blockAuthorization");
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.get !== undefined ||
        descriptor.set !== undefined || !isTrustedBlockTransitionAuthorizationContext(descriptor.value)) return null;
    return descriptor.value;
  } catch {
    return null;
  }
}

export function derivePrivateHostedAgentBlockedPresence(
  value: unknown
): HostedPresenceValidationResult<PrivateHostedAgentPresenceResponse> {
  const trustedBlockAuthorization = trustedBlockAuthorizationFromInput(value);
  const candidate = snapshotWorkingValue(value);
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
      !sameKeys(Object.keys(candidate), BLOCKED_INPUT_KEYS)) return reject();
  const input = candidate as SnapshotObject;
  if (input.schemaVersion !== "1.0" || !isConfigScope(input.profileName) || !isCanonicalUtc(input.checkedAt) ||
      !isCanonicalUtc(input.generatedAt) || time(input.checkedAt as string) > time(input.generatedAt as string)) {
    return reject();
  }

  const mappingResult = validateReviewedHostedIdentityMapping(input.mapping, input.checkedAt as string);
  if (!mappingResult.ok) return reject();
  const mapping = mappingResult.value;
  if (input.profileName !== mapping.profileName) return reject();
  if (mapping.status !== "active") {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "membership_revoked"));
  }

  if (input.record === null || typeof input.record !== "object" || Array.isArray(input.record) ||
      input.assignment === null || typeof input.assignment !== "object" || Array.isArray(input.assignment) ||
      input.trace === null || typeof input.trace !== "object" || Array.isArray(input.trace) ||
      input.audit === null || typeof input.audit !== "object" || Array.isArray(input.audit) ||
      input.authorization === null || typeof input.authorization !== "object" || Array.isArray(input.authorization) ||
      input.blockAuthorization === null || typeof input.blockAuthorization !== "object" ||
      Array.isArray(input.blockAuthorization)) {
    return reject();
  }
  const record = input.record as SnapshotObject;
  const assignment = input.assignment as SnapshotObject;
  const trace = input.trace as SnapshotObject;
  const audit = input.audit as SnapshotObject;
  const authorization = input.authorization as SnapshotObject;
  const blockAuthorization = input.blockAuthorization as SnapshotObject;
  if (!sameKeys(Object.keys(record), BLOCKED_RECORD_KEYS) ||
      !sameKeys(Object.keys(assignment), WORKING_ASSIGNMENT_KEYS) ||
      !sameKeys(Object.keys(trace), WORKING_TRACE_KEYS) ||
      !sameKeys(Object.keys(audit), BLOCK_AUDIT_KEYS) ||
      !sameKeys(Object.keys(authorization), WORKING_AUTHORIZATION_KEYS) ||
      !sameKeys(Object.keys(blockAuthorization), BLOCK_AUTHORIZATION_KEYS)) return reject();
  if (trustedBlockAuthorization === null) {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "record_unavailable"));
  }
  const trustedAuthorization = trustedBlockAuthorization as unknown as SnapshotObject;

  if (!isOpaqueId(record.tenantId) || !isOpaqueId(record.recordId) || record.schemaVersion !== "1.0" ||
      !isRevision(record.revision) || !isCanonicalUtc(record.stateChangedAt) ||
      !isCanonicalUtc(record.recordedAt) || !hasWorkingAssignee(record.assignees, record.tenantId, mapping.subjectId) ||
      !validWorkingSource(record.source, record.tenantId) ||
      !validBlockReason(record.blockReason, record.tenantId) ||
      !isOpaqueId(assignment.tenantId) || !isOpaqueId(assignment.recordId) ||
      !isOpaqueId(assignment.authorizationId) || !isRevision(assignment.acceptedRevision) ||
      !hasWorkingAssignee(assignment.assignees, assignment.tenantId, mapping.subjectId) ||
      !validWorkingSource(assignment.source, assignment.tenantId) ||
      !isOpaqueId(trace.tenantId) || !isOpaqueId(trace.recordId) || !isRevision(trace.recordRevision) ||
      !isOpaqueId(trace.assignmentAuthorizationId) || !isOpaqueId(trace.activityId) ||
      !isClosedString(trace.hermesTaskId) || !TASK_ID.test(trace.hermesTaskId) ||
      !isPositiveId(trace.hermesRunId) || !isPositiveId(trace.hermesEventId) ||
      !isRevision(trace.mappingRevision) || !isPositivePolicyRevision(trace.policyRevision) ||
      !isOpaqueId(audit.auditEventId) || !isOpaqueId(audit.tenantId) || !isOpaqueId(audit.recordId) ||
      audit.eventKind !== "block" || !validWorkingSubject(audit.actor, audit.tenantId as string) ||
      (audit.onBehalfOf !== null && !validWorkingSubject(audit.onBehalfOf, audit.tenantId as string)) ||
      !isOpaqueId(audit.authorizationRef) ||
      !isPositivePolicyRevision(audit.policyRevision) || !isRevision(audit.priorRevision) ||
      !isRevision(audit.newRevision) ||
      !isCanonicalUtc(audit.occurredAt) || !isCanonicalUtc(audit.recordedAt) ||
      (audit.reasonRef !== null && !isOpaqueId(audit.reasonRef)) ||
      !validWorkingSource(audit.source, audit.tenantId as string) ||
      !hasExactBlockDelta(audit.changedFields, record.blockReason as SnapshotObject) ||
      !isOpaqueId(authorization.tenantId) || authorization.action !== "assign" ||
      !isOpaqueId(authorization.authorizationId) || !isOpaqueId(authorization.authorizationRef) ||
      !isOpaqueId(authorization.scope) ||
      !validWorkingSubject(authorization.beneficiary, authorization.tenantId as string) ||
      !isPositivePolicyRevision(authorization.policyRevision) || typeof authorization.allowed !== "boolean" ||
      !validBlockTransitionAuthorizationFacts(Object.fromEntries(
        Object.entries(blockAuthorization).filter(([key]) => key !== "provenance")
      ))) return reject();

  const tenantMatches = [record, assignment, trace, audit, authorization]
    .every((item) => item.tenantId === mapping.tenantId);
  const recordMatches = [assignment, trace, audit].every((item) => item.recordId === record.recordId);
  const sourceMatches = sameWorkingSource(record.source as SnapshotObject, assignment.source as SnapshotObject) &&
    sameWorkingSource(record.source as SnapshotObject, audit.source as SnapshotObject);
  const reason = record.blockReason as SnapshotObject;
  const chronologyValid = time((record.source as SnapshotObject).observedAt as string) <=
      time(record.recordedAt as string) &&
    time(record.recordedAt as string) <= time(reason.blockedAt as string) &&
    time(reason.blockedAt as string) <= time(audit.recordedAt as string) &&
    time((audit.source as SnapshotObject).observedAt as string) <= time(audit.occurredAt as string) &&
    time(audit.occurredAt as string) <= time(audit.recordedAt as string) &&
    record.stateChangedAt === audit.recordedAt &&
    time(audit.recordedAt as string) <= time(input.checkedAt as string) &&
    time(input.checkedAt as string) <= time(input.generatedAt as string);
  const acceptedM3 = record.state === "blocked" && oneOf(record.freshness, ["live", "recent"]) &&
    record.tenantId === mapping.tenantId && record.revision >= 1 &&
    audit.priorRevision === record.revision - 1 && audit.newRevision === record.revision &&
    assignment.acceptedRevision === audit.priorRevision && trace.recordRevision === record.revision &&
    authorization.authorizationId === assignment.authorizationId &&
    assignment.authorizationId === trace.assignmentAuthorizationId &&
    trace.mappingRevision === mapping.registryRevision && authorization.scope === record.recordId &&
    (authorization.beneficiary as SnapshotObject).subjectId === mapping.subjectId && authorization.allowed === true &&
    authorization.policyRevision === trace.policyRevision &&
    (audit.actor as SnapshotObject).subjectId === mapping.subjectId &&
    (trustedAuthorization.authentication as SnapshotObject).subjectId === (audit.actor as SnapshotObject).subjectId &&
    (trustedAuthorization.membership as SnapshotObject).tenantId === mapping.tenantId &&
    (audit.onBehalfOf === null ? trustedAuthorization.onBehalfOf === null :
      trustedAuthorization.onBehalfOf !== null &&
      (trustedAuthorization.onBehalfOf as SnapshotObject).tenantId === (audit.onBehalfOf as SnapshotObject).tenantId &&
      (trustedAuthorization.onBehalfOf as SnapshotObject).subjectId === (audit.onBehalfOf as SnapshotObject).subjectId) &&
    trustedAuthorization.auditEventId === audit.auditEventId &&
    trustedAuthorization.scope === record.recordId &&
    trustedAuthorization.authorizationRef === audit.authorizationRef &&
    trustedAuthorization.policyRevision === audit.policyRevision && audit.policyRevision === trace.policyRevision;

  if (!tenantMatches || !recordMatches || !sourceMatches || !chronologyValid || !acceptedM3) {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "record_unavailable"));
  }

  const response: PrivateHostedAgentPresenceResponse = {
    schemaVersion: "1.0",
    tenantId: mapping.tenantId,
    generatedAt: input.generatedAt as string,
    presence: {
      identityId: "stg-spiders",
      displayName: "Spiders",
      roleLabel: "Chief Agent",
      workplace: {
        id: "stg-chief-agent-office",
        label: "Chief Agent Office",
        relationship: "designated"
      },
      state: "blocked",
      freshness: record.freshness as "live" | "recent",
      reason: null,
      stateChangedAt: record.stateChangedAt as string,
      observedAt: audit.recordedAt as string,
      checkedAt: input.checkedAt as string,
      recordRef: {
        recordId: record.recordId as string,
        href: `/api/private/tenants/${mapping.tenantId}/records/${record.recordId as string}`
      }
    }
  };
  const detached = snapshotObject(response);
  if (!detached) return reject();
  return validatePrivateHostedAgentPresenceResponse(detached, input.generatedAt as string);
}

function exactOpaqueIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isOpaqueId) &&
    new Set(value).size === value.length;
}

function sameStrings(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((item, index) => item === right[index]);
}

function validCompletionEvidence(value: unknown, tenantId: string): value is SnapshotObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(Object.keys(value), COMPLETION_EVIDENCE_KEYS)) return false;
  const evidence = value as SnapshotObject;
  const integrity = evidence.integrity;
  return evidence.tenantId === tenantId && isOpaqueId(evidence.evidenceId) && evidence.relation === "result" &&
    isClosedString(evidence.locator) && /^internal:[A-Za-z0-9._:/-]{1,491}$/.test(evidence.locator) &&
    isClosedString(evidence.label) && (evidence.label as string).length <= 200 &&
    oneOf(evidence.sensitivity, ["tenant_private", "tenant_restricted", "public_approved"]) &&
    evidence.availability === "available" && integrity !== null && typeof integrity === "object" &&
    !Array.isArray(integrity) && sameKeys(Object.keys(integrity), INTEGRITY_KEYS) &&
    (integrity as SnapshotObject).algorithm === "sha256" &&
    typeof (integrity as SnapshotObject).digest === "string" &&
    /^[a-f0-9]{64}$/.test((integrity as SnapshotObject).digest as string) &&
    validWorkingSource(evidence.source, tenantId) && isCanonicalUtc(evidence.sourceOccurredAt) &&
    isCanonicalUtc(evidence.observedAt) && isCanonicalUtc(evidence.recordedAt) &&
    evidence.sourceOccurredAt === (evidence.source as SnapshotObject).occurredAt &&
    evidence.observedAt === (evidence.source as SnapshotObject).observedAt &&
    time(evidence.sourceOccurredAt as string) <= time(evidence.observedAt as string) &&
    time(evidence.observedAt as string) <= time(evidence.recordedAt as string);
}

function hasExactCompletionDelta(value: unknown, completedAt: string): boolean {
  if (!Array.isArray(value) || value.length !== 2 || value.some((change) =>
    change === null || typeof change !== "object" || Array.isArray(change) ||
    !sameKeys(Object.keys(change), FIELD_CHANGE_KEYS))) return false;
  const changes = value as SnapshotObject[];
  const state = changes.find((change) => change.field === "state");
  const completed = changes.find((change) => change.field === "completedAt");
  return new Set(changes.map((change) => change.field)).size === 2 &&
    state?.before === "active" && state.after === "completed" &&
    completed?.before === null && completed.after === completedAt;
}

function validCompletionAcceptanceAuthorityFacts(value: unknown): value is SnapshotObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(Object.keys(value), COMPLETION_AUTHORITY_FACT_KEYS)) return false;
  const authority = value as SnapshotObject;
  return authority.action === "accept_outcome" && isOpaqueId(authority.acceptanceAuthorizationId) &&
    isOpaqueId(authority.auditEventId) &&
    isOpaqueId(authority.scope) && isOpaqueId(authority.authorizationRef) &&
    isPositivePolicyRevision(authority.policyRevision) && isRevision(authority.mappingRevision) &&
    isRevision(authority.recordRevision) && isOpaqueId(authority.assignmentAuthorizationId) &&
    isOpaqueId(authority.outcomeId) && exactOpaqueIds(authority.evidenceIds) &&
    Array.isArray(authority.evidenceIntegrityDigests) &&
    authority.evidenceIntegrityDigests.length === authority.evidenceIds.length &&
    authority.evidenceIntegrityDigests.every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)) &&
    new Set(authority.evidenceIntegrityDigests).size === authority.evidenceIntegrityDigests.length &&
    isOpaqueId(authority.sourceId) && isClosedString(authority.sourceRecordId) &&
    (authority.sourceRecordId as string).length <= 200 && isClosedString(authority.sourceEventId) &&
    (authority.sourceEventId as string).length <= 200 && isCanonicalUtc(authority.acceptedAt) &&
    isCanonicalUtc(authority.auditRecordedAt) &&
    time(authority.acceptedAt as string) <= time(authority.auditRecordedAt as string) &&
    Array.isArray(authority.permissions) && authority.permissions.length === 1 &&
    authority.permissions[0] === "accept_outcome" &&
    Array.isArray(authority.decisionAuthorities) && authority.decisionAuthorities.length === 1 &&
    authority.decisionAuthorities[0] === "accept_outcome" && authority.onBehalfOf === null &&
    authority.authentication !== null && typeof authority.authentication === "object" &&
    !Array.isArray(authority.authentication) &&
    sameKeys(Object.keys(authority.authentication), AUTHENTICATION_KEYS) &&
    (authority.authentication as SnapshotObject).authenticated === true &&
    isOpaqueId((authority.authentication as SnapshotObject).subjectId) &&
    authority.membership !== null && typeof authority.membership === "object" &&
    !Array.isArray(authority.membership) && sameKeys(Object.keys(authority.membership), MEMBERSHIP_KEYS) &&
    (authority.membership as SnapshotObject).active === true &&
    isOpaqueId((authority.membership as SnapshotObject).tenantId);
}

function trustedCompletionAuthorizationSnapshot(
  value: unknown,
  tenantId: string,
  record: WorkRecord
): SnapshotObject | null {
  try {
    const decision = authorizeAction({
      authorization: value as TrustedAuthorizationInput,
      action: "transition",
      tenantId,
      record
    });
    const capability = snapshotWorkingValue(value);
    if (!decision.allowed || capability === null || typeof capability !== "object" || Array.isArray(capability) ||
        !sameKeys(Object.keys(capability), COMPLETION_CAPABILITY_KEYS)) return null;
    const trusted = capability as SnapshotObject;
    return trusted.provenance === "backend_trusted" && isOpaqueId(trusted.authorizationRef) &&
      isPositivePolicyRevision(trusted.policyRevision) &&
      Array.isArray(trusted.permissions) && trusted.permissions.length === 1 &&
      trusted.permissions[0] === "transition" &&
      Array.isArray(trusted.decisionAuthorities) && trusted.decisionAuthorities.length === 1 &&
      trusted.decisionAuthorities[0] === "accept_outcome" &&
      trusted.authentication !== null && typeof trusted.authentication === "object" &&
      !Array.isArray(trusted.authentication) &&
      sameKeys(Object.keys(trusted.authentication), AUTHENTICATION_KEYS) &&
      (trusted.authentication as SnapshotObject).authenticated === true &&
      isOpaqueId((trusted.authentication as SnapshotObject).subjectId) &&
      trusted.membership !== null && typeof trusted.membership === "object" &&
      !Array.isArray(trusted.membership) && sameKeys(Object.keys(trusted.membership), MEMBERSHIP_KEYS) &&
      (trusted.membership as SnapshotObject).active === true &&
      (trusted.membership as SnapshotObject).tenantId === tenantId ? trusted : null;
  } catch {
    return null;
  }
}

export function createTrustedCompletionAcceptanceAuthorityContext(
  value: unknown,
  acceptanceAuthorization: unknown,
  auditAuthorization: unknown,
  backendRecord: unknown
): HostedPresenceValidationResult<TrustedCompletionAcceptanceAuthorityContext> {
  const facts = snapshotWorkingValue(value);
  const record = snapshotWorkingValue(backendRecord);
  if (!validCompletionAcceptanceAuthorityFacts(facts) || record === null || typeof record !== "object" ||
      Array.isArray(record) || acceptanceAuthorization === auditAuthorization) return reject();
  const authority = facts as SnapshotObject;
  const tenantId = (authority.membership as SnapshotObject).tenantId as string;
  const acceptance = trustedCompletionAuthorizationSnapshot(
    acceptanceAuthorization,
    tenantId,
    record as WorkRecord
  );
  const audit = trustedCompletionAuthorizationSnapshot(auditAuthorization, tenantId, record as WorkRecord);
  if (!acceptance || !audit) return reject();
  if (acceptance.authorizationRef !== authority.acceptanceAuthorizationId ||
      audit.authorizationRef !== authority.authorizationRef ||
      acceptance.policyRevision !== authority.policyRevision || audit.policyRevision !== authority.policyRevision ||
      (acceptance.authentication as SnapshotObject).subjectId !==
        (authority.authentication as SnapshotObject).subjectId ||
      (audit.authentication as SnapshotObject).subjectId !== (authority.authentication as SnapshotObject).subjectId ||
      (acceptance.membership as SnapshotObject).tenantId !== (authority.membership as SnapshotObject).tenantId ||
      (audit.membership as SnapshotObject).tenantId !== (authority.membership as SnapshotObject).tenantId ||
      (record as SnapshotObject).tenantId !== tenantId ||
      (record as SnapshotObject).recordId !== authority.scope ||
      (record as SnapshotObject).revision !== authority.recordRevision) {
    return reject();
  }
  const context = Object.freeze({
    ...(facts as SnapshotObject),
    provenance: "backend_trusted" as const
  }) as unknown as TrustedCompletionAcceptanceAuthorityContext;
  trustedCompletionAcceptanceAuthorityContexts.add(context);
  return accept(context);
}

function isTrustedCompletionAcceptanceAuthorityContext(
  value: unknown
): value is TrustedCompletionAcceptanceAuthorityContext {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    trustedCompletionAcceptanceAuthorityContexts.has(value) &&
    sameKeys(Object.keys(value), COMPLETION_AUTHORITY_KEYS) &&
    (value as SnapshotObject).provenance === "backend_trusted" &&
    validCompletionAcceptanceAuthorityFacts(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "provenance")
    ));
}

function trustedCompletionAuthorityFromInput(
  value: unknown
): TrustedCompletionAcceptanceAuthorityContext | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptor = Reflect.getOwnPropertyDescriptor(value, "acceptanceAuthority");
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.get !== undefined ||
        descriptor.set !== undefined || !isTrustedCompletionAcceptanceAuthorityContext(descriptor.value)) return null;
    return descriptor.value;
  } catch {
    return null;
  }
}

export function derivePrivateHostedAgentCompletedPresence(
  value: unknown
): HostedPresenceValidationResult<PrivateHostedAgentPresenceResponse> {
  const trustedAcceptanceAuthority = trustedCompletionAuthorityFromInput(value);
  const candidate = snapshotWorkingValue(value);
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
      !sameKeys(Object.keys(candidate), COMPLETED_INPUT_KEYS)) return reject();
  const input = candidate as SnapshotObject;
  if (input.schemaVersion !== "1.0" || !isConfigScope(input.profileName) || !isCanonicalUtc(input.checkedAt) ||
      !isCanonicalUtc(input.generatedAt) || time(input.checkedAt as string) > time(input.generatedAt as string)) {
    return reject();
  }

  const mappingResult = validateReviewedHostedIdentityMapping(input.mapping, input.checkedAt as string);
  if (!mappingResult.ok) return reject();
  const mapping = mappingResult.value;
  if (input.profileName !== mapping.profileName) return reject();
  if (mapping.status !== "active") {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "membership_revoked"));
  }

  if (input.record === null || typeof input.record !== "object" || Array.isArray(input.record) ||
      input.assignment === null || typeof input.assignment !== "object" || Array.isArray(input.assignment) ||
      input.authorization === null || typeof input.authorization !== "object" || Array.isArray(input.authorization) ||
      input.trace === null || typeof input.trace !== "object" || Array.isArray(input.trace) ||
      !Array.isArray(input.evidence) || input.outcome === null || typeof input.outcome !== "object" ||
      Array.isArray(input.outcome) || input.audit === null || typeof input.audit !== "object" ||
      Array.isArray(input.audit) || input.acceptanceAuthority === null ||
      typeof input.acceptanceAuthority !== "object" || Array.isArray(input.acceptanceAuthority)) return reject();
  const record = input.record as SnapshotObject;
  const assignment = input.assignment as SnapshotObject;
  const authorization = input.authorization as SnapshotObject;
  const trace = input.trace as SnapshotObject;
  const outcome = input.outcome as SnapshotObject;
  const audit = input.audit as SnapshotObject;
  if (!sameKeys(Object.keys(record), COMPLETED_RECORD_KEYS) ||
      !sameKeys(Object.keys(assignment), WORKING_ASSIGNMENT_KEYS) ||
      !sameKeys(Object.keys(authorization), WORKING_AUTHORIZATION_KEYS) ||
      !sameKeys(Object.keys(trace), COMPLETED_TRACE_KEYS) ||
      !sameKeys(Object.keys(outcome), OUTCOME_KEYS) || !sameKeys(Object.keys(audit), COMPLETION_AUDIT_KEYS) ||
      !sameKeys(Object.keys(input.acceptanceAuthority as SnapshotObject), COMPLETION_AUTHORITY_KEYS)) return reject();
  if (trustedAcceptanceAuthority === null) {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "completion_unaccepted"));
  }
  const authority = trustedAcceptanceAuthority as unknown as SnapshotObject;

  if (!isOpaqueId(record.tenantId) || !isOpaqueId(record.recordId) || record.schemaVersion !== "1.0" ||
      !isRevision(record.revision) || !isCanonicalUtc(record.stateChangedAt) ||
      !isCanonicalUtc(record.recordedAt) || !isCanonicalUtc(record.completedAt) ||
      !hasWorkingAssignee(record.assignees, record.tenantId, mapping.subjectId) ||
      !validWorkingSource(record.source, record.tenantId) ||
      !isOpaqueId(assignment.tenantId) || !isOpaqueId(assignment.recordId) ||
      !isOpaqueId(assignment.authorizationId) || !isRevision(assignment.acceptedRevision) ||
      !hasWorkingAssignee(assignment.assignees, assignment.tenantId, mapping.subjectId) ||
      !validWorkingSource(assignment.source, assignment.tenantId) ||
      !isOpaqueId(authorization.tenantId) || authorization.action !== "assign" ||
      !isOpaqueId(authorization.authorizationId) || !isOpaqueId(authorization.authorizationRef) ||
      !isOpaqueId(authorization.scope) ||
      !validWorkingSubject(authorization.beneficiary, authorization.tenantId as string) ||
      !isPositivePolicyRevision(authorization.policyRevision) || authorization.allowed !== true ||
      !isOpaqueId(trace.tenantId) || !isOpaqueId(trace.recordId) || !isRevision(trace.recordRevision) ||
      !isOpaqueId(trace.assignmentAuthorizationId) || !isRevision(trace.mappingRevision) ||
      !isPositivePolicyRevision(trace.policyRevision) || !validWorkingSource(trace.source, trace.tenantId as string) ||
      !isOpaqueId(outcome.outcomeId) || !isOpaqueId(outcome.tenantId) || !isOpaqueId(outcome.recordId) ||
      !validWorkingSubject(outcome.acceptanceActor, outcome.tenantId as string) ||
      !isOpaqueId(outcome.acceptanceAuthorizationId) || !exactOpaqueIds(outcome.requiredEvidenceIds) ||
      !isCanonicalUtc(outcome.acceptedAt) || !isOpaqueId(audit.auditEventId) || !isOpaqueId(audit.tenantId) ||
      !isOpaqueId(audit.recordId) || audit.eventKind !== "outcome_acceptance" ||
      !validWorkingSubject(audit.actor, audit.tenantId as string) || audit.onBehalfOf !== null ||
      !isOpaqueId(audit.authorizationRef) || !isPositivePolicyRevision(audit.policyRevision) ||
      !isRevision(audit.priorRevision) || !isRevision(audit.newRevision) || !isCanonicalUtc(audit.occurredAt) ||
      !isCanonicalUtc(audit.recordedAt) || !isOpaqueId(audit.outcomeId) || !exactOpaqueIds(audit.evidenceIds) ||
      !validWorkingSource(audit.source, audit.tenantId as string) ||
      !hasExactCompletionDelta(audit.changedFields, record.completedAt as string)) return reject();

  if (input.evidence.length === 0 ||
      !input.evidence.every((item) => validCompletionEvidence(item, mapping.tenantId)) ||
      new Set(input.evidence.map((item) => (item as SnapshotObject).evidenceId)).size !== input.evidence.length) {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "completion_unaccepted"));
  }

  const evidence = input.evidence as SnapshotObject[];
  const evidenceIds = evidence.map((item) => item.evidenceId);
  const evidenceDigests = evidence.map((item) => (item.integrity as SnapshotObject).digest);
  const source = record.source as SnapshotObject;
  const tenantsMatch = [record, assignment, authorization, trace, outcome, audit]
    .every((item) => item.tenantId === mapping.tenantId);
  const recordsMatch = [assignment, trace, outcome, audit].every((item) => item.recordId === record.recordId);
  const sourcesMatch = sameWorkingSource(source, assignment.source as SnapshotObject) &&
    sameWorkingSource(source, trace.source as SnapshotObject) && sameWorkingSource(source, audit.source as SnapshotObject) &&
    evidence.every((item) => sameWorkingSource(source, item.source as SnapshotObject));
  const chronologyValid = time(source.observedAt as string) <= time(record.recordedAt as string) &&
    evidence.every((item) => time(item.sourceOccurredAt as string) <= time(item.observedAt as string) &&
      time(item.observedAt as string) <= time(item.recordedAt as string) &&
      time(item.recordedAt as string) <= time(outcome.acceptedAt as string)) &&
    time(record.recordedAt as string) <= time(outcome.acceptedAt as string) &&
    outcome.acceptedAt === audit.occurredAt && time(audit.occurredAt as string) <= time(audit.recordedAt as string) &&
    audit.recordedAt === record.stateChangedAt && record.stateChangedAt === record.completedAt &&
    time(audit.recordedAt as string) <= time(input.checkedAt as string) &&
    time(input.checkedAt as string) <= time(input.generatedAt as string);
  const acceptedM3 = record.state === "completed" && oneOf(record.freshness, ["live", "recent"]) &&
    record.revision >= 1 && assignment.acceptedRevision === record.revision - 1 &&
    trace.recordRevision === record.revision && audit.priorRevision === record.revision - 1 &&
    audit.newRevision === record.revision && authorization.authorizationId === assignment.authorizationId &&
    assignment.authorizationId === trace.assignmentAuthorizationId && trace.mappingRevision === mapping.registryRevision &&
    authorization.scope === record.recordId &&
    (authorization.beneficiary as SnapshotObject).subjectId === mapping.subjectId &&
    authorization.policyRevision === trace.policyRevision && trace.policyRevision === audit.policyRevision &&
    outcome.recordId === record.recordId && outcome.acceptanceAuthorizationId !== assignment.authorizationId &&
    (outcome.acceptanceActor as SnapshotObject).subjectId !== mapping.subjectId &&
    audit.outcomeId === outcome.outcomeId && sameStrings(outcome.requiredEvidenceIds, evidenceIds) &&
    sameStrings(audit.evidenceIds, evidenceIds) &&
    (audit.actor as SnapshotObject).subjectId === (outcome.acceptanceActor as SnapshotObject).subjectId &&
    (authority.authentication as SnapshotObject).subjectId === (audit.actor as SnapshotObject).subjectId &&
    (authority.membership as SnapshotObject).tenantId === mapping.tenantId && authority.auditEventId === audit.auditEventId &&
    authority.scope === record.recordId && authority.authorizationRef === audit.authorizationRef &&
    authority.policyRevision === audit.policyRevision && authority.mappingRevision === mapping.registryRevision &&
    authority.recordRevision === record.revision && authority.assignmentAuthorizationId === assignment.authorizationId &&
    authority.acceptanceAuthorizationId === outcome.acceptanceAuthorizationId &&
    authority.outcomeId === outcome.outcomeId && sameStrings(authority.evidenceIds, evidenceIds) &&
    sameStrings(authority.evidenceIntegrityDigests, evidenceDigests) && authority.sourceId === source.sourceId &&
    authority.sourceRecordId === source.sourceRecordId && authority.sourceEventId === source.sourceEventId &&
    authority.acceptedAt === outcome.acceptedAt && authority.auditRecordedAt === audit.recordedAt;

  if (!tenantsMatch || !recordsMatch || !sourcesMatch || !chronologyValid || !acceptedM3) {
    return accept(workingUnavailable(mapping.tenantId, input.checkedAt as string,
      input.generatedAt as string, "completion_unaccepted"));
  }

  const response: PrivateHostedAgentPresenceResponse = {
    schemaVersion: "1.0",
    tenantId: mapping.tenantId,
    generatedAt: input.generatedAt as string,
    presence: {
      identityId: "stg-spiders",
      displayName: "Spiders",
      roleLabel: "Chief Agent",
      workplace: {
        id: "stg-chief-agent-office",
        label: "Chief Agent Office",
        relationship: "designated"
      },
      state: "completed",
      freshness: record.freshness as "live" | "recent",
      reason: null,
      stateChangedAt: record.stateChangedAt as string,
      observedAt: audit.recordedAt as string,
      checkedAt: input.checkedAt as string,
      recordRef: {
        recordId: record.recordId as string,
        href: `/api/private/tenants/${mapping.tenantId}/records/${record.recordId as string}`
      }
    }
  };
  const detached = snapshotObject(response);
  if (!detached) return reject();
  return validatePrivateHostedAgentPresenceResponse(detached, input.generatedAt as string);
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
