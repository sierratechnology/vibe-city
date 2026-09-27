const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const TRUSTED_AUTHORIZATION = Symbol('trusted authorization context');
const TRUSTED_SOURCE_HEALTH = Symbol('trusted source health fact');
const TRUSTED_AUTHORIZATION_CONTEXTS = new WeakSet<object>();
const TRUSTED_SOURCE_HEALTH_FACTS = new WeakSet<object>();

type UnknownRecord = Record<string, unknown>;

type TrustedAuthorizationContext = Readonly<{
  authorizationId: string;
  actorSubjectId: string;
  authenticated: boolean;
  memberships: readonly Readonly<{
    tenantId: string;
    status: string;
    role: string;
  }>[];
  permissions: readonly string[];
  decisionAuthorities: readonly string[];
  policyRevision: string;
  [TRUSTED_AUTHORIZATION]: true;
}>;

type TrustedSourceHealthFact = Readonly<{
  tenantId: string;
  sourceId: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  [TRUSTED_SOURCE_HEALTH]: true;
}>;

function requireObject(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function requireClosedObject(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): UnknownRecord {
  const object = requireObject(value, label);
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain own-key object`);
  }
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${label} properties must be own data properties`);
    }
  }
  const unknownKey = Reflect.ownKeys(object)
    .find((key) => typeof key !== 'string' || !allowedKeys.includes(key));
  if (unknownKey !== undefined) {
    throw new TypeError(`${label} has unknown key ${String(unknownKey)}`);
  }
  return object;
}

function requireTraceObject(
  value: unknown,
  label: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): UnknownRecord {
  const object = requireClosedObject(value, label, [...requiredKeys, ...optionalKeys]);
  const missingKey = requiredKeys.find((key) => !Object.hasOwn(object, key));
  if (missingKey !== undefined) {
    throw new TypeError(`${label} is missing own key ${missingKey}`);
  }
  return object;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw new TypeError(`${label} must be a stable opaque ID`);
  }
  return value;
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function requireBoundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value) {
    throw new TypeError(`${label} must be a bounded canonical string`);
  }
  return value;
}

function requireBoundedArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return value;
}

function requireMaterialAudit(value: unknown): UnknownRecord {
  const audit = requireClosedObject(value, 'material audit event', [
    'auditId', 'tenantId', 'recordId', 'actorSubjectId', 'authorizationId',
    'policyRevision', 'sourceId', 'priorRevision', 'newRevision', 'occurredAt',
    'recordedAt', 'changedFields',
  ]);
  requireId(audit.auditId, 'auditId');
  requireBoundedString(audit.policyRevision, 'audit policyRevision', 120);
  const changedFields = requireBoundedArray(audit.changedFields, 'audit changedFields', 20);
  if (changedFields.some((field) => typeof field !== 'string')) {
    throw new TypeError('audit changedFields must contain canonical strings');
  }
  return audit;
}

const TRACE_SOURCE_KEYS = [
  'tenantId', 'sourceId', 'sourceRecordId', 'sourceEventId', 'contractVersion',
  'occurredAt', 'observedAt',
] as const;
const TRACE_EVIDENCE_KEYS = [
  'tenantId', 'evidenceId', 'activityId', 'relation', 'locator', 'label', 'sensitivity', 'integrity',
  'sourceOccurredAt', 'observedAt', 'recordedAt', 'availability',
] as const;

function validateTraceSource(value: unknown, tenantId: string, label: string): UnknownRecord {
  const source = requireTraceObject(value, label, TRACE_SOURCE_KEYS);
  if (requireId(source.tenantId, `${label} tenantId`) !== tenantId) {
    throw new TypeError(`${label} tenant must match trace tenant`);
  }
  requireId(source.sourceId, `${label} sourceId`);
  requireBoundedString(source.sourceRecordId, `${label} sourceRecordId`, 200);
  if (source.sourceEventId !== null) {
    requireBoundedString(source.sourceEventId, `${label} sourceEventId`, 200);
  }
  requireBoundedString(source.contractVersion, `${label} contractVersion`, 32);
  const occurredAt = requireCanonicalTimestamp(source.occurredAt, `${label} occurredAt`);
  const observedAt = requireCanonicalTimestamp(source.observedAt, `${label} observedAt`);
  if (occurredAt > observedAt) throw new TypeError(`${label} chronology is invalid`);
  return source;
}

function isApprovedTraceEvidenceLocator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  if (/^urn:stg:evidence:[a-z0-9][a-z0-9._:/-]{0,200}$/.test(value)) return true;
  if (/^internal:[A-Za-z0-9._:/-]{1,491}$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== ''
      || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 4
      || parts.slice(0, 2).some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part))) return false;
    if (parts[2] === 'commit') return /^[a-f0-9]{7,64}$/.test(parts[3]);
    return (parts[2] === 'pull' || parts[2] === 'issues') && /^[1-9][0-9]{0,19}$/.test(parts[3]);
  } catch {
    return false;
  }
}

function validateTraceEvidence(value: unknown, tenantId: string, index: number): UnknownRecord {
  const label = `trace evidence ${index}`;
  const evidence = requireTraceObject(
    value, label, TRACE_EVIDENCE_KEYS.filter((key) => key !== 'integrity'), ['integrity'],
  );
  if (requireId(evidence.tenantId, `${label} tenantId`) !== tenantId) {
    throw new TypeError(`${label} tenant must match trace tenant`);
  }
  requireId(evidence.evidenceId, `${label} evidenceId`);
  requireId(evidence.activityId, `${label} activityId`);
  if (!['supports', 'result', 'review', 'decision', 'source'].includes(evidence.relation as string)) {
    throw new TypeError(`${label} relation is invalid`);
  }
  if (!isApprovedTraceEvidenceLocator(evidence.locator)) {
    throw new TypeError(`${label} locator class is invalid`);
  }
  requireBoundedString(evidence.label, `${label} label`, 200);
  if (!['tenant_private', 'restricted', 'public_approved'].includes(evidence.sensitivity as string)) {
    throw new TypeError(`${label} sensitivity is invalid`);
  }
  if (!['available', 'stale', 'unavailable', 'withdrawn', 'deleted_tombstone']
    .includes(evidence.availability as string)) {
    throw new TypeError(`${label} availability is invalid`);
  }
  if (evidence.integrity !== null) {
    const integrity = requireTraceObject(
      evidence.integrity, `${label} integrity`, ['algorithm', 'digest'],
    );
    if (integrity.algorithm !== 'sha256' || typeof integrity.digest !== 'string'
      || !/^[a-f0-9]{64}$/.test(integrity.digest)) {
      throw new TypeError(`${label} integrity is invalid`);
    }
  }
  const sourceOccurredAt = requireCanonicalTimestamp(
    evidence.sourceOccurredAt, `${label} sourceOccurredAt`,
  );
  const observedAt = requireCanonicalTimestamp(evidence.observedAt, `${label} observedAt`);
  const recordedAt = requireCanonicalTimestamp(evidence.recordedAt, `${label} recordedAt`);
  if (sourceOccurredAt > observedAt || observedAt > recordedAt) {
    throw new TypeError(`${label} chronology is invalid`);
  }
  return evidence;
}

