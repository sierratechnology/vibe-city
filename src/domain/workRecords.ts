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

export function validateWorkRecord(input: unknown): UnknownRecord {
  const record = requireClosedObject(input, 'work record', [
    'tenantId', 'recordId', 'title', 'owner', 'assignees', 'lifecycle', 'freshness',
    'sensitivity', 'revision', 'createdAt', 'updatedAt', 'source', 'evidence',
    'supersedes', 'correctionOf', 'archivedAt', 'deletedAt',
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
  if (!['open', 'in_progress', 'completed', 'archived', 'deleted'].includes(record.lifecycle as string)) {
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
    if (typeof evidence.locator !== 'string'
      || !/^urn:stg:evidence:[a-z0-9][a-z0-9._:/-]{0,200}$/.test(evidence.locator)) {
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
    'supersedes', 'correctionOf', 'archivedAt', 'deletedAt',
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
    'record.create', 'record.read',
    'record.transition', 'record.sensitivity.change', 'record.archive', 'record.delete',
    'record.restore', 'record.correct', 'record.supersede',
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
