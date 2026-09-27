import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = new URL('../src/domain/workRecords.ts', import.meta.url);

async function loadDomain() {
  let source;
  try {
    source = await readFile(moduleUrl, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }

  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const IDS = Object.freeze({
  tenant: 'id_1111111111111111',
  otherTenant: 'id_2222222222222222',
  record: 'id_3333333333333333',
  owner: 'id_4444444444444444',
  source: 'id_5555555555555555',
  evidence: 'id_6666666666666666',
});

function recordFixture(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    recordId: IDS.record,
    title: 'Synthetic fixture record',
    owner: { tenantId: IDS.tenant, subjectId: IDS.owner },
    assignees: [],
    lifecycle: 'open',
    freshness: 'unknown',
    sensitivity: 'tenant_private',
    revision: 1,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    source: {
      tenantId: IDS.tenant,
      sourceId: IDS.source,
      occurredAt: '2026-09-26T11:58:00.000Z',
      observedAt: '2026-09-26T11:59:00.000Z',
      recordedAt: '2026-09-26T12:00:00.000Z',
    },
    evidence: [{
      tenantId: IDS.tenant,
      evidenceId: IDS.evidence,
      locator: 'urn:stg:evidence:synthetic-fixture',
      recordedAt: '2026-09-26T12:00:00.000Z',
    }],
    supersedes: null,
    correctionOf: null,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function traceFixture(overrides = {}) {
  const source = {
    tenantId: IDS.tenant,
    sourceId: IDS.source,
    sourceRecordId: 'synthetic-direction-1',
    sourceEventId: 'synthetic-event-1',
    contractVersion: '1.0',
    occurredAt: '2026-09-26T11:58:00.000Z',
    observedAt: '2026-09-26T11:59:00.000Z',
  };
  const subject = (subjectId) => ({ tenantId: IDS.tenant, subjectId });
  return {
    tenantId: IDS.tenant,
    recordId: IDS.record,
    direction: {
      tenantId: IDS.tenant, directionId: 'id_a111111111111111',
      directingSubject: subject(IDS.owner), source,
      occurredAt: source.occurredAt, sensitivity: 'tenant_private',
    },
    authorization: {
      tenantId: IDS.tenant, authorizationId: 'id_a222222222222222',
      directionId: 'id_a111111111111111', action: 'assign', scope: IDS.record,
      authorizer: subject(IDS.owner), beneficiary: subject('id_a333333333333333'),
      constraints: ['synthetic-only'], policyRevision: 1, effectiveAt: source.observedAt,
    },
    assignment: {
      tenantId: IDS.tenant, recordId: IDS.record,
      authorizationId: 'id_a222222222222222', owner: subject(IDS.owner),
      assignees: [subject('id_a333333333333333')], acceptedRevision: 1, source,
      occurredAt: '2026-09-26T12:00:00.000Z',
    },
    activities: [{
      tenantId: IDS.tenant, recordId: IDS.record, activityId: 'id_a444444444444444',
      actor: subject('id_a333333333333333'), source, eventKind: 'work_performed',
      occurredAt: source.occurredAt, observedAt: source.observedAt,
      recordedAt: '2026-09-26T12:00:00.000Z',
    }],
    evidence: [{
      tenantId: IDS.tenant, evidenceId: 'id_a555555555555555', relation: 'result',
      activityId: 'id_a444444444444444',
      locator: 'urn:stg:evidence:synthetic-result', label: 'Synthetic result',
      sensitivity: 'tenant_private', integrity: null, sourceOccurredAt: source.occurredAt,
      observedAt: source.observedAt, recordedAt: '2026-09-26T12:00:00.000Z',
      availability: 'available',
    }],
    outcome: {
      tenantId: IDS.tenant, recordId: IDS.record, outcomeId: 'id_a666666666666666',
      acceptanceActor: subject(IDS.owner), acceptanceAuthorizationId: 'id_a222222222222222',
      requiredEvidenceIds: ['id_a555555555555555'], acceptedAt: '2026-09-26T12:01:00.000Z',
    },
    ...overrides,
  };
}

test('trace chronology rejects activity before authorization becomes effective', async () => {
  const domain = await loadDomain();
  const trace = traceFixture();

  assert.deepEqual(domain.validateTraceBundle(trace), {
    ok: false, code: 'invalid_activity_chronology',
  });
});

test('trace chronology rejects activity after authorization but before assignment', async () => {
  const domain = await loadDomain();
  const trace = traceFixture();
  trace.activities[0] = {
    ...trace.activities[0],
    occurredAt: '2026-09-26T11:59:30.000Z',
    observedAt: '2026-09-26T11:59:45.000Z',
  };

  assert.deepEqual(domain.validateTraceBundle(trace), {
    ok: false, code: 'invalid_activity_chronology',
  });
});

test('work record validation rejects missing or mismatched tenant', async () => {
  const domain = await loadDomain();

  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ tenantId: undefined })),
    { message: /tenant/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ recordId: 'record-3' })),
    { message: /recordId/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      owner: { tenantId: IDS.otherTenant, subjectId: IDS.owner },
    })),
    { message: /owner.*tenant/i },
  );
});