export function validateTraceBundle(input: unknown):
  { ok: true; value: UnknownRecord } | { ok: false; code: string } {
  try {
    const trace = requireTraceObject(input, 'trace', [
      'tenantId', 'recordId', 'direction', 'authorization', 'assignment', 'activities',
      'evidence', 'outcome',
    ]);
    const tenantId = requireId(trace.tenantId, 'trace tenantId');
    const recordId = requireId(trace.recordId, 'trace recordId');
    const direction = requireTraceObject(trace.direction, 'trace direction', [
      'tenantId', 'directionId', 'directingSubject', 'source', 'occurredAt', 'sensitivity',
    ]);
    if (requireId(direction.tenantId, 'direction tenantId') !== tenantId) {
      return { ok: false, code: 'invalid_direction' };
    }
    const directionId = requireId(direction.directionId, 'directionId');
    const directingSubject = requireTraceObject(
      direction.directingSubject, 'directingSubject', ['tenantId', 'subjectId'],
    );
    if (requireId(directingSubject.tenantId, 'directingSubject tenantId') !== tenantId) {
      return { ok: false, code: 'invalid_direction' };
    }
    requireId(directingSubject.subjectId, 'directingSubject subjectId');
    const directionSource = validateTraceSource(direction.source, tenantId, 'direction source');
    const directionOccurredAt = requireCanonicalTimestamp(
      direction.occurredAt, 'direction occurredAt',
    );
    if (!['tenant_private', 'restricted', 'public_approved'].includes(direction.sensitivity as string)) {
      return { ok: false, code: 'invalid_direction' };
    }

    if (trace.authorization === null || trace.authorization === undefined) {
      return { ok: false, code: 'missing_assignment_authorization' };
    }
    const authorization = requireTraceObject(trace.authorization, 'trace authorization', [
      'tenantId', 'authorizationId', 'directionId', 'action', 'scope', 'authorizer',
      'beneficiary', 'constraints', 'policyRevision', 'effectiveAt',
    ]);
    if (requireId(authorization.tenantId, 'trace authorization tenantId') !== tenantId
      || authorization.action !== 'assign'
      || requireId(authorization.scope, 'trace authorization scope') !== recordId
      || requireId(authorization.directionId, 'trace authorization directionId') !== directionId) {
      return { ok: false, code: 'invalid_assignment_authorization' };
    }
    const authorizationId = requireId(authorization.authorizationId, 'trace authorizationId');
    for (const name of ['authorizer', 'beneficiary'] as const) {
      const subject = requireTraceObject(authorization[name], name, ['tenantId', 'subjectId']);
      if (requireId(subject.tenantId, `${name} tenantId`) !== tenantId) {
        return { ok: false, code: 'invalid_assignment_authorization' };
      }
      requireId(subject.subjectId, `${name} subjectId`);
    }
    const constraints = requireBoundedArray(authorization.constraints, 'authorization constraints', 50);
    if (constraints.some((constraint) => typeof constraint !== 'string'
      || constraint.length < 1 || constraint.length > 200 || constraint.trim() !== constraint)) {
      return { ok: false, code: 'invalid_assignment_authorization' };
    }
    if (!(Number.isSafeInteger(authorization.policyRevision)
      && Number(authorization.policyRevision) >= 1)
      && (typeof authorization.policyRevision !== 'string'
        || authorization.policyRevision.length < 1
        || authorization.policyRevision.length > 120
        || authorization.policyRevision.trim() !== authorization.policyRevision)) {
      return { ok: false, code: 'invalid_assignment_authorization' };
    }
    const authorizationEffectiveAt = requireCanonicalTimestamp(
      authorization.effectiveAt, 'authorization effectiveAt',
    );
    if (authorizationEffectiveAt < directionOccurredAt) {
      return { ok: false, code: 'invalid_assignment_authorization_chronology' };
    }

    const assignment = requireTraceObject(trace.assignment, 'trace assignment', [
      'tenantId', 'recordId', 'authorizationId', 'owner', 'assignees', 'acceptedRevision',
      'source', 'occurredAt',
    ]);
    if (requireId(assignment.tenantId, 'assignment tenantId') !== tenantId
      || requireId(assignment.recordId, 'assignment recordId') !== recordId
      || requireId(assignment.authorizationId, 'assignment authorizationId') !== authorizationId) {
      return { ok: false, code: 'invalid_assignment' };
    }
    const owner = requireTraceObject(assignment.owner, 'assignment owner', ['tenantId', 'subjectId']);
    if (requireId(owner.tenantId, 'assignment owner tenantId') !== tenantId) {
      return { ok: false, code: 'invalid_assignment' };
    }
    requireId(owner.subjectId, 'assignment owner subjectId');
    const assignees = requireBoundedArray(assignment.assignees, 'assignment assignees', 50);
    if (assignees.length === 0) return { ok: false, code: 'invalid_assignment' };
    const assigneeIds = new Set<string>();
    for (const [index, candidate] of assignees.entries()) {
      const assignee = requireTraceObject(
        candidate, `assignment assignee ${index}`, ['tenantId', 'subjectId'],
      );
      if (requireId(assignee.tenantId, `assignment assignee ${index} tenantId`) !== tenantId) {
        return { ok: false, code: 'invalid_assignment' };
      }
      const subjectId = requireId(assignee.subjectId, `assignment assignee ${index} subjectId`);
      if (assigneeIds.has(subjectId)) return { ok: false, code: 'invalid_assignment' };
      assigneeIds.add(subjectId);
    }
    const beneficiary = requireObject(authorization.beneficiary, 'authorization beneficiary');
    if (!assigneeIds.has(String(beneficiary.subjectId))
      || !Number.isSafeInteger(assignment.acceptedRevision)
      || Number(assignment.acceptedRevision) < 1) return { ok: false, code: 'invalid_assignment' };
    const assignmentSource = validateTraceSource(assignment.source, tenantId, 'assignment source');
    const assignmentOccurredAt = requireCanonicalTimestamp(
      assignment.occurredAt, 'assignment occurredAt',
    );
    if (assignmentSource.sourceId !== directionSource.sourceId
      || assignmentOccurredAt < authorizationEffectiveAt) {
      return { ok: false, code: 'invalid_assignment_link' };
    }

    const activities = requireBoundedArray(trace.activities, 'trace activities', 200);
    if (activities.length === 0) return { ok: false, code: 'missing_activity' };
    const activityIds = new Set<string>();
    let latestActivityRecordedAt = assignmentOccurredAt;
    for (const [index, candidate] of activities.entries()) {
      const activity = requireTraceObject(candidate, `activity ${index}`, [
        'tenantId', 'recordId', 'activityId', 'actor', 'source', 'eventKind',
        'occurredAt', 'observedAt', 'recordedAt',
      ]);
      if (requireId(activity.tenantId, `activity ${index} tenantId`) !== tenantId
        || requireId(activity.recordId, `activity ${index} recordId`) !== recordId) {
        return { ok: false, code: 'invalid_activity' };
      }
      const activityId = requireId(activity.activityId, `activity ${index} activityId`);
      if (activityIds.has(activityId)) return { ok: false, code: 'duplicate_activity' };
      activityIds.add(activityId);
      if (activity.actor === null || activity.actor === undefined) {
        return { ok: false, code: 'invalid_activity_actor' };
      }
      const actor = requireTraceObject(
        activity.actor, `activity ${index} actor`, ['tenantId', 'subjectId'],
      );
      if (requireId(actor.tenantId, `activity ${index} actor tenantId`) !== tenantId) {
        return { ok: false, code: 'invalid_activity_actor' };
      }
      requireId(actor.subjectId, `activity ${index} actor subjectId`);
      if (activity.source === null || activity.source === undefined) {
        return { ok: false, code: 'invalid_activity_source' };
      }
      const activitySource = validateTraceSource(
        activity.source, tenantId, `activity ${index} source`,
      );
      if (activitySource.sourceId !== directionSource.sourceId) {
        return { ok: false, code: 'invalid_activity_source' };
      }
      if (!['work_started', 'work_performed', 'review_requested'].includes(activity.eventKind as string)) {
        return { ok: false, code: 'invalid_activity_chronology' };
      }
      const occurredAt = requireCanonicalTimestamp(activity.occurredAt, `activity ${index} occurredAt`);
      const observedAt = requireCanonicalTimestamp(activity.observedAt, `activity ${index} observedAt`);
      const recordedAt = requireCanonicalTimestamp(activity.recordedAt, `activity ${index} recordedAt`);
      if (occurredAt < authorizationEffectiveAt || occurredAt < assignmentOccurredAt
        || occurredAt > observedAt || observedAt > recordedAt) {
        return { ok: false, code: 'invalid_activity_chronology' };
      }
      if (recordedAt > latestActivityRecordedAt) latestActivityRecordedAt = recordedAt;
    }

    const evidenceValues = requireBoundedArray(trace.evidence, 'trace evidence', 50);
    const evidenceIds = new Set<string>();
    let latestEvidenceRecordedAt = assignmentOccurredAt;
    for (const [index, candidate] of evidenceValues.entries()) {
      const evidence = validateTraceEvidence(candidate, tenantId, index);
      const evidenceId = String(evidence.evidenceId);
      if (evidenceIds.has(evidenceId)) return { ok: false, code: 'duplicate_evidence' };
      if (!activityIds.has(String(evidence.activityId))) {
        return { ok: false, code: 'invalid_evidence_activity_link' };
      }
      const evidenceRecordedAt = String(evidence.recordedAt);
      if (evidenceRecordedAt > latestEvidenceRecordedAt) latestEvidenceRecordedAt = evidenceRecordedAt;
      evidenceIds.add(evidenceId);
    }
    if (trace.outcome === null || trace.outcome === undefined) {
      return { ok: false, code: 'missing_outcome' };
    }
    const outcome = requireTraceObject(trace.outcome, 'trace outcome', [
      'tenantId', 'recordId', 'outcomeId', 'acceptanceActor', 'acceptanceAuthorizationId',
      'requiredEvidenceIds', 'acceptedAt',
    ]);
    if (requireId(outcome.tenantId, 'outcome tenantId') !== tenantId
      || requireId(outcome.recordId, 'outcome recordId') !== recordId
      || requireId(outcome.acceptanceAuthorizationId, 'outcome acceptanceAuthorizationId') !== authorizationId) {
      return { ok: false, code: 'invalid_outcome' };
    }
    requireId(outcome.outcomeId, 'outcomeId');
    const acceptanceActor = requireTraceObject(
      outcome.acceptanceActor, 'outcome acceptanceActor', ['tenantId', 'subjectId'],
    );
    if (requireId(acceptanceActor.tenantId, 'outcome acceptanceActor tenantId') !== tenantId) {
      return { ok: false, code: 'invalid_outcome' };
    }
    requireId(acceptanceActor.subjectId, 'outcome acceptanceActor subjectId');
    const requiredEvidenceIds = requireBoundedArray(
      outcome.requiredEvidenceIds, 'outcome requiredEvidenceIds', 50,
    ).map((evidenceId, index) => requireId(evidenceId, `requiredEvidenceId ${index}`));
    if (requiredEvidenceIds.length === 0) return { ok: false, code: 'missing_required_evidence' };
    if (new Set(requiredEvidenceIds).size !== requiredEvidenceIds.length) {
      return { ok: false, code: 'duplicate_required_evidence' };
    }
    const usableEvidence = new Set(evidenceValues.filter((candidate) => {
      const evidence = requireObject(candidate, 'trace evidence');
      return evidence.availability === 'available' || evidence.availability === 'stale';
    }).map((candidate) => String(requireObject(candidate, 'trace evidence').evidenceId)));
    if (requiredEvidenceIds.some((evidenceId) => !usableEvidence.has(evidenceId))) {
      return { ok: false, code: 'missing_required_evidence' };
    }
    const acceptedAt = requireCanonicalTimestamp(outcome.acceptedAt, 'outcome acceptedAt');
    if (acceptedAt < assignmentOccurredAt || acceptedAt < latestActivityRecordedAt
      || acceptedAt < latestEvidenceRecordedAt) {
      return { ok: false, code: 'invalid_outcome_chronology' };
    }
    return { ok: true, value: structuredClone(trace) };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/activity.*actor/i.test(message)) return { ok: false, code: 'invalid_activity_actor' };
    if (/activity.*source/i.test(message)) return { ok: false, code: 'invalid_activity_source' };
    if (/activity/i.test(message)) return { ok: false, code: 'invalid_activity' };
    if (/authorization/i.test(message)) return { ok: false, code: 'invalid_assignment_authorization' };
    if (/assignment/i.test(message)) return { ok: false, code: 'invalid_assignment' };
    if (/direction/i.test(message)) return { ok: false, code: 'invalid_direction' };
    if (/evidence/i.test(message)) return { ok: false, code: 'invalid_trace_evidence' };
    if (/outcome/i.test(message)) return { ok: false, code: 'invalid_outcome' };
    return { ok: false, code: 'invalid_trace' };
  }
}

