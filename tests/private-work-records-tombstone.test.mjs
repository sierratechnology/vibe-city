import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
const EVIDENCE = 'id_7777777777777777';
const CREATED = '2026-09-26T12:00:00.000Z';
const ARCHIVED = '2026-09-26T12:05:00.000Z';
const ARCHIVE_RECORDED = '2026-09-26T12:06:00.000Z';
const DELETED = '2026-09-26T12:10:00.000Z';
const DELETE_RECORDED = '2026-09-26T12:11:00.000Z';

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

function recordFixture({ tenantId = TENANT_A, recordId = RECORD, lifecycle = 'open' } = {}) {
  return {
    tenantId, recordId, title: 'Synthetic tombstone record',
    owner: { tenantId, subjectId: ACTOR }, assignees: [], lifecycle,
    freshness: 'unknown', sensitivity: 'tenant_private', revision: 1,
    createdAt: CREATED, updatedAt: CREATED,
    source: {
      tenantId, sourceId: SOURCE,
      occurredAt: '2026-09-26T11:58:00.000Z',
      observedAt: '2026-09-26T11:59:00.000Z', recordedAt: CREATED,
    },
    evidence: [{
      tenantId, evidenceId: EVIDENCE,
      locator: 'urn:stg:evidence:synthetic-tombstone', recordedAt: CREATED,
    }],
    supersedes: null, correctionOf: null,
    archivedAt: null, deletedAt: null,
  };
}

function creationAudit(record) {
  return {
    auditId: 'id_aaaaaaaaaaaaaaaa', tenantId: record.tenantId, recordId: record.recordId,
    actorSubjectId: ACTOR, authorizationId: AUTHORIZATION, policyRevision: 'policy-1',
    sourceId: SOURCE, priorRevision: 0, newRevision: 1,
    occurredAt: CREATED, recordedAt: CREATED, changedFields: ['recordId'],
  };
}

function archiveBody(overrides = {}) {
  return {
    expectedRevision: 1, requestId: 'id_bbbbbbbbbbbbbbbb',
    occurredAt: ARCHIVED, reasonRef: 'direction-synthetic-archive', ...overrides,
  };
}

function tombstoneBody(overrides = {}) {
  return {
    expectedRevision: 2, requestId: 'id_cccccccccccccccc',
    occurredAt: DELETED, reasonRef: 'direction-synthetic-tombstone', ...overrides,
  };
}