test('authorization rejects client-asserted tenant', async () => {
  const domain = await loadDomain();
  const record = recordFixture();
  const trusted = domain.createTrustedAuthorizationContext?.({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.transition'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });

  assert.equal(
    domain.authorizeRecordAction?.(trusted, {
      action: 'record.transition',
      requestedTenantId: IDS.tenant,
    }, record),
    true,
  );
  assert.throws(
    () => domain.authorizeRecordAction?.({ ...trusted }, {
      action: 'record.transition',
      requestedTenantId: IDS.tenant,
    }, record),
    { message: /trusted/i },
  );

  const inactive = domain.createTrustedAuthorizationContext?.({
    authorizationId: 'id_8888888888888888',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'inactive', role: 'member' }],
    permissions: ['record.transition'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  assert.throws(
    () => domain.authorizeRecordAction?.(inactive, {
      action: 'record.transition',
      requestedTenantId: IDS.tenant,
    }, record),
    { message: /active membership/i },
  );
});

test('authorized state transition returns one revised record', async () => {
  const domain = await loadDomain();
  const original = recordFixture();
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.transition'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const audit = {
    auditId: 'id_9999999999999999',
    tenantId: IDS.tenant,
    recordId: IDS.record,
    actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777',
    policyRevision: 'policy-1',
    sourceId: IDS.source,
    priorRevision: 1,
    newRevision: 2,
    occurredAt: '2026-09-26T12:01:00.000Z',
    recordedAt: '2026-09-26T12:02:00.000Z',
    changedFields: ['lifecycle'],
  };

  const result = domain.transitionWorkRecord?.(context, original, {
    requestedTenantId: IDS.tenant,
    expectedRevision: 1,
    toLifecycle: 'in_progress',
    auditEvents: [audit],
  });

  assert.equal(result.record.lifecycle, 'in_progress');
  assert.equal(result.record.revision, 2);
  assert.deepEqual(result.auditEvents, [audit]);
  assert.equal(original.lifecycle, 'open');
  assert.equal(original.revision, 1);
  assert.throws(
    () => domain.transitionWorkRecord(context, original, {
      requestedTenantId: IDS.tenant,
      expectedRevision: 2,
      toLifecycle: 'in_progress',
      auditEvents: [audit],
    }),
    { message: /revision/i },
  );
});

test('publication-authorized sensitivity downgrade', async () => {
  const domain = await loadDomain();
  const { sensitivity: _omitted, ...withoutSensitivity } = recordFixture();
  const privateRecord = domain.createWorkRecord?.(withoutSensitivity);
  assert.equal(privateRecord.sensitivity, 'tenant_private');

  const baseFacts = {
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.sensitivity.change'],
    policyRevision: 'policy-1',
  };
  const audit = {
    auditId: 'id_aaaaaaaaaaaaaaaa',
    tenantId: IDS.tenant,
    recordId: IDS.record,
    actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777',
    policyRevision: 'policy-1',
    sourceId: IDS.source,
    priorRevision: 1,
    newRevision: 2,
    occurredAt: '2026-09-26T12:01:00.000Z',
    recordedAt: '2026-09-26T12:02:00.000Z',
    changedFields: ['sensitivity'],
  };
  const command = {
    requestedTenantId: IDS.tenant,
    expectedRevision: 1,
    toSensitivity: 'public_approved',
    auditEvents: [audit],
  };

  const permissionOnly = domain.createTrustedAuthorizationContext({
    ...baseFacts,
    decisionAuthorities: [],
  });
  assert.throws(
    () => domain.changeRecordSensitivity?.(permissionOnly, privateRecord, command),
    { message: /publication decision authority/i },
  );

  const authorized = domain.createTrustedAuthorizationContext({
    ...baseFacts,
    decisionAuthorities: ['publication.approve'],
  });
  const result = domain.changeRecordSensitivity?.(authorized, privateRecord, command);
  assert.equal(result.record.sensitivity, 'public_approved');
  assert.equal(result.record.revision, 2);
  assert.equal(result.record.publishedAt, undefined);
  assert.equal(privateRecord.sensitivity, 'tenant_private');
});

test('freshness is derived from exact trusted source health facts', async () => {
  const domain = await loadDomain();
  const record = recordFixture();
  assert.throws(
    () => domain.validateWorkRecord(recordFixture({
      source: {
        ...record.source,
        occurredAt: '2026-09-26T12:01:00.000Z',
        observedAt: '2026-09-26T12:00:00.000Z',
      },
    })),
    { message: /source chronology/i },
  );

  const health = domain.createTrustedSourceHealthFact?.({
    tenantId: IDS.tenant,
    sourceId: IDS.source,
    status: 'healthy',
    checkedAt: '2026-09-26T12:03:00.000Z',
  });
  const refreshed = domain.deriveRecordFreshness?.(record, health);
  assert.equal(refreshed.freshness, 'fresh');
  assert.equal(refreshed.lifecycle, 'open');
  assert.equal(record.freshness, 'unknown');
  assert.throws(
    () => domain.deriveRecordFreshness?.(record, { ...health }),
    { message: /trusted source health/i },
  );
});

test('tenant rename changes only mutable identity facts', async () => {
  const domain = await loadDomain();
  const original = {
    tenantId: IDS.tenant,
    displayName: 'Synthetic Tenant',
    revision: 1,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
  };

  const renamed = domain.renameTenantIdentity?.(original, {
    expectedRevision: 1,
    displayName: 'Renamed Synthetic Tenant',
    recordedAt: '2026-09-26T12:04:00.000Z',
  });

  assert.equal(renamed.tenantId, IDS.tenant);
  assert.equal(renamed.displayName, 'Renamed Synthetic Tenant');
  assert.equal(renamed.revision, 2);
  assert.equal(renamed.createdAt, original.createdAt);
  assert.equal(original.displayName, 'Synthetic Tenant');
});

test('archive preserves prior record facts in a detached revision', async () => {
  const domain = await loadDomain();
  const original = recordFixture();
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.archive'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const recordedAt = '2026-09-26T12:05:00.000Z';
  const audit = {
    auditId: 'id_bbbbbbbbbbbbbbbb',
    tenantId: IDS.tenant,
    recordId: IDS.record,
    actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777',
    policyRevision: 'policy-1',
    sourceId: IDS.source,
    priorRevision: 1,
    newRevision: 2,
    occurredAt: recordedAt,
    recordedAt,
    changedFields: ['lifecycle', 'archivedAt'],
  };

  const result = domain.archiveWorkRecord?.(context, original, {
    requestedTenantId: IDS.tenant,
    expectedRevision: 1,
    recordedAt,
    auditEvents: [audit],
  });

  assert.equal(result.record.recordId, original.recordId);
  assert.equal(result.record.title, original.title);
  assert.equal(result.record.lifecycle, 'archived');
  assert.equal(result.record.archivedAt, recordedAt);
  assert.equal(result.record.revision, 2);
  assert.equal(original.lifecycle, 'open');
  assert.equal(original.archivedAt, null);
});

test('tombstone deletion preserves the archived historical revision', async () => {
  const domain = await loadDomain();
  const archived = recordFixture({
    lifecycle: 'archived',
    revision: 2,
    archivedAt: '2026-09-26T12:05:00.000Z',
    updatedAt: '2026-09-26T12:05:00.000Z',
  });
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.delete'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const recordedAt = '2026-09-26T12:06:00.000Z';
  const audit = {
    auditId: 'id_cccccccccccccccc',
    tenantId: IDS.tenant,
    recordId: IDS.record,
    actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777',
    policyRevision: 'policy-1',
    sourceId: IDS.source,
    priorRevision: 2,
    newRevision: 3,
    occurredAt: recordedAt,
    recordedAt,
    changedFields: ['lifecycle', 'deletedAt'],
  };

  const result = domain.tombstoneWorkRecord?.(context, archived, {
    requestedTenantId: IDS.tenant,
    expectedRevision: 2,
    recordedAt,
    auditEvents: [audit],
  });

  assert.equal(result.record.recordId, archived.recordId);
  assert.equal(result.record.lifecycle, 'deleted');
  assert.equal(result.record.deletedAt, recordedAt);
  assert.equal(result.record.revision, 3);
  assert.equal(archived.lifecycle, 'archived');
  assert.equal(archived.deletedAt, null);
});

test('restore appends a revision without erasing tombstone history', async () => {
  const domain = await loadDomain();
  const deletedAt = '2026-09-26T12:06:00.000Z';
  const tombstone = recordFixture({
    lifecycle: 'deleted',
    revision: 3,
    archivedAt: '2026-09-26T12:05:00.000Z',
    deletedAt,
    updatedAt: deletedAt,
  });
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.restore'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const recordedAt = '2026-09-26T12:07:00.000Z';
  const audit = {
    auditId: 'id_dddddddddddddddd',
    tenantId: IDS.tenant,
    recordId: IDS.record,
    actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777',
    policyRevision: 'policy-1',
    sourceId: IDS.source,
    priorRevision: 3,
    newRevision: 4,
    occurredAt: recordedAt,
    recordedAt,
    changedFields: ['lifecycle', 'deletedAt'],
  };

  const result = domain.restoreWorkRecord?.(context, tombstone, {
    requestedTenantId: IDS.tenant,
    expectedRevision: 3,
    recordedAt,
    auditEvents: [audit],
  });

  assert.equal(result.record.lifecycle, 'archived');
  assert.equal(result.record.deletedAt, null);
  assert.equal(result.record.archivedAt, tombstone.archivedAt);
  assert.equal(result.record.revision, 4);
  assert.equal(tombstone.lifecycle, 'deleted');
  assert.equal(tombstone.deletedAt, deletedAt);
});

test('correction creates a linked record without rewriting prior facts', async () => {
  const domain = await loadDomain();
  const original = recordFixture();
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.correct'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const correction = recordFixture({
    recordId: 'id_eeeeeeeeeeeeeeee',
    title: 'Corrected synthetic fixture record',
    correctionOf: { tenantId: IDS.tenant, recordId: IDS.record },
  });

  const result = domain.createCorrectionRecord?.(context, original, correction);

  assert.equal(result.recordId, 'id_eeeeeeeeeeeeeeee');
  assert.deepEqual(result.correctionOf, {
    tenantId: IDS.tenant,
    recordId: IDS.record,
  });
  assert.equal(original.title, 'Synthetic fixture record');
  assert.equal(original.correctionOf, null);
  assert.notEqual(result, correction);
});