export function validateWorkRecord(input: unknown): UnknownRecord {
  const record = requireClosedObject(input, 'work record', [
    'tenantId', 'recordId', 'title', 'owner', 'assignees', 'lifecycle', 'freshness',
    'sensitivity', 'revision', 'createdAt', 'updatedAt', 'source', 'evidence',
    'supersedes', 'correctionOf', 'archivedAt', 'deletedAt', 'blockReason',
    'stateChangedAt',
  ]);
  const tenantId = requireId(record.tenantId, 'tenantId');
  requireId(record.recordId, 'recordId');
  requireBoundedString(record.title, 'title', 240);
  const createdAt = requireCanonicalTimestamp(record.createdAt, 'record createdAt');
  const updatedAt = requireCanonicalTimestamp(record.updatedAt, 'record updatedAt');
  if (createdAt > updatedAt) {
    throw new TypeError('record chronology requires createdAt before updatedAt');
  }
  if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
    throw new TypeError('record revision must be a positive safe integer');
  }
  if (!['open', 'in_progress', 'blocked', 'completed', 'archived', 'deleted']
    .includes(record.lifecycle as string)) {
    throw new TypeError('record lifecycle is invalid');
  }
  if (!['unknown', 'fresh', 'stale'].includes(record.freshness as string)) {
    throw new TypeError('record freshness is invalid');
  }
  if (!['tenant_private', 'restricted', 'public_approved'].includes(record.sensitivity as string)) {
    throw new TypeError('record sensitivity is invalid');
  }

  const archivedAt = record.archivedAt === null
    ? null
    : requireCanonicalTimestamp(record.archivedAt, 'archivedAt');
  const deletedAt = record.deletedAt === null
    ? null
    : requireCanonicalTimestamp(record.deletedAt, 'deletedAt');
  if ((record.lifecycle === 'archived' || record.lifecycle === 'deleted') && archivedAt === null) {
    throw new TypeError('archivedAt is required for archived or deleted lifecycle');
  }
  if (record.lifecycle === 'deleted' && deletedAt === null) {
    throw new TypeError('deletedAt is required for deleted lifecycle');
  }
  if (record.lifecycle !== 'archived' && record.lifecycle !== 'deleted' && archivedAt !== null) {
    throw new TypeError('archivedAt is forbidden before archived lifecycle');
  }
  if (record.lifecycle !== 'deleted' && deletedAt !== null) {
    throw new TypeError('deletedAt is forbidden before deleted lifecycle');
  }
  if ((archivedAt !== null && archivedAt > updatedAt)
    || (deletedAt !== null && (archivedAt === null || deletedAt < archivedAt || deletedAt > updatedAt))) {
    throw new TypeError('lifecycle chronology is invalid');
  }

  if (record.lifecycle === 'blocked'
    && (!Object.hasOwn(record, 'blockReason') || !Object.hasOwn(record, 'stateChangedAt'))) {
    throw new TypeError('blocked lifecycle requires own blockReason and stateChangedAt fields');
  }
  const stateChangedAt = record.stateChangedAt === undefined
    ? undefined
    : requireCanonicalTimestamp(record.stateChangedAt, 'stateChangedAt');
  if (stateChangedAt !== undefined && (stateChangedAt < createdAt || stateChangedAt > updatedAt)) {
    throw new TypeError('stateChangedAt chronology is invalid');
  }
  if (record.lifecycle === 'blocked') {
    const reason = requireClosedObject(record.blockReason, 'blockReason', [
      'category', 'summary', 'resolutionAuthoritySubjectId', 'blockedAt',
    ]);
    if (reason.category !== 'dependency') {
      throw new TypeError('blockReason category is invalid');
    }
    requireBoundedString(reason.summary, 'blockReason summary', 240);
    if (reason.resolutionAuthoritySubjectId !== undefined) {
      requireId(reason.resolutionAuthoritySubjectId, 'resolutionAuthoritySubjectId');
    }
    const blockedAt = requireCanonicalTimestamp(reason.blockedAt, 'blockedAt');
    if (stateChangedAt === undefined || blockedAt !== stateChangedAt || blockedAt > updatedAt) {
      throw new TypeError('blocked state chronology is invalid');
    }
  } else if (record.blockReason !== undefined && record.blockReason !== null) {
    throw new TypeError('blockReason is valid only for blocked lifecycle');
  }

  const owner = requireClosedObject(record.owner, 'owner', ['tenantId', 'subjectId']);
  if (requireId(owner.tenantId, 'owner tenantId') !== tenantId) {
    throw new TypeError('owner tenant must match record tenant');
  }
  requireId(owner.subjectId, 'owner subjectId');

  const assigneeIds = new Set<string>();
  requireBoundedArray(record.assignees, 'assignees', 50).forEach((value, index) => {
    const assignee = requireClosedObject(
      value,
      `assignee ${index}`,
      ['tenantId', 'subjectId'],
    );
    if (requireId(assignee.tenantId, `assignee ${index} tenantId`) !== tenantId) {
      throw new TypeError('assignee tenant must match record tenant');
    }
    const subjectId = requireId(assignee.subjectId, `assignee ${index} subjectId`);
    if (assigneeIds.has(subjectId)) {
      throw new TypeError('duplicate assignee subjectId');
    }
    assigneeIds.add(subjectId);
  });

  const source = requireClosedObject(record.source, 'source', [
    'tenantId', 'sourceId', 'occurredAt', 'observedAt', 'recordedAt',
  ]);
  if (requireId(source.tenantId, 'source tenantId') !== tenantId) {
    throw new TypeError('source tenant must match record tenant');
  }
  requireId(source.sourceId, 'sourceId');
  const occurredAt = requireCanonicalTimestamp(source.occurredAt, 'source occurredAt');
  const observedAt = requireCanonicalTimestamp(source.observedAt, 'source observedAt');
  const recordedAt = requireCanonicalTimestamp(source.recordedAt, 'source recordedAt');
  if (occurredAt > observedAt || observedAt > recordedAt) {
    throw new TypeError('source chronology must be occurredAt, observedAt, recordedAt');
  }
  if (recordedAt > updatedAt) {
    throw new TypeError('source chronology cannot exceed record updatedAt');
  }

  requireBoundedArray(record.evidence, 'evidence', 50).forEach((value, index) => {
    const evidence = requireClosedObject(
      value,
      `evidence ${index}`,
      ['tenantId', 'evidenceId', 'locator', 'recordedAt'],
    );
    if (requireId(evidence.tenantId, `evidence ${index} tenantId`) !== tenantId) {
      throw new TypeError('evidence tenant must match record tenant');
    }
    requireId(evidence.evidenceId, `evidence ${index} evidenceId`);
    if (!isApprovedTraceEvidenceLocator(evidence.locator)) {
      throw new TypeError('safe evidence locator required');
    }
    const evidenceRecordedAt = requireCanonicalTimestamp(
      evidence.recordedAt,
      `evidence ${index} recordedAt`,
    );
    if (evidenceRecordedAt > updatedAt) {
      throw new TypeError('evidence chronology cannot exceed record updatedAt');
    }
  });

  for (const linkName of ['supersedes', 'correctionOf'] as const) {
    if (record[linkName] === null) continue;
    const link = requireClosedObject(record[linkName], linkName, ['tenantId', 'recordId']);
    if (requireId(link.tenantId, `${linkName} tenantId`) !== tenantId) {
      throw new TypeError(`${linkName} tenant must match the same-tenant record`);
    }
    requireId(link.recordId, `${linkName} recordId`);
  }

  return structuredClone(record);
}

