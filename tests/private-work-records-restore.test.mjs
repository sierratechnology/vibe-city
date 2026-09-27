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
const RESTORED = '2026-09-26T12:10:00.000Z';
const RESTORE_RECORDED = '2026-09-26T12:11:00.000Z';

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
    tenantId, recordId, title: 'Synthetic restore record',
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
      locator: 'urn:stg:evidence:synthetic-restore', recordedAt: CREATED,
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

function archiveAudit(record, priorLifecycle = 'open', overrides = {}) {
  return {
    auditId: 'id_bbbbbbbbbbbbbbbb', tenantId: record.tenantId, recordId: record.recordId,
    eventKind: 'archive', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
    policyRevision: 'policy-1', sourceId: SOURCE,
    reasonRef: 'direction-synthetic-archive', priorRevision: 1, newRevision: 2,
    occurredAt: ARCHIVED, recordedAt: ARCHIVE_RECORDED,
    changedFields: {
      lifecycle: { prior: priorLifecycle, next: 'archived' },
      archivedAt: { prior: null, next: ARCHIVED },
    },
    ...overrides,
  };
}

function restoreBody(overrides = {}) {
  return {
    expectedRevision: 2, requestId: 'id_cccccccccccccccc',
    occurredAt: RESTORED, reasonRef: 'direction-synthetic-restore', ...overrides,
  };
}

async function fixture({ identities, databasePath, now = Date.parse(RESTORE_RECORDED) } = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import('../server/privateWorkRecordsApi.mjs'),
    import('../server/privateWorkRecordsStore.mjs'),
    loadDomain(),
  ]);
  const directory = databasePath ? null : mkdtempSync(join(tmpdir(), 'office-private-restore-'));
  const path = databasePath ?? join(directory, 'records.sqlite');
  const store = new PrivateWorkRecordsStore(path);
  let sequence = 12;
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

function seedArchived(context, priorLifecycle = 'open', auditOverrides = {}) {
  const original = recordFixture({ lifecycle: priorLifecycle });
  context.store.create(original, creationAudit(original), 0);
  const archived = {
    ...original, lifecycle: 'archived', archivedAt: ARCHIVED,
    stateChangedAt: ARCHIVED, revision: 2, updatedAt: ARCHIVE_RECORDED,
  };
  const audit = archiveAudit(original, priorLifecycle, auditOverrides);
  assert.deepEqual(context.store.mutate(archived, audit, 1), { ok: true, replayed: false });
  return { original, archived, audit };
}

async function json(responsePromise) {
  const response = await responsePromise;
  return { status: response.status, body: await response.json() };
}

