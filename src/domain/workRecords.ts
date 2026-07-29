export type OpaqueId = string;
export const DURABLE_TIMESTAMP_SEMANTICS =
  "recordedAt is durable system acceptance; occurredAt and observedAt preserve source timing";
export const EVIDENCE_LABEL_MAX_LENGTH = 200;
export const EVIDENCE_LOCATOR_MAX_LENGTH = 500;
export type Sensitivity = "tenant_private" | "tenant_restricted" | "public_approved";
export type LifecycleState =
  | "proposed"
  | "authorized"
  | "ready"
  | "active"
  | "blocked"
  | "review"
  | "completed"
  | "archived"
  | "deleted_tombstone";
export type Freshness = "live" | "recent" | "stale" | "degraded" | "unavailable";

export interface TenantIdentity {
  tenantId: OpaqueId;
  displayName: string;
  lifecycle: "active" | "archived" | "deleted_tombstone";
  recordedAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface TenantScopedSubject {
  tenantId: OpaqueId;
  subjectId: OpaqueId;
}

export interface SourceReference {
  tenantId: OpaqueId;
  sourceId: OpaqueId;
  sourceRecordId: string;
  sourceEventId: string | null;
  contractVersion: string;
  occurredAt: string;
  observedAt: string;
}

export interface EvidenceReference {
  evidenceId: OpaqueId;
  tenantId: OpaqueId;
  relation: "supports" | "result" | "review" | "decision" | "source";
  locator: string;
  label: string;
  sensitivity: Sensitivity;
  integrity: { algorithm: string; digest: string } | null;
  sourceOccurredAt: string;
  observedAt: string;
  recordedAt: string;
  availability: "available" | "stale" | "unavailable" | "withdrawn" | "deleted_tombstone";
}

export interface TenantScopedRecordReference {
  tenantId: OpaqueId;
  recordId: OpaqueId;
}

export interface BlockReason {
  category: string;
  summary: string;
  resolutionAuthority: TenantScopedSubject | null;
  blockedAt: string;
}

export interface WorkRecord {
  schemaVersion: "1.0";
  recordId: OpaqueId;
  tenantId: OpaqueId;
  recordType: "assignment" | "decision" | "work_item" | "blocker" | "outcome";
  title: string;
  owner: TenantScopedSubject;
  assignees: TenantScopedSubject[];
  state: LifecycleState;
  freshness: Freshness;
  blockReason: BlockReason | null;
  evidenceLinks: EvidenceReference[];
  source: SourceReference;
  sensitivity: Sensitivity;
  /** Durable system acceptance time; source occurrence and observation remain separate. */
  recordedAt: string;
  updatedAt: string;
  stateChangedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  revision: number;
  supersedes: TenantScopedRecordReference | null;
}

export interface MaterialAuditEvent {
  auditEventId: OpaqueId;
  tenantId: OpaqueId;
  recordId: OpaqueId;
  eventKind: string;
  actor: TenantScopedSubject;
  onBehalfOf: TenantScopedSubject | null;
  authorizationRef: OpaqueId;
  policyRevision: number;
  occurredAt: string;
  /** Durable append time; distinct from when the represented action occurred. */
  recordedAt: string;
  priorRevision: number;
  newRevision: number;
  changedFields: MaterialFieldChange[];
  reasonRef: OpaqueId | null;
  source: SourceReference;
}

export interface MaterialFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; code: string };
export type AuthorizationDecision = { allowed: true; code: "allowed" } | { allowed: false; code: string };

export interface TrustedAuthorizationFacts {
  authentication: { authenticated: boolean; subjectId: OpaqueId | null };
  membership: { active: boolean; tenantId: OpaqueId | null };
  permissions: string[];
  decisionAuthorities: string[];
  authorizationRef: OpaqueId;
  policyRevision: number;
}

export interface TrustedAuthorizationInput extends TrustedAuthorizationFacts {
  provenance: "backend_trusted";
}

export interface TrustedFreshnessSourceFacts {
  sourceAvailability: "active" | "degraded" | "unavailable";
  activeSessionHealthy: boolean;
  observedAt: string;
  evaluatedAt: string;
  liveHealthWindowMs: number;
  recentWindowMs: number;
}