test('supersession creates a same-tenant link without rewriting prior facts', async () => {
  const domain = await loadDomain();
  const original = recordFixture();
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.supersede'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const replacement = recordFixture({
    recordId: 'id_ffffffffffffffff',
    title: 'Replacement synthetic fixture record',
    supersedes: { tenantId: IDS.tenant, recordId: IDS.record },
  });

  const result = domain.createSupersedingRecord?.(context, original, replacement);

  assert.equal(result.recordId, 'id_ffffffffffffffff');
  assert.deepEqual(result.supersedes, {
    tenantId: IDS.tenant,
    recordId: IDS.record,
  });
  assert.equal(original.supersedes, null);
  assert.throws(
    () => domain.createSupersedingRecord?.(context, original, {
      ...replacement,
      supersedes: { tenantId: IDS.otherTenant, recordId: IDS.record },
    }),
    { message: /same-tenant/i },
  );
});

test('closed schemas reject unknown and inherited keys', async () => {
  const domain = await loadDomain();
  assert.throws(
    () => domain.validateWorkRecord?.({ ...recordFixture(), clientRole: 'admin' }),
    { message: /unknown.*clientRole/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.({
      ...recordFixture(),
      owner: { ...recordFixture().owner, permission: 'all' },
    }),
    { message: /unknown.*permission/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(Object.create(recordFixture())),
    { message: /plain own-key object/i },
  );
  assert.throws(
    () => domain.createTrustedAuthorizationContext?.({
      authorizationId: 'id_7777777777777777',
      actorSubjectId: IDS.owner,
      authenticated: true,
      memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
      permissions: ['record.transition'],
      decisionAuthorities: [],
      policyRevision: 'policy-1',
      clientProvenance: 'trusted',
    }),
    { message: /unknown.*clientProvenance/i },
  );
});

test('record validation enforces bounded deduplicated nested values', async () => {
  const domain = await loadDomain();
  const assignee = { tenantId: IDS.tenant, subjectId: 'id_abababababababab' };
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ assignees: [assignee, assignee] })),
    { message: /duplicate assignee/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      evidence: [{
        ...recordFixture().evidence[0],
        tenantId: IDS.otherTenant,
      }],
    })),
    { message: /evidence.*tenant/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      evidence: [{
        ...recordFixture().evidence[0],
        locator: 'https://example.invalid/private',
      }],
    })),
    { message: /safe evidence locator/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ title: 'x'.repeat(241) })),
    { message: /title.*bounded/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      evidence: [{
        ...recordFixture().evidence[0],
        evidenceId: 'evidence-6',
      }],
    })),
    { message: /evidenceId/i },
  );
});

