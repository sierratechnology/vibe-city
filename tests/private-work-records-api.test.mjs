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

async function apiFixture({
  identities = {},
  resolveTrustedReferences = async () => true,
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
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(path)) assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    store.close();
    store = new PrivateWorkRecordsStore(databasePath);
    assert.equal(store.countRecords(TENANT_A), 1);
    assert.equal(store.countAudits(TENANT_A), 1);
    assert.deepEqual(store.read(TENANT_A, record.recordId), record);
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
