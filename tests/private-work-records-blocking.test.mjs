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
const RESOLUTION_AUTHORITY = 'id_7777777777777777';
const CREATED = '2026-09-26T12:00:00.000Z';
const BLOCKED = '2026-09-26T12:05:00.000Z';
const UNBLOCKED = '2026-09-26T12:06:00.000Z';
const PRIVATE_HEADERS = {
  'cache-control': 'private, no-store',
  'content-type': 'application/json; charset=utf-8',
  vary: 'authorization',
  'x-content-type-options': 'nosniff',
};

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
    title: 'Synthetic blocking record',
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

function creationAudit(record, auditId = 'id_aaaaaaaaaaaaaaaa') {
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
  const directory = mkdtempSync(join(tmpdir(), 'office-private-blocking-'));
  const store = new PrivateWorkRecordsStore(join(directory, 'records.sqlite'));
  let sequence = 11;
  let clock = Date.parse(BLOCKED);
  const handler = createPrivateWorkRecordsApiHandler({
    store,
    domain,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences,
    now: () => clock,
    generateId: () => `id_${(sequence++).toString(16).repeat(16)}`,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    setClock(value) { clock = Date.parse(value); },
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

async function rawHttp(base, method, path, headers = {}, body = undefined) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method,
      path,
      headers,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: raw === '' ? null : JSON.parse(raw),
      }));
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

function blockBody(overrides = {}) {
  return {
    expectedRevision: 1,
    requestId: 'id_bbbbbbbbbbbbbbbb',
    blockReason: {
      category: 'dependency',
      summary: 'Waiting on a synthetic dependency',
      resolutionAuthoritySubjectId: RESOLUTION_AUTHORITY,
      blockedAt: BLOCKED,
    },
    reasonRef: 'direction-synthetic-block',
    ...overrides,
  };
}

function unblockBody(overrides = {}) {
  return {
    expectedRevision: 2,
    requestId: 'id_cccccccccccccccc',
    reasonRef: 'direction-synthetic-unblock',
    occurredAt: UNBLOCKED,
    ...overrides,
  };
}

function snapshot(context) {
  return {
    record: context.store.read(TENANT_A, RECORD),
    history: context.store.readHistory(TENANT_A, RECORD, 50),
    requests: context.store.database.prepare(`
      SELECT tenant_id, principal_id, authorization_id, policy_revision,
        operation, request_id, request_semantics, record_json
      FROM private_mutation_requests ORDER BY rowid
    `).all(),
  };
}

test('authorized block stores a structured reason and atomically appends one immutable event', async () => {
  const resolutions = [];
  const context = await fixture({
    identities: { 'Bearer blocker': identity(['record.block']) },
    resolveTrustedReferences: async (scope) => { resolutions.push(scope); return true; },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const result = await mutation(context.base, 'block', 'Bearer blocker', blockBody());
    assert.equal(result.status, 200);
    assert.equal(result.body.record.lifecycle, 'blocked');
    assert.equal(result.body.record.revision, 2);
    assert.equal(result.body.record.updatedAt, BLOCKED);
    assert.equal(result.body.record.stateChangedAt, BLOCKED);
    assert.deepEqual(result.body.record.blockReason, blockBody().blockReason);
    assert.equal(resolutions.length, 1);
    assert.equal(resolutions[0].resolutionAuthoritySubjectId, RESOLUTION_AUTHORITY);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 2);
    assert.deepEqual(history[1], {
      auditId: 'id_bbbbbbbbbbbbbbbb',
      tenantId: TENANT_A,
      recordId: RECORD,
      eventKind: 'block',
      actorSubjectId: ACTOR,
      authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1',
      sourceId: SOURCE,
      reasonRef: 'direction-synthetic-block',
      priorRevision: 1,
      newRevision: 2,
      occurredAt: BLOCKED,
      recordedAt: BLOCKED,
      changedFields: {
        lifecycle: { prior: 'open', next: 'blocked' },
        blockReason: { prior: null, next: blockBody().blockReason },
      },
    });
  } finally {
    await context.close();
  }
});