test('record validation rejects noncanonical scalar and chronology states', async () => {
  const domain = await loadDomain();
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      createdAt: '2026-09-26T12:00:00Z',
    })),
    { message: /createdAt.*canonical UTC/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      createdAt: '2026-09-26T12:01:00.000Z',
      updatedAt: '2026-09-26T12:00:00.000Z',
    })),
    { message: /record chronology/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ lifecycle: 'working' })),
    { message: /lifecycle/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ revision: 0 })),
    { message: /revision/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      supersedes: { tenantId: IDS.otherTenant, recordId: 'id_ffffffffffffffff' },
    })),
    { message: /supersedes.*tenant/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      evidence: [{
        ...recordFixture().evidence[0],
        recordedAt: '2026-09-26T12:01:00.000Z',
      }],
    })),
    { message: /evidence chronology/i },
  );
});

test('material audit rejects incomplete or client-shaped provenance', async () => {
  const domain = await loadDomain();
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.transition'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });
  const audit = {
    auditId: 'id_9999999999999999',
    tenantId: IDS.tenant,
    recordId: IDS.record,
    actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777',
    policyRevision: 'policy-1',
    sourceId: IDS.source,
    priorRevision: 1,
    newRevision: 2,
    occurredAt: '2026-09-26T12:01:00.000Z',
    recordedAt: '2026-09-26T12:02:00.000Z',
    changedFields: ['lifecycle'],
  };
  const transition = (auditEvent) => domain.transitionWorkRecord?.(context, recordFixture(), {
    requestedTenantId: IDS.tenant,
    expectedRevision: 1,
    toLifecycle: 'in_progress',
    auditEvents: [auditEvent],
  });

  assert.throws(
    () => transition({ ...audit, auditId: 'audit-9' }),
    { message: /auditId/i },
  );
  assert.throws(
    () => transition({ ...audit, clientRole: 'admin' }),
    { message: /unknown.*clientRole/i },
  );
  assert.throws(
    () => transition({ ...audit, authorizationId: 'id_8888888888888888' }),
    { message: /audit provenance/i },
  );
});

test('trusted authorization facts are bounded and canonical', async () => {
  const domain = await loadDomain();
  const facts = {
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.transition'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  };
  assert.throws(
    () => domain.createTrustedAuthorizationContext?.({ ...facts, authenticated: 'true' }),
    { message: /authenticated.*boolean/i },
  );
  assert.throws(
    () => domain.createTrustedAuthorizationContext?.({
      ...facts,
      memberships: [facts.memberships[0], facts.memberships[0]],
    }),
    { message: /duplicate membership/i },
  );
  assert.throws(
    () => domain.createTrustedAuthorizationContext?.({
      ...facts,
      permissions: ['record.transition', 'record.transition'],
    }),
    { message: /duplicate permission/i },
  );
  assert.throws(
    () => domain.createTrustedAuthorizationContext?.({
      ...facts,
      permissions: ['*'],
    }),
    { message: /permission.*invalid/i },
  );
});

test('authorization request rejects client-asserted authority claims', async () => {
  const domain = await loadDomain();
  const context = domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777',
    actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.transition'],
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  });

  assert.throws(
    () => domain.authorizeRecordAction?.(context, {
      action: 'record.transition',
      requestedTenantId: IDS.tenant,
      role: 'owner',
    }, recordFixture()),
    { message: /unknown.*role/i },
  );
});

test('lifecycle timestamps must match lifecycle chronology', async () => {
  const domain = await loadDomain();
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({ lifecycle: 'archived' })),
    { message: /archivedAt.*required/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      lifecycle: 'deleted', archivedAt: '2026-09-26T12:02:00.000Z',
    })),
    { message: /deletedAt.*required/i },
  );
  assert.throws(
    () => domain.validateWorkRecord?.(recordFixture({
      lifecycle: 'deleted',
      archivedAt: '2026-09-26T12:02:00.000Z',
      deletedAt: '2026-09-26T12:01:00.000Z',
      updatedAt: '2026-09-26T12:02:00.000Z',
    })),
    { message: /lifecycle chronology/i },
  );
});

