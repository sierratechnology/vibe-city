import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const TENANT_A = 'id_1111111111111111';
const TENANT_B = 'id_2222222222222222';
const SUBJECT_A = 'id_3333333333333333';
const SOURCE_ID = 'id_4444444444444444';
const AUTHORIZATION_ID = 'id_5555555555555555';
const NOW = '2026-09-26T12:00:00.000Z';

async function loadDomain() {
  const source = await readFile(new URL('../src/domain/workRecords.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

async function loadStore() {
  try {
    return await import('../server/privateWorkRecordsStore.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

async function loadApi() {
  try {
    return await import('../server/privateWorkRecordsApi.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

function identity({
  tenantId = TENANT_A,
  subjectId = SUBJECT_A,
  active = true,
  permissions = ['record.transition'],
  policyRevision = 'policy-1',
} = {}) {
  return {
    authorizationId: AUTHORIZATION_ID,
    actorSubjectId: subjectId,
    authenticated: true,
    memberships: [{ tenantId, status: active ? 'active' : 'inactive', role: 'member' }],
    permissions,
    decisionAuthorities: [],
    policyRevision,
  };
}

function createBody(overrides = {}) {
  return {
    expectedRevision: 0,
    requestId: 'id_6666666666666666',
    record: {
      title: 'Synthetic private work record',
      owner: { tenantId: TENANT_A, subjectId: SUBJECT_A },
      assignees: [],
      lifecycle: 'open',
      freshness: 'unknown',
      sensitivity: 'tenant_private',
      source: {
        tenantId: TENANT_A,
        sourceId: SOURCE_ID,
        occurredAt: '2026-09-26T11:58:00.000Z',
        observedAt: '2026-09-26T11:59:00.000Z',
        recordedAt: NOW,
      },
      evidence: [],
      supersedes: null,
      correctionOf: null,
      archivedAt: null,
      deletedAt: null,
      ...overrides,
    },
  };
}

function traceBody(recordId, overrides = {}) {
  const source = {
    tenantId: TENANT_A, sourceId: SOURCE_ID,
    sourceRecordId: 'synthetic-direction-1', sourceEventId: 'synthetic-event-1',
    contractVersion: '1.0', occurredAt: '2026-09-26T11:58:00.000Z',
    observedAt: '2026-09-26T11:59:00.000Z',
  };
  const evidence = {
    tenantId: TENANT_A, evidenceId: 'id_cccccccccccccccc',
    activityId: 'id_eeeeeeeeeeeeeeee', relation: 'result',
    locator: 'urn:stg:evidence:synthetic-result', label: 'Synthetic result',
    sensitivity: 'tenant_private', integrity: null, sourceOccurredAt: source.occurredAt,
    observedAt: source.observedAt, recordedAt: NOW, availability: 'available',
  };
  return {
    expectedRevision: 1,
    requestId: 'id_bbbbbbbbbbbbbbbb',
    trace: {
      tenantId: TENANT_A,
      recordId,
      direction: {
        tenantId: TENANT_A, directionId: 'id_dddddddddddddddd',
        directingSubject: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        source, occurredAt: source.occurredAt, sensitivity: 'tenant_private',
      },
      authorization: {
        tenantId: TENANT_A, authorizationId: AUTHORIZATION_ID,
        directionId: 'id_dddddddddddddddd', action: 'assign', scope: recordId,
        authorizer: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        beneficiary: { tenantId: TENANT_A, subjectId: 'id_9999999999999999' },
        constraints: ['synthetic-only'], policyRevision: 'policy-1',
        effectiveAt: source.observedAt,
      },
      assignment: {
        tenantId: TENANT_A, recordId, authorizationId: AUTHORIZATION_ID,
        owner: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        assignees: [{ tenantId: TENANT_A, subjectId: 'id_9999999999999999' }],
        acceptedRevision: 1, source, occurredAt: NOW,
      },
      activities: [{
        tenantId: TENANT_A, recordId, activityId: 'id_eeeeeeeeeeeeeeee',
        actor: { tenantId: TENANT_A, subjectId: 'id_9999999999999999' },
        source, eventKind: 'work_performed', occurredAt: NOW,
        observedAt: NOW, recordedAt: NOW,
      }],
      evidence: [evidence],
      outcome: {
        tenantId: TENANT_A, recordId, outcomeId: 'id_ffffffffffffffff',
        acceptanceActor: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        acceptanceAuthorizationId: AUTHORIZATION_ID,
        requiredEvidenceIds: [evidence.evidenceId], acceptedAt: NOW,
      },
      ...overrides,
    },
  };
}

async function apiFixture({
  identities = {},
  resolveTrustedReferences = async () => true,
  resolveTracePolicy = async () => true,
  ids,
  now = () => Date.parse(NOW),
} = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    loadApi(), loadStore(), loadDomain(),
  ]);
  assert.equal(typeof createPrivateWorkRecordsApiHandler, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'office-private-api-'));
  const store = new PrivateWorkRecordsStore(join(directory, 'records.sqlite'));
  let sequence = 0;
  const handler = createPrivateWorkRecordsApiHandler({
    store,
    domain,
    now,
    generateId: ids ?? ((kind) =>
      `id_${kind === 'record' ? '7' : '8'}${String(sequence++).padStart(15, '0')}`),
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences,
    resolveTracePolicy,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function json(responsePromise) {
  const response = await responsePromise;
  return { status: response.status, body: await response.json() };
}

async function rawGet(base, path, authorization) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      headers: { authorization },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('repository atomically creates one tenant-scoped revision-1 record and audit', async () => {
  const module = await loadStore();
  assert.equal(typeof module.PrivateWorkRecordsStore, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'office-private-records-'));
  const store = new module.PrivateWorkRecordsStore(join(directory, 'records.sqlite'));
  const record = {
    tenantId: TENANT_A, recordId: 'id_2222222222222222',
    revision: 1, updatedAt: NOW,
  };
  const audit = {
    auditId: 'id_3333333333333333', tenantId: record.tenantId,
    recordId: record.recordId, priorRevision: 0, newRevision: 1,
    recordedAt: record.updatedAt,
  };
  try {
    assert.deepEqual(store.create(record, audit, 0), { ok: true, replayed: false });
    assert.deepEqual(store.read(record.tenantId, record.recordId), record);
    assert.equal(store.countRecords(record.tenantId), 1);
    assert.equal(store.countAudits(record.tenantId), 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('repository atomically completes and persists one tenant-scoped trace', async () => {
  const { PrivateWorkRecordsStore } = await loadStore();
  const directory = mkdtempSync(join(tmpdir(), 'office-private-trace-'));
  const store = new PrivateWorkRecordsStore(join(directory, 'records.sqlite'));
  const initial = {
    tenantId: TENANT_A, recordId: 'id_2222222222222222', revision: 1, updatedAt: NOW,
  };
  const created = {
    auditId: 'id_3333333333333333', tenantId: TENANT_A, recordId: initial.recordId,
    priorRevision: 0, newRevision: 1, recordedAt: NOW,
  };
  const completed = { ...initial, revision: 2 };
  const completionAudit = {
    auditId: 'id_4444444444444444', tenantId: TENANT_A, recordId: initial.recordId,
    priorRevision: 1, newRevision: 2, recordedAt: NOW,
  };
  const trace = { tenantId: TENANT_A, recordId: initial.recordId, synthetic: true };
  const requestIdentity = {
    tenantId: TENANT_A, principalId: SUBJECT_A, authorizationId: AUTHORIZATION_ID,
    policyRevision: 'policy-1', operation: 'trace', requestId: 'id_5555555555555555',
    requestSemantics: 'synthetic-trace',
  };
  try {
    assert.deepEqual(store.create(initial, created, 0), { ok: true, replayed: false });
    assert.deepEqual(store.completeTrace(
      completed, completionAudit, trace, 1, requestIdentity,
    ), { ok: true, replayed: false, record: completed });
    assert.deepEqual(store.readTrace(TENANT_A, initial.recordId), trace);
    assert.equal(store.countTraces(TENANT_A), 1);
    assert.equal(store.countAudits(TENANT_A), 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('trace and evidence transactions leave zero partial state after simulated storage failures', async () => {
  const { PrivateWorkRecordsStore } = await loadStore();
  const directory = mkdtempSync(join(tmpdir(), 'office-private-trace-rollback-'));
  const store = new PrivateWorkRecordsStore(join(directory, 'records.sqlite'));
  const record = {
    tenantId: TENANT_A, recordId: 'id_aaaaaaaaaaaaaaaa', revision: 1, updatedAt: NOW,
  };
  const createAudit = {
    tenantId: TENANT_A, auditId: 'id_bbbbbbbbbbbbbbbb', recordId: record.recordId,
    priorRevision: 0, newRevision: 1, recordedAt: NOW,
  };
  const completed = { ...record, revision: 2, updatedAt: '2026-09-26T12:01:00.000Z' };
  const completionAudit = {
    ...createAudit, auditId: 'id_cccccccccccccccc', priorRevision: 1, newRevision: 2,
    recordedAt: completed.updatedAt,
  };
  const trace = {
    tenantId: TENANT_A, recordId: record.recordId,
    evidence: [{ evidenceId: 'id_dddddddddddddddd', availability: 'available' }],
  };
  const completionRequest = {
    tenantId: TENANT_A, principalId: SUBJECT_A, authorizationId: AUTHORIZATION_ID,
    policyRevision: 'policy-1', operation: 'trace', requestId: 'id_eeeeeeeeeeeeeeee',
    requestSemantics: '{"completion":true}',
  };
  try {
    assert.equal(store.create(record, createAudit, 0).ok, true);
    const originalInsert = store.insertTraceStatement.run;
    store.insertTraceStatement.run = () => { throw new Error('simulated trace insert failure'); };
    assert.throws(() => store.completeTrace(
      completed, completionAudit, trace, 1, completionRequest,
    ), /simulated trace insert failure/);
    store.insertTraceStatement.run = originalInsert;
    assert.deepEqual({
      record: store.read(TENANT_A, record.recordId), audits: store.countAudits(TENANT_A),
      traces: store.countTraces(TENANT_A), replay: store.replayMutation(completionRequest),
    }, { record, audits: 1, traces: 0, replay: null });

    assert.equal(store.completeTrace(
      completed, completionAudit, trace, 1, completionRequest,
    ).ok, true);
    const mutated = { ...completed, revision: 3, updatedAt: '2026-09-26T12:02:00.000Z' };
    const mutationAudit = {
      ...createAudit, auditId: 'id_ffffffffffffffff', priorRevision: 2, newRevision: 3,
      recordedAt: mutated.updatedAt,
    };
    const nextTrace = {
      ...trace, evidence: [{ ...trace.evidence[0], availability: 'unavailable' }],
    };
    const mutationRequest = {
      ...completionRequest, operation: 'evidence_availability',
      requestId: 'id_1111111111111111', requestSemantics: '{"unavailable":true}',
    };
    const originalUpdate = store.updateTraceStatement.run;
    store.updateTraceStatement.run = () => { throw new Error('simulated trace update failure'); };
    assert.throws(() => store.mutateEvidence(
      mutated, mutationAudit, nextTrace, 2, mutationRequest,
    ), /simulated trace update failure/);
    store.updateTraceStatement.run = originalUpdate;
    assert.deepEqual({
      record: store.read(TENANT_A, record.recordId), audits: store.countAudits(TENANT_A),
      trace: store.readTrace(TENANT_A, record.recordId), replay: store.replayMutation(mutationRequest),
    }, { record: completed, audits: 2, trace, replay: null });
    console.log('TRACE_ATOMICITY simulated_insert=rollback simulated_update=rollback');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('authorized completion persists the full chain and evaluates each activity edge separately', async () => {
  const policyCalls = [];
  const context = await apiFixture({
    identities: {
      'Bearer tracer': identity({
        permissions: [
          'record.create', 'record.trace.write', 'record.trace.read', 'record.evidence.resolve',
        ],
      }),
    },
    resolveTracePolicy: async (scope) => {
      policyCalls.push(scope);
      return true;
    },
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: 'POST',
      headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
      body: JSON.stringify(createBody()),
    }));
    assert.equal(created.status, 201);
    const recordId = created.body.record.recordId;
    const completion = traceBody(recordId);
    completion.trace.activities.push({
      ...completion.trace.activities[0],
      activityId: 'id_9999999999999999',
      eventKind: 'review_requested',
    });
    const completed = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
        body: JSON.stringify(completion),
      },
    ));
    assert.equal(completed.status, 201);
    assert.equal(completed.body.record.lifecycle, 'completed');
    assert.equal(completed.body.record.revision, 2);
    assert.equal(context.store.countTraces(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 2);

    const traversedResponse = await fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      { headers: { authorization: 'Bearer tracer' } },
    );
    const traversedBody = await traversedResponse.json();
    assert.equal(traversedResponse.status, 200);
    assert.deepEqual(traversedBody.trace.edges.map(({ link, decision }) => [link, decision]), [
      ['direction', { allowed: true, code: 'allowed' }],
      ['authorization', { allowed: true, code: 'allowed' }],
      ['assignment', { allowed: true, code: 'allowed' }],
      ['activity', { allowed: true, code: 'allowed' }],
      ['activity', { allowed: true, code: 'allowed' }],
      ['evidence', { allowed: true, code: 'allowed' }],
      ['outcome', { allowed: true, code: 'allowed' }],
    ]);
    assert.equal(traversedResponse.headers.get('cache-control'), 'private, no-store');
    assert.equal(policyCalls.filter(({ action }) => action === 'write').length, 7);
    assert.equal(policyCalls.filter(({ action }) => action === 'read').length, 7);
    console.log(`TRACE_FIXTURE ${JSON.stringify(traversedBody)}`);
  } finally {
    await context.close();
  }
});

test('evidence resolution distinguishes stale unavailable withdrawn missing and not-authorized', async () => {
  let denyEvidenceRead = false;
  let denyEvidenceWrite = false;
  const context = await apiFixture({
    identities: {
      'Bearer tracer': identity({ permissions: [
        'record.create', 'record.read', 'record.trace.write', 'record.trace.read',
        'record.evidence.resolve', 'record.evidence.availability.update',
      ] }),
      'Bearer locator-holder': identity({ permissions: ['record.trace.read'] }),
    },
    resolveTracePolicy: async ({ action, link }) =>
      !(denyEvidenceRead && action === 'read' && link === 'evidence')
      && !(denyEvidenceWrite && action === 'write' && link === 'evidence'),
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: 'POST',
      headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
      body: JSON.stringify(createBody()),
    }));
    const recordId = created.body.record.recordId;
    const completion = traceBody(recordId);
    const staleEvidence = {
      ...completion.trace.evidence[0], evidenceId: 'id_bbbbbbbbbbbbbbbb',
      locator: 'https://github.com/synthetic-owner/synthetic-repo/commit/abcdef1',
      label: 'Stale repository result', availability: 'stale',
    };
    const tombstonedEvidence = {
      ...completion.trace.evidence[0], evidenceId: 'id_aaaaaaaaaaaaaaaa',
      locator: 'urn:stg:evidence:deleted-result', label: 'Deleted result',
      availability: 'deleted_tombstone',
    };
    completion.trace.evidence.push(staleEvidence, tombstonedEvidence);
    assert.equal((await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`, {
        method: 'POST',
        headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
        body: JSON.stringify(completion),
      },
    ))).status, 201);
    const evidenceId = completion.trace.evidence[0].evidenceId;
    const evidenceUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/${evidenceId}`;
    const staleUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/${staleEvidence.evidenceId}`;
    const tombstoneUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/${tombstonedEvidence.evidenceId}`;

    const available = await json(fetch(evidenceUrl, { headers: { authorization: 'Bearer tracer' } }));
    assert.equal(available.body.state, 'available');
    assert.equal(available.body.inspectable, true);
    assert.equal(available.body.evidence.locator, 'urn:stg:evidence:synthetic-result');
    const ordinaryAvailable = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      { headers: { authorization: 'Bearer tracer' } },
    ));
    assert.equal('locator' in ordinaryAvailable.body.record.evidence[0], false);
    const listedAvailable = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: 'Bearer tracer' } },
    ));
    assert.equal('locator' in listedAvailable.body.records[0].evidence[0], false);
    assert.equal((await json(fetch(staleUrl, {
      headers: { authorization: 'Bearer tracer' },
    }))).body.state, 'stale');
    const tombstone = await json(fetch(tombstoneUrl, {
      headers: { authorization: 'Bearer tracer' },
    }));
    assert.equal(tombstone.body.state, 'deleted_tombstone');
    assert.equal(tombstone.body.inspectable, false);
    assert.equal(Object.hasOwn(tombstone.body.evidence, 'locator'), false);
    assert.equal((await json(fetch(tombstoneUrl, {
      method: 'PATCH',
      headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
      body: JSON.stringify({
        availability: 'unavailable', expectedRevision: 2,
        requestId: 'id_aaaaaaaaaaaaaaaa',
      }),
    }))).status, 404);

    denyEvidenceRead = true;
    assert.deepEqual(await json(fetch(evidenceUrl, {
      headers: { authorization: 'Bearer tracer' },
    })), { status: 404, body: { error: 'not_found' } });
    const deniedTrace = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      { headers: { authorization: 'Bearer tracer' } },
    ));
    assert.equal(deniedTrace.body.trace.edges.find(({ link }) => link === 'evidence').state,
      'not_authorized');
    assert.deepEqual(await json(fetch(evidenceUrl, {
      headers: { authorization: 'Bearer locator-holder' },
    })), { status: 404, body: { error: 'not_found' } });
    denyEvidenceRead = false;

    const patchAvailability = (availability, expectedRevision, requestId) => json(fetch(evidenceUrl, {
      method: 'PATCH',
      headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
      body: JSON.stringify({ availability, expectedRevision, requestId }),
    }));
    const unavailableMutation = await patchAvailability(
      'unavailable', 2, 'id_1111111111111111',
    );
    assert.equal(unavailableMutation.status, 200);
    assert.equal(Object.hasOwn(unavailableMutation.body.record.evidence[0], 'locator'), false);
    denyEvidenceWrite = true;
    assert.equal((await patchAvailability(
      'unavailable', 2, 'id_1111111111111111',
    )).status, 404);
    denyEvidenceWrite = false;
    const unavailable = await json(fetch(evidenceUrl, {
      headers: { authorization: 'Bearer tracer' },
    }));
    assert.equal(unavailable.body.state, 'unavailable');
    assert.equal(unavailable.body.inspectable, false);
    assert.equal(Object.hasOwn(unavailable.body.evidence, 'locator'), false);
    const ordinaryRead = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      { headers: { authorization: 'Bearer tracer' } },
    ));
    assert.equal(Object.hasOwn(ordinaryRead.body.record.evidence[0], 'locator'), false);
    const ordinaryList = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: 'Bearer tracer' } },
    ));
    assert.equal(Object.hasOwn(ordinaryList.body.records[0].evidence[0], 'locator'), false);
    assert.equal((await patchAvailability(
      'withdrawn', 3, 'id_2222222222222222',
    )).status, 200);
    assert.equal((await json(fetch(evidenceUrl, {
      headers: { authorization: 'Bearer tracer' },
    }))).body.state, 'withdrawn');
    const missing = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/id_9999999999999999`,
      { headers: { authorization: 'Bearer tracer' } },
    ));
    assert.deepEqual(missing, { status: 404, body: { error: 'not_found' } });
    console.log(`EVIDENCE_STATE_MATRIX ${JSON.stringify({
      available: available.body.state, stale: 'stale', notAuthorized: 'not_authorized',
      unavailable: unavailable.body.state, withdrawn: 'withdrawn', missing: 'missing',
    })}`);
  } finally {
    await context.close();
  }
});

test('trace attack matrix rejects linkage authority policy replay and route attacks with zero delta', async () => {
  let policyAllowed = true;
  const context = await apiFixture({
    identities: {
      'Bearer tracer': identity({ permissions: [
        'record.create', 'record.trace.write', 'record.trace.read', 'record.evidence.resolve',
      ] }),
    },
    resolveTracePolicy: async () => policyAllowed,
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: 'POST',
      headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
      body: JSON.stringify(createBody()),
    }));
    const recordId = created.body.record.recordId;
    const traceUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`;
    const postTrace = (body, url = traceUrl) => json(fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer tracer', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const snapshot = () => ({
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      traces: context.store.countTraces(TENANT_A),
      revision: context.store.read(TENANT_A, recordId).revision,
    });
    const baseline = snapshot();
    const expectNoDelta = async (body, expectedStatus = 404, url = traceUrl) => {
      assert.equal((await postTrace(body, url)).status, expectedStatus);
      assert.deepEqual(snapshot(), baseline);
    };

    policyAllowed = false;
    await expectNoDelta(traceBody(recordId));
    policyAllowed = true;
    const crossTenant = traceBody(recordId);
    crossTenant.requestId = 'id_1111111111111111';
    crossTenant.trace.activities[0].actor.tenantId = TENANT_B;
    await expectNoDelta(crossTenant);
    const mismatchedAuthorization = traceBody(recordId);
    mismatchedAuthorization.requestId = 'id_2222222222222222';
    mismatchedAuthorization.trace.authorization.authorizationId = 'id_aaaaaaaaaaaaaaaa';
    await expectNoDelta(mismatchedAuthorization);
    const spoofedAuthorizer = traceBody(recordId);
    spoofedAuthorizer.requestId = 'id_7777777777777777';
    spoofedAuthorizer.trace.authorization.authorizer.subjectId = 'id_aaaaaaaaaaaaaaaa';
    await expectNoDelta(spoofedAuthorizer);
    const outsiderActivity = traceBody(recordId);
    outsiderActivity.requestId = 'id_8888888888888888';
    outsiderActivity.trace.activities[0].actor.subjectId = 'id_aaaaaaaaaaaaaaaa';
    await expectNoDelta(outsiderActivity);
    const mismatchedBeneficiary = traceBody(recordId);
    mismatchedBeneficiary.requestId = 'id_2222222222222222';
    mismatchedBeneficiary.trace.authorization.beneficiary.subjectId = 'id_aaaaaaaaaaaaaaaa';
    await expectNoDelta(mismatchedBeneficiary);
    const mismatchedEvidenceActivity = traceBody(recordId);
    mismatchedEvidenceActivity.requestId = 'id_aaaaaaaaaaaaaaaa';
    mismatchedEvidenceActivity.trace.evidence[0].activityId = 'id_bbbbbbbbbbbbbbbb';
    await expectNoDelta(mismatchedEvidenceActivity);
    const unusableOutcome = traceBody(recordId);
    unusableOutcome.requestId = 'id_3333333333333333';
    unusableOutcome.trace.evidence[0].availability = 'unavailable';
    await expectNoDelta(unusableOutcome);
    const unsafeLocator = traceBody(recordId);
    unsafeLocator.requestId = 'id_4444444444444444';
    unsafeLocator.trace.evidence[0].locator = 'https://example.invalid/private-result';
    await expectNoDelta(unsafeLocator);
    const stale = traceBody(recordId);
    stale.requestId = 'id_5555555555555555';
    stale.expectedRevision = 0;
    await expectNoDelta(stale, 409);

    const accepted = traceBody(recordId);
    const first = await postTrace(accepted);
    assert.equal(first.status, 201);
    const acceptedSnapshot = snapshot();
    assert.deepEqual(acceptedSnapshot, { records: 1, audits: 2, traces: 1, revision: 2 });
    assert.equal((await postTrace(accepted)).status, 200);
    assert.deepEqual(snapshot(), acceptedSnapshot);
    policyAllowed = false;
    assert.equal((await postTrace(accepted)).status, 404);
    assert.deepEqual(snapshot(), acceptedSnapshot);
    policyAllowed = true;
    const changedReplay = structuredClone(accepted);
    changedReplay.trace.outcome.outcomeId = 'id_aaaaaaaaaaaaaaaa';
    assert.equal((await postTrace(changedReplay)).status, 409);
    assert.deepEqual(snapshot(), acceptedSnapshot);
    const terminalDuplicate = traceBody(recordId);
    terminalDuplicate.requestId = 'id_6666666666666666';
    assert.equal((await postTrace(terminalDuplicate)).status, 404);
    assert.deepEqual(snapshot(), acceptedSnapshot);
    assert.equal((await postTrace(
      traceBody(recordId), `${traceUrl}/alternate`,
    )).status, 404);
    assert.deepEqual(snapshot(), acceptedSnapshot);
    console.log(`TRACE_ATTACK_MATRIX ${JSON.stringify({
      denied: 1, crossTenant: 1, mismatchedAuthorization: 1, spoofedAuthorizer: 1,
      outsiderActivity: 1, mismatchedBeneficiary: 1, mismatchedEvidenceActivity: 1,
      unusableOutcome: 1,
      unsafeLocator: 1, stale: 1, exactReplay: 1, changedReplay: 1,
      terminalDuplicate: 1, alternateRoute: 1,
    })}`);
  } finally {
    await context.close();
  }
});