export function createWorkRecord(input: unknown): UnknownRecord {
  const record = requireClosedObject(input, 'work record', [
    'tenantId', 'recordId', 'title', 'owner', 'assignees', 'lifecycle', 'freshness',
    'sensitivity', 'revision', 'createdAt', 'updatedAt', 'source', 'evidence',
    'supersedes', 'correctionOf', 'archivedAt', 'deletedAt', 'blockReason',
    'stateChangedAt',
  ]);
  return validateWorkRecord({
    ...record,
    sensitivity: record.sensitivity ?? 'tenant_private',
  });
}

export function validateCreationAuditEvent(
  auditValue: unknown,
  recordValue: unknown,
  contextValue: unknown,
): UnknownRecord {
  const context = requireObject(
    contextValue,
    'authorization context',
  ) as Partial<TrustedAuthorizationContext>;
  if (context[TRUSTED_AUTHORIZATION] !== true
    || !TRUSTED_AUTHORIZATION_CONTEXTS.has(context)) {
    throw new TypeError('trusted authorization context required');
  }
  const record = validateWorkRecord(recordValue);
  const audit = requireMaterialAudit(auditValue);
  const source = requireObject(record.source, 'record source');
  if (requireId(audit.tenantId, 'audit tenantId') !== record.tenantId
    || requireId(audit.recordId, 'audit recordId') !== record.recordId
    || requireId(audit.actorSubjectId, 'audit actorSubjectId') !== context.actorSubjectId
    || requireId(audit.authorizationId, 'audit authorizationId') !== context.authorizationId
    || String(audit.policyRevision) !== context.policyRevision
    || requireId(audit.sourceId, 'audit sourceId') !== source.sourceId
    || audit.priorRevision !== 0 || audit.newRevision !== 1
    || record.revision !== 1) {
    throw new TypeError('creation audit provenance must match revision 0 to 1');
  }
  if (!Array.isArray(audit.changedFields)
    || audit.changedFields.length !== 1 || audit.changedFields[0] !== 'recordId') {
    throw new TypeError('creation audit changedFields must exactly describe record identity');
  }
  const occurredAt = requireCanonicalTimestamp(audit.occurredAt, 'audit occurredAt');
  const recordedAt = requireCanonicalTimestamp(audit.recordedAt, 'audit recordedAt');
  if (occurredAt > recordedAt || recordedAt < String(record.updatedAt)
    || recordedAt < String(source.recordedAt)) {
    throw new TypeError('creation audit chronology cannot predate durable record or source');
  }
  return structuredClone(audit);
}

