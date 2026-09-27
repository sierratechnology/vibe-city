import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const TENANT_A = 'id_1111111111111111';
const TENANT_B = 'id_2222222222222222';
const ACTOR = 'id_3333333333333333';
const SOURCE = 'id_4444444444444444';
const AUTHORIZATION = 'id_5555555555555555';
const RECORD = 'id_6666666666666666';
const CREATED = '2026-09-26T12:00:00.000Z';
const MUTATED = '2026-09-26T12:05:00.000Z';

async function loadDomain() {
  const source = await readFile(new URL('../src/domain/workRecords.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function identity(permissions, { tenantId = TENANT_A, active = true } = {}) {
  return {
    authorizationId: AUTHORIZATION,
    actorSubjectId: ACTOR,
    authenticated: true,
    memberships: [{ tenantId, status: active ? 'active' : 'inactive', role: 'member' }],
    permissions,
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  };
}

function recordFixture({ tenantId = TENANT_A, recordId = RECORD } = {}) {
  return {
    tenantId,
    recordId,
    title: 'Original synthetic title',
    owner: { tenantId, subjectId: ACTOR },
    assignees: [],
    lifecycle: 'open',
    freshness: 'unknown',
    sensitivity: 'tenant_private',
    revision: 1,
    createdAt: CREATED,
    updatedAt: CREATED,
    source: {
      tenantId,
      sourceId: SOURCE,
      occurredAt: '2026-09-26T11:58:00.000Z',
      observedAt: '2026-09-26T11:59:00.000Z',
      recordedAt: CREATED,
    },
    evidence: [],
    supersedes: null,
    correctionOf: null,
    archivedAt: null,
    deletedAt: null,
  };
}

function creationAudit(record, auditId = 'id_7777777777777777') {
  return {
    auditId,
    tenantId: record.tenantId,
    recordId: record.recordId,
    actorSubjectId: ACTOR,
    authorizationId: AUTHORIZATION,
    policyRevision: 'policy-1',
    sourceId: SOURCE,
    priorRevision: 0,
    newRevision: 1,
    occurredAt: CREATED,
    recordedAt: CREATED,
    changedFields: ['recordId'],
  };
}

async function fixture({ identities, resolveTrustedReferences = async () => true } = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import('../server/privateWorkRecordsApi.mjs'),
    import('../server/privateWorkRecordsStore.mjs'),
    loadDomain(),
  ]);
  const directory = mkdtempSync(join(tmpdir(), 'office-private-history-'));
  const store = new PrivateWorkRecordsStore(join(directory, 'records.sqlite'));
  let sequence = 8;
  const handler = createPrivateWorkRecordsApiHandler({
    store,
    domain,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences,
    now: () => Date.parse(MUTATED),
    generateId: () => `id_${String(sequence++).repeat(16)}`,
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

async function rawRequest(base, path, { authorization, method = 'GET', contentType, body } = {}) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const headers = { authorization };
    if (contentType !== undefined) headers['content-type'] = contentType;
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          body: JSON.parse(text),
          headers: response.headers,
          text,
        });
      });
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function mutation(base, kind, authorization, body, recordId = RECORD, tenantId = TENANT_A) {
  return json(fetch(`${base}/api/private/tenants/${tenantId}/records/${recordId}/${kind}`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function renameBody(overrides = {}) {
  return {
    expectedRevision: 1,
    requestId: 'id_9999999999999999',
    title: 'Renamed synthetic title',
    reasonRef: 'direction-synthetic-1',
    occurredAt: MUTATED,
    ...overrides,
  };
}

function reassignmentBody(overrides = {}) {
  return {
    expectedRevision: 1,
    requestId: 'id_aaaaaaaaaaaaaaaa',
    assigneeSubjectIds: ['id_bbbbbbbbbbbbbbbb', 'id_cccccccccccccccc'],
    reasonRef: 'direction-synthetic-2',
    occurredAt: MUTATED,
    ...overrides,
  };
}

test('authorized rename preserves identity and atomically appends a bounded historical snapshot', async () => {
  const context = await fixture({
    identities: { 'Bearer renamer': identity(['record.rename']) },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const result = await mutation(context.base, 'rename', 'Bearer renamer', renameBody());
    assert.equal(result.status, 200);
    assert.equal(result.body.record.recordId, RECORD);
    assert.equal(result.body.record.tenantId, TENANT_A);
    assert.equal(result.body.record.title, 'Renamed synthetic title');
    assert.equal(result.body.record.revision, 2);
    assert.equal(result.body.record.updatedAt, MUTATED);
    assert.deepEqual(context.store.read(TENANT_A, RECORD), result.body.record);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 2);
    assert.deepEqual(history[1], {
      auditId: 'id_8888888888888888',
      tenantId: TENANT_A,
      recordId: RECORD,
      eventKind: 'rename',
      actorSubjectId: ACTOR,
      authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1',
      sourceId: SOURCE,
      reasonRef: 'direction-synthetic-1',
      priorRevision: 1,
      newRevision: 2,
      occurredAt: MUTATED,
      recordedAt: MUTATED,
      changedFields: {
        title: { prior: 'Original synthetic title', next: 'Renamed synthetic title' },
      },
    });
  } finally {
    await context.close();
  }
});

test('rename authority denial stale input and replay are fail-closed and atomic', async () => {
  const context = await fixture({
    identities: {
      'Bearer reader': identity(['record.read']),
      'Bearer renamer': identity(['record.rename']),
      'Bearer revoked': identity(['record.rename'], { active: false }),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  let readCalls = 0;
  const originalRead = context.store.read.bind(context.store);
  context.store.read = (...args) => { readCalls += 1; return originalRead(...args); };
  const baseline = () => ({
    record: originalRead(TENANT_A, RECORD),
    audits: context.store.readHistory(TENANT_A, RECORD, 50),
  });
  try {
    const before = baseline();
    for (const authorization of ['Bearer missing', 'Bearer reader', 'Bearer revoked']) {
      assert.deepEqual(await mutation(context.base, 'rename', authorization, renameBody()), {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(readCalls, 0);
    assert.deepEqual(baseline(), before);
    assert.equal((await mutation(context.base, 'rename', 'Bearer renamer', renameBody())).status, 200);
    const accepted = baseline();
    assert.deepEqual(await mutation(context.base, 'rename', 'Bearer renamer', renameBody()), {
      status: 200, body: { record: accepted.record },
    });
    assert.deepEqual(baseline(), accepted);
    for (const body of [
      renameBody({ expectedRevision: 1, requestId: 'id_aaaaaaaaaaaaaaaa', title: 'Stale rename' }),
      renameBody({ requestId: 'id_bbbbbbbbbbbbbbbb', title: 'x'.repeat(241) }),
      { ...renameBody({ requestId: 'id_cccccccccccccccc' }), tenantId: TENANT_B },
      renameBody({ requestId: 'id_dddddddddddddddd', occurredAt: '2026-09-26T12:06:00.000Z' }),
    ]) {
      const denied = await mutation(context.base, 'rename', 'Bearer renamer', body);
      assert.equal([404, 409].includes(denied.status), true);
      assert.deepEqual(baseline(), accepted);
    }
  } finally {
    await context.close();
  }
});

test('authorized reassignment resolves active same-tenant assignees and appends snapshots', async () => {
  const resolutions = [];
  const context = await fixture({
    identities: { 'Bearer reassigner': identity(['record.reassign']) },
    resolveTrustedReferences: async (scope) => { resolutions.push(scope); return true; },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const result = await mutation(
      context.base, 'reassignment', 'Bearer reassigner', reassignmentBody(),
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.record.assignees, [
      { tenantId: TENANT_A, subjectId: 'id_bbbbbbbbbbbbbbbb' },
      { tenantId: TENANT_A, subjectId: 'id_cccccccccccccccc' },
    ]);
    assert.equal(result.body.record.revision, 2);
    assert.equal(resolutions.length, 1);
    assert.deepEqual(resolutions[0].assigneeSubjectIds, reassignmentBody().assigneeSubjectIds);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 2);
    assert.equal(history[1].eventKind, 'reassignment');
    assert.deepEqual(history[1].changedFields.assignees, {
      prior: [], next: reassignmentBody().assigneeSubjectIds,
    });
  } finally {
    await context.close();
  }
});

test('reassignment rejects stale and conflicting requests while replaying identical requests atomically', async () => {
  const context = await fixture({
    identities: { 'Bearer reassigner': identity(['record.reassign']) },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const snapshot = () => ({
    record: context.store.read(TENANT_A, RECORD),
    history: context.store.readHistory(TENANT_A, RECORD, 50),
    requests: Number(context.store.database.prepare(
      'SELECT count(*) AS count FROM private_mutation_requests',
    ).get().count),
  });
  try {
    const accepted = await mutation(
      context.base, 'reassignment', 'Bearer reassigner', reassignmentBody(),
    );
    assert.equal(accepted.status, 200);
    const afterAccepted = snapshot();
    assert.deepEqual(await mutation(
      context.base, 'reassignment', 'Bearer reassigner', reassignmentBody(),
    ), accepted);
    assert.deepEqual(snapshot(), afterAccepted);
    assert.deepEqual(await mutation(
      context.base,
      'reassignment',
      'Bearer reassigner',
      reassignmentBody({ assigneeSubjectIds: ['id_dddddddddddddddd'] }),
    ), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(), afterAccepted);
    assert.deepEqual(await mutation(
      context.base,
      'reassignment',
      'Bearer reassigner',
      reassignmentBody({ requestId: 'id_eeeeeeeeeeeeeeee', expectedRevision: 1 }),
    ), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(), afterAccepted);
  } finally {
    await context.close();
  }
});

test('mutation routes reject malformed unsupported and oversized bodies with private headers', async (t) => {
  const context = await fixture({
    identities: {
      'Bearer mutator': identity(['record.rename', 'record.reassign']),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const baseline = {
    record: context.store.read(TENANT_A, RECORD),
    history: context.store.readHistory(TENANT_A, RECORD, 50),
    requests: Number(context.store.database.prepare(
      'SELECT count(*) AS count FROM private_mutation_requests',
    ).get().count),
  };
  try {
    for (const [kind, validBody] of [
      ['rename', renameBody()],
      ['reassignment', reassignmentBody()],
    ]) {
      for (const [caseName, contentType, body] of [
        ['malformed', 'application/json', '{'],
        ['unsupported-content-type', 'text/plain', JSON.stringify(validBody)],
        ['oversized', 'application/json', JSON.stringify(validBody).padEnd(40_000, ' ')],
      ]) {
        await t.test(`${kind} ${caseName}`, async () => {
          const result = await rawRequest(
            context.base,
            `/api/private/tenants/${TENANT_A}/records/${RECORD}/${kind}`,
            {
              method: 'POST',
              authorization: 'Bearer mutator',
              contentType,
              body,
            },
          );
          assert.equal(result.status, 404);
          assert.deepEqual(result.body, { error: 'not_found' });
          assert.equal(result.headers['cache-control'], 'private, no-store');
          assert.equal(result.headers.vary, 'authorization');
          assert.equal(result.headers['x-content-type-options'], 'nosniff');
          assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
          assert.equal(Number(result.headers['content-length']), Buffer.byteLength(result.text));
        });
      }
    }
    assert.deepEqual({
      record: context.store.read(TENANT_A, RECORD),
      history: context.store.readHistory(TENANT_A, RECORD, 50),
      requests: Number(context.store.database.prepare(
        'SELECT count(*) AS count FROM private_mutation_requests',
      ).get().count),
    }, baseline);
  } finally {
    await context.close();
  }
});

test('history read is separately authorized tenant-scoped bounded and non-enumerating', async () => {
  const context = await fixture({
    identities: {
      'Bearer historian': identity(['record.history.read']),
      'Bearer reader': identity(['record.read']),
      'Bearer renamer': identity(['record.rename']),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    assert.equal((await mutation(context.base, 'rename', 'Bearer renamer', renameBody())).status, 200);
    context.store.mutate(
      {
        ...context.store.read(TENANT_A, RECORD),
        assignees: [{ tenantId: TENANT_A, subjectId: 'id_bbbbbbbbbbbbbbbb' }],
        revision: 3,
      },
      {
        auditId: 'id_aaaaaaaaaaaaaaaa', tenantId: TENANT_A, recordId: RECORD,
        eventKind: 'reassignment', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
        policyRevision: 'policy-1', sourceId: SOURCE, reasonRef: 'direction-history',
        priorRevision: 2, newRevision: 3, occurredAt: MUTATED, recordedAt: MUTATED,
        changedFields: { assignees: { prior: [], next: ['id_bbbbbbbbbbbbbbbb'] } },
      },
      2,
    );
    const url = `${context.base}/api/private/tenants/${TENANT_A}/records/${RECORD}/history`;
    const accepted = await json(fetch(url, { headers: { authorization: 'Bearer historian' } }));
    assert.equal(accepted.status, 200);
    assert.equal(Object.keys(accepted.body).join(','), 'history');
    assert.equal(accepted.body.history.length, 3);
    assert.deepEqual(accepted.body.history.map((event) => event.eventKind), [
      'creation', 'rename', 'reassignment',
    ]);
    assert.deepEqual(accepted.body.history.map((event) => event.newRevision), [1, 2, 3]);
    assert.equal(accepted.body.history[2].source.availability, 'unavailable');
    assert.deepEqual(accepted.body.history[2].changedFields.assignees.next, [{
      subjectId: 'id_bbbbbbbbbbbbbbbb', availability: 'unavailable',
    }]);
    assert.equal(JSON.stringify(accepted.body).includes('requestId'), false);
    assert.equal(JSON.stringify(accepted.body).includes('request_semantics'), false);

    let historyCalls = 0;
    const originalReadHistory = context.store.readHistory.bind(context.store);
    context.store.readHistory = (...args) => { historyCalls += 1; return originalReadHistory(...args); };
    for (const authorization of ['Bearer missing', 'Bearer reader']) {
      assert.deepEqual(await json(fetch(url, { headers: { authorization } })), {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(historyCalls, 0);
    for (const path of [
      `/api/private/tenants/${TENANT_A}/records/${RECORD}/history/`,
      `/api/private/tenants/${TENANT_A}/records/${RECORD}/history?limit=1`,
      `/api/private/tenants/${TENANT_A}/records/history/${RECORD}`,
      `/api/private/tenants/${TENANT_A}/audits/id_7777777777777777`,
    ]) {
      assert.deepEqual(await json(fetch(`${context.base}${path}`, {
        headers: { authorization: 'Bearer historian' },
      })), { status: 404, body: { error: 'not_found' } });
    }
  } finally {
    await context.close();
  }
});

test('history denies foreign record and route tenants with the same non-enumerating response', async () => {
  const context = await fixture({
    identities: { 'Bearer historian': identity(['record.history.read']) },
  });
  const local = recordFixture();
  const foreign = recordFixture({ tenantId: TENANT_B, recordId: 'id_ffffffffffffffff' });
  context.store.create(local, creationAudit(local), 0);
  context.store.create(foreign, creationAudit(foreign, 'id_eeeeeeeeeeeeeeee'), 0);
  const get = (tenantId, recordId) => json(fetch(
    `${context.base}/api/private/tenants/${tenantId}/records/${recordId}/history`,
    { headers: { authorization: 'Bearer historian' } },
  ));
  try {
    assert.equal((await get(TENANT_A, RECORD)).status, 200);
    const denial = { status: 404, body: { error: 'not_found' } };
    assert.deepEqual(await get(TENANT_A, foreign.recordId), denial);
    assert.deepEqual(await get(TENANT_B, foreign.recordId), denial);
    assert.deepEqual(await get(TENANT_A, 'id_dddddddddddddddd'), denial);
  } finally {
    await context.close();
  }
});

test('history returns the first 50 of more than 50 events in stable append order', async () => {
  const context = await fixture({
    identities: { 'Bearer historian': identity(['record.history.read']) },
  });
  let current = recordFixture();
  context.store.create(current, creationAudit(current), 0);
  for (let revision = 2; revision <= 55; revision += 1) {
    const next = {
      ...current,
      title: `Synthetic title revision ${revision}`,
      revision,
      updatedAt: MUTATED,
    };
    assert.deepEqual(context.store.mutate(next, {
      auditId: `id_${revision.toString(16).padStart(16, '0')}`,
      tenantId: TENANT_A,
      recordId: RECORD,
      eventKind: 'rename',
      actorSubjectId: ACTOR,
      authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1',
      sourceId: SOURCE,
      reasonRef: `direction-bound-${revision}`,
      priorRevision: revision - 1,
      newRevision: revision,
      occurredAt: MUTATED,
      recordedAt: MUTATED,
      changedFields: { title: { prior: current.title, next: next.title } },
    }, revision - 1), { ok: true, replayed: false });
    current = next;
  }
  const url = `${context.base}/api/private/tenants/${TENANT_A}/records/${RECORD}/history`;
  try {
    const first = await json(fetch(url, { headers: { authorization: 'Bearer historian' } }));
    const second = await json(fetch(url, { headers: { authorization: 'Bearer historian' } }));
    assert.equal(first.status, 200);
    assert.equal(first.body.history.length, 50);
    assert.deepEqual(first.body, second.body);
    assert.deepEqual(
      first.body.history.map((event) => event.newRevision),
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
    assert.equal(first.body.history.at(-1).changedFields.title.next, 'Synthetic title revision 50');
    assert.equal(JSON.stringify(first.body).includes('Synthetic title revision 51'), false);
  } finally {
    await context.close();
  }
});

test('history alternate route matrix fails closed without aliases or aggregate surfaces', async (t) => {
  const context = await fixture({
    identities: { 'Bearer historian': identity(['record.history.read']) },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const paths = [
    `/api/private/records/${RECORD}/history`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/history/`,
    `/api/private//tenants/${TENANT_A}/records/${RECORD}/history`,
    `/api/private/x/../tenants/${TENANT_A}/records/${RECORD}/history`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/history?limit=1`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/search`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/count`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/export`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/batch`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/evidence`,
    `/api/private/tenants/${TENANT_A}/audits/id_7777777777777777`,
    `/api/private/tenants/${TENANT_A}/records/history/${RECORD}`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/audit`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/audit-history`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/material-history`,
    `/api/private/tenants/${TENANT_A}/records/${RECORD}/history-events`,
  ];
  try {
    for (const path of paths) {
      await t.test(path, async () => {
        const result = await rawRequest(context.base, path, {
          authorization: 'Bearer historian',
        });
        assert.equal(result.status, 404);
        assert.deepEqual(result.body, { error: 'not_found' });
        assert.equal(result.headers['cache-control'], 'private, no-store');
        assert.equal(result.headers.vary, 'authorization');
      });
    }
  } finally {
    await context.close();
  }
});

test('rename and reassignment roll back record audit and request identity at every write boundary', async (t) => {
  const context = await fixture({
    identities: {
      'Bearer renamer': identity(['record.rename']),
      'Bearer reassigner': identity(['record.reassign']),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const snapshot = () => ({
    record: context.store.read(TENANT_A, RECORD),
    history: context.store.readHistory(TENANT_A, RECORD, 50),
    requests: context.store.database.prepare(`
      SELECT tenant_id, principal_id, authorization_id, policy_revision,
        operation, request_id, request_semantics, record_json
      FROM private_mutation_requests ORDER BY rowid
    `).all(),
  });
  const baseline = snapshot();
  const boundaries = [
    ['record-update', 'BEFORE UPDATE ON private_work_records', 'a'],
    ['audit-append', 'BEFORE INSERT ON private_material_audit_events', 'b'],
    ['request-identity', 'BEFORE INSERT ON private_mutation_requests', 'c'],
  ];
  try {
    for (const [operation, authorization, makeBody, prefix] of [
      ['rename', 'Bearer renamer', renameBody, 'd'],
      ['reassignment', 'Bearer reassigner', reassignmentBody, 'e'],
    ]) {
      for (const [boundary, clause, suffix] of boundaries) {
        await t.test(`${operation} ${boundary}`, async () => {
          context.store.database.exec(`
            CREATE TRIGGER fail_mutation_boundary ${clause}
            BEGIN SELECT RAISE(ABORT, 'synthetic ${boundary} failure'); END;
          `);
          try {
            const requestId = `id_${prefix}${suffix.repeat(15)}`;
            assert.deepEqual(await mutation(
              context.base,
              operation,
              authorization,
              makeBody({ requestId }),
            ), { status: 409, body: { error: 'conflict' } });
            assert.deepEqual(snapshot(), baseline);
          } finally {
            context.store.database.exec('DROP TRIGGER fail_mutation_boundary');
          }
        });
      }
    }
  } finally {
    await context.close();
  }
});

test('restart persistence and transaction-boundary failure preserve record audit and replay identity', async () => {
  const { PrivateWorkRecordsStore } = await import('../server/privateWorkRecordsStore.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'office-private-history-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const original = recordFixture();
  let store = new PrivateWorkRecordsStore(databasePath);
  try {
    store.create(original, creationAudit(original), 0);
    const renamed = { ...original, title: 'Persisted rename', revision: 2, updatedAt: MUTATED };
    const audit = {
      auditId: 'id_8888888888888888', tenantId: TENANT_A, recordId: RECORD,
      eventKind: 'rename', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', sourceId: SOURCE, reasonRef: 'direction-persistence',
      priorRevision: 1, newRevision: 2, occurredAt: MUTATED, recordedAt: MUTATED,
      changedFields: { title: { prior: original.title, next: renamed.title } },
    };
    const requestIdentity = {
      tenantId: TENANT_A, principalId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', operation: 'rename', requestId: 'id_9999999999999999',
      requestSemantics: 'persisted-semantics',
    };
    assert.deepEqual(store.mutate(renamed, audit, 1, requestIdentity), {
      ok: true, replayed: false,
    });
    store.close();
    store = new PrivateWorkRecordsStore(databasePath);
    assert.deepEqual(store.read(TENANT_A, RECORD), renamed);
    assert.equal(store.readHistory(TENANT_A, RECORD, 50).length, 2);
    assert.equal(Number(store.database.prepare(
      'SELECT count(*) AS count FROM private_mutation_requests',
    ).get().count), 1);

    store.database.exec(`
      CREATE TRIGGER fail_mutation_request BEFORE INSERT ON private_mutation_requests
      BEGIN SELECT RAISE(ABORT, 'synthetic request failure'); END;
    `);
    const next = {
      ...renamed, title: 'Must roll back', revision: 3,
      updatedAt: '2026-09-26T12:06:00.000Z',
    };
    const nextAudit = {
      ...audit, auditId: 'id_aaaaaaaaaaaaaaaa', priorRevision: 2,
      newRevision: 3, occurredAt: next.updatedAt, recordedAt: next.updatedAt,
      changedFields: { title: { prior: renamed.title, next: next.title } },
    };
    const failed = store.mutate(next, nextAudit, 2, {
      ...requestIdentity, requestId: 'id_bbbbbbbbbbbbbbbb', requestSemantics: 'must-fail',
    });
    assert.equal(failed.ok, false);
    assert.deepEqual(store.read(TENANT_A, RECORD), renamed);
    assert.equal(store.readHistory(TENANT_A, RECORD, 50).length, 2);
    assert.equal(Number(store.database.prepare(
      'SELECT count(*) AS count FROM private_mutation_requests',
    ).get().count), 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reassignment denial precedes reference resolution and rejected references are atomic', async () => {
  let resolutions = 0;
  const context = await fixture({
    identities: {
      'Bearer reader': identity(['record.read']),
      'Bearer renamer': identity(['record.rename']),
      'Bearer historian': identity(['record.history.read']),
      'Bearer reassigner': identity(['record.reassign']),
    },
    resolveTrustedReferences: async () => { resolutions += 1; return false; },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const baseline = () => ({
    record: context.store.read(TENANT_A, RECORD),
    history: context.store.readHistory(TENANT_A, RECORD, 50),
  });
  try {
    const before = baseline();
    for (const authorization of ['Bearer missing', 'Bearer reader', 'Bearer renamer', 'Bearer historian']) {
      assert.deepEqual(await mutation(
        context.base, 'reassignment', authorization, reassignmentBody(),
      ), { status: 404, body: { error: 'not_found' } });
    }
    assert.equal(resolutions, 0);
    assert.deepEqual(baseline(), before);
    assert.deepEqual(await mutation(
      context.base, 'reassignment', 'Bearer reassigner', reassignmentBody(),
    ), { status: 404, body: { error: 'not_found' } });
    assert.equal(resolutions, 1);
    assert.deepEqual(baseline(), before);
    for (const body of [
      reassignmentBody({ assigneeSubjectIds: ['id_bbbbbbbbbbbbbbbb', 'id_bbbbbbbbbbbbbbbb'] }),
      reassignmentBody({ assigneeSubjectIds: Array.from({ length: 51 }, (_, index) =>
        `id_${index.toString(16).padStart(16, '0')}`) }),
      { ...reassignmentBody(), tenantId: TENANT_B },
    ]) {
      assert.deepEqual(await mutation(
        context.base, 'reassignment', 'Bearer reassigner', body,
      ), { status: 404, body: { error: 'not_found' } });
    }
    assert.equal(resolutions, 1);
    assert.deepEqual(baseline(), before);
  } finally {
    await context.close();
  }
});