test('authenticated active same-tenant create succeeds while identity failures deny generically', async () => {
  const context = await apiFixture({
    identities: {
      'Bearer active': identity({ permissions: ['record.create'] }),
      'Bearer revoked': identity({ active: false, permissions: ['record.create'] }),
      'Bearer foreign': identity({ tenantId: TENANT_B, permissions: ['record.create'] }),
    },
  });
  const post = (authorization) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records`,
    {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(createBody()),
    },
  ));
  try {
    const accepted = await post('Bearer active');
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.record.tenantId, TENANT_A);
    for (const authorization of ['Bearer missing', 'Bearer revoked', 'Bearer foreign']) {
      assert.deepEqual(await post(authorization), { status: 404, body: { error: 'not_found' } });
    }
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test('create-only authority creates while update-only authority cannot create', async () => {
  let referenceResolutions = 0;
  const context = await apiFixture({
    identities: {
      'Bearer creator': identity({ permissions: ['record.create'] }),
      'Bearer updater': identity({ permissions: ['record.transition'] }),
    },
    resolveTrustedReferences: async () => {
      referenceResolutions += 1;
      return true;
    },
  });
  const post = (authorization, title) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records`,
    {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(createBody({ title })),
    },
  ));
  try {
    assert.equal((await post('Bearer creator', 'Create authority')).status, 201);
    assert.equal(referenceResolutions, 1);
    assert.deepEqual(await post('Bearer updater', 'Update authority'), {
      status: 404, body: { error: 'not_found' },
    });
    assert.equal(referenceResolutions, 1);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test('invented same-tenant references fail through the trusted resolver with zero state delta', async () => {
  const calls = [];
  const context = await apiFixture({
    identities: { 'Bearer creator': identity({ permissions: ['record.create'] }) },
    resolveTrustedReferences: async (scope) => {
      calls.push(scope);
      return false;
    },
  });
  const invented = 'id_aaaaaaaaaaaaaaaa';
  const body = createBody({
    owner: { tenantId: TENANT_A, subjectId: invented },
    assignees: [{ tenantId: TENANT_A, subjectId: 'id_bbbbbbbbbbbbbbbb' }],
    evidence: [{
      tenantId: TENANT_A,
      evidenceId: 'id_cccccccccccccccc',
      locator: 'urn:stg:evidence:synthetic-invented',
      recordedAt: NOW,
    }],
    source: { ...createBody().record.source, sourceId: 'id_dddddddddddddddd' },
    supersedes: { tenantId: TENANT_A, recordId: 'id_eeeeeeeeeeeeeeee' },
  });
  try {
    const denied = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: 'POST',
      headers: { authorization: 'Bearer creator', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    assert.deepEqual(denied, { status: 404, body: { error: 'not_found' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tenantId, TENANT_A);
    assert.equal(calls[0].principalId, SUBJECT_A);
    assert.equal(calls[0].authorizationId, AUTHORIZATION_ID);
    assert.equal(calls[0].record.owner.subjectId, invented);
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);
  } finally {
    await context.close();
  }
});

test('direct read is authorized by tenant plus record ID and denies foreign IDs generically', async () => {
  const context = await apiFixture({
    identities: { 'Bearer reader': identity({ permissions: ['record.read'] }) },
  });
  const recordA = {
    ...createBody().record,
    tenantId: TENANT_A,
    recordId: 'id_aaaaaaaaaaaaaaaa',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const recordB = {
    ...recordA,
    tenantId: TENANT_B,
    recordId: 'id_bbbbbbbbbbbbbbbb',
    owner: { tenantId: TENANT_B, subjectId: SUBJECT_A },
    source: { ...recordA.source, tenantId: TENANT_B },
  };
  const seed = (record, auditId) => context.store.create(record, {
    auditId, tenantId: record.tenantId, recordId: record.recordId,
    priorRevision: 0, newRevision: 1, recordedAt: NOW,
  }, 0);
  seed(recordA, 'id_cccccccccccccccc');
  seed(recordB, 'id_dddddddddddddddd');
  const get = (tenantId, recordId) => json(fetch(
    `${context.base}/api/private/tenants/${tenantId}/records/${recordId}`,
    { headers: { authorization: 'Bearer reader' } },
  ));
  try {
    assert.deepEqual(await get(TENANT_A, recordA.recordId), {
      status: 200, body: { record: recordA },
    });
    assert.deepEqual(await get(TENANT_A, recordB.recordId), {
      status: 404, body: { error: 'not_found' },
    });
    assert.deepEqual(await get(TENANT_B, recordB.recordId), {
      status: 404, body: { error: 'not_found' },
    });
  } finally {
    await context.close();
  }
});

test('ordinary direct and list reads omit evidence locators when no trace exists', async () => {
  const domain = await loadDomain();
  const context = await apiFixture({
    identities: { 'Bearer reader': identity({ permissions: ['record.read'] }) },
  });
  const record = domain.validateWorkRecord({
    ...createBody({
      evidence: [{
        tenantId: TENANT_A,
        evidenceId: 'id_cccccccccccccccc',
        locator: 'urn:stg:evidence:private-locator',
        recordedAt: NOW,
      }],
    }).record,
    tenantId: TENANT_A,
    recordId: 'id_aaaaaaaaaaaaaaaa',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  context.store.create(record, {
    auditId: 'id_bbbbbbbbbbbbbbbb', tenantId: TENANT_A, recordId: record.recordId,
    priorRevision: 0, newRevision: 1, recordedAt: NOW,
  }, 0);
  try {
    assert.equal(context.store.readTrace(TENANT_A, record.recordId), null);
    const directResponse = await fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${record.recordId}`,
      { headers: { authorization: 'Bearer reader' } },
    );
    const listResponse = await fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: 'Bearer reader' } },
    );
    const [direct, listed] = await Promise.all([directResponse.json(), listResponse.json()]);
    assert.deepEqual([
      direct.record.evidence[0].locator,
      listed.records[0].evidence[0].locator,
    ], [undefined, undefined]);
    assert.equal(directResponse.headers.get('cache-control'), 'private, no-store');
    assert.equal(listResponse.headers.get('cache-control'), 'private, no-store');
    assert.equal(listed.count, 1);
    assert.equal(listed.cursor, null);
  } finally {
    await context.close();
  }
});

test('direct read denial performs no storage lookup or state change without read authority', async () => {
  const context = await apiFixture({
    identities: { 'Bearer updater': identity({ permissions: ['record.transition'] }) },
  });
  const record = {
    ...createBody().record,
    tenantId: TENANT_A,
    recordId: 'id_aaaaaaaaaaaaaaaa',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  context.store.create(record, {
    auditId: 'id_bbbbbbbbbbbbbbbb', tenantId: TENANT_A, recordId: record.recordId,
    priorRevision: 0, newRevision: 1, recordedAt: NOW,
  }, 0);
  const baseline = {
    records: context.store.countRecords(TENANT_A),
    audits: context.store.countAudits(TENANT_A),
    requests: Number(context.store.database.prepare(
      'SELECT count(*) AS count FROM private_create_requests',
    ).get().count),
  };
  let readCalls = 0;
  const originalRead = context.store.read.bind(context.store);
  context.store.read = (...args) => {
    readCalls += 1;
    return originalRead(...args);
  };
  const get = (recordId) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    { headers: { authorization: 'Bearer updater' } },
  ));
  try {
    assert.deepEqual(await get(record.recordId), {
      status: 404, body: { error: 'not_found' },
    });
    assert.deepEqual(await get('id_cccccccccccccccc'), {
      status: 404, body: { error: 'not_found' },
    });
    assert.equal(readCalls, 0);
    assert.deepEqual({
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      requests: Number(context.store.database.prepare(
        'SELECT count(*) AS count FROM private_create_requests',
      ).get().count),
    }, baseline);
  } finally {
    await context.close();
  }
});

test('tenant list is stable bounded to 50 and alternate routes reveal no foreign count or cursor', async () => {
  const context = await apiFixture({
    identities: { 'Bearer reader': identity({ permissions: ['record.read'] }) },
  });
  const seed = (tenantId, index) => {
    const suffix = index.toString(16).padStart(16, '0');
    const record = {
      ...createBody({
        owner: { tenantId, subjectId: SUBJECT_A },
        source: { ...createBody().record.source, tenantId },
      }).record,
      tenantId,
      recordId: `id_${suffix}`,
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    context.store.create(record, {
      auditId: `id_a${suffix.slice(1)}`, tenantId, recordId: record.recordId,
      priorRevision: 0, newRevision: 1, recordedAt: NOW,
    }, 0);
  };
  for (let index = 1; index <= 51; index += 1) seed(TENANT_A, index);
  seed(TENANT_B, 60);
  try {
    const listed = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      headers: { authorization: 'Bearer reader' },
    }));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.records.length, 50);
    assert.equal(listed.body.count, 50);
    assert.equal(listed.body.cursor, null);
    assert.equal(listed.body.records.every((record) => record.tenantId === TENANT_A), true);
    assert.deepEqual(listed.body.records.map((record) => record.recordId),
      [...listed.body.records].map((record) => record.recordId).sort().reverse());
    for (const path of ['search', 'count', 'export', 'batch', 'history', 'evidence']) {
      assert.deepEqual(await json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records/${path}`,
        { headers: { authorization: 'Bearer reader' } },
      )), { status: 404, body: { error: 'not_found' } });
    }
    assert.deepEqual(await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records?limit=51`,
      { headers: { authorization: 'Bearer reader' } },
    )), { status: 404, body: { error: 'not_found' } });
    for (const path of [
      `/api/private/tenants/${TENANT_A}/records/`,
      `/api//private/tenants/${TENANT_A}/records`,
      `/api/private/x/../tenants/${TENANT_A}/records`,
    ]) {
      assert.deepEqual(await rawGet(context.base, path, 'Bearer reader'), {
        status: 404, body: { error: 'not_found' },
      });
    }
  } finally {
    await context.close();
  }
});

test('closed request identity replays identically, conflicts generically, and stays scope-isolated', async () => {
  const context = await apiFixture({
    identities: {
      'Bearer creator-a': identity({ permissions: ['record.create'] }),
      'Bearer creator-b': identity({
        subjectId: 'id_9999999999999999', permissions: ['record.create'],
      }),
      'Bearer creator-policy': identity({
        permissions: ['record.create'], policyRevision: 'policy-2',
      }),
    },
  });
  const post = (authorization, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records`,
    {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  ));
  try {
    const accepted = await post('Bearer creator-a', createBody());
    assert.equal(accepted.status, 201);
    assert.deepEqual(await post('Bearer creator-a', createBody()), {
      status: 200, body: accepted.body,
    });
    assert.deepEqual(await post('Bearer creator-a', createBody({ title: 'Conflicting semantics' })), {
      status: 409, body: { error: 'conflict' },
    });
    assert.equal((await post('Bearer creator-b', createBody())).status, 201);
    assert.equal((await post('Bearer creator-policy', createBody())).status, 201);
    assert.equal(context.store.countRecords(TENANT_A), 3);
    assert.equal(context.store.countAudits(TENANT_A), 3);
    for (const requestId of [undefined, 'caller-key', 'id_aaaaaaaaaaaaaaaag']) {
      const body = createBody();
      if (requestId === undefined) delete body.requestId;
      else body.requestId = requestId;
      assert.deepEqual(await post('Bearer creator-a', body), {
        status: 404, body: { error: 'not_found' },
      });
    }
  } finally {
    await context.close();
  }
});

test('stale duplicate and malformed creation audit failures roll back record audit and request identity', async () => {
  let recordIndex = 0;
  let auditIndex = 0;
  const recordIds = [
    'id_a000000000000001', 'id_a000000000000002',
    'id_a000000000000003', 'id_a000000000000004',
  ];
  const auditIds = [
    'id_b000000000000001', 'malformed-audit-id',
    'id_b000000000000003', 'id_b000000000000003',
  ];
  const context = await apiFixture({
    identities: { 'Bearer creator': identity({ permissions: ['record.create'] }) },
    ids: (kind) => kind === 'record' ? recordIds[recordIndex++] : auditIds[auditIndex++],
  });
  const post = (body) => json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
    method: 'POST',
    headers: { authorization: 'Bearer creator', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  try {
    assert.deepEqual(await post({ ...createBody(), expectedRevision: 1 }), {
      status: 409, body: { error: 'conflict' },
    });
    assert.deepEqual(await post(createBody()), {
      status: 404, body: { error: 'not_found' },
    });
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);

    assert.equal((await post({ ...createBody(), requestId: 'id_7777777777777777' })).status, 201);
    assert.deepEqual(await post({
      ...createBody({ title: 'Duplicate audit rollback' }),
      requestId: 'id_8888888888888888',
    }), { status: 409, body: { error: 'conflict' } });
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test('owner-only SQLite files persist accepted rows across a clean restart', async () => {
  const { PrivateWorkRecordsStore } = await loadStore();
  const directory = mkdtempSync(join(tmpdir(), 'office-private-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const record = {
    tenantId: TENANT_A,
    recordId: 'id_aaaaaaaaaaaaaaaa',
    revision: 1,
    updatedAt: NOW,
  };
  const audit = {
    auditId: 'id_bbbbbbbbbbbbbbbb',
    tenantId: TENANT_A,
    recordId: record.recordId,
    priorRevision: 0,
    newRevision: 1,
    recordedAt: NOW,
  };
  let store = new PrivateWorkRecordsStore(databasePath);
  try {
    assert.deepEqual(store.create(record, audit, 0), { ok: true, replayed: false });
    const completedRecord = { ...record, revision: 2, updatedAt: '2026-09-26T12:01:00.000Z' };
    const completionAudit = {
      ...audit, auditId: 'id_cccccccccccccccc', priorRevision: 1, newRevision: 2,
      recordedAt: completedRecord.updatedAt,
    };
    const trace = { tenantId: TENANT_A, recordId: record.recordId, evidence: [] };
    const requestIdentity = {
      tenantId: TENANT_A, principalId: SUBJECT_A, authorizationId: AUTHORIZATION_ID,
      policyRevision: 'policy-1', operation: 'trace', requestId: 'id_dddddddddddddddd',
      requestSemantics: '{"restart":true}',
    };
    assert.deepEqual(store.completeTrace(
      completedRecord, completionAudit, trace, 1, requestIdentity,
    ), { ok: true, replayed: false, record: completedRecord });
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(path)) assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    store.close();
    store = new PrivateWorkRecordsStore(databasePath);
    assert.equal(store.countRecords(TENANT_A), 1);
    assert.equal(store.countAudits(TENANT_A), 2);
    assert.equal(store.countTraces(TENANT_A), 1);
    assert.deepEqual(store.read(TENANT_A, record.recordId), completedRecord);
    assert.deepEqual(store.readTrace(TENANT_A, record.recordId), trace);
    assert.deepEqual(store.replayMutation(requestIdentity), {
      ok: true, replayed: true, record: completedRecord,
    });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('private responses have exact headers and bounded malformed bodies fail without mutation', async () => {
  const context = await apiFixture({
    identities: { 'Bearer creator': identity({ permissions: ['record.create'] }) },
  });
  const postRaw = async (body) => {
    const response = await fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: 'POST',
      headers: { authorization: 'Bearer creator', 'content-type': 'application/json' },
      body,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
  };
  try {
    const malformed = await postRaw('{');
    assert.equal(malformed.status, 404);
    assert.deepEqual(malformed.body, { error: 'not_found' });
    const oversizedBody = JSON.stringify({
      ...createBody(), requestId: 'id_7777777777777777',
    }).padEnd(40_000, ' ');
    const oversized = await postRaw(oversizedBody);
    assert.equal(oversized.status, 404);
    assert.deepEqual(oversized.body, { error: 'not_found' });
    for (const [index, field] of [
      'tenantId', 'recordId', 'createdAt', 'updatedAt', 'revision',
    ].entries()) {
      const body = createBody({ [field]: field === 'revision' ? 9 : 'client-assertion' });
      body.requestId = `id_c${String(index).padStart(15, '0')}`;
      const asserted = await postRaw(JSON.stringify(body));
      assert.equal(asserted.status, 404);
      assert.deepEqual(asserted.body, { error: 'not_found' });
    }
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);
    for (const result of [malformed, oversized]) {
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      assert.equal(result.headers.get('vary'), 'authorization');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(result.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.equal(Number(result.headers.get('content-length')), Buffer.byteLength(result.text));
      assert.equal(Buffer.byteLength(result.text) < 1024, true);
    }
  } finally {
    await context.close();
  }
});

test('handler rejects incomplete dependencies and nonnumeric clocks without mutation', async () => {
  const { createPrivateWorkRecordsApiHandler } = await loadApi();
  assert.throws(() => createPrivateWorkRecordsApiHandler({}), /dependencies/);
  const context = await apiFixture({
    identities: { 'Bearer creator': identity({ permissions: ['record.create'] }) },
    now: () => NOW,
  });
  try {
    assert.deepEqual(await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: 'POST',
      headers: { authorization: 'Bearer creator', 'content-type': 'application/json' },
      body: JSON.stringify(createBody()),
    })), { status: 404, body: { error: 'not_found' } });
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);
  } finally {
    await context.close();
  }
});