function restore(base, authorization, body = restoreBody(), recordId = RECORD, tenantId = TENANT_A) {
  return json(fetch(`${base}/api/private/tenants/${tenantId}/records/${recordId}/restore`, {
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

function replaceArchiveEvent(context, change) {
  const history = context.store.readHistory(TENANT_A, RECORD, 50);
  const event = change(structuredClone(history.at(-1)));
  context.store.database.prepare(`
    UPDATE private_material_audit_events SET event_json = ?
    WHERE tenant_id = ? AND audit_event_id = ?
  `).run(JSON.stringify(event), TENANT_A, event.auditId);
}

test('authorized restore returns to proven pre-archive lifecycle without erasing archive interval', async () => {
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
  });
  try {
    const { original, audit: immutableArchive } = seedArchived(context);
    const result = await restore(context.base, 'Bearer restorer');
    assert.equal(result.status, 200);
    assert.equal(result.body.record.tenantId, TENANT_A);
    assert.equal(result.body.record.recordId, RECORD);
    assert.equal(result.body.record.title, original.title);
    assert.deepEqual(result.body.record.source, original.source);
    assert.deepEqual(result.body.record.evidence, original.evidence);
    assert.equal(result.body.record.lifecycle, 'open');
    assert.equal(result.body.record.archivedAt, null);
    assert.equal(result.body.record.deletedAt, null);
    assert.equal(result.body.record.stateChangedAt, RESTORED);
    assert.equal(result.body.record.updatedAt, RESTORE_RECORDED);
    assert.equal(result.body.record.revision, 3);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.equal(history.length, 3);
    assert.deepEqual(history[1], immutableArchive);
    assert.deepEqual(history[2], {
      auditId: 'id_cccccccccccccccc', tenantId: TENANT_A, recordId: RECORD,
      eventKind: 'restore', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', sourceId: SOURCE,
      reasonRef: 'direction-synthetic-restore', priorRevision: 2, newRevision: 3,
      occurredAt: RESTORED, recordedAt: RESTORE_RECORDED,
      changedFields: {
        lifecycle: { prior: 'archived', next: 'open' },
        archivedAt: { prior: ARCHIVED, next: null },
      },
    });
  } finally {
    await context.close();
  }
});

test('restore returns to the exact allowed in-progress or completed pre-archive lifecycle', async (t) => {
  for (const [name, priorLifecycle] of [
    ['in-progress', 'in_progress'],
    ['completed', 'completed'],
  ]) {
    await t.test(name, async () => {
      const context = await fixture({
        identities: { 'Bearer restorer': identity(['record.restore']) },
      });
      try {
        seedArchived(context, priorLifecycle);
        const result = await restore(context.base, 'Bearer restorer');
        assert.equal(result.status, 200);
        assert.equal(result.body.record.lifecycle, priorLifecycle);
        assert.equal(result.body.record.archivedAt, null);
      } finally {
        await context.close();
      }
    });
  }
});

test('restore authority and active route-tenant membership precede record lookup', async () => {
  const context = await fixture({ identities: {
    'Bearer restorer': identity(['record.restore']),
    'Bearer reader': identity(['record.read']),
    'Bearer archiver': identity(['record.archive']),
    'Bearer deleter': identity(['record.delete']),
    'Bearer renamer': identity(['record.rename']),
    'Bearer reassigner': identity(['record.reassign']),
    'Bearer blocker': identity(['record.block']),
    'Bearer unblocker': identity(['record.unblock']),
    'Bearer historian': identity(['record.history.read']),
    'Bearer transitioner': identity(['record.transition']),
    'Bearer corrector': identity(['record.correct']),
    'Bearer superseder': identity(['record.supersede']),
    'Bearer inactive': identity(['record.restore'], { active: false }),
    'Bearer foreign': identity(['record.restore'], { tenantId: TENANT_B }),
  } });
  try {
    seedArchived(context);
    const baseline = snapshot(context);
    let reads = 0;
    const originalRead = context.store.read.bind(context.store);
    context.store.read = (...args) => { reads += 1; return originalRead(...args); };
    for (const authorization of [
      'Bearer missing', 'Bearer reader', 'Bearer archiver', 'Bearer deleter',
      'Bearer renamer', 'Bearer reassigner', 'Bearer blocker', 'Bearer unblocker',
      'Bearer historian', 'Bearer transitioner', 'Bearer corrector', 'Bearer superseder',
      'Bearer inactive', 'Bearer foreign',
    ]) {
      assert.deepEqual(await restore(context.base, authorization), {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(reads, 0);
    assert.deepEqual(snapshot(context), baseline);
    reads = 0;
    assert.deepEqual(await restore(context.base, 'Bearer restorer', {
      ...restoreBody(), tenantId: TENANT_B,
    }), { status: 404, body: { error: 'not_found' } });
    assert.equal(reads, 0);
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('restore rejects incomplete archive provenance with zero durable delta', async () => {
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
  });
  try {
    seedArchived(context, 'open', { actorSubjectId: undefined });
    const baseline = snapshot(context);
    assert.deepEqual(await restore(context.base, 'Bearer restorer'), {
      status: 404, body: { error: 'not_found' },
    });
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('restore rejects duplicate archive provenance for the current revision with zero durable delta', async () => {
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
  });
  try {
    const { audit } = seedArchived(context);
    const duplicate = {
      ...audit,
      auditId: 'id_dddddddddddddddd',
      reasonRef: 'forged-completed-archive',
      changedFields: {
        lifecycle: { prior: 'completed', next: 'archived' },
        archivedAt: { prior: null, next: ARCHIVED },
      },
    };
    context.store.database.prepare(`
      INSERT INTO private_material_audit_events
        (tenant_id, audit_event_id, record_id, prior_revision, new_revision, event_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      TENANT_A, duplicate.auditId, RECORD, duplicate.priorRevision, duplicate.newRevision,
      JSON.stringify(duplicate), duplicate.recordedAt,
    );
    const baseline = snapshot(context);
    assert.deepEqual(await restore(context.base, 'Bearer restorer'), {
      status: 404, body: { error: 'not_found' },
    });
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('restore uses the unique current archive proof after a legitimate later archive cycle', async () => {
  const secondArchiveOccurredAt = '2026-09-26T12:20:00.000Z';
  const secondArchiveRecordedAt = '2026-09-26T12:21:00.000Z';
  const secondRestoreOccurredAt = '2026-09-26T12:30:00.000Z';
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
    now: Date.parse('2026-09-26T12:31:00.000Z'),
  });
  try {
    const { original, archived } = seedArchived(context);
    const firstRestored = {
      ...archived,
      lifecycle: 'open', archivedAt: null, stateChangedAt: RESTORED,
      revision: 3, updatedAt: RESTORE_RECORDED,
    };
    assert.deepEqual(context.store.mutate(firstRestored, {
      auditId: 'id_eeeeeeeeeeeeeeee', tenantId: TENANT_A, recordId: RECORD,
      eventKind: 'restore', actorSubjectId: ACTOR, authorizationId: AUTHORIZATION,
      policyRevision: 'policy-1', sourceId: SOURCE,
      reasonRef: 'first-legitimate-restore', priorRevision: 2, newRevision: 3,
      occurredAt: RESTORED, recordedAt: RESTORE_RECORDED,
      changedFields: {
        lifecycle: { prior: 'archived', next: 'open' },
        archivedAt: { prior: ARCHIVED, next: null },
      },
    }, 2), { ok: true, replayed: false });
    const rearchived = {
      ...firstRestored,
      lifecycle: 'archived', archivedAt: secondArchiveOccurredAt,
      stateChangedAt: secondArchiveOccurredAt,
      revision: 4, updatedAt: secondArchiveRecordedAt,
    };
    const currentArchive = archiveAudit(original, 'open', {
      auditId: 'id_ffffffffffffffff', reasonRef: 'second-legitimate-archive',
      priorRevision: 3, newRevision: 4,
      occurredAt: secondArchiveOccurredAt, recordedAt: secondArchiveRecordedAt,
      changedFields: {
        lifecycle: { prior: 'open', next: 'archived' },
        archivedAt: { prior: null, next: secondArchiveOccurredAt },
      },
    });
    assert.deepEqual(context.store.mutate(rearchived, currentArchive, 3), {
      ok: true, replayed: false,
    });

    const result = await restore(context.base, 'Bearer restorer', restoreBody({
      expectedRevision: 4,
      requestId: 'id_9999999999999999',
      occurredAt: secondRestoreOccurredAt,
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.record.lifecycle, 'open');
    assert.equal(result.body.record.revision, 5);
    assert.equal(result.body.record.archivedAt, null);
    const history = context.store.readHistory(TENANT_A, RECORD, 50);
    assert.deepEqual(history.filter((event) => event.eventKind === 'archive'), [
      archiveAudit(original), currentArchive,
    ]);
    assert.deepEqual(history.map((event) => event.eventKind ?? 'creation'), [
      'creation', 'archive', 'restore', 'archive', 'restore',
    ]);
  } finally {
    await context.close();
  }
});

test('restore replay is idempotent while conflicting and stale identities are atomic', async () => {
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
  });
  try {
    seedArchived(context);
    const accepted = await restore(context.base, 'Bearer restorer');
    assert.equal(accepted.status, 200);
    const afterAccepted = snapshot(context);
    assert.deepEqual(await restore(context.base, 'Bearer restorer'), accepted);
    assert.deepEqual(snapshot(context), afterAccepted);
    assert.deepEqual(await restore(context.base, 'Bearer restorer', restoreBody({
      reasonRef: 'conflicting-restore-reason',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await restore(context.base, 'Bearer restorer', restoreBody({
      requestId: 'id_dddddddddddddddd', expectedRevision: 2,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await restore(context.base, 'Bearer restorer', restoreBody({
      requestId: 'id_eeeeeeeeeeeeeeee', expectedRevision: 3,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(snapshot(context), afterAccepted);
  } finally {
    await context.close();
  }
});

test('restore rejects active blocked and tombstoned records without rewriting history', async (t) => {
  const records = [
    ['open', recordFixture({ lifecycle: 'open' })],
    ['in-progress', recordFixture({ lifecycle: 'in_progress' })],
    ['completed', recordFixture({ lifecycle: 'completed' })],
    ['blocked', {
      ...recordFixture({ lifecycle: 'blocked' }), updatedAt: ARCHIVED,
      stateChangedAt: ARCHIVED,
      blockReason: { category: 'dependency', summary: 'Synthetic dependency', blockedAt: ARCHIVED },
    }],
    ['deleted', {
      ...recordFixture({ lifecycle: 'deleted' }), updatedAt: RESTORED,
      archivedAt: ARCHIVED, deletedAt: RESTORED, stateChangedAt: RESTORED,
    }],
  ];
  for (const [name, record] of records) {
    await t.test(name, async () => {
      const context = await fixture({
        identities: { 'Bearer restorer': identity(['record.restore']) },
      });
      try {
        context.store.create(record, creationAudit(record), 0);
        const baseline = snapshot(context);
        assert.deepEqual(await restore(context.base, 'Bearer restorer', restoreBody({
          expectedRevision: 1,
        })), { status: 409, body: { error: 'conflict' } });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('restore malformed chronology tenant and alternate-route matrix fails closed with zero delta', async () => {
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
  });
  try {
    seedArchived(context);
    const baseline = snapshot(context);
    const canonical = `/api/private/tenants/${TENANT_A}/records/${RECORD}/restore`;
    const postRaw = async (path, body, contentType = 'application/json') => json(fetch(
      `${context.base}${path}`,
      { method: 'POST', headers: { authorization: 'Bearer restorer', 'content-type': contentType }, body },
    ));
    for (const result of [
      await postRaw(canonical, '{'),
      await postRaw(canonical, JSON.stringify(restoreBody()), 'text/plain'),
      await postRaw(canonical, JSON.stringify(restoreBody()).padEnd(40_000, ' ')),
      await restore(context.base, 'Bearer restorer', restoreBody({ occurredAt: 'not-a-time' })),
      await restore(context.base, 'Bearer restorer', restoreBody({ occurredAt: ARCHIVED })),
      await restore(context.base, 'Bearer restorer', restoreBody({
        occurredAt: '2026-09-26T12:12:00.000Z',
      })),
      await restore(context.base, 'Bearer restorer', restoreBody(), RECORD, TENANT_B),
      await restore(context.base, 'Bearer restorer', restoreBody(), 'id_9999999999999999'),
      await postRaw(`${canonical}/`, JSON.stringify(restoreBody())),
      await postRaw(`${canonical}?force=true`, JSON.stringify(restoreBody())),
      await postRaw(`/api/private/records/${RECORD}/restore`, JSON.stringify(restoreBody())),
      await postRaw(`/api/private/tenants/${TENANT_A}/records/${RECORD}/undelete`, JSON.stringify(restoreBody())),
    ]) {
      assert.deepEqual(result, { status: 404, body: { error: 'not_found' } });
    }
    assert.deepEqual(snapshot(context), baseline);
  } finally {
    await context.close();
  }
});

test('restore rolls back record audit and request identity at every write boundary', async (t) => {
  const boundaries = [
    ['record-update', 'BEFORE UPDATE ON private_work_records'],
    ['audit-append', 'BEFORE INSERT ON private_material_audit_events'],
    ['request-identity', 'BEFORE INSERT ON private_mutation_requests'],
  ];
  for (const [boundary, clause] of boundaries) {
    await t.test(boundary, async () => {
      const context = await fixture({
        identities: { 'Bearer restorer': identity(['record.restore']) },
      });
      try {
        seedArchived(context);
        const baseline = snapshot(context);
        context.store.database.exec(`
          CREATE TRIGGER fail_restore_boundary ${clause}
          BEGIN SELECT RAISE(ABORT, 'synthetic restore failure'); END;
        `);
        assert.deepEqual(await restore(context.base, 'Bearer restorer'), {
          status: 409, body: { error: 'conflict' },
        });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('restored state interval history references active list and replay survive clean restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-private-restore-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const identities = {
    'Bearer operator': identity(['record.restore', 'record.read', 'record.history.read']),
  };
  let running;
  try {
    running = await fixture({ identities, databasePath });
    const { original, audit: archiveEvent } = seedArchived(running);
    const accepted = await restore(running.base, 'Bearer operator');
    assert.equal(accepted.status, 200);
    await running.close();
    running = null;

    running = await fixture({ identities, databasePath });
    assert.deepEqual(running.store.read(TENANT_A, RECORD), accepted.body.record);
    assert.equal(running.store.countRecords(TENANT_A), 1);
    const root = `${running.base}/api/private/tenants/${TENANT_A}/records`;
    assert.deepEqual(await json(fetch(root, {
      headers: { authorization: 'Bearer operator' },
    })), { status: 200, body: { records: [accepted.body.record], count: 1, cursor: null } });
    assert.deepEqual(await json(fetch(`${root}/${RECORD}`, {
      headers: { authorization: 'Bearer operator' },
    })), accepted);
    const history = await json(fetch(`${root}/${RECORD}/history`, {
      headers: { authorization: 'Bearer operator' },
    }));
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.history.map((event) => event.eventKind), [
      'creation', 'archive', 'restore',
    ]);
    assert.deepEqual(running.store.readHistory(TENANT_A, RECORD, 50)[1], archiveEvent);
    assert.deepEqual(accepted.body.record.source, original.source);
    assert.deepEqual(accepted.body.record.evidence, original.evidence);
    const beforeReplay = snapshot(running);
    assert.deepEqual(await restore(running.base, 'Bearer operator'), accepted);
    assert.deepEqual(snapshot(running), beforeReplay);
  } finally {
    if (running !== null && running !== undefined) await running.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore rejects a missing archive event without deleting canonical facts', async () => {
  const context = await fixture({
    identities: { 'Bearer restorer': identity(['record.restore']) },
  });
  try {
    const record = {
      ...recordFixture(), lifecycle: 'archived', archivedAt: ARCHIVED,
      stateChangedAt: ARCHIVED, updatedAt: ARCHIVE_RECORDED,
    };
    context.store.create(record, creationAudit(record), 0);
    const baseline = snapshot(context);
    assert.deepEqual(await restore(context.base, 'Bearer restorer', restoreBody({
      expectedRevision: 1,
    })), { status: 404, body: { error: 'not_found' } });
    assert.deepEqual(snapshot(context), baseline);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test('restore rejects invalid lifecycle proofs and malformed archive provenance', async (t) => {
  const cases = [
    ['blocked-prior', (event) => ({
      ...event,
      changedFields: { ...event.changedFields, lifecycle: { prior: 'blocked', next: 'archived' } },
    })],
    ['missing-authorization', (event) => { delete event.authorizationId; return event; }],
    ['wrong-source', (event) => ({ ...event, sourceId: 'id_9999999999999999' })],
    ['wrong-prior-revision', (event) => ({ ...event, priorRevision: 0 })],
    ['noncanonical-recorded-time', (event) => ({ ...event, recordedAt: 'not-a-time' })],
    ['unknown-field', (event) => ({ ...event, invented: true })],
    ['unknown-changed-field', (event) => ({
      ...event, changedFields: { ...event.changedFields, title: { prior: 'a', next: 'b' } },
    })],
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => {
      const context = await fixture({
        identities: { 'Bearer restorer': identity(['record.restore']) },
      });
      try {
        seedArchived(context);
        replaceArchiveEvent(context, change);
        const baseline = snapshot(context);
        assert.deepEqual(await restore(context.base, 'Bearer restorer'), {
          status: 404, body: { error: 'not_found' },
        });
        assert.deepEqual(snapshot(context), baseline);
      } finally {
        await context.close();
      }
    });
  }
});