export function createTrustedAuthorizationContext(input: unknown): TrustedAuthorizationContext {
  const facts = requireClosedObject(input, 'trusted authorization facts', [
    'authorizationId', 'actorSubjectId', 'authenticated', 'memberships', 'permissions',
    'decisionAuthorities', 'policyRevision',
  ]);
  if (typeof facts.authenticated !== 'boolean') {
    throw new TypeError('authenticated must be a boolean');
  }
  const membershipTenantIds = new Set<string>();
  const memberships = requireBoundedArray(facts.memberships, 'memberships', 20)
    .map((value, index) => {
    const membership = requireClosedObject(
      value,
      `membership ${index}`,
      ['tenantId', 'status', 'role'],
    );
    const tenantId = requireId(membership.tenantId, `membership ${index} tenantId`);
    if (membershipTenantIds.has(tenantId)) {
      throw new TypeError('duplicate membership tenantId');
    }
    membershipTenantIds.add(tenantId);
    if (membership.status !== 'active' && membership.status !== 'inactive') {
      throw new TypeError('membership status is invalid');
    }
    if (!['owner', 'admin', 'member', 'auditor'].includes(membership.role as string)) {
      throw new TypeError('membership role is invalid');
    }
    return Object.freeze({
      tenantId,
      status: membership.status,
      role: membership.role as string,
    });
  });
  const allowedPermissions = [
    'record.create', 'record.read', 'record.rename', 'record.reassign', 'record.history.read',
    'record.block', 'record.unblock',
    'record.transition', 'record.sensitivity.change', 'record.archive', 'record.delete',
    'record.restore', 'record.correct', 'record.supersede',
    'record.trace.write', 'record.trace.read', 'record.evidence.resolve',
    'record.evidence.availability.update',
  ];
  const permissions = requireBoundedArray(facts.permissions, 'permissions', 20) as string[];
  if (permissions.some((permission) => !allowedPermissions.includes(permission))) {
    throw new TypeError('permission is invalid');
  }
  if (new Set(permissions).size !== permissions.length) {
    throw new TypeError('duplicate permission');
  }
  const decisionAuthorities = requireBoundedArray(
    facts.decisionAuthorities,
    'decisionAuthorities',
    10,
  ) as string[];
  if (decisionAuthorities.some((authority) => authority !== 'publication.approve')) {
    throw new TypeError('decision authority is invalid');
  }
  if (new Set(decisionAuthorities).size !== decisionAuthorities.length) {
    throw new TypeError('duplicate decision authority');
  }
  const context = {
    authorizationId: requireId(facts.authorizationId, 'authorizationId'),
    actorSubjectId: requireId(facts.actorSubjectId, 'actorSubjectId'),
    authenticated: facts.authenticated,
    memberships: Object.freeze(memberships),
    permissions: Object.freeze([...permissions]),
    decisionAuthorities: Object.freeze([...decisionAuthorities]),
    policyRevision: requireBoundedString(facts.policyRevision, 'policyRevision', 120),
  } as Omit<TrustedAuthorizationContext, typeof TRUSTED_AUTHORIZATION> & {
    [TRUSTED_AUTHORIZATION]?: true;
  };
  Object.defineProperty(context, TRUSTED_AUTHORIZATION, { value: true });
  TRUSTED_AUTHORIZATION_CONTEXTS.add(context);
  return Object.freeze(context) as TrustedAuthorizationContext;
}

export function createTrustedSourceHealthFact(input: unknown): TrustedSourceHealthFact {
  const facts = requireClosedObject(input, 'trusted source health facts', [
    'tenantId', 'sourceId', 'status', 'checkedAt',
  ]);
  if (facts.status !== 'healthy' && facts.status !== 'degraded' && facts.status !== 'unavailable') {
    throw new TypeError('source health status is invalid');
  }
  const fact = {
    tenantId: requireId(facts.tenantId, 'source health tenantId'),
    sourceId: requireId(facts.sourceId, 'source health sourceId'),
    status: facts.status,
    checkedAt: requireCanonicalTimestamp(facts.checkedAt, 'source health checkedAt'),
  } as Omit<TrustedSourceHealthFact, typeof TRUSTED_SOURCE_HEALTH> & {
    [TRUSTED_SOURCE_HEALTH]?: true;
  };
  Object.defineProperty(fact, TRUSTED_SOURCE_HEALTH, { value: true });
  TRUSTED_SOURCE_HEALTH_FACTS.add(fact);
  return Object.freeze(fact) as TrustedSourceHealthFact;
}