const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const SENSITIVITIES = new Set<Sensitivity>([
  "tenant_private",
  "tenant_restricted",
  "public_approved"
]);
const EVIDENCE_RELATIONS = new Set(["supports", "result", "review", "decision", "source"]);
const EVIDENCE_AVAILABILITY = new Set([
  "available", "stale", "unavailable", "withdrawn", "deleted_tombstone"
]);
const RECORD_TYPES = new Set(["assignment", "decision", "work_item", "blocker", "outcome"]);
const SOURCE_KEYS = [
  "contractVersion", "observedAt", "occurredAt", "sourceEventId", "sourceId", "sourceRecordId", "tenantId"
];
const EVIDENCE_KEYS = [
  "availability", "evidenceId", "integrity", "label", "locator", "observedAt", "recordedAt", "relation",
  "sensitivity", "sourceOccurredAt", "tenantId"
];
const SUBJECT_KEYS = ["subjectId", "tenantId"];
const TENANT_IDENTITY_KEYS = [
  "archivedAt", "deletedAt", "displayName", "lifecycle", "recordedAt", "tenantId", "updatedAt"
];
const BLOCK_REASON_KEYS = ["blockedAt", "category", "resolutionAuthority", "summary"];
const RECORD_REFERENCE_KEYS = ["recordId", "tenantId"];
const INTEGRITY_KEYS = ["algorithm", "digest"];
const AUDIT_KEYS = [
  "actor", "auditEventId", "authorizationRef", "changedFields", "eventKind", "newRevision", "occurredAt",
  "onBehalfOf", "policyRevision", "priorRevision", "reasonRef", "recordId", "recordedAt", "source", "tenantId"
];
const WORK_RECORD_KEYS = [
  "archivedAt", "assignees", "blockReason", "completedAt", "deletedAt", "evidenceLinks",
  "freshness", "owner", "recordId", "recordType", "recordedAt", "revision", "schemaVersion",
  "sensitivity", "source", "state", "stateChangedAt", "supersedes", "tenantId", "title", "updatedAt"
];
const SENSITIVITY_RANK: Readonly<Record<Sensitivity, number>> = {
  public_approved: 0,
  tenant_private: 1,
  tenant_restricted: 2
};
const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, ReadonlySet<LifecycleState>>> = {
  proposed: new Set(["authorized", "deleted_tombstone"]),
  authorized: new Set(["ready", "deleted_tombstone"]),
  ready: new Set(["active", "blocked", "archived", "deleted_tombstone"]),
  active: new Set(["blocked", "review", "completed", "archived", "deleted_tombstone"]),
  blocked: new Set(["ready", "active", "archived", "deleted_tombstone"]),
  review: new Set(["active", "blocked", "completed", "archived", "deleted_tombstone"]),
  completed: new Set(["archived", "deleted_tombstone"]),
  archived: new Set([]),
  deleted_tombstone: new Set([])
};
const LIFECYCLES = new Set<LifecycleState>(Object.keys(LIFECYCLE_TRANSITIONS) as LifecycleState[]);
const FRESHNESS_STATES = new Set<Freshness>(["live", "recent", "stale", "degraded", "unavailable"]);
const AUTHORIZED_ACTIONS = new Set([
  "create", "read", "assign", "transition", "update", "archive", "delete", "project_public"
]);
const AUDIT_EVENT_KINDS = new Set([
  "creation", "authorization", "assignment", "reassignment", "state_transition", "block", "unblock",
  "evidence_attach", "evidence_detach", "sensitivity_change", "rename", "archive", "delete_tombstone",
  "correction", "outcome_acceptance"
]);
const AUTHORIZATION_FACT_KEYS = [
  "authentication", "authorizationRef", "decisionAuthorities", "membership", "permissions", "policyRevision"
];
const AUTHORIZATION_CONTEXT_KEYS = [...AUTHORIZATION_FACT_KEYS, "provenance"].sort();
const AUTHENTICATION_KEYS = ["authenticated", "subjectId"];
const MEMBERSHIP_KEYS = ["active", "tenantId"];
const AUTHORIZATION_REQUEST_KEYS = ["action", "authorization", "record", "tenantId"];
const TENANT_UPDATE_REQUEST_KEYS = ["changes", "tenant", "updatedAt"];
const TRANSITION_REQUEST_KEYS = [
  "auditEvent", "authorization", "blockReason", "expectedRevision", "nextState", "record"
];
const SENSITIVITY_REQUEST_KEYS = [
  "auditEvent", "authorization", "expectedRevision", "nextSensitivity", "record"
];
const FRESHNESS_FACT_KEYS = [
  "activeSessionHealthy", "evaluatedAt", "liveHealthWindowMs", "observedAt", "recentWindowMs",
  "sourceAvailability"
];
const trustedAuthorizationContexts = new WeakSet<object>();

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is OpaqueId {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function hasTenant(value: unknown, tenantId: string): boolean {
  return isObject(value) && value.tenantId === tenantId;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function hasExactFields(actual: MaterialFieldChange[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((field) => actual.some((change) => change.field === field));
}

export function materialBlockReasonAuditValue(reason: BlockReason | null): string | null {
  if (reason === null) return null;
  return JSON.stringify({
    category: reason.category,
    summary: reason.summary,
    resolutionAuthority: reason.resolutionAuthority,
    blockedAt: reason.blockedAt
  });
}

function hasValidAuthorizationFacts(value: Record<string, unknown>): boolean {
  if (!isObject(value.authentication) || !hasExactKeys(value.authentication, AUTHENTICATION_KEYS) ||
      !isObject(value.membership) || !hasExactKeys(value.membership, MEMBERSHIP_KEYS) ||
      typeof value.authentication.authenticated !== "boolean" ||
      typeof value.membership.active !== "boolean" ||
      !Array.isArray(value.permissions) || value.permissions.some((permission) => typeof permission !== "string") ||
      !Array.isArray(value.decisionAuthorities) ||
      value.decisionAuthorities.some((authority) => typeof authority !== "string") ||
      !isOpaqueId(value.authorizationRef) || !Number.isSafeInteger(value.policyRevision) ||
      (value.policyRevision as number) < 1) {
    return false;
  }
  const subjectId = value.authentication.subjectId;
  const membershipTenantId = value.membership.tenantId;
  return (subjectId === null || isOpaqueId(subjectId)) &&
    (!value.authentication.authenticated || isOpaqueId(subjectId)) &&
    (membershipTenantId === null || isOpaqueId(membershipTenantId)) &&
    (!value.membership.active || isOpaqueId(membershipTenantId));
}

export function createTrustedAuthorizationContext(
  value: unknown
): ValidationResult<TrustedAuthorizationInput> {
  if (!isObject(value) || !hasExactKeys(value, AUTHORIZATION_FACT_KEYS) || !hasValidAuthorizationFacts(value)) {
    return { ok: false, code: "invalid_trusted_authorization_facts" };
  }
  const context = Object.freeze({
    provenance: "backend_trusted" as const,
    authentication: Object.freeze({ ...(value.authentication as Record<string, unknown>) }),
    membership: Object.freeze({ ...(value.membership as Record<string, unknown>) }),
    permissions: Object.freeze([...(value.permissions as string[])]),
    decisionAuthorities: Object.freeze([...(value.decisionAuthorities as string[])]),
    authorizationRef: value.authorizationRef,
    policyRevision: value.policyRevision
  }) as unknown as TrustedAuthorizationInput;
  trustedAuthorizationContexts.add(context);
  return { ok: true, value: context };
}

function isTrustedAuthorizationContext(value: unknown): value is TrustedAuthorizationInput {
  return isObject(value) && trustedAuthorizationContexts.has(value) &&
    hasExactKeys(value, AUTHORIZATION_CONTEXT_KEYS) && value.provenance === "backend_trusted" &&
    hasValidAuthorizationFacts(value);
}

export function deriveFreshnessFromSourceFacts(value: unknown): ValidationResult<Freshness> {
  if (!isObject(value) || !hasExactKeys(value, FRESHNESS_FACT_KEYS) ||
      !new Set(["active", "degraded", "unavailable"]).has(value.sourceAvailability as string) ||
      typeof value.activeSessionHealthy !== "boolean" ||
      !isCanonicalTimestamp(value.observedAt) || !isCanonicalTimestamp(value.evaluatedAt) ||
      Date.parse(value.observedAt as string) > Date.parse(value.evaluatedAt as string) ||
      !Number.isSafeInteger(value.liveHealthWindowMs) || !Number.isSafeInteger(value.recentWindowMs) ||
      (value.liveHealthWindowMs as number) < 1 || (value.liveHealthWindowMs as number) > 300_000 ||
      (value.recentWindowMs as number) < (value.liveHealthWindowMs as number) ||
      (value.recentWindowMs as number) > 604_800_000) {
    return { ok: false, code: "invalid_freshness_source_facts" };
  }
  if (value.sourceAvailability === "unavailable") return { ok: true, value: "unavailable" };
  if (value.sourceAvailability === "degraded") return { ok: true, value: "degraded" };
  const age = Date.parse(value.evaluatedAt as string) - Date.parse(value.observedAt as string);
  if (value.activeSessionHealthy && age <= (value.liveHealthWindowMs as number)) {
    return { ok: true, value: "live" };
  }
  return { ok: true, value: age <= (value.recentWindowMs as number) ? "recent" : "stale" };
}

export function validateSourceReference(
  value: unknown,
  expectedTenantId: OpaqueId
): ValidationResult<SourceReference> {
  if (!isObject(value) || !hasExactKeys(value, SOURCE_KEYS) || value.tenantId !== expectedTenantId ||
      !isOpaqueId(value.sourceId) ||
      typeof value.sourceRecordId !== "string" || value.sourceRecordId.length === 0 ||
      value.sourceRecordId.length > 200 ||
      (value.sourceEventId !== null &&
        (typeof value.sourceEventId !== "string" || value.sourceEventId.length === 0 ||
          value.sourceEventId.length > 200)) ||
      typeof value.contractVersion !== "string" || value.contractVersion.length === 0 ||
      value.contractVersion.length > 32) {
    return { ok: false, code: "invalid_source" };
  }
  if (!isCanonicalTimestamp(value.occurredAt) || !isCanonicalTimestamp(value.observedAt)) {
    return { ok: false, code: "invalid_source_timestamp" };
  }
  if (Date.parse(value.occurredAt) > Date.parse(value.observedAt)) {
    return { ok: false, code: "invalid_source_chronology" };
  }
  return { ok: true, value: value as unknown as SourceReference };
}

export function validateEvidenceReference(
  value: unknown,
  expectedTenantId: OpaqueId
): ValidationResult<EvidenceReference> {
  if (!isObject(value)) return { ok: false, code: "invalid_evidence" };
  if (!hasExactKeys(value, EVIDENCE_KEYS)) return { ok: false, code: "unknown_evidence_field" };
  if (value.tenantId !== expectedTenantId || !isOpaqueId(value.evidenceId) ||
      typeof value.locator !== "string" || value.locator.length === 0 ||
      value.locator.length > EVIDENCE_LOCATOR_MAX_LENGTH ||
      typeof value.label !== "string" || value.label.length === 0 ||
      value.label.length > EVIDENCE_LABEL_MAX_LENGTH) {
    return { ok: false, code: "invalid_evidence" };
  }
  if (!SENSITIVITIES.has(value.sensitivity as Sensitivity)) {
    return { ok: false, code: "invalid_evidence_sensitivity" };
  }
  if (!EVIDENCE_RELATIONS.has(value.relation as string)) {
    return { ok: false, code: "invalid_evidence_relation" };
  }
  if (!EVIDENCE_AVAILABILITY.has(value.availability as string)) {
    return { ok: false, code: "invalid_evidence_availability" };
  }
  if (!(value.locator as string).startsWith("internal:")) {
    return { ok: false, code: "invalid_evidence_locator" };
  }
  if (value.integrity !== null && (!isObject(value.integrity) || !hasExactKeys(value.integrity, INTEGRITY_KEYS) ||
      value.integrity.algorithm !== "sha256" || typeof value.integrity.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.integrity.digest))) {
    return { ok: false, code: "invalid_evidence_integrity" };
  }
  if (!isCanonicalTimestamp(value.sourceOccurredAt) || !isCanonicalTimestamp(value.observedAt) ||
      !isCanonicalTimestamp(value.recordedAt)) {
    return { ok: false, code: "invalid_evidence_timestamp" };
  }
  if (Date.parse(value.sourceOccurredAt) > Date.parse(value.observedAt) ||
      Date.parse(value.observedAt) > Date.parse(value.recordedAt)) {
    return { ok: false, code: "invalid_evidence_chronology" };
  }
  return { ok: true, value: value as unknown as EvidenceReference };
}

export function validateTenantIdentity(value: unknown): ValidationResult<TenantIdentity> {
  if (!isObject(value) || !isOpaqueId(value.tenantId)) return { ok: false, code: "invalid_tenant" };
  if (!hasExactKeys(value, TENANT_IDENTITY_KEYS)) return { ok: false, code: "unknown_tenant_field" };
  if (typeof value.displayName !== "string" || value.displayName.trim().length === 0) {
    return { ok: false, code: "invalid_display_name" };
  }
  if (!new Set(["active", "archived", "deleted_tombstone"]).has(value.lifecycle as string)) {
    return { ok: false, code: "invalid_tenant_lifecycle" };
  }
  if (!isCanonicalTimestamp(value.recordedAt) || !isCanonicalTimestamp(value.updatedAt) ||
      Date.parse(value.recordedAt) > Date.parse(value.updatedAt)) {
    return { ok: false, code: "invalid_timestamp" };
  }
  if ((value.lifecycle === "active" && (value.archivedAt !== null || value.deletedAt !== null)) ||
      (value.lifecycle === "archived" && (value.archivedAt === null || value.deletedAt !== null)) ||
      (value.lifecycle === "deleted_tombstone" && value.deletedAt === null)) {
    return { ok: false, code: "invalid_tenant_lifecycle_timestamp" };
  }
  const lifecycleTimestamps = [value.archivedAt, value.deletedAt]
    .filter((timestamp): timestamp is string => typeof timestamp === "string");
  if ([value.archivedAt, value.deletedAt].some(
    (timestamp) => timestamp !== null && typeof timestamp !== "string"
  )) return { ok: false, code: "invalid_tenant_lifecycle_timestamp" };
  if (lifecycleTimestamps.some((timestamp) => !isCanonicalTimestamp(timestamp))) {
    return { ok: false, code: "invalid_tenant_lifecycle_timestamp" };
  }
  if (lifecycleTimestamps.some((timestamp) => Date.parse(timestamp) < Date.parse(value.recordedAt as string) ||
      Date.parse(timestamp) > Date.parse(value.updatedAt as string))) {
    return { ok: false, code: "invalid_tenant_chronology" };
  }
  return { ok: true, value: value as unknown as TenantIdentity };
}

export function updateTenantIdentity(input: {
  tenant: TenantIdentity;
  changes: Partial<TenantIdentity>;
  updatedAt: string;
}): ValidationResult<TenantIdentity> {
  if (!isObject(input) || !hasExactKeys(input, TENANT_UPDATE_REQUEST_KEYS) ||
      !isObject(input.tenant) || !isObject(input.changes)) {
    return { ok: false, code: "invalid_tenant_update" };
  }
  if (input.changes.tenantId !== undefined && input.changes.tenantId !== input.tenant.tenantId) {
    return { ok: false, code: "immutable_tenant_scope" };
  }
  if (Object.keys(input.changes).some((key) => key !== "tenantId" && key !== "displayName")) {
    return { ok: false, code: "unsupported_tenant_change" };
  }
  const candidate: TenantIdentity = {
    ...input.tenant,
    displayName: input.changes.displayName ?? input.tenant.displayName,
    updatedAt: input.updatedAt
  };
  return validateTenantIdentity(candidate);
}

export function validateWorkRecord(value: unknown): ValidationResult<WorkRecord> {
  if (!isObject(value) || !isOpaqueId(value.tenantId)) return { ok: false, code: "invalid_tenant" };
  if (Object.hasOwn(value, "createdAt")) return { ok: false, code: "ambiguous_durable_timestamp" };
  const keys = Object.keys(value).sort();
  if (keys.length !== WORK_RECORD_KEYS.length || keys.some((key, index) => key !== WORK_RECORD_KEYS[index])) {
    return { ok: false, code: "unknown_or_missing_field" };
  }
  if (value.schemaVersion !== "1.0") return { ok: false, code: "invalid_schema_version" };
  if (!RECORD_TYPES.has(value.recordType as string)) return { ok: false, code: "invalid_record_type" };
  if (typeof value.title !== "string" || value.title.trim().length === 0 || value.title.length > 200) {
    return { ok: false, code: "invalid_title" };
  }
  const tenantId = value.tenantId;
  if (!hasTenant(value.owner, tenantId)) return { ok: false, code: "foreign_owner" };
  if (!isObject(value.owner) || !hasExactKeys(value.owner, SUBJECT_KEYS)) {
    return { ok: false, code: "invalid_owner" };
  }
  if (!Array.isArray(value.assignees) || value.assignees.some((assignee) => !hasTenant(assignee, tenantId))) {
    return { ok: false, code: "foreign_assignee" };
  }
  if (value.assignees.some((assignee) => !isObject(assignee) || !hasExactKeys(assignee, SUBJECT_KEYS))) {
    return { ok: false, code: "invalid_assignee" };
  }
  if (!Array.isArray(value.evidenceLinks) || value.evidenceLinks.some((item) => !hasTenant(item, tenantId))) {
    return { ok: false, code: "foreign_evidence" };
  }
  if (!hasTenant(value.source, tenantId)) return { ok: false, code: "foreign_source" };
  if (value.supersedes !== null && !hasTenant(value.supersedes, tenantId)) {
    return { ok: false, code: "foreign_supersession" };
  }
  if (value.supersedes !== null && (!isObject(value.supersedes) ||
      !hasExactKeys(value.supersedes, RECORD_REFERENCE_KEYS) || !isOpaqueId(value.supersedes.recordId))) {
    return { ok: false, code: "invalid_supersession" };
  }
  if (isObject(value.supersedes) && value.supersedes.recordId === value.recordId) {
    return { ok: false, code: "self_supersession" };
  }
  if (!isOpaqueId(value.recordId) || !isObject(value.owner) || !isOpaqueId(value.owner.subjectId) ||
      value.assignees.some((assignee) => !isObject(assignee) || !isOpaqueId(assignee.subjectId))) {
    return { ok: false, code: "invalid_identifier" };
  }
  const assigneeIds = value.assignees.map((assignee) => (assignee as Record<string, unknown>).subjectId);
  if (new Set(assigneeIds).size !== assigneeIds.length) return { ok: false, code: "duplicate_assignee" };
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    return { ok: false, code: "invalid_revision" };
  }
  const sourceValidation = validateSourceReference(value.source, tenantId);
  if (!sourceValidation.ok) return { ok: false, code: sourceValidation.code };
  for (const item of value.evidenceLinks) {
    const evidenceValidation = validateEvidenceReference(item, tenantId);
    if (!evidenceValidation.ok) return { ok: false, code: evidenceValidation.code };
  }
  if (!SENSITIVITIES.has(value.sensitivity as Sensitivity)) return { ok: false, code: "invalid_sensitivity" };
  if (!LIFECYCLES.has(value.state as LifecycleState)) return { ok: false, code: "invalid_lifecycle" };
  if (!FRESHNESS_STATES.has(value.freshness as Freshness)) return { ok: false, code: "invalid_freshness" };
  if (value.freshness === "live" || value.freshness === "recent") {
    return { ok: false, code: "unsubstantiated_freshness" };
  }
  if ((value.state === "blocked") !== (value.blockReason !== null)) {
    return { ok: false, code: "invalid_block_reason" };
  }
  if (value.blockReason !== null) {
    if (!isObject(value.blockReason) || !hasExactKeys(value.blockReason, BLOCK_REASON_KEYS) ||
        typeof value.blockReason.category !== "string" ||
        value.blockReason.category.trim().length === 0 || value.blockReason.category.length > 64 ||
        typeof value.blockReason.summary !== "string" || value.blockReason.summary.trim().length === 0 ||
        value.blockReason.summary.length > 500 || !isCanonicalTimestamp(value.blockReason.blockedAt)) {
      return { ok: false, code: "invalid_block_reason" };
    }
    if (value.blockReason.resolutionAuthority !== null &&
        !hasTenant(value.blockReason.resolutionAuthority, tenantId)) {
      return { ok: false, code: "foreign_block_authority" };
    }
    if (value.blockReason.resolutionAuthority !== null &&
        (!isObject(value.blockReason.resolutionAuthority) ||
          !hasExactKeys(value.blockReason.resolutionAuthority, SUBJECT_KEYS) ||
          !isOpaqueId(value.blockReason.resolutionAuthority.subjectId))) {
      return { ok: false, code: "invalid_block_reason" };
    }
    if (Date.parse(value.blockReason.blockedAt as string) < Date.parse(value.recordedAt as string) ||
        Date.parse(value.blockReason.blockedAt as string) > Date.parse(value.updatedAt as string)) {
      return { ok: false, code: "invalid_block_timestamp" };
    }
  }
  if ([value.completedAt, value.archivedAt, value.deletedAt].some(
    (timestamp) => timestamp !== null && typeof timestamp !== "string"
  )) return { ok: false, code: "invalid_timestamp" };
  if ((value.state === "completed" && value.completedAt === null) ||
      (value.state === "archived" && value.archivedAt === null) ||
      (value.state === "deleted_tombstone" && value.deletedAt === null) ||
      (!["completed", "archived", "deleted_tombstone"].includes(value.state as string) && value.completedAt !== null) ||
      (value.state !== "archived" && value.state !== "deleted_tombstone" && value.archivedAt !== null) ||
      (value.state !== "deleted_tombstone" && value.deletedAt !== null)) {
    return { ok: false, code: "invalid_lifecycle_timestamp" };
  }
  const lifecycleTimestamps = [value.completedAt, value.archivedAt, value.deletedAt]
    .filter((timestamp): timestamp is string => typeof timestamp === "string");
  if ([value.completedAt, value.archivedAt, value.deletedAt].some(
    (timestamp) => timestamp !== null && typeof timestamp !== "string"
  )) return { ok: false, code: "invalid_timestamp" };
  const isInitialProposedRevision = value.state === "proposed" && value.revision === 1;
  if ((value.stateChangedAt === null) !== isInitialProposedRevision ||
      (value.stateChangedAt !== null && !isCanonicalTimestamp(value.stateChangedAt))) {
    return { ok: false, code: "invalid_state_changed_at" };
  }
  if (!isCanonicalTimestamp(value.recordedAt) || !isCanonicalTimestamp(value.updatedAt) ||
      lifecycleTimestamps.some((timestamp) => !isCanonicalTimestamp(timestamp))) {
    return { ok: false, code: "invalid_timestamp" };
  }
  const recordedAt = value.recordedAt as string;
  const updatedAt = value.updatedAt as string;
  const stateChangedAt = value.stateChangedAt === null ? recordedAt : value.stateChangedAt as string;
  if (Date.parse(sourceValidation.value.observedAt) > Date.parse(recordedAt) ||
      Date.parse(recordedAt) > Date.parse(stateChangedAt) ||
      Date.parse(stateChangedAt) > Date.parse(updatedAt) ||
      (value.stateChangedAt === null && updatedAt !== recordedAt) ||
      lifecycleTimestamps.some((timestamp) => Date.parse(timestamp) < Date.parse(recordedAt) ||
        Date.parse(timestamp) > Date.parse(updatedAt))) {
    return { ok: false, code: "invalid_chronology" };
  }
  return { ok: true, value: value as unknown as WorkRecord };
}

function validateMaterialAuditEventContract(
  value: unknown,
  record: WorkRecord,
  authorization?: TrustedAuthorizationInput,
  allowInitialCreation = false
): ValidationResult<MaterialAuditEvent> {
  const recordValidation = validateWorkRecord(record);
  if (!recordValidation.ok) return { ok: false, code: "invalid_audit_record" };
  if (!isObject(value) || !hasExactKeys(value, AUDIT_KEYS) ||
      value.tenantId !== record.tenantId || value.recordId !== record.recordId) {
    return { ok: false, code: "foreign_audit_reference" };
  }
  if (!isOpaqueId(value.auditEventId) || !hasTenant(value.actor, record.tenantId) ||
      !hasTenant(value.source, record.tenantId)) {
    return { ok: false, code: "invalid_audit_event" };
  }
  if (!isObject(value.actor) || !hasExactKeys(value.actor, SUBJECT_KEYS) || !isOpaqueId(value.actor.subjectId) ||
      (value.onBehalfOf !== null && (!hasTenant(value.onBehalfOf, record.tenantId) ||
        !isObject(value.onBehalfOf) || !hasExactKeys(value.onBehalfOf, SUBJECT_KEYS) ||
        !isOpaqueId(value.onBehalfOf.subjectId))) ||
      !isOpaqueId(value.authorizationRef) || typeof value.eventKind !== "string" ||
      value.eventKind.length === 0 || !Number.isSafeInteger(value.policyRevision) ||
      (value.policyRevision as number) < 1) {
    return { ok: false, code: "invalid_audit_event" };
  }
  if (value.reasonRef !== null && !isOpaqueId(value.reasonRef)) {
    return { ok: false, code: "invalid_audit_event" };
  }
  if (authorization !== undefined && value.policyRevision !== authorization.policyRevision) {
    return { ok: false, code: "audit_policy_revision_mismatch" };
  }
  if (!AUDIT_EVENT_KINDS.has(value.eventKind as string)) {
    return { ok: false, code: "invalid_audit_event_kind" };
  }
  if (!isCanonicalTimestamp(value.occurredAt) || !isCanonicalTimestamp(value.recordedAt) ||
      Date.parse(value.occurredAt) > Date.parse(value.recordedAt) ||
      Date.parse(value.recordedAt) < Date.parse(record.updatedAt)) {
    return { ok: false, code: "invalid_audit_timestamp" };
  }
  const sourceValidation = validateSourceReference(value.source, record.tenantId);
  if (!sourceValidation.ok) return { ok: false, code: sourceValidation.code };
  if (Date.parse(sourceValidation.value.observedAt) > Date.parse(value.occurredAt as string)) {
    return { ok: false, code: "invalid_audit_source_chronology" };
  }
  const isInitialCreation = allowInitialCreation && value.eventKind === "creation" && record.revision === 1 &&
    value.priorRevision === 0 && value.newRevision === 1;
  if (!isInitialCreation &&
      (value.priorRevision !== record.revision || value.newRevision !== record.revision + 1)) {
    return { ok: false, code: "invalid_audit_revision" };
  }
  if (!Array.isArray(value.changedFields) || value.changedFields.length === 0 ||
      value.changedFields.some((change) => !isObject(change) ||
        !hasExactKeys(change, ["after", "before", "field"]) ||
        typeof change.field !== "string" || !WORK_RECORD_KEYS.includes(change.field) ||
        (change.before !== null && (typeof change.before !== "string" || change.before.length > 1000)) ||
        (change.after !== null && (typeof change.after !== "string" || change.after.length > 1000))) ||
      new Set(value.changedFields.map((change) => (change as Record<string, unknown>).field)).size !==
        value.changedFields.length) {
    return { ok: false, code: "invalid_audit_changed_fields" };
  }
  return { ok: true, value: value as unknown as MaterialAuditEvent };
}

export function validateMaterialAuditEvent(
  value: unknown,
  record: WorkRecord,
  authorization?: TrustedAuthorizationInput
): ValidationResult<MaterialAuditEvent> {
  return validateMaterialAuditEventContract(value, record, authorization);
}

export function validateCreationAuditEvent(
  value: unknown,
  record: WorkRecord,
  authorization: TrustedAuthorizationInput
): ValidationResult<MaterialAuditEvent> {
  if (!isTrustedAuthorizationContext(authorization)) {
    return { ok: false, code: "untrusted_authorization_input" };
  }
  const validation = validateMaterialAuditEventContract(value, record, authorization, true);
  if (!validation.ok) return validation;
  const audit = validation.value;
  if (record.revision !== 1 || record.state !== "proposed" || record.stateChangedAt !== null ||
      record.recordedAt !== record.updatedAt || audit.eventKind !== "creation" ||
      audit.priorRevision !== 0 || audit.newRevision !== 1 || audit.onBehalfOf !== null ||
      audit.reasonRef !== null || audit.actor.subjectId !== authorization.authentication.subjectId ||
      audit.authorizationRef !== authorization.authorizationRef ||
      audit.occurredAt !== record.recordedAt || audit.recordedAt !== record.recordedAt ||
      JSON.stringify(audit.source) !== JSON.stringify(record.source) ||
      !hasExactFields(audit.changedFields, ["recordId"]) ||
      audit.changedFields[0].before !== null || audit.changedFields[0].after !== record.recordId) {
    return { ok: false, code: "invalid_creation_audit_contract" };
  }
  return validation;
}

export function transitionWorkRecord(input: {
  record: WorkRecord;
  nextState: LifecycleState;
  blockReason: BlockReason | null;
  expectedRevision: number;
  auditEvent: MaterialAuditEvent | null;
  authorization: TrustedAuthorizationInput;
}): ValidationResult<{ record: WorkRecord; auditEvent: MaterialAuditEvent }> {
  if (!isObject(input) || !hasExactKeys(input, TRANSITION_REQUEST_KEYS)) {
    return { ok: false, code: "invalid_transition_input" };
  }
  const currentRecordValidation = validateWorkRecord(input.record);
  if (!currentRecordValidation.ok) return { ok: false, code: currentRecordValidation.code };
  if (!LIFECYCLE_TRANSITIONS[input.record.state]?.has(input.nextState)) {
    return { ok: false, code: "invalid_transition" };
  }
  if (input.expectedRevision !== input.record.revision) return { ok: false, code: "stale_revision" };
  if (input.auditEvent === null) return { ok: false, code: "missing_audit_event" };
  const decision = authorizeAction({
    authorization: input.authorization,
    action: input.nextState === "archived" ? "archive" :
      input.nextState === "deleted_tombstone" ? "delete" : "transition",
    tenantId: input.record.tenantId,
    record: input.record
  });
  if (!decision.allowed) return { ok: false, code: decision.code };
  if ((input.nextState === "blocked") !== (input.blockReason !== null)) {
    return { ok: false, code: "invalid_block_reason" };
  }
  const auditValidation = validateMaterialAuditEvent(input.auditEvent, input.record, input.authorization);
  if (!auditValidation.ok) return auditValidation;
  if (input.auditEvent.actor.subjectId !== input.authorization.authentication.subjectId) {
    return { ok: false, code: "audit_actor_mismatch" };
  }
  const expectedEventKind = input.nextState === "archived" ? "archive" :
    input.nextState === "deleted_tombstone" ? "delete_tombstone" :
      input.nextState === "blocked" ? "block" :
        input.record.state === "blocked" ? "unblock" : "state_transition";
  const expectedFields = input.nextState === "blocked" || input.record.state === "blocked" ?
    ["state", "blockReason"] : ["state"];
  const blockReasonChange = input.auditEvent.changedFields.find((change) => change.field === "blockReason");
  if (input.auditEvent.authorizationRef !== input.authorization.authorizationRef ||
      input.auditEvent.eventKind !== expectedEventKind ||
      !hasExactFields(input.auditEvent.changedFields, expectedFields) ||
      !input.auditEvent.changedFields.some((change) => change.field === "state" &&
        change.before === input.record.state && change.after === input.nextState) ||
      ((input.nextState === "blocked" || input.record.state === "blocked") &&
        (blockReasonChange?.before !== materialBlockReasonAuditValue(input.record.blockReason) ||
          blockReasonChange?.after !== materialBlockReasonAuditValue(input.blockReason)))) {
    return { ok: false, code: "invalid_audit_contract" };
  }
  const nextRecord: WorkRecord = {
    ...input.record,
    state: input.nextState,
    blockReason: input.blockReason,
    updatedAt: input.auditEvent.recordedAt,
    stateChangedAt: input.auditEvent.recordedAt,
    completedAt: input.nextState === "completed" ? input.auditEvent.recordedAt : input.record.completedAt,
    archivedAt: input.nextState === "archived" ? input.auditEvent.recordedAt : input.record.archivedAt,
    deletedAt: input.nextState === "deleted_tombstone" ? input.auditEvent.recordedAt : input.record.deletedAt,
    revision: input.record.revision + 1
  };
  const recordValidation = validateWorkRecord(nextRecord);
  if (!recordValidation.ok) return recordValidation;
  return { ok: true, value: { record: nextRecord, auditEvent: input.auditEvent } };
}

export function changeWorkRecordSensitivity(input: {
  record: WorkRecord;
  nextSensitivity: Sensitivity;
  expectedRevision: number;
  auditEvent: MaterialAuditEvent | null;
  authorization: TrustedAuthorizationInput;
}): ValidationResult<{ record: WorkRecord; auditEvent: MaterialAuditEvent }> {
  if (!isObject(input) || !hasExactKeys(input, SENSITIVITY_REQUEST_KEYS)) {
    return { ok: false, code: "invalid_sensitivity_input" };
  }
  const currentRecordValidation = validateWorkRecord(input.record);
  if (!currentRecordValidation.ok) return { ok: false, code: currentRecordValidation.code };
  if (!SENSITIVITIES.has(input.nextSensitivity)) return { ok: false, code: "invalid_sensitivity" };
  if (input.expectedRevision !== input.record.revision) return { ok: false, code: "stale_revision" };
  if (input.auditEvent === null) return { ok: false, code: "missing_audit_event" };
  const decision = authorizeAction({
    authorization: input.authorization,
    action: "update",
    tenantId: input.record.tenantId,
    record: input.record
  });
  if (!decision.allowed) return { ok: false, code: decision.code };
  if (SENSITIVITY_RANK[input.nextSensitivity] < SENSITIVITY_RANK[input.record.sensitivity] &&
      !input.authorization.decisionAuthorities.includes("publication")) {
    return { ok: false, code: "missing_publication_authority" };
  }
  const auditValidation = validateMaterialAuditEvent(input.auditEvent, input.record, input.authorization);
  if (!auditValidation.ok) return { ok: false, code: auditValidation.code };
  if (input.auditEvent.actor.subjectId !== input.authorization.authentication.subjectId) {
    return { ok: false, code: "audit_actor_mismatch" };
  }
  if (input.auditEvent.authorizationRef !== input.authorization.authorizationRef ||
      input.auditEvent.eventKind !== "sensitivity_change" ||
      !hasExactFields(input.auditEvent.changedFields, ["sensitivity"]) ||
      !input.auditEvent.changedFields.some((change) => change.field === "sensitivity" &&
        change.before === input.record.sensitivity && change.after === input.nextSensitivity)) {
    return { ok: false, code: "invalid_audit_contract" };
  }
  const nextRecord: WorkRecord = {
    ...input.record,
    sensitivity: input.nextSensitivity,
    updatedAt: input.auditEvent.recordedAt,
    revision: input.record.revision + 1
  };
  const recordValidation = validateWorkRecord(nextRecord);
  if (!recordValidation.ok) return { ok: false, code: recordValidation.code };
  return { ok: true, value: { record: nextRecord, auditEvent: input.auditEvent } };
}

export function authorizeAction(input: {
  authorization: TrustedAuthorizationInput;
  clientAssertions?: unknown;
  action: string;
  tenantId: OpaqueId;
  record?: WorkRecord;
}): AuthorizationDecision {
  if (!isObject(input)) return { allowed: false, code: "invalid_authorization_request" };
  if (input.clientAssertions !== undefined) return { allowed: false, code: "untrusted_client_claim" };
  if (!hasExactKeys(input, AUTHORIZATION_REQUEST_KEYS)) {
    return { allowed: false, code: "invalid_authorization_request" };
  }
  if (!isObject(input.authorization) || !trustedAuthorizationContexts.has(input.authorization)) {
    return { allowed: false, code: "untrusted_authorization_input" };
  }
  if (!isTrustedAuthorizationContext(input.authorization)) {
    return { allowed: false, code: "invalid_authorization_context" };
  }
  if (!AUTHORIZED_ACTIONS.has(input.action)) return { allowed: false, code: "unknown_action" };
  if (!input.authorization.authentication.authenticated) return { allowed: false, code: "unauthenticated" };
  if (!input.authorization.membership.active) return { allowed: false, code: "inactive_membership" };
  if (input.authorization.membership.tenantId !== input.tenantId ||
      (isObject(input.record) && input.record.tenantId !== input.tenantId)) {
    return { allowed: false, code: "tenant_scope_mismatch" };
  }
  const recordValidation = validateWorkRecord(input.record);
  if (!recordValidation.ok) return { allowed: false, code: "invalid_record" };
  if (!input.authorization.permissions.includes(input.action)) return { allowed: false, code: "missing_permission" };

  if (input.action === "project_public" &&
      !input.authorization.decisionAuthorities.includes("publication")) {
    return { allowed: false, code: "missing_decision_authority" };
  }
  if (input.action === "project_public" && input.record?.sensitivity !== "public_approved") {
    return { allowed: false, code: "non_public_sensitivity" };
  }
  if (input.action === "project_public" &&
      (!Array.isArray(input.record?.evidenceLinks) ||
        input.record.evidenceLinks.some((item) => item.sensitivity !== "public_approved"))) {
    return { allowed: false, code: "nested_sensitivity_not_public" };
  }
  return { allowed: true, code: "allowed" };
}