test('replay item 10 rejects unknown own keys on trusted source-health facts', async () => {
  const domain = await loadDomain();
  assert.throws(
    () => domain.createTrustedSourceHealthFact({
      tenantId: IDS.tenant,
      sourceId: IDS.source,
      status: 'healthy',
      checkedAt: '2026-09-26T12:03:00.000Z',
      clientAuthority: 'trusted',
    }),
    { message: /unknown.*clientAuthority/i },
  );
});

test('replay item 10 rejects inherited trusted source-health facts', async () => {
  const domain = await loadDomain();
  const facts = Object.assign(Object.create({ clientAuthority: 'trusted' }), {
    tenantId: IDS.tenant,
    sourceId: IDS.source,
    status: 'healthy',
    checkedAt: '2026-09-26T12:03:00.000Z',
  });
  assert.throws(
    () => domain.createTrustedSourceHealthFact(facts),
    { message: /plain own-key object/i },
  );
});

test('replay item 11 rejects unknown own keys on tenant identity', async () => {
  const domain = await loadDomain();
  assert.throws(
    () => domain.renameTenantIdentity({
      tenantId: IDS.tenant,
      displayName: 'Synthetic Tenant',
      revision: 1,
      createdAt: '2026-09-26T12:00:00.000Z',
      updatedAt: '2026-09-26T12:00:00.000Z',
      clientRole: 'owner',
    }, {
      expectedRevision: 1,
      displayName: 'Renamed Tenant',
      recordedAt: '2026-09-26T12:04:00.000Z',
    }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 11 rejects inherited tenant identity', async () => {
  const domain = await loadDomain();
  const identity = Object.assign(Object.create({ clientRole: 'owner' }), {
    tenantId: IDS.tenant,
    displayName: 'Synthetic Tenant',
    revision: 1,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
  });
  assert.throws(
    () => domain.renameTenantIdentity(identity, {
      expectedRevision: 1,
      displayName: 'Renamed Tenant',
      recordedAt: '2026-09-26T12:04:00.000Z',
    }),
    { message: /plain own-key object/i },
  );
});

function tenantIdentityFixture() {
  return {
    tenantId: IDS.tenant, displayName: 'Synthetic Tenant', revision: 1,
    createdAt: '2026-09-26T12:00:00.000Z', updatedAt: '2026-09-26T12:00:00.000Z',
  };
}

function renameCommandFixture() {
  return {
    expectedRevision: 1, displayName: 'Renamed Tenant',
    recordedAt: '2026-09-26T12:04:00.000Z',
  };
}

test('replay item 12 rejects unknown own keys on tenant rename command', async () => {
  const domain = await loadDomain();
  assert.throws(
    () => domain.renameTenantIdentity(tenantIdentityFixture(), {
      ...renameCommandFixture(), clientRole: 'owner',
    }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 12 rejects inherited tenant rename command', async () => {
  const domain = await loadDomain();
  const command = Object.assign(Object.create({ clientRole: 'owner' }), renameCommandFixture());
  assert.throws(
    () => domain.renameTenantIdentity(tenantIdentityFixture(), command),
    { message: /plain own-key object/i },
  );
});

test('replay item 13 rejects inherited create-record input before private defaulting', async () => {
  const domain = await loadDomain();
  const { sensitivity: _omitted, ...privateByDefault } = recordFixture();
  const input = Object.assign(Object.create({ clientRole: 'owner' }), privateByDefault);
  assert.throws(
    () => domain.createWorkRecord(input),
    { message: /plain own-key object/i },
  );
});

function trustedContextFor(domain, permission, decisionAuthorities = []) {
  return domain.createTrustedAuthorizationContext({
    authorizationId: 'id_7777777777777777', actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: [permission], decisionAuthorities, policyRevision: 'policy-1',
  });
}

function mutationBoundary(domain, family) {
  const spec = {
    transition: ['record.transition', 'transitionWorkRecord', recordFixture(), 1, 2,
      '2026-09-26T12:02:00.000Z', ['lifecycle'], { toLifecycle: 'in_progress' }],
    sensitivity: ['record.sensitivity.change', 'changeRecordSensitivity', recordFixture(), 1, 2,
      '2026-09-26T12:02:00.000Z', ['sensitivity'], { toSensitivity: 'public_approved' }],
    archive: ['record.archive', 'archiveWorkRecord', recordFixture(), 1, 2,
      '2026-09-26T12:05:00.000Z', ['lifecycle', 'archivedAt'], {}],
    tombstone: ['record.delete', 'tombstoneWorkRecord', recordFixture({
      lifecycle: 'archived', revision: 2, archivedAt: '2026-09-26T12:05:00.000Z',
      updatedAt: '2026-09-26T12:05:00.000Z',
    }), 2, 3, '2026-09-26T12:06:00.000Z', ['lifecycle', 'deletedAt'], {}],
    restore: ['record.restore', 'restoreWorkRecord', recordFixture({
      lifecycle: 'deleted', revision: 3, archivedAt: '2026-09-26T12:05:00.000Z',
      deletedAt: '2026-09-26T12:06:00.000Z', updatedAt: '2026-09-26T12:06:00.000Z',
    }), 3, 4, '2026-09-26T12:07:00.000Z', ['lifecycle', 'deletedAt'], {}],
  }[family];
  const [permission, method, record, priorRevision, newRevision, recordedAt, changedFields, extra] = spec;
  const context = trustedContextFor(
    domain, permission, family === 'sensitivity' ? ['publication.approve'] : [],
  );
  const audit = {
    auditId: `id_${String(newRevision).repeat(16)}`, tenantId: IDS.tenant,
    recordId: IDS.record, actorSubjectId: IDS.owner,
    authorizationId: 'id_7777777777777777', policyRevision: 'policy-1',
    sourceId: IDS.source, priorRevision, newRevision,
    occurredAt: recordedAt, recordedAt, changedFields,
  };
  const command = {
    requestedTenantId: IDS.tenant, expectedRevision: priorRevision,
    ...(family === 'archive' || family === 'tombstone' || family === 'restore'
      ? { recordedAt } : {}),
    ...extra, auditEvents: [audit],
  };
  return { command, invoke: (candidate) => domain[method](context, record, candidate) };
}

test('replay item 14 rejects unknown own keys on transition command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'transition');
  assert.throws(
    () => boundary.invoke({ ...boundary.command, clientRole: 'owner' }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 14 rejects inherited transition command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'transition');
  const command = Object.assign(Object.create({ clientRole: 'owner' }), boundary.command);
  assert.throws(() => boundary.invoke(command), { message: /plain own-key object/i });
});

test('replay item 15 rejects unknown own keys on sensitivity command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'sensitivity');
  assert.throws(
    () => boundary.invoke({ ...boundary.command, clientRole: 'owner' }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 15 rejects inherited sensitivity command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'sensitivity');
  const command = Object.assign(Object.create({ clientRole: 'owner' }), boundary.command);
  assert.throws(() => boundary.invoke(command), { message: /plain own-key object/i });
});

test('replay item 16 rejects unknown own keys on archive command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'archive');
  assert.throws(
    () => boundary.invoke({ ...boundary.command, clientRole: 'owner' }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 16 rejects inherited archive command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'archive');
  const command = Object.assign(Object.create({ clientRole: 'owner' }), boundary.command);
  assert.throws(() => boundary.invoke(command), { message: /plain own-key object/i });
});

test('replay item 17 rejects unknown own keys on tombstone command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'tombstone');
  assert.throws(
    () => boundary.invoke({ ...boundary.command, clientRole: 'owner' }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 17 rejects inherited tombstone command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'tombstone');
  const command = Object.assign(Object.create({ clientRole: 'owner' }), boundary.command);
  assert.throws(() => boundary.invoke(command), { message: /plain own-key object/i });
});

test('replay item 18 rejects unknown own keys on restore command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'restore');
  assert.throws(
    () => boundary.invoke({ ...boundary.command, clientRole: 'owner' }),
    { message: /unknown.*clientRole/i },
  );
});

test('replay item 18 rejects inherited restore command', async () => {
  const boundary = mutationBoundary(await loadDomain(), 'restore');
  const command = Object.assign(Object.create({ clientRole: 'owner' }), boundary.command);
  assert.throws(() => boundary.invoke(command), { message: /plain own-key object/i });
});

test('allowed-key accessors are rejected without invocation across closed boundaries', async (t) => {
  const domain = await loadDomain();
  const authorizationFacts = () => ({
    authorizationId: 'id_7777777777777777', actorSubjectId: IDS.owner,
    authenticated: true,
    memberships: [{ tenantId: IDS.tenant, status: 'active', role: 'member' }],
    permissions: ['record.transition'], decisionAuthorities: [], policyRevision: 'policy-1',
  });
  const boundaries = [
    ['record', () => recordFixture(), 'title', (value) => domain.validateWorkRecord(value)],
    ['authorization facts', authorizationFacts, 'policyRevision',
      (value) => domain.createTrustedAuthorizationContext(value)],
    ['source-health facts', () => ({
      tenantId: IDS.tenant, sourceId: IDS.source, status: 'healthy',
      checkedAt: '2026-09-26T12:03:00.000Z',
    }), 'status', (value) => domain.createTrustedSourceHealthFact(value)],
    ['owner', () => recordFixture().owner, 'subjectId', (value) => domain.validateWorkRecord(
      recordFixture({ owner: value }),
    )],
    ['source', () => recordFixture().source, 'sourceId', (value) => domain.validateWorkRecord(
      recordFixture({ source: value }),
    )],
    ['evidence', () => recordFixture().evidence[0], 'locator',
      (value) => domain.validateWorkRecord(recordFixture({ evidence: [value] }))],
    ['membership', () => authorizationFacts().memberships[0], 'role', (value) => {
      const facts = authorizationFacts();
      return domain.createTrustedAuthorizationContext({ ...facts, memberships: [value] });
    }],
    ['tenant identity', tenantIdentityFixture, 'displayName',
      (value) => domain.renameTenantIdentity(value, renameCommandFixture())],
    ...['transition', 'sensitivity', 'archive', 'tombstone', 'restore'].map((family) => {
      const boundary = mutationBoundary(domain, family);
      const key = family === 'transition' ? 'toLifecycle'
        : family === 'sensitivity' ? 'toSensitivity' : 'recordedAt';
      return [`${family} command`, () => structuredClone(boundary.command), key, boundary.invoke];
    }),
  ];
  {
    const boundary = mutationBoundary(domain, 'transition');
    boundaries.push(['audit event', () => structuredClone(boundary.command.auditEvents[0]),
      'changedFields', (value) => boundary.invoke({ ...boundary.command, auditEvents: [value] })]);
  }

  for (const [label, makeValue, key, invoke] of boundaries) {
    for (const kind of ['getter', 'setter']) {
      await t.test(`${label} ${kind}`, () => {
        const value = makeValue();
        const original = value[key];
        let hits = 0;
        Object.defineProperty(value, key, kind === 'getter'
          ? { enumerable: true, get() { hits += 1; return original; } }
          : { enumerable: true, set() { hits += 1; } });
        let thrown;
        try {
          invoke(value);
        } catch (error) {
          thrown = error;
        }
        assert.equal(hits, 0, `${label} ${kind} invocation count`);
        assert.match(thrown?.message ?? '', /data propert/i);
      });
    }
  }
});

test('create-record setter descriptor is rejected before private defaulting', async () => {
  const domain = await loadDomain();
  const input = recordFixture();
  let hits = 0;
  Object.defineProperty(input, 'sensitivity', {
    enumerable: true, set() { hits += 1; },
  });
  assert.throws(() => domain.createWorkRecord(input), { message: /data propert/i });
  assert.equal(hits, 0);
});

test('accepted replay scalars and lifecycle states fail closed', async (t) => {
  const domain = await loadDomain();
  const cases = [
    ['item 1 boxed lifecycle', () => domain.validateWorkRecord(
      recordFixture({ lifecycle: new String('open') }))],
    ['item 2 boxed freshness', () => domain.validateWorkRecord(
      recordFixture({ freshness: new String('unknown') }))],
    ['item 3 boxed sensitivity', () => domain.validateWorkRecord(
      recordFixture({ sensitivity: new String('tenant_private') }))],
    ['item 4 boxed membership role', () => domain.createTrustedAuthorizationContext({
      authorizationId: 'id_7777777777777777', actorSubjectId: IDS.owner, authenticated: true,
      memberships: [{ tenantId: IDS.tenant, status: 'active', role: new String('member') }],
      permissions: ['record.transition'], decisionAuthorities: [], policyRevision: 'policy-1',
    })],
    ['item 5 boxed action', () => domain.authorizeRecordAction(
      trustedContextFor(domain, 'record.transition'),
      { action: new String('record.transition'), requestedTenantId: IDS.tenant }, recordFixture())],
    ['item 6 boxed transition target', () => {
      const boundary = mutationBoundary(domain, 'transition');
      boundary.invoke({ ...boundary.command, toLifecycle: new String('in_progress') });
    }],
    ...['open', 'in_progress', 'completed'].map((lifecycle) => [
      `item 8 ${lifecycle} archivedAt`, () => domain.validateWorkRecord(recordFixture({
        lifecycle, archivedAt: '2026-09-26T12:00:00.000Z',
      })),
    ]),
    ['item 9 open deletedAt', () => domain.validateWorkRecord(recordFixture({
      deletedAt: '2026-09-26T12:00:00.000Z',
    }))],
    ['item 9 archived deletedAt', () => domain.validateWorkRecord(recordFixture({
      lifecycle: 'archived', archivedAt: '2026-09-26T12:00:00.000Z',
      deletedAt: '2026-09-26T12:00:00.000Z',
    }))],
  ];
  for (const [label, invoke] of cases) {
    await t.test(label, () => assert.throws(invoke));
  }
});

test('replay item 7 boxed sensitivity target is unchanged characterization', async () => {
  const domain = await loadDomain();
  const boundary = mutationBoundary(domain, 'sensitivity');
  assert.throws(() => boundary.invoke({
    ...boundary.command, toSensitivity: new String('public_approved'),
  }), { message: /sensitivity downgrade/i });
});

test('replay items 20 and 21 reject hidden and symbol own keys', async (t) => {
  const domain = await loadDomain();
  const transition = mutationBoundary(domain, 'transition');
  const cases = [
    ['item 20 record hidden', recordFixture(), (value) => domain.validateWorkRecord(value),
      'clientRole'],
    ['item 20 command hidden', structuredClone(transition.command), transition.invoke, 'clientRole'],
    ['item 21 record symbol', recordFixture(), (value) => domain.validateWorkRecord(value),
      Symbol('clientRole')],
    ['item 21 command symbol', structuredClone(transition.command), transition.invoke,
      Symbol('clientRole')],
  ];
  for (const [label, value, invoke, key] of cases) {
    await t.test(label, () => {
      Object.defineProperty(value, key, { value: 'owner', enumerable: false });
      assert.throws(() => invoke(value), { message: /unknown/i });
    });
  }
});

test('exact trust and durable chronology corrections fail closed', async (t) => {
  const domain = await loadDomain();
  await t.test('forged inherited authorization context', () => {
    const trusted = trustedContextFor(domain, 'record.archive');
    const forged = Object.create(trusted);
    Object.defineProperty(forged, 'permissions', { value: ['record.transition'] });
    assert.throws(() => domain.authorizeRecordAction(forged, {
      action: 'record.transition', requestedTenantId: IDS.tenant,
    }, recordFixture()), { message: /trusted/i });
  });
  await t.test('forged inherited source-health fact', () => {
    const trusted = domain.createTrustedSourceHealthFact({
      tenantId: IDS.tenant, sourceId: IDS.source, status: 'healthy',
      checkedAt: '2026-09-26T12:03:00.000Z',
    });
    const forged = Object.create(trusted);
    Object.defineProperty(forged, 'status', { value: 'unavailable' });
    assert.throws(() => domain.deriveRecordFreshness(recordFixture(), forged),
      { message: /trusted/i });
  });
  await t.test('source cannot postdate record update', () => {
    assert.throws(() => domain.validateWorkRecord(recordFixture({
      source: { ...recordFixture().source, recordedAt: '2026-09-26T12:10:00.000Z' },
    })), { message: /source chronology/i });
  });
  for (const family of ['transition', 'sensitivity']) {
    await t.test(`backward ${family} audit chronology`, () => {
      const boundary = mutationBoundary(domain, family);
      const audit = { ...boundary.command.auditEvents[0],
        occurredAt: '2026-09-26T11:59:00.000Z', recordedAt: '2026-09-26T11:59:00.000Z' };
      assert.throws(() => boundary.invoke({ ...boundary.command, auditEvents: [audit] }),
        { message: /chronology|predate/i });
    });
  }
  for (const family of ['archive', 'tombstone', 'restore']) {
    await t.test(`${family} cannot predate durable source`, () => {
      const boundary = mutationBoundary(domain, family);
      const history = family === 'tombstone' ? {
        lifecycle: 'archived', revision: 2, archivedAt: '2026-09-26T12:05:00.000Z',
        updatedAt: '2026-09-26T12:05:00.000Z',
      } : family === 'restore' ? {
        lifecycle: 'deleted', revision: 3, archivedAt: '2026-09-26T12:05:00.000Z',
        deletedAt: '2026-09-26T12:06:00.000Z', updatedAt: '2026-09-26T12:06:00.000Z',
      } : {};
      const record = recordFixture({ ...history,
        source: { ...recordFixture().source, recordedAt: '2026-09-26T12:10:00.000Z' } });
      const permission = family === 'archive' ? 'record.archive'
        : family === 'tombstone' ? 'record.delete' : 'record.restore';
      const method = family === 'archive' ? 'archiveWorkRecord'
        : family === 'tombstone' ? 'tombstoneWorkRecord' : 'restoreWorkRecord';
      assert.throws(() => domain[method](trustedContextFor(domain, permission), record,
        boundary.command), { message: /chronology|predate/i });
    });
  }
});

test('private trace preserves explicit stable links across all six stages', async () => {
  const domain = await loadDomain();
  const source = {
    tenantId: IDS.tenant,
    sourceId: IDS.source,
    sourceRecordId: 'synthetic-direction-1',
    sourceEventId: 'synthetic-event-1',
    contractVersion: '1.0',
    occurredAt: '2026-09-26T11:58:00.000Z',
    observedAt: '2026-09-26T11:59:00.000Z',
  };
  const subject = (subjectId) => ({ tenantId: IDS.tenant, subjectId });
  const trace = {
    tenantId: IDS.tenant,
    recordId: IDS.record,
    direction: {
      tenantId: IDS.tenant,
      directionId: 'id_a111111111111111',
      directingSubject: subject(IDS.owner),
      source,
      occurredAt: source.occurredAt,
      sensitivity: 'tenant_private',
    },
    authorization: {
      tenantId: IDS.tenant,
      authorizationId: 'id_a222222222222222',
      directionId: 'id_a111111111111111',
      action: 'assign',
      scope: IDS.record,
      authorizer: subject(IDS.owner),
      beneficiary: subject('id_a333333333333333'),
      constraints: ['synthetic-only'],
      policyRevision: 1,
      effectiveAt: source.observedAt,
    },
    assignment: {
      tenantId: IDS.tenant,
      recordId: IDS.record,
      authorizationId: 'id_a222222222222222',
      owner: subject(IDS.owner),
      assignees: [subject('id_a333333333333333')],
      acceptedRevision: 1,
      source,
      occurredAt: '2026-09-26T12:00:00.000Z',
    },
    activities: [{
      tenantId: IDS.tenant,
      recordId: IDS.record,
      activityId: 'id_a444444444444444',
      actor: subject('id_a333333333333333'),
      source,
      eventKind: 'work_performed',
      occurredAt: '2026-09-26T12:00:00.000Z',
      observedAt: '2026-09-26T12:00:00.000Z',
      recordedAt: '2026-09-26T12:00:00.000Z',
    }],
    evidence: [{
      tenantId: IDS.tenant,
      evidenceId: 'id_a555555555555555',
      activityId: 'id_a444444444444444',
      relation: 'result',
      locator: 'urn:stg:evidence:synthetic-result',
      label: 'Synthetic result',
      sensitivity: 'tenant_private',
      integrity: null,
      sourceOccurredAt: source.occurredAt,
      observedAt: source.observedAt,
      recordedAt: '2026-09-26T12:00:00.000Z',
      availability: 'available',
    }],
    outcome: {
      tenantId: IDS.tenant,
      recordId: IDS.record,
      outcomeId: 'id_a666666666666666',
      acceptanceActor: subject(IDS.owner),
      acceptanceAuthorizationId: 'id_a222222222222222',
      requiredEvidenceIds: ['id_a555555555555555'],
      acceptedAt: '2026-09-26T12:01:00.000Z',
    },
  };

  const validated = domain.validateTraceBundle?.(trace);

  assert.deepEqual(validated, { ok: true, value: trace });
  assert.notEqual(validated.value, trace);

  const brokenSourceLink = structuredClone(trace);
  brokenSourceLink.assignment.source = {
    ...brokenSourceLink.assignment.source, sourceId: 'id_b111111111111111',
  };
  assert.equal(domain.validateTraceBundle(brokenSourceLink).ok, false);
  const impossibleAcceptance = structuredClone(trace);
  impossibleAcceptance.outcome.acceptedAt = '2026-09-26T11:59:30.000Z';
  assert.equal(domain.validateTraceBundle(impossibleAcceptance).ok, false);

  const polluted = structuredClone(trace);
  delete polluted.outcome.acceptedAt;
  Object.defineProperty(Object.prototype, 'acceptedAt', {
    value: '2026-09-26T12:01:00.000Z', configurable: true,
  });
  try {
    assert.equal(domain.validateTraceBundle(polluted).ok, false);
  } finally {
    delete Object.prototype.acceptedAt;
  }
});