export function deriveRecordFreshness(recordValue: unknown, factValue: unknown): UnknownRecord {
  const record = validateWorkRecord(recordValue);
  const fact = requireObject(factValue, 'source health fact') as Partial<TrustedSourceHealthFact>;
  if (fact[TRUSTED_SOURCE_HEALTH] !== true || !TRUSTED_SOURCE_HEALTH_FACTS.has(fact)) {
    throw new TypeError('trusted source health fact required');
  }
  const source = requireObject(record.source, 'source');
  if (fact.tenantId !== record.tenantId || fact.sourceId !== source.sourceId) {
    throw new TypeError('source health fact must match record tenant and source');
  }
  if (String(fact.checkedAt) < String(source.recordedAt)) {
    throw new TypeError('source health fact cannot predate durable source recording');
  }
  return {
    ...record,
    freshness: fact.status === 'healthy' ? 'fresh' : 'stale',
  };
}

export function renameTenantIdentity(identityValue: unknown, commandValue: unknown): UnknownRecord {
  const identity = requireClosedObject(identityValue, 'tenant identity', [
    'tenantId', 'displayName', 'revision', 'createdAt', 'updatedAt',
  ]);
  const command = requireClosedObject(commandValue, 'tenant rename command', [
    'expectedRevision', 'displayName', 'recordedAt',
  ]);
  requireId(identity.tenantId, 'tenantId');
  const createdAt = requireCanonicalTimestamp(identity.createdAt, 'tenant createdAt');
  requireCanonicalTimestamp(identity.updatedAt, 'tenant updatedAt');
  if (!Number.isSafeInteger(identity.revision) || identity.revision !== command.expectedRevision) {
    throw new TypeError('expected revision must match tenant identity revision');
  }
  if (typeof command.displayName !== 'string'
    || command.displayName.trim() !== command.displayName
    || command.displayName.length < 1
    || command.displayName.length > 120) {
    throw new TypeError('tenant displayName must be a bounded canonical string');
  }
  const recordedAt = requireCanonicalTimestamp(command.recordedAt, 'rename recordedAt');
  if (recordedAt < createdAt || recordedAt < String(identity.updatedAt)) {
    throw new TypeError('rename recordedAt cannot predate tenant identity');
  }
  return {
    ...structuredClone(identity),
    displayName: command.displayName,
    revision: Number(identity.revision) + 1,
    updatedAt: recordedAt,
  };
}

export function authorizeRecordAction(
  contextValue: unknown,
  requestValue: unknown,
  recordValue: unknown,
): true {
  const context = requireObject(contextValue, 'authorization context') as Partial<TrustedAuthorizationContext>;
  if (context[TRUSTED_AUTHORIZATION] !== true
    || !TRUSTED_AUTHORIZATION_CONTEXTS.has(context)) {
    throw new TypeError('trusted authorization context required');
  }
  if (!context.authenticated) {
    throw new TypeError('authenticated subject required');
  }

  const request = requireClosedObject(
    requestValue,
    'authorization request',
    ['action', 'requestedTenantId'],
  );
  const record = validateWorkRecord(recordValue);
  const requestedTenantId = requireId(request.requestedTenantId, 'requestedTenantId');
  if (requestedTenantId !== record.tenantId) {
    throw new TypeError('requested tenant must match record tenant');
  }
  const membership = context.memberships?.find((candidate) => candidate.tenantId === requestedTenantId);
  if (!membership || membership.status !== 'active') {
    throw new TypeError('active membership required');
  }
  if (!context.permissions?.includes(request.action as string)) {
    throw new TypeError('action permission required');
  }
  return true;
}

export function transitionWorkRecord(
  contextValue: unknown,
  recordValue: unknown,
  commandValue: unknown,
): { record: UnknownRecord; auditEvents: UnknownRecord[] } {
  const command = requireClosedObject(commandValue, 'transition command', [
    'requestedTenantId', 'expectedRevision', 'toLifecycle', 'auditEvents',
  ]);
  authorizeRecordAction(contextValue, {
    action: 'record.transition',
    requestedTenantId: command.requestedTenantId,
  }, recordValue);

  const context = contextValue as TrustedAuthorizationContext;
  const record = validateWorkRecord(recordValue);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== record.revision) {
    throw new TypeError('expected revision must match current revision');
  }
  const transitions: Record<string, readonly string[]> = {
    open: ['in_progress'],
    in_progress: ['completed'],
  };
  const toLifecycle = command.toLifecycle;
  if (typeof toLifecycle !== 'string'
    || !transitions[String(record.lifecycle)]?.includes(toLifecycle)) {
    throw new TypeError('invalid lifecycle transition');
  }
  if (!Array.isArray(command.auditEvents) || command.auditEvents.length !== 1) {
    throw new TypeError('exactly one material audit event is required');
  }

  const audit = requireMaterialAudit(command.auditEvents[0]);
  const nextRevision = Number(record.revision) + 1;
  const source = requireObject(record.source, 'record source');
  if (
    requireId(audit.tenantId, 'audit tenantId') !== record.tenantId
    || requireId(audit.recordId, 'audit recordId') !== record.recordId
    || requireId(audit.actorSubjectId, 'audit actorSubjectId') !== context.actorSubjectId
    || requireId(audit.authorizationId, 'audit authorizationId') !== context.authorizationId
    || String(audit.policyRevision) !== context.policyRevision
    || requireId(audit.sourceId, 'audit sourceId') !== source.sourceId
    || audit.priorRevision !== record.revision
    || audit.newRevision !== nextRevision
  ) {
    throw new TypeError('material audit provenance must match transition');
  }
  if (!Array.isArray(audit.changedFields)
    || audit.changedFields.length !== 1
    || audit.changedFields[0] !== 'lifecycle') {
    throw new TypeError('material audit changedFields must exactly describe lifecycle');
  }
  const occurredAt = requireCanonicalTimestamp(audit.occurredAt, 'audit occurredAt');
  const recordedAt = requireCanonicalTimestamp(audit.recordedAt, 'audit recordedAt');
  if (occurredAt > recordedAt
    || recordedAt < String(record.updatedAt)
    || recordedAt < String(source.recordedAt)) {
    throw new TypeError('audit chronology cannot predate durable record or source');
  }

  return {
    record: {
      ...record,
      lifecycle: toLifecycle,
      stateChangedAt: recordedAt,
      revision: nextRevision,
      updatedAt: recordedAt,
    },
    auditEvents: [structuredClone(audit)],
  };
}