async function fixture({ identities, databasePath, nowValues = [ARCHIVE_RECORDED, DELETE_RECORDED] } = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import('../server/privateWorkRecordsApi.mjs'),
    import('../server/privateWorkRecordsStore.mjs'),
    loadDomain(),
  ]);
  const directory = databasePath ? null : mkdtempSync(join(tmpdir(), 'office-private-tombstone-'));
  const path = databasePath ?? join(directory, 'records.sqlite');
  const store = new PrivateWorkRecordsStore(path);
  let sequence = 11;
  let nowIndex = 0;
  const server = createServer(createPrivateWorkRecordsApiHandler({
    store, domain,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences: async () => true,
    now: () => Date.parse(nowValues[Math.min(nowIndex++, nowValues.length - 1)]),
    generateId: () => `id_${(sequence++).toString(16).repeat(16)}`,
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`, store,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
      if (directory !== null) rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function json(responsePromise) {
  const response = await responsePromise;
  return { status: response.status, body: await response.json() };
}

function postMutation(base, authorization, action, body, recordId = RECORD, tenantId = TENANT_A) {
  return json(fetch(`${base}/api/private/tenants/${tenantId}/records/${recordId}/${action}`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function archive(base, authorization, body = archiveBody(), recordId = RECORD, tenantId = TENANT_A) {
  return postMutation(base, authorization, 'archive', body, recordId, tenantId);
}

function tombstone(base, authorization, body = tombstoneBody(), recordId = RECORD, tenantId = TENANT_A) {
  return postMutation(base, authorization, 'tombstone', body, recordId, tenantId);
}

function snapshot(context) {
  return {
    record: context.store.read(TENANT_A, RECORD),
    history: context.store.readHistory(TENANT_A, RECORD, 50),
    requests: context.store.database.prepare(
      'SELECT operation, request_id, request_semantics, record_json FROM private_mutation_requests ORDER BY rowid',
    ).all(),
  };
}

async function seedArchived(context, authorization = 'Bearer operator') {
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const archived = await archive(context.base, authorization);
  assert.equal(archived.status, 200);
  return { original, archived };
}

test('authorized tombstone preserves canonical archived facts and appends one material event', async () => {
  const context = await fixture({
    identities: { 'Bearer operator': identity(['record.archive', 'record.delete']) },
  });
  try {
    const { original } = await seedArchived(context);
    const result = await tombstone(context.base, 'Bearer operator');
    assert.equal(result.status, 200);
    assert.equal(result.body.record.tenantId, TENANT_A);
    assert.equal(result.body.record.recordId, RECORD);
    assert.equal(result.body.record.title, original.title);
    assert.deepEqual(result.body.record.source, original.source);
    assert.deepEqual(result.body.record.evidence, original.evidence);
    assert.equal(result.body.record.lifecycle, 'deleted');
    assert.equal(result.body.record.archivedAt, ARCHIVED);
    assert.equal(result.body.record.deletedAt, DELETED);
    assert.equal(result.body.record.stateChangedAt, DELETED);
    assert.equal(result.body.record.updatedAt, DELETE_RECORDED);
    assert.equal(result.body.record.revision, 3);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 3);
    assert.deepEqual(history.map((event) => event.eventKind ?? 'creation'), [
      'creation', 'archive', 'tombstone',
    ]);
    assert.deepEqual(history[2], {
      auditId: 'id_cccccccccccccccc', tenantId: TENANT_A, recordId: RECORD,
      eventKind: 'tombstone', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', sourceId: SOURCE,
      reasonRef: 'direction-synthetic-tombstone', priorRevision: 2, newRevision: 3,
      occurredAt: DELETED, recordedAt: DELETE_RECORDED,
      changedFields: {
        lifecycle: { prior: 'archived', next: 'deleted' },
        deletedAt: { prior: null, next: DELETED },
      },
    });
  } finally {
    await context.close();
  }
});

test('delete authority and active tenant membership precede record lookup', async () => {
  const context = await fixture({ identities: {
    'Bearer operator': identity(['record.archive', 'record.delete']),
    'Bearer reader': identity(['record.read']),
    'Bearer archiver': identity(['record.archive']),
    'Bearer renamer': identity(['record.rename']),
    'Bearer reassigner': identity(['record.reassign']),
    'Bearer blocker': identity(['record.block']),
    'Bearer unblocker': identity(['record.unblock']),
    'Bearer historian': identity(['record.history.read']),
    'Bearer updater': identity(['record.transition']),
    'Bearer inactive': identity(['record.delete'], { active: false }),
    'Bearer foreign': identity(['record.delete'], { tenantId: TENANT_B }),
  } });
  try {
    await seedArchived(context);
    const baseline = snapshot(context);
    let reads = 0;
    const originalRead = context.store.read.bind(context.store);
    context.store.read = (...args) => { reads += 1; return originalRead(...args); };
    for (const authorization of [
      'Bearer missing', 'Bearer reader', 'Bearer archiver', 'Bearer renamer',
      'Bearer reassigner', 'Bearer blocker', 'Bearer unblocker', 'Bearer historian',
      'Bearer updater', 'Bearer inactive', 'Bearer foreign',
    ]) {
      assert.deepEqual(await tombstone(context.base, authorization), {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(reads, 0);
    assert.deepEqual(snapshot(context), baseline);
    reads = 0;
    assert.deepEqual(await tombstone(context.base, 'Bearer operator', {
      ...tombstoneBody(), tenantId: TENANT_B,
    }), { status: 404, body: { error: 'not_found' } });
    assert.equal(reads, 0);
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('tombstone replay is idempotent while conflicting and stale identities are atomic', async () => {
  const context = await fixture({
    identities: { 'Bearer operator': identity(['record.archive', 'record.delete']) },
  });
  try {
    await seedArchived(context);
    const accepted = await tombstone(context.base, 'Bearer operator');
    assert.equal(accepted.status, 200);
    const afterAccepted = snapshot(context);
    assert.deepEqual(await tombstone(context.base, 'Bearer operator'), accepted);
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await tombstone(context.base, 'Bearer operator', tombstoneBody({
      reasonRef: 'conflicting-tombstone-reason',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await tombstone(context.base, 'Bearer operator', tombstoneBody({
      requestId: 'id_dddddddddddddddd', expectedRevision: 2,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await tombstone(context.base, 'Bearer operator', tombstoneBody({
      requestId: 'id_eeeeeeeeeeeeeeee', expectedRevision: 3,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
  } finally {
    await context.close();
  }
});

test('non-archived and already tombstoned records reject deletion without rewriting history', async (t) => {
  for (const [name, record] of [
    ['open', recordFixture()],
    ['in-progress', recordFixture({ lifecycle: 'in_progress' })],
    ['completed', recordFixture({ lifecycle: 'completed' })],
    ['blocked', {
      ...recordFixture({ lifecycle: 'blocked' }), updatedAt: ARCHIVED,
      stateChangedAt: ARCHIVED,
      blockReason: { category: 'dependency', summary: 'Synthetic dependency', blockedAt: ARCHIVED },
    }],
    ['deleted', {
      ...recordFixture({ lifecycle: 'deleted' }), updatedAt: DELETED,
      archivedAt: ARCHIVED, deletedAt: DELETED, stateChangedAt: DELETED,
    }],
  ]) {
    await t.test(name, async () => {
      const context = await fixture({ identities: {
        'Bearer deleter': identity(['record.delete']),
      } });
      context.store.create(record, creationAudit(record), 0);
      const baseline = snapshot(context);
      try {
        assert.deepEqual(await tombstone(context.base, 'Bearer deleter', tombstoneBody({
          expectedRevision: 1,
        })), { status: 409, body: { error: 'conflict' } });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('tombstone malformed chronology tenant and alternate-route matrix fails closed with zero delta', async () => {
  const context = await fixture({ identities: {
    'Bearer operator': identity(['record.archive', 'record.delete']),
  } });
  try {
    await seedArchived(context);
    const baseline = snapshot(context);
    const canonical = `/api/private/tenants/${TENANT_A}/records/${RECORD}/tombstone`;
    const postRaw = async (path, body, contentType = 'application/json') => json(fetch(
      `${context.base}${path}`,
      { method: 'POST', headers: { authorization: 'Bearer operator', 'content-type': contentType }, body },
    ));
    for (const result of [
      await postRaw(canonical, '{'),
      await postRaw(canonical, JSON.stringify(tombstoneBody()), 'text/plain'),
      await postRaw(canonical, JSON.stringify(tombstoneBody()).padEnd(40_000, ' ')),
      await tombstone(context.base, 'Bearer operator', tombstoneBody({ occurredAt: 'not-a-time' })),
      await tombstone(context.base, 'Bearer operator', tombstoneBody({
        occurredAt: '2026-09-26T12:05:59.000Z',
      })),
      await tombstone(context.base, 'Bearer operator', tombstoneBody({
        occurredAt: '2026-09-26T12:12:00.000Z',
      })),
      await tombstone(context.base, 'Bearer operator', tombstoneBody(), RECORD, TENANT_B),
      await tombstone(context.base, 'Bearer operator', tombstoneBody(), 'id_9999999999999999'),
      await postRaw(`${canonical}/`, JSON.stringify(tombstoneBody())),
      await postRaw(`${canonical}?force=true`, JSON.stringify(tombstoneBody())),
      await postRaw(`/api/private/records/${RECORD}/tombstone`, JSON.stringify(tombstoneBody())),
      await postRaw(`/api/private/tenants/${TENANT_A}/records/${RECORD}/delete`, JSON.stringify(tombstoneBody())),
    ]) {
      assert.deepEqual(result, { status: 404, body: { error: 'not_found' } });
    }
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('tombstone rolls back record audit and request identity at every write boundary', async (t) => {
  const boundaries = [
    ['record-update', 'BEFORE UPDATE ON private_work_records'],
    ['audit-append', 'BEFORE INSERT ON private_material_audit_events'],
    ['request-identity', 'BEFORE INSERT ON private_mutation_requests'],
  ];
  for (const [boundary, clause] of boundaries) {
    await t.test(boundary, async () => {
      const context = await fixture({ identities: {
        'Bearer operator': identity(['record.archive', 'record.delete']),
      } });
      try {
        await seedArchived(context);
        const baseline = snapshot(context);
        context.store.database.exec(`
          CREATE TRIGGER fail_tombstone_boundary ${clause}
          BEGIN SELECT RAISE(ABORT, 'synthetic tombstone failure'); END;
        `);
        assert.deepEqual(await tombstone(context.base, 'Bearer operator'), {
          status: 409, body: { error: 'conflict' },
        });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('tombstoned state history references active-list exclusion and replay survive clean restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-private-tombstone-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const identities = {
    'Bearer operator': identity([
      'record.archive', 'record.delete', 'record.read', 'record.history.read',
    ]),
  };
  let running;
  try {
    running = await fixture({ identities, databasePath });
    const { original } = await seedArchived(running);
    const accepted = await tombstone(running.base, 'Bearer operator');
    assert.equal(accepted.status, 200);
    await running.close();
    running = null;

    running = await fixture({ identities, databasePath });
    assert.deepEqual(running.store.read(TENANT_A, RECORD), accepted.body.record);
    assert.equal(running.store.countRecords(TENANT_A), 1);
    const root = `${running.base}/api/private/tenants/${TENANT_A}/records`;
    assert.deepEqual(await json(fetch(root, {
      headers: { authorization: 'Bearer operator' },
    })), { status: 200, body: { records: [], count: 0, cursor: null } });
    const ordinaryRecord = structuredClone(accepted.body.record);
    for (const evidence of ordinaryRecord.evidence) delete evidence.locator;
    assert.deepEqual(await json(fetch(`${root}/${RECORD}`, {
      headers: { authorization: 'Bearer operator' },
    })), { status: 200, body: { record: ordinaryRecord } });
    const history = await json(fetch(`${root}/${RECORD}/history`, {
      headers: { authorization: 'Bearer operator' },
    }));
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.history.map((event) => event.eventKind), [
      'creation', 'archive', 'tombstone',
    ]);
    assert.deepEqual(accepted.body.record.source, original.source);
    assert.deepEqual(accepted.body.record.evidence, original.evidence);
    const beforeReplay = snapshot(running);
    assert.deepEqual(await tombstone(running.base, 'Bearer operator'), accepted);
    assert.deepEqual(snapshot(running), beforeReplay);
  } finally {
    if (running !== null && running !== undefined) await running.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
