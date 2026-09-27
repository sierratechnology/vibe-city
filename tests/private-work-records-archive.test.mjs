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
const CREATED = '2026-09-26T12:00:00.000Z';
const ARCHIVED = '2026-09-26T12:05:00.000Z';
const RECORDED = '2026-09-26T12:06:00.000Z';

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
    tenantId, recordId, title: 'Synthetic archive record',
    owner: { tenantId, subjectId: ACTOR }, assignees: [], lifecycle,
    freshness: 'unknown', sensitivity: 'tenant_private', revision: 1,
    createdAt: CREATED, updatedAt: CREATED,
    source: {
      tenantId, sourceId: SOURCE,
      occurredAt: '2026-09-26T11:58:00.000Z',
      observedAt: '2026-09-26T11:59:00.000Z', recordedAt: CREATED,
    },
    evidence: [], supersedes: null, correctionOf: null,
    archivedAt: null, deletedAt: null,
  };
}

function creationAudit(record, auditId = 'id_aaaaaaaaaaaaaaaa') {
  return {
    auditId, tenantId: record.tenantId, recordId: record.recordId,
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

async function fixture({ identities, databasePath, now = Date.parse(RECORDED) } = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import('../server/privateWorkRecordsApi.mjs'),
    import('../server/privateWorkRecordsStore.mjs'),
    loadDomain(),
  ]);
  const directory = databasePath ? null : mkdtempSync(join(tmpdir(), 'office-private-archive-'));
  const path = databasePath ?? join(directory, 'records.sqlite');
  const store = new PrivateWorkRecordsStore(path);
  let sequence = 11;
  const server = createServer(createPrivateWorkRecordsApiHandler({
    store, domain,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences: async () => true,
    now: () => now,
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

function archive(base, authorization, body = archiveBody(), recordId = RECORD, tenantId = TENANT_A) {
  return json(fetch(`${base}/api/private/tenants/${tenantId}/records/${recordId}/archive`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
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

test('authorized archive preserves identity and prior facts while appending one material event', async () => {
  const context = await fixture({ identities: { 'Bearer archiver': identity(['record.archive']) } });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const result = await archive(context.base, 'Bearer archiver');
    assert.equal(result.status, 200);
    assert.equal(result.body.record.tenantId, TENANT_A);
    assert.equal(result.body.record.recordId, RECORD);
    assert.equal(result.body.record.title, original.title);
    assert.equal(result.body.record.lifecycle, 'archived');
    assert.equal(result.body.record.archivedAt, ARCHIVED);
    assert.equal(result.body.record.stateChangedAt, ARCHIVED);
    assert.equal(result.body.record.updatedAt, RECORDED);
    assert.equal(result.body.record.revision, 2);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 2);
    assert.deepEqual(history[1], {
      auditId: 'id_bbbbbbbbbbbbbbbb', tenantId: TENANT_A, recordId: RECORD,
      eventKind: 'archive', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', sourceId: SOURCE,
      reasonRef: 'direction-synthetic-archive', priorRevision: 1, newRevision: 2,
      occurredAt: ARCHIVED, recordedAt: RECORDED,
      changedFields: {
        lifecycle: { prior: 'open', next: 'archived' },
        archivedAt: { prior: null, next: ARCHIVED },
      },
    });
  } finally {
    await context.close();
  }
});

test('archive authority and active tenant membership precede record lookup', async () => {
  const context = await fixture({ identities: {
    'Bearer archiver': identity(['record.archive']),
    'Bearer reader': identity(['record.read']),
    'Bearer renamer': identity(['record.rename']),
    'Bearer reassigner': identity(['record.reassign']),
    'Bearer blocker': identity(['record.block']),
    'Bearer unblocker': identity(['record.unblock']),
    'Bearer historian': identity(['record.history.read']),
    'Bearer updater': identity(['record.transition']),
    'Bearer inactive': identity(['record.archive'], { active: false }),
    'Bearer foreign': identity(['record.archive'], { tenantId: TENANT_B }),
  } });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const baseline = snapshot(context);
  let reads = 0;
  const originalRead = context.store.read.bind(context.store);
  context.store.read = (...args) => { reads += 1; return originalRead(...args); };
  try {
    for (const authorization of [
      'Bearer missing', 'Bearer reader', 'Bearer renamer', 'Bearer reassigner',
      'Bearer blocker', 'Bearer unblocker', 'Bearer historian', 'Bearer updater',
      'Bearer inactive', 'Bearer foreign',
    ]) {
      assert.deepEqual(await archive(context.base, authorization), {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(reads, 0);
    assert.deepEqual(snapshot(context), baseline);
    reads = 0;
    assert.deepEqual(await archive(context.base, 'Bearer archiver', {
      ...archiveBody(), tenantId: TENANT_B,
    }), { status: 404, body: { error: 'not_found' } });
    assert.equal(reads, 0);
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('archive replay is idempotent while conflicting stale and invalid lifecycle requests are atomic', async () => {
  const context = await fixture({ identities: { 'Bearer archiver': identity(['record.archive']) } });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const accepted = await archive(context.base, 'Bearer archiver');
    assert.equal(accepted.status, 200);
    const afterAccepted = snapshot(context);
    assert.deepEqual(await archive(context.base, 'Bearer archiver'), accepted);
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await archive(context.base, 'Bearer archiver', archiveBody({
      reasonRef: 'conflicting-archive-reason',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await archive(context.base, 'Bearer archiver', archiveBody({
      requestId: 'id_cccccccccccccccc', expectedRevision: 1,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await archive(context.base, 'Bearer archiver', archiveBody({
      requestId: 'id_dddddddddddddddd', expectedRevision: 2,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
  } finally {
    await context.close();
  }
});

test('archive removes the record from active list while direct read and history remain available', async () => {
  const context = await fixture({ identities: {
    'Bearer operator': identity(['record.archive', 'record.read', 'record.history.read']),
  } });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const accepted = await archive(context.base, 'Bearer operator');
    assert.equal(accepted.status, 200);
    const root = `${context.base}/api/private/tenants/${TENANT_A}/records`;
    assert.deepEqual(await json(fetch(root, {
      headers: { authorization: 'Bearer operator' },
    })), { status: 200, body: { records: [], count: 0, cursor: null } });
    assert.deepEqual(await json(fetch(`${root}/${RECORD}`, {
      headers: { authorization: 'Bearer operator' },
    })), accepted);
    const history = await json(fetch(`${root}/${RECORD}/history`, {
      headers: { authorization: 'Bearer operator' },
    }));
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.history.map((event) => event.eventKind), ['creation', 'archive']);
  } finally {
    await context.close();
  }
});

test('archive rolls back record audit and request identity at every write boundary', async (t) => {
  const boundaries = [
    ['record-update', 'BEFORE UPDATE ON private_work_records'],
    ['audit-append', 'BEFORE INSERT ON private_material_audit_events'],
    ['request-identity', 'BEFORE INSERT ON private_mutation_requests'],
  ];
  for (const [boundary, clause] of boundaries) {
    await t.test(boundary, async () => {
      const context = await fixture({
        identities: { 'Bearer archiver': identity(['record.archive']) },
      });
      const original = recordFixture();
      context.store.create(original, creationAudit(original), 0);
      const baseline = snapshot(context);
      try {
        context.store.database.exec(`
          CREATE TRIGGER fail_archive_boundary ${clause}
          BEGIN SELECT RAISE(ABORT, 'synthetic archive failure'); END;
        `);
        assert.deepEqual(await archive(context.base, 'Bearer archiver'), {
          status: 409, body: { error: 'conflict' },
        });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('blocked and tombstoned records reject archival without rewriting history', async (t) => {
  for (const [name, record] of [
    ['blocked', {
      ...recordFixture({ lifecycle: 'blocked' }), updatedAt: ARCHIVED,
      stateChangedAt: ARCHIVED,
      blockReason: { category: 'dependency', summary: 'Synthetic dependency', blockedAt: ARCHIVED },
    }],
    ['deleted', {
      ...recordFixture({ lifecycle: 'deleted' }), updatedAt: RECORDED,
      archivedAt: ARCHIVED, deletedAt: RECORDED, stateChangedAt: RECORDED,
    }],
  ]) {
    await t.test(name, async () => {
      const context = await fixture({
        identities: { 'Bearer archiver': identity(['record.archive']) },
      });
      context.store.create(record, creationAudit(record), 0);
      const baseline = snapshot(context);
      try {
        assert.deepEqual(await archive(context.base, 'Bearer archiver'), {
          status: 409, body: { error: 'conflict' },
        });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('archive malformed chronology tenant and alternate-route matrix fails closed with zero delta', async () => {
  const context = await fixture({ identities: {
    'Bearer archiver': identity(['record.archive']),
  } });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const baseline = snapshot(context);
  const canonical = `/api/private/tenants/${TENANT_A}/records/${RECORD}/archive`;
  const postRaw = async (path, body, contentType = 'application/json') => json(fetch(
    `${context.base}${path}`,
    { method: 'POST', headers: { authorization: 'Bearer archiver', 'content-type': contentType }, body },
  ));
  try {
    for (const result of [
      await postRaw(canonical, '{'),
      await postRaw(canonical, JSON.stringify(archiveBody()), 'text/plain'),
      await postRaw(canonical, JSON.stringify(archiveBody()).padEnd(40_000, ' ')),
      await archive(context.base, 'Bearer archiver', archiveBody({ occurredAt: 'not-a-time' })),
      await archive(context.base, 'Bearer archiver', archiveBody({
        occurredAt: '2026-09-26T11:59:59.000Z',
      })),
      await archive(context.base, 'Bearer archiver', archiveBody({
        occurredAt: '2026-09-26T12:07:00.000Z',
      })),
      await archive(context.base, 'Bearer archiver', archiveBody(), RECORD, TENANT_B),
      await archive(context.base, 'Bearer archiver', archiveBody(), 'id_9999999999999999'),
      await postRaw(`${canonical}/`, JSON.stringify(archiveBody())),
      await postRaw(`${canonical}?force=true`, JSON.stringify(archiveBody())),
      await postRaw(`/api/private/records/${RECORD}/archive`, JSON.stringify(archiveBody())),
    ]) {
      assert.deepEqual(result, { status: 404, body: { error: 'not_found' } });
    }
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('archived state complete history and replay identity survive a clean restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-private-archive-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const identities = { 'Bearer archiver': identity(['record.archive']) };
  let running;
  try {
    running = await fixture({ identities, databasePath });
    const original = recordFixture();
    running.store.create(original, creationAudit(original), 0);
    const accepted = await archive(running.base, 'Bearer archiver');
    assert.equal(accepted.status, 200);
    await running.close();
    running = null;

    running = await fixture({ identities, databasePath });
    assert.deepEqual(running.store.read(TENANT_A, RECORD), accepted.body.record);
    assert.deepEqual(
      running.store.readHistory(TENANT_A, RECORD, 50).map((event) => event.eventKind ?? 'creation'),
      ['creation', 'archive'],
    );
    const beforeReplay = snapshot(running);
    assert.deepEqual(await archive(running.base, 'Bearer archiver'), accepted);
    assert.deepEqual(snapshot(running), beforeReplay);
  } finally {
    if (running !== null && running !== undefined) await running.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('archived records reject ordinary private mutations with zero state delta', async () => {
  const context = await fixture({ identities: {
    'Bearer operator': identity(['record.archive', 'record.rename', 'record.reassign', 'record.block']),
  } });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    assert.equal((await archive(context.base, 'Bearer operator')).status, 200);
    const baseline = snapshot(context);
    const root = `${context.base}/api/private/tenants/${TENANT_A}/records/${RECORD}`;
    for (const [action, body] of [
      ['rename', {
        expectedRevision: 2, requestId: 'id_cccccccccccccccc', title: 'Forbidden rename',
        reasonRef: 'direction-forbidden-rename', occurredAt: RECORDED,
      }],
      ['reassignment', {
        expectedRevision: 2, requestId: 'id_dddddddddddddddd', assigneeSubjectIds: [],
        reasonRef: 'direction-forbidden-reassignment', occurredAt: RECORDED,
      }],
      ['block', {
        expectedRevision: 2, requestId: 'id_eeeeeeeeeeeeeeee',
        blockReason: { category: 'dependency', summary: 'Forbidden block', blockedAt: RECORDED },
        reasonRef: 'direction-forbidden-block',
      }],
    ]) {
      assert.deepEqual(await json(fetch(`${root}/${action}`, {
        method: 'POST',
        headers: { authorization: 'Bearer operator', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })), { status: 409, body: { error: 'conflict' } });
    }
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});