export function changeRecordSensitivity(
  contextValue: unknown,
  recordValue: unknown,
  commandValue: unknown,
): { record: UnknownRecord; auditEvents: UnknownRecord[] } {
  const command = requireClosedObject(commandValue, 'sensitivity command', [
    'requestedTenantId', 'expectedRevision', 'toSensitivity', 'auditEvents',
  ]);
  authorizeRecordAction(contextValue, {
    action: 'record.sensitivity.change',
    requestedTenantId: command.requestedTenantId,
  }, recordValue);

  const context = contextValue as TrustedAuthorizationContext;
  if (!context.decisionAuthorities.includes('publication.approve')) {
    throw new TypeError('publication decision authority required');
  }
  const record = validateWorkRecord(recordValue);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== record.revision) {
    throw new TypeError('expected revision must match current revision');
  }
  if (record.sensitivity !== 'tenant_private' || command.toSensitivity !== 'public_approved') {
    throw new TypeError('invalid sensitivity downgrade');
  }
  if (!Array.isArray(command.auditEvents) || command.auditEvents.length !== 1) {
    throw new TypeError('exactly one material audit event is required');
  }
  const audit = requireMaterialAudit(command.auditEvents[0]);
  const nextRevision = Number(record.revision) + 1;
  const source = requireObject(record.source, 'record source');
  if (
    requireId(audit.tenantId, 'audit tenantId') !== record.tenantId
    || requireId(audit.recordId, 'audit recordId') !== record.recordId
    || requireId(audit.actorSubjectId, 'audit actorSubjectId') !== context.actorSubjectId
    || requireId(audit.authorizationId, 'audit authorizationId') !== context.authorizationId
    || String(audit.policyRevision) !== context.policyRevision
    || requireId(audit.sourceId, 'audit sourceId') !== source.sourceId
    || audit.priorRevision !== record.revision
    || audit.newRevision !== nextRevision
  ) {
    throw new TypeError('material audit provenance must match sensitivity change');
  }
  if (!Array.isArray(audit.changedFields)
    || audit.changedFields.length !== 1
    || audit.changedFields[0] !== 'sensitivity') {
    throw new TypeError('material audit changedFields must exactly describe sensitivity');
  }
  const occurredAt = requireCanonicalTimestamp(audit.occurredAt, 'audit occurredAt');
  const recordedAt = requireCanonicalTimestamp(audit.recordedAt, 'audit recordedAt');
  if (occurredAt > recordedAt
    || recordedAt < String(record.updatedAt)
    || recordedAt < String(source.recordedAt)) {
    throw new TypeError('audit chronology cannot predate durable record or source');
  }
  return {
    record: {
      ...record,
      sensitivity: 'public_approved',
      revision: nextRevision,
      updatedAt: recordedAt,
    },
    auditEvents: [structuredClone(audit)],
  };
}

export function archiveWorkRecord(
  contextValue: unknown,
  recordValue: unknown,
  commandValue: unknown,
): { record: UnknownRecord; auditEvents: UnknownRecord[] } {
  const command = requireClosedObject(commandValue, 'archive command', [
    'requestedTenantId', 'expectedRevision', 'recordedAt', 'auditEvents',
  ]);
  authorizeRecordAction(contextValue, {
    action: 'record.archive',
    requestedTenantId: command.requestedTenantId,
  }, recordValue);
  const context = contextValue as TrustedAuthorizationContext;
  const record = validateWorkRecord(recordValue);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== record.revision) {
    throw new TypeError('expected revision must match current revision');
  }
  if (record.lifecycle === 'blocked') {
    throw new TypeError('blocked record must be unblocked before archival');
  }
  if (record.lifecycle === 'archived' || record.lifecycle === 'deleted') {
    throw new TypeError('record lifecycle cannot be archived');
  }
  const recordedAt = requireCanonicalTimestamp(command.recordedAt, 'archive recordedAt');
  if (recordedAt < String(record.updatedAt)) {
    throw new TypeError('archive recordedAt cannot predate record');
  }
  if (!Array.isArray(command.auditEvents) || command.auditEvents.length !== 1) {
    throw new TypeError('exactly one material audit event is required');
  }
  const audit = requireMaterialAudit(command.auditEvents[0]);
  const nextRevision = Number(record.revision) + 1;
  const source = requireObject(record.source, 'record source');
  if (
    requireId(audit.tenantId, 'audit tenantId') !== record.tenantId
    || requireId(audit.recordId, 'audit recordId') !== record.recordId
    || requireId(audit.actorSubjectId, 'audit actorSubjectId') !== context.actorSubjectId
    || requireId(audit.authorizationId, 'audit authorizationId') !== context.authorizationId
    || String(audit.policyRevision) !== context.policyRevision
    || requireId(audit.sourceId, 'audit sourceId') !== source.sourceId
    || audit.priorRevision !== record.revision
    || audit.newRevision !== nextRevision
  ) {
    throw new TypeError('material audit provenance must match archive');
  }
  if (!Array.isArray(audit.changedFields)
    || audit.changedFields.length !== 2
    || audit.changedFields[0] !== 'lifecycle'
    || audit.changedFields[1] !== 'archivedAt') {
    throw new TypeError('material audit changedFields must exactly describe archive');
  }
  if (requireCanonicalTimestamp(audit.occurredAt, 'audit occurredAt') > recordedAt
    || requireCanonicalTimestamp(audit.recordedAt, 'audit recordedAt') !== recordedAt) {
    throw new TypeError('material audit timestamps must match archive');
  }
  return {
    record: {
      ...record,
      lifecycle: 'archived',
      archivedAt: recordedAt,
      stateChangedAt: recordedAt,
      revision: nextRevision,
      updatedAt: recordedAt,
    },
    auditEvents: [structuredClone(audit)],
  };
}