test('blocked record validation rejects inherited required state without invoking accessors', async () => {
  const domain = await loadDomain();
  let getterCalls = 0;
  Object.defineProperties(Object.prototype, {
    blockReason: {
      configurable: true,
      get() { getterCalls += 1; return blockBody().blockReason; },
    },
    stateChangedAt: {
      configurable: true,
      get() { getterCalls += 1; return BLOCKED; },
    },
  });
  try {
    assert.throws(() => domain.validateWorkRecord({
      ...recordFixture(), lifecycle: 'blocked', revision: 2, updatedAt: BLOCKED,
    }), { message: /own|required/i });
    assert.equal(getterCalls, 0);
  } finally {
    delete Object.prototype.blockReason;
    delete Object.prototype.stateChangedAt;
  }
});

test('block replay is idempotent while conflicting stale and re-block requests are atomic', async () => {
  const context = await fixture({
    identities: { 'Bearer blocker': identity(['record.block']) },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    const accepted = await mutation(context.base, 'block', 'Bearer blocker', blockBody());
    assert.equal(accepted.status, 200);
    const afterAccepted = snapshot(context);
    assert.deepEqual(await mutation(context.base, 'block', 'Bearer blocker', blockBody()), accepted);
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await mutation(context.base, 'block', 'Bearer blocker', blockBody({
      blockReason: { ...blockBody().blockReason, summary: 'Conflicting summary' },
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await mutation(context.base, 'block', 'Bearer blocker', blockBody({
      expectedRevision: 1,
      requestId: 'id_dddddddddddddddd',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await mutation(context.base, 'block', 'Bearer blocker', blockBody({
      expectedRevision: 2,
      requestId: 'id_eeeeeeeeeeeeeeee',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
  } finally {
    await context.close();
  }
});

test('authorized unblock returns to open and preserves the prior reason in append-only history', async () => {
  const context = await fixture({
    identities: {
      'Bearer blocker': identity(['record.block']),
      'Bearer unblocker': identity(['record.unblock']),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    assert.equal((await mutation(
      context.base, 'block', 'Bearer blocker', blockBody(),
    )).status, 200);
    const blockedReason = structuredClone(context.store.read(TENANT_A, RECORD).blockReason);
    context.setClock(UNBLOCKED);
    const result = await mutation(
      context.base, 'unblock', 'Bearer unblocker', unblockBody(),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.record.lifecycle, 'open');
    assert.equal(result.body.record.revision, 3);
    assert.equal(result.body.record.updatedAt, UNBLOCKED);
    assert.equal(result.body.record.stateChangedAt, UNBLOCKED);
    assert.equal(result.body.record.blockReason, null);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 3);
    assert.deepEqual(history[1].changedFields.blockReason.next, blockedReason);
    assert.deepEqual(history[2], {
      auditId: 'id_cccccccccccccccc', tenantId: TENANT_A, recordId: RECORD,
      eventKind: 'unblock', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', sourceId: SOURCE,
      reasonRef: 'direction-synthetic-unblock', priorRevision: 2, newRevision: 3,
      occurredAt: UNBLOCKED, recordedAt: UNBLOCKED,
      changedFields: {
        lifecycle: { prior: 'blocked', next: 'open' },
        blockReason: { prior: blockedReason, next: null },
      },
    });
  } finally {
    await context.close();
  }
});

test('unblock restores the actionable lifecycle that block interrupted', async () => {
  const context = await fixture({
    identities: {
      'Bearer blocker': identity(['record.block']),
      'Bearer unblocker': identity(['record.unblock']),
    },
  });
  const original = { ...recordFixture(), lifecycle: 'in_progress' };
  context.store.create(original, creationAudit(original), 0);
  try {
    assert.equal((await mutation(context.base, 'block', 'Bearer blocker', blockBody())).status, 200);
    context.setClock(UNBLOCKED);
    const result = await mutation(context.base, 'unblock', 'Bearer unblocker', unblockBody());
    assert.equal(result.status, 200);
    assert.equal(result.body.record.lifecycle, 'in_progress');
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.deepEqual(history[2].changedFields.lifecycle, {
      prior: 'blocked', next: 'in_progress',
    });
  } finally {
    await context.close();
  }
});

test('block authority and reason validation precede record and trusted-reference resolution', async () => {
  let resolutions = 0;
  const context = await fixture({
    identities: {
      'Bearer reader': identity(['record.read']),
      'Bearer renamer': identity(['record.rename']),
      'Bearer reassigner': identity(['record.reassign']),
      'Bearer historian': identity(['record.history.read']),
      'Bearer unblocker': identity(['record.unblock']),
      'Bearer revoked': identity(['record.block'], { active: false }),
      'Bearer blocker': identity(['record.block']),
    },
    resolveTrustedReferences: async () => { resolutions += 1; return false; },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const baseline = snapshot(context);
  let reads = 0;
  const originalRead = context.store.read.bind(context.store);
  context.store.read = (...args) => { reads += 1; return originalRead(...args); };
  try {
    for (const authorization of [
      'Bearer missing', 'Bearer reader', 'Bearer renamer', 'Bearer reassigner',
      'Bearer historian', 'Bearer unblocker', 'Bearer revoked',
    ]) {
      assert.deepEqual(await mutation(
        context.base, 'block', authorization, blockBody(),
      ), { status: 404, body: { error: 'not_found' } });
    }
    assert.equal(reads, 0);
    assert.equal(resolutions, 0);
    assert.deepEqual(snapshot(context), baseline);
    assert.deepEqual(await mutation(context.base, 'block', 'Bearer blocker', blockBody({
      blockReason: { ...blockBody().blockReason, category: 'invented-policy' },
    })), { status: 404, body: { error: 'not_found' } });
    assert.equal(resolutions, 0);
    assert.deepEqual(snapshot(context), baseline);
    assert.deepEqual(await mutation(
      context.base, 'block', 'Bearer blocker', blockBody(),
    ), { status: 404, body: { error: 'not_found' } });
    assert.equal(resolutions, 1);
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('unblock authority replay stale conflict and double-unblock semantics are atomic', async () => {
  const context = await fixture({
    identities: {
      'Bearer blocker': identity(['record.block']),
      'Bearer unblocker': identity(['record.unblock']),
      'Bearer reader': identity(['record.read']),
      'Bearer renamer': identity(['record.rename']),
      'Bearer reassigner': identity(['record.reassign']),
      'Bearer historian': identity(['record.history.read']),
      'Bearer revoked': identity(['record.unblock'], { active: false }),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  assert.equal((await mutation(context.base, 'block', 'Bearer blocker', blockBody())).status, 200);
  context.setClock(UNBLOCKED);
  let reads = 0;
  const originalRead = context.store.read.bind(context.store);
  context.store.read = (...args) => { reads += 1; return originalRead(...args); };
  try {
    for (const authorization of [
      'Bearer missing', 'Bearer blocker', 'Bearer reader', 'Bearer renamer',
      'Bearer reassigner', 'Bearer historian', 'Bearer revoked',
    ]) {
      assert.deepEqual(await mutation(
        context.base, 'unblock', authorization, unblockBody(),
      ), { status: 404, body: { error: 'not_found' } });
    }
    assert.equal(reads, 0);
    const accepted = await mutation(context.base, 'unblock', 'Bearer unblocker', unblockBody());
    assert.equal(accepted.status, 200);
    const afterAccepted = snapshot(context);
    assert.deepEqual(await mutation(
      context.base, 'unblock', 'Bearer unblocker', unblockBody(),
    ), accepted);
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await mutation(context.base, 'unblock', 'Bearer unblocker', unblockBody({
      reasonRef: 'conflicting-unblock-reason',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await mutation(context.base, 'unblock', 'Bearer unblocker', unblockBody({
      expectedRevision: 2, requestId: 'id_dddddddddddddddd',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await mutation(context.base, 'unblock', 'Bearer unblocker', unblockBody({
      expectedRevision: 3, requestId: 'id_eeeeeeeeeeeeeeee',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
  } finally {
    await context.close();
  }
});

test('block and unblock roll back record audit and request identity at every write boundary', async (t) => {
  const boundaries = [
    ['record-update', 'BEFORE UPDATE ON private_work_records'],
    ['audit-append', 'BEFORE INSERT ON private_material_audit_events'],
    ['request-identity', 'BEFORE INSERT ON private_mutation_requests'],
  ];
  for (const operation of ['block', 'unblock']) {
    for (const [boundary, clause] of boundaries) {
      await t.test(`${operation} ${boundary}`, async () => {
        const context = await fixture({
          identities: {
            'Bearer blocker': identity(['record.block']),
            'Bearer unblocker': identity(['record.unblock']),
          },
        });
        const original = recordFixture();
        context.store.create(original, creationAudit(original), 0);
        try {
          if (operation === 'unblock') {
            assert.equal((await mutation(
              context.base, 'block', 'Bearer blocker', blockBody(),
            )).status, 200);
            context.setClock(UNBLOCKED);
          }
          const baseline = snapshot(context);
          context.store.database.exec(`
            CREATE TRIGGER fail_blocking_boundary ${clause}
            BEGIN SELECT RAISE(ABORT, 'synthetic blocking failure'); END;
          `);
          const result = await mutation(
            context.base,
            operation,
            operation === 'block' ? 'Bearer blocker' : 'Bearer unblocker',
            operation === 'block' ? blockBody() : unblockBody(),
          );
          assert.deepEqual(result, { status: 409, body: { error: 'conflict' } });
          assert.deepEqual(snapshot(context), baseline);
        } finally {
          await context.close();
        }
      });
    }
  }
});

test('blocking routes reject malformed oversized unsupported and alternate requests privately', async () => {
  const context = await fixture({
    identities: { 'Bearer blocker': identity(['record.block', 'record.unblock']) },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  const baseline = snapshot(context);
  const canonical = `/api/private/tenants/${TENANT_A}/records/${RECORD}`;
  try {
    for (const action of ['block', 'unblock']) {
      for (const request of [
        await rawHttp(context.base, 'POST', `${canonical}/${action}`, {
          authorization: 'Bearer blocker', 'content-type': 'application/json',
        }, '{'),
        await rawHttp(context.base, 'POST', `${canonical}/${action}`, {
          authorization: 'Bearer blocker', 'content-type': 'text/plain',
        }, JSON.stringify(action === 'block' ? blockBody() : unblockBody())),
        await rawHttp(context.base, 'POST', `${canonical}/${action}`, {
          authorization: 'Bearer blocker', 'content-type': 'application/json',
        }, JSON.stringify({ padding: 'x'.repeat(65_536) })),
      ]) {
        assert.equal(request.status, 404);
        assert.deepEqual(request.body, { error: 'not_found' });
        for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
          assert.equal(request.headers[name], value);
        }
      }
    }
    for (const [method, path] of [
      ['POST', `${canonical}/block/`],
      ['POST', `${canonical}/unblock?mode=force`],
      ['GET', `${canonical}/block`],
      ['PATCH', `${canonical}/unblock`],
      ['POST', `/api/private/records/${RECORD}/block`],
      ['POST', `/api/private//tenants/${TENANT_A}/records/${RECORD}/block`],
      ['POST', `/api/private/x/../tenants/${TENANT_A}/records/${RECORD}/unblock`],
      ['POST', `/api/private/tenants/${TENANT_B}/records/${RECORD}/block`],
      ['POST', `/api/private/tenants/${TENANT_A}/records/id_9999999999999999/unblock`],
    ]) {
      const request = await rawHttp(context.base, method, path, {
        authorization: 'Bearer blocker', 'content-type': 'application/json',
      }, method === 'GET' ? undefined
        : JSON.stringify(path.includes('unblock') ? unblockBody() : blockBody()));
      assert.equal(request.status, 404, `${method} ${path}`);
      assert.deepEqual(request.body, { error: 'not_found' }, `${method} ${path}`);
    }
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('accepted block and unblock state history and replay identity survive clean restarts', async () => {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import('../server/privateWorkRecordsApi.mjs'),
    import('../server/privateWorkRecordsStore.mjs'),
    loadDomain(),
  ]);
  const directory = mkdtempSync(join(tmpdir(), 'office-private-blocking-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const identities = {
    'Bearer blocker': identity(['record.block']),
    'Bearer unblocker': identity(['record.unblock']),
  };
  async function start(store, clock, sequenceStart) {
    let sequence = sequenceStart;
    const server = createServer(createPrivateWorkRecordsApiHandler({
      store, domain,
      resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
      resolveTrustedReferences: async () => true,
      now: () => Date.parse(clock),
      generateId: () => `id_${(sequence++).toString(16).repeat(16)}`,
    }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      base: `http://127.0.0.1:${server.address().port}`,
      async stop() {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        store.close();
      },
    };
  }
  let running;
  try {
    let store = new PrivateWorkRecordsStore(databasePath);
    const original = recordFixture();
    store.create(original, creationAudit(original), 0);
    running = await start(store, BLOCKED, 11);
    const blocked = await mutation(running.base, 'block', 'Bearer blocker', blockBody());
    assert.equal(blocked.status, 200);
    await running.stop();
    running = null;
    store = new PrivateWorkRecordsStore(databasePath);
    assert.deepEqual(store.read(TENANT_A, RECORD), blocked.body.record);
    assert.equal(store.readHistory(TENANT_A, RECORD, 50).length, 2);
    running = await start(store, UNBLOCKED, 12);
    assert.deepEqual(await mutation(running.base, 'block', 'Bearer blocker', blockBody()), blocked);
    const unblocked = await mutation(running.base, 'unblock', 'Bearer unblocker', unblockBody());
    assert.equal(unblocked.status, 200);
    assert.deepEqual(await mutation(running.base, 'block', 'Bearer blocker', blockBody()), blocked);
    assert.deepEqual(await mutation(running.base, 'unblock', 'Bearer unblocker', unblockBody()), unblocked);
    await running.stop();
    running = null;
    store = new PrivateWorkRecordsStore(databasePath);
    assert.deepEqual(store.read(TENANT_A, RECORD), unblocked.body.record);
    assert.deepEqual(store.readHistory(TENANT_A, RECORD, 50).map((event) => event.eventKind ?? 'create'), [
      'create', 'block', 'unblock',
    ]);
    store.close();
  } finally {
    if (running !== null && running !== undefined) await running.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('unblock rejects event chronology that predates its durable blocked state', async () => {
  const context = await fixture({
    identities: {
      'Bearer blocker': identity(['record.block']),
      'Bearer unblocker': identity(['record.unblock']),
    },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  assert.equal((await mutation(context.base, 'block', 'Bearer blocker', blockBody())).status, 200);
  context.setClock(UNBLOCKED);
  const baseline = snapshot(context);
  try {
    assert.deepEqual(await mutation(context.base, 'unblock', 'Bearer unblocker', unblockBody({
      occurredAt: CREATED,
    })), { status: 404, body: { error: 'not_found' } });
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('blocked records must be unblocked before archival', async () => {
  const domain = await loadDomain();
  const blocked = domain.validateWorkRecord({
    ...recordFixture(),
    lifecycle: 'blocked', revision: 2, updatedAt: BLOCKED, stateChangedAt: BLOCKED,
    blockReason: blockBody().blockReason,
  });
  const context = domain.createTrustedAuthorizationContext(identity(['record.archive']));
  const audit = {
    auditId: 'id_dddddddddddddddd', tenantId: TENANT_A, recordId: RECORD,
    actorSubjectId: ACTOR, authorizationId: AUTHORIZATION, policyRevision: 'policy-1',
    sourceId: SOURCE, priorRevision: 2, newRevision: 3,
    occurredAt: UNBLOCKED, recordedAt: UNBLOCKED,
    changedFields: ['lifecycle', 'archivedAt'],
  };
  assert.throws(() => domain.archiveWorkRecord(context, blocked, {
    requestedTenantId: TENANT_A,
    expectedRevision: 2,
    recordedAt: UNBLOCKED,
    auditEvents: [audit],
  }), { message: /blocked/i });
});

test('a lifecycle transition after unblock advances stateChangedAt', async () => {
  const domain = await loadDomain();
  const transitionedAt = '2026-09-26T12:07:00.000Z';
  const unblocked = domain.validateWorkRecord({
    ...recordFixture(),
    revision: 3, updatedAt: UNBLOCKED, stateChangedAt: UNBLOCKED, blockReason: null,
  });
  const context = domain.createTrustedAuthorizationContext(identity(['record.transition']));
  const audit = {
    auditId: 'id_eeeeeeeeeeeeeeee', tenantId: TENANT_A, recordId: RECORD,
    actorSubjectId: ACTOR, authorizationId: AUTHORIZATION, policyRevision: 'policy-1',
    sourceId: SOURCE, priorRevision: 3, newRevision: 4,
    occurredAt: transitionedAt, recordedAt: transitionedAt,
    changedFields: ['lifecycle'],
  };
  const result = domain.transitionWorkRecord(context, unblocked, {
    requestedTenantId: TENANT_A,
    expectedRevision: 3,
    toLifecycle: 'in_progress',
    auditEvents: [audit],
  });
  assert.equal(result.record.stateChangedAt, transitionedAt);
});

test('archival after unblock advances stateChangedAt', async () => {
  const domain = await loadDomain();
  const archivedAt = '2026-09-26T12:08:00.000Z';
  const unblocked = domain.validateWorkRecord({
    ...recordFixture(),
    revision: 3, updatedAt: UNBLOCKED, stateChangedAt: UNBLOCKED, blockReason: null,
  });
  const context = domain.createTrustedAuthorizationContext(identity(['record.archive']));
  const audit = {
    auditId: 'id_ffffffffffffffff', tenantId: TENANT_A, recordId: RECORD,
    actorSubjectId: ACTOR, authorizationId: AUTHORIZATION, policyRevision: 'policy-1',
    sourceId: SOURCE, priorRevision: 3, newRevision: 4,
    occurredAt: archivedAt, recordedAt: archivedAt,
    changedFields: ['lifecycle', 'archivedAt'],
  };
  const result = domain.archiveWorkRecord(context, unblocked, {
    requestedTenantId: TENANT_A,
    expectedRevision: 3,
    recordedAt: archivedAt,
    auditEvents: [audit],
  });
  assert.equal(result.record.stateChangedAt, archivedAt);
});

test('tombstone and restore advance stateChangedAt after unblock', async () => {
  const domain = await loadDomain();
  const archivedAt = '2026-09-26T12:08:00.000Z';
  const deletedAt = '2026-09-26T12:09:00.000Z';
  const restoredAt = '2026-09-26T12:10:00.000Z';
  const archived = domain.validateWorkRecord({
    ...recordFixture(), lifecycle: 'archived', revision: 4,
    updatedAt: archivedAt, archivedAt, stateChangedAt: archivedAt, blockReason: null,
  });
  const context = domain.createTrustedAuthorizationContext(
    identity(['record.delete', 'record.restore']),
  );
  const audit = (auditId, priorRevision, newRevision, recordedAt) => ({
    auditId, tenantId: TENANT_A, recordId: RECORD,
    actorSubjectId: ACTOR, authorizationId: AUTHORIZATION, policyRevision: 'policy-1',
    sourceId: SOURCE, priorRevision, newRevision,
    occurredAt: recordedAt, recordedAt,
    changedFields: ['lifecycle', 'deletedAt'],
  });
  const deleted = domain.tombstoneWorkRecord(context, archived, {
    requestedTenantId: TENANT_A,
    expectedRevision: 4,
    recordedAt: deletedAt,
    auditEvents: [audit('id_1010101010101010', 4, 5, deletedAt)],
  }).record;
  assert.equal(deleted.stateChangedAt, deletedAt);
  const restored = domain.restoreWorkRecord(context, deleted, {
    requestedTenantId: TENANT_A,
    expectedRevision: 5,
    recordedAt: restoredAt,
    auditEvents: [audit('id_1111111111111110', 5, 6, restoredAt)],
  }).record;
  assert.equal(restored.stateChangedAt, restoredAt);
});

test('block accepts a canonical event time before server recording time', async () => {
  const context = await fixture({
    identities: { 'Bearer blocker': identity(['record.block']) },
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  context.setClock(UNBLOCKED);
  try {
    const result = await mutation(context.base, 'block', 'Bearer blocker', blockBody());
    assert.equal(result.status, 200);
    assert.equal(result.body.record.stateChangedAt, BLOCKED);
    assert.equal(result.body.record.updatedAt, UNBLOCKED);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history[1].occurredAt, BLOCKED);
    assert.equal(history[1].recordedAt, UNBLOCKED);
  } finally {
    await context.close();
  }
});

test('unblock chronology is anchored to the block event across non-lifecycle mutations', async () => {
  const context = await fixture({
    identities: {
      'Bearer operator': identity(['record.block', 'record.reassign', 'record.unblock']),
    },
    resolver: async () => true,
  });
  const original = recordFixture();
  context.store.create(original, creationAudit(original), 0);
  try {
    assert.equal((await mutation(context.base, 'block', 'Bearer operator', blockBody())).status, 200);
    context.setClock(UNBLOCKED);
    assert.equal((await mutation(context.base, 'reassignment', 'Bearer operator', {
      expectedRevision: 2,
      assigneeSubjectIds: [],
      reasonRef: 'assignment reviewed',
      occurredAt: UNBLOCKED,
      requestId: 'id_1212121212121212',
    })).status, 200);
    context.setClock('2026-09-26T12:08:00.000Z');
    const result = await mutation(context.base, 'unblock', 'Bearer operator', unblockBody({
      expectedRevision: 3,
      occurredAt: '2026-09-26T12:05:30.000Z',
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.record.lifecycle, 'open');
    assert.equal(result.body.record.stateChangedAt, '2026-09-26T12:05:30.000Z');
  } finally {
    await context.close();
  }
});