export function tombstoneWorkRecord(
  contextValue: unknown,
  recordValue: unknown,
  commandValue: unknown,
): { record: UnknownRecord; auditEvents: UnknownRecord[] } {
  const command = requireClosedObject(commandValue, 'tombstone command', [
    'requestedTenantId', 'expectedRevision', 'recordedAt', 'auditEvents',
  ]);
  authorizeRecordAction(contextValue, {
    action: 'record.delete',
    requestedTenantId: command.requestedTenantId,
  }, recordValue);
  const context = contextValue as TrustedAuthorizationContext;
  const record = validateWorkRecord(recordValue);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== record.revision) {
    throw new TypeError('expected revision must match current revision');
  }
  if (record.lifecycle !== 'archived' || typeof record.archivedAt !== 'string') {
    throw new TypeError('only an archived record can be tombstoned');
  }
  const recordedAt = requireCanonicalTimestamp(command.recordedAt, 'tombstone recordedAt');
  if (recordedAt < String(record.updatedAt)) {
    throw new TypeError('tombstone recordedAt cannot predate record');
  }
  if (!Array.isArray(command.auditEvents) || command.auditEvents.length !== 1) {
    throw new TypeError('exactly one material audit event is required');
  }
  const audit = requireMaterialAudit(command.auditEvents[0]);
  const nextRevision = Number(record.revision) + 1;
  const source = requireObject(record.source, 'record source');
  if (
    requireId(audit.tenantId, 'audit tenantId') !== record.tenantId
    || requireId(audit.recordId, 'audit recordId') !== record.recordId
    || requireId(audit.actorSubjectId, 'audit actorSubjectId') !== context.actorSubjectId
    || requireId(audit.authorizationId, 'audit authorizationId') !== context.authorizationId
    || String(audit.policyRevision) !== context.policyRevision
    || requireId(audit.sourceId, 'audit sourceId') !== source.sourceId
    || audit.priorRevision !== record.revision
    || audit.newRevision !== nextRevision
  ) {
    throw new TypeError('material audit provenance must match tombstone');
  }
  if (!Array.isArray(audit.changedFields)
    || audit.changedFields.length !== 2
    || audit.changedFields[0] !== 'lifecycle'
    || audit.changedFields[1] !== 'deletedAt') {
    throw new TypeError('material audit changedFields must exactly describe tombstone');
  }
  if (requireCanonicalTimestamp(audit.occurredAt, 'audit occurredAt') > recordedAt
    || requireCanonicalTimestamp(audit.recordedAt, 'audit recordedAt') !== recordedAt) {
    throw new TypeError('material audit timestamps must match tombstone');
  }
  return {
    record: {
      ...record,
      lifecycle: 'deleted',
      deletedAt: recordedAt,
      stateChangedAt: recordedAt,
      revision: nextRevision,
      updatedAt: recordedAt,
    },
    auditEvents: [structuredClone(audit)],
  };
}

export function restoreWorkRecord(
  contextValue: unknown,
  recordValue: unknown,
  commandValue: unknown,
): { record: UnknownRecord; auditEvents: UnknownRecord[] } {
  const command = requireClosedObject(commandValue, 'restore command', [
    'requestedTenantId', 'expectedRevision', 'recordedAt', 'auditEvents',
  ]);
  authorizeRecordAction(contextValue, {
    action: 'record.restore',
    requestedTenantId: command.requestedTenantId,
  }, recordValue);
  const context = contextValue as TrustedAuthorizationContext;
  const record = validateWorkRecord(recordValue);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== record.revision) {
    throw new TypeError('expected revision must match current revision');
  }
  if (record.lifecycle !== 'deleted' || typeof record.deletedAt !== 'string') {
    throw new TypeError('only a tombstoned record can be restored');
  }
  const recordedAt = requireCanonicalTimestamp(command.recordedAt, 'restore recordedAt');
  if (recordedAt < String(record.updatedAt)) {
    throw new TypeError('restore recordedAt cannot predate record');
  }
  if (!Array.isArray(command.auditEvents) || command.auditEvents.length !== 1) {
    throw new TypeError('exactly one material audit event is required');
  }
  const audit = requireMaterialAudit(command.auditEvents[0]);
  const nextRevision = Number(record.revision) + 1;
  const source = requireObject(record.source, 'record source');
  if (
    requireId(audit.tenantId, 'audit tenantId') !== record.tenantId
    || requireId(audit.recordId, 'audit recordId') !== record.recordId
    || requireId(audit.actorSubjectId, 'audit actorSubjectId') !== context.actorSubjectId
    || requireId(audit.authorizationId, 'audit authorizationId') !== context.authorizationId
    || String(audit.policyRevision) !== context.policyRevision
    || requireId(audit.sourceId, 'audit sourceId') !== source.sourceId
    || audit.priorRevision !== record.revision
    || audit.newRevision !== nextRevision
  ) {
    throw new TypeError('material audit provenance must match restore');
  }
  if (!Array.isArray(audit.changedFields)
    || audit.changedFields.length !== 2
    || audit.changedFields[0] !== 'lifecycle'
    || audit.changedFields[1] !== 'deletedAt') {
    throw new TypeError('material audit changedFields must exactly describe restore');
  }
  if (requireCanonicalTimestamp(audit.occurredAt, 'audit occurredAt') > recordedAt
    || requireCanonicalTimestamp(audit.recordedAt, 'audit recordedAt') !== recordedAt) {
    throw new TypeError('material audit timestamps must match restore');
  }
  return {
    record: {
      ...record,
      lifecycle: 'archived',
      deletedAt: null,
      stateChangedAt: recordedAt,
      revision: nextRevision,
      updatedAt: recordedAt,
    },
    auditEvents: [structuredClone(audit)],
  };
}

export function createCorrectionRecord(
  contextValue: unknown,
  originalValue: unknown,
  correctionValue: unknown,
): UnknownRecord {
  const original = validateWorkRecord(originalValue);
  authorizeRecordAction(contextValue, {
    action: 'record.correct',
    requestedTenantId: original.tenantId,
  }, original);
  const correction = validateWorkRecord(correctionValue);
  if (correction.tenantId !== original.tenantId) {
    throw new TypeError('correction tenant must match prior record tenant');
  }
  if (correction.recordId === original.recordId) {
    throw new TypeError('correction requires a new stable recordId');
  }
  if (correction.revision !== 1) {
    throw new TypeError('correction must begin at revision 1');
  }
  const link = requireObject(correction.correctionOf, 'correctionOf');
  if (requireId(link.tenantId, 'correctionOf tenantId') !== original.tenantId
    || requireId(link.recordId, 'correctionOf recordId') !== original.recordId) {
    throw new TypeError('correctionOf must identify the prior same-tenant record');
  }
  return structuredClone(correction);
}

export function createSupersedingRecord(
  contextValue: unknown,
  originalValue: unknown,
  replacementValue: unknown,
): UnknownRecord {
  const original = validateWorkRecord(originalValue);
  authorizeRecordAction(contextValue, {
    action: 'record.supersede',
    requestedTenantId: original.tenantId,
  }, original);
  const replacement = validateWorkRecord(replacementValue);
  if (replacement.tenantId !== original.tenantId) {
    throw new TypeError('replacement tenant must match prior record tenant');
  }
  if (replacement.recordId === original.recordId) {
    throw new TypeError('supersession requires a new stable recordId');
  }
  if (replacement.revision !== 1) {
    throw new TypeError('superseding record must begin at revision 1');
  }
  const link = requireObject(replacement.supersedes, 'supersedes');
  if (requireId(link.tenantId, 'supersedes tenantId') !== original.tenantId
    || requireId(link.recordId, 'supersedes recordId') !== original.recordId) {
    throw new TypeError('supersedes must identify the prior same-tenant record');
  }
  return structuredClone(replacement);
}
